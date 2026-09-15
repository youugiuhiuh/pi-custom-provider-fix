import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import type { ProviderConfig } from "./types";
import { usesAuthHeader } from "./types";
import {
  apiChoiceIndex,
  normalizeOAuthProvider,
  normalizeOAuthProviderForApi,
  OAUTH_PROVIDER_CHOICES,
} from "./pi-catalog";
import {
  hasStoredOAuthCredential,
  importPastedOAuthJson,
  loginStoredOAuthProvider,
  resolveOAuthCredential,
} from "./oauth";
import { syncConfiguredProviders } from "./provider-registry";
import {
  readConfig,
  writeConfig,
  repairConfig,
  addProvider,
  removeProvider,
  replaceProvider,
  mergeSelectedModels,
} from "./models-config";
import { discoverCodexOAuthModels, discoverModels, prefetchModelCatalog, recommendModel } from "./discovery";
import { createWizardState, renderWizard, handleWizardInput } from "./wizard";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export default function (pi: ExtensionAPI) {
  syncConfiguredProviders(pi, repairConfig());
  pi.registerCommand("provider-setup", {
    description: "Manage custom LLM providers and models",
    handler: async (_a, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("TUI only", "error");
        return;
      }
      await run(pi, ctx);
    },
  });
}

function readAuthKey(id: string): string | undefined {
  try {
    const d = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
    const p = path.join(d, "auth.json");
    if (!fs.existsSync(p)) return;
    const a = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (a[id]?.type === "api_key") return a[id].key;
  } catch {}
}
function writeAndSync(pi: ExtensionAPI, config: ReturnType<typeof readConfig>): void {
  writeConfig(config);
  syncConfiguredProviders(pi, config);
}

function materializeOAuthJson(
  providerId: string,
  oauthProvider: NonNullable<ProviderConfig["oauthProvider"]>,
  oauthJsonPath: string | undefined,
  oauthJsonRaw: string | undefined,
): string | undefined {
  if (oauthJsonRaw?.trim()) {
    importPastedOAuthJson(providerId, oauthProvider, oauthJsonRaw);
    return undefined;
  }
  const trimmed = oauthJsonPath?.trim();
  return trimmed || undefined;
}

interface AuthInteractionOptions {
  manualCodePromptDelayMs?: number;
  manualCodePrompt?: (prompt: AuthPrompt & { type: "manual_code" }, delayMs: number) => Promise<string | undefined>;
  autoSelectFirst?: boolean;
}

export function createAuthInteraction(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  optionsOrDelay: number | AuthInteractionOptions = {},
): AuthInteraction {
  const options = typeof optionsOrDelay === "number" ? { manualCodePromptDelayMs: optionsOrDelay } : optionsOrDelay;
  const manualCodePromptDelayMs = options.manualCodePromptDelayMs ?? 8_000;
  const controller = new AbortController();
  const abortError = () => new Error("Login prompt canceled.");
  const abortable = <T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> => {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return Promise.race([promise, aborted]).finally(() => {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    });
  };
  const delayedManualCodePrompt = (prompt: AuthPrompt & { type: "manual_code" }): Promise<string | undefined> => {
    const signal = prompt.signal;
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(abortable(ctx.ui.input(prompt.message, prompt.placeholder, signal ? { signal } : undefined), signal));
      }, manualCodePromptDelayMs);
      if (signal) {
        onAbort = () => {
          cleanup();
          reject(abortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  };
  return {
    signal: controller.signal,
    async prompt(prompt: AuthPrompt): Promise<string> {
      if (prompt.type === "select") {
        if (options.autoSelectFirst) {
          const option = prompt.options[0];
          if (!option) throw new Error("Login canceled.");
          return option.id;
        }
        const labels = prompt.options.map((option) =>
          option.description ? `${option.label} (${option.description})` : option.label,
        );
        const selected = await abortable(ctx.ui.select(prompt.message, labels, prompt.signal ? { signal: prompt.signal } : undefined), prompt.signal);
        if (!selected) throw new Error("Login canceled.");
        const index = labels.indexOf(selected);
        const option = prompt.options[index];
        if (!option) throw new Error("Login canceled.");
        return option.id;
      }
      const value =
        prompt.type === "manual_code"
          ? await (options.manualCodePrompt
              ? options.manualCodePrompt(prompt, manualCodePromptDelayMs)
              : delayedManualCodePrompt(prompt))
          : await abortable(
              ctx.ui.input(prompt.message, prompt.placeholder, prompt.signal ? { signal: prompt.signal } : undefined),
              prompt.signal,
            );
      if (value === undefined) throw new Error("Login canceled.");
      return value;
    },
    notify(event: AuthEvent): void {
      if (event.type === "auth_url") {
        void pi.exec("open", [event.url]).catch(() => {});
        ctx.ui.notify(`OAuth login opened in browser.\n${event.url}\nIf it does not finish, paste the redirect URL when prompted.`);
      } else if (event.type === "device_code") {
        ctx.ui.notify(`Open ${event.verificationUri} and enter code ${event.userCode}.`);
      } else {
        ctx.ui.notify(event.message);
      }
    },
  };
}

async function run(pi: ExtensionAPI, ctx: ExtensionContext) {
  const cfg = readConfig();
  const existing = Object.entries(cfg.providers).map(([id, p]) => ({
    id,
    name: p.name,
    modelCount: p.models?.length || 0,
  }));
  const s = createWizardState(existing);
  let refreshView = () => {};
  let submitOAuthManualInput: ((value: string | undefined) => void) | undefined;
  let cancelOAuthManualInput: ((error?: Error) => void) | undefined;

  const selectedOAuthProvider = (cfg: ProviderConfig | undefined) =>
    normalizeOAuthProviderForApi(OAUTH_PROVIDER_CHOICES[s.oauthProviderIdx], s.apiType) ||
    normalizeOAuthProviderForApi(cfg?.oauthProvider, s.apiType);

  const stagedProvider = (cfg: ProviderConfig | undefined, oauthProvider?: ProviderConfig["oauthProvider"], oauthJsonPath?: string): ProviderConfig => ({
    ...(cfg || {}),
    name: s.providerName.trim() || cfg?.name,
    baseUrl: s.baseUrl || cfg?.baseUrl || "",
    api: s.apiType,
    apiKey: oauthProvider ? undefined : s.apiKey || cfg?.apiKey || undefined,
    oauthProvider,
    oauthJsonPath,
    models: cfg?.models || [],
  });

  const clearOAuthManualPrompt = () => {
    s.oauthManualVisible = false;
    s.oauthManualMessage = "";
    s.oauthManualPlaceholder = "";
    s.oauthManualInput = "";
    submitOAuthManualInput = undefined;
    cancelOAuthManualInput = undefined;
  };

  const promptOAuthManualCode = (prompt: AuthPrompt & { type: "manual_code" }, delayMs: number): Promise<string | undefined> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const signal = prompt.signal;
      const finish = (value: string | undefined) => {
        if (settled) return;
        settled = true;
        cleanup();
        clearOAuthManualPrompt();
        refreshView();
        resolve(value);
      };
      const fail = (error = new Error("Login prompt canceled.")) => {
        if (settled) return;
        settled = true;
        cleanup();
        clearOAuthManualPrompt();
        refreshView();
        reject(error);
      };
      const onAbort = () => fail();
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      if (signal?.aborted) {
        fail();
        return;
      }
      cancelOAuthManualInput?.();
      const timer = setTimeout(() => {
        if (settled) return;
        s.oauthManualVisible = true;
        s.oauthManualMessage = prompt.message;
        s.oauthManualPlaceholder = prompt.placeholder || "";
        s.oauthManualInput = "";
        submitOAuthManualInput = finish;
        cancelOAuthManualInput = fail;
        refreshView();
      }, delayMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  const handleOAuthManualInput = (data: string): boolean => {
    if (!s.oauthManualVisible) return false;
    if (data === "\x1b" || data === "\x03") {
      cancelOAuthManualInput?.();
      return true;
    }
    if (data === "\x15") {
      s.oauthManualInput = "";
      refreshView();
      return true;
    }
    if (data === "\r" || data === "\n") {
      const value = s.oauthManualInput.trim();
      if (!value) {
        s.statusMessage = "Paste the authorization code or redirect URL before submitting.";
        s.statusType = "error";
        refreshView();
        return true;
      }
      submitOAuthManualInput?.(value);
      return true;
    }
    if (data === "\x7f" || data === "\b") {
      s.oauthManualInput = s.oauthManualInput.slice(0, -1);
      refreshView();
      return true;
    }
    const clean = data.replace(/\x1b\[[0-9;]*[~a-zA-Z]/g, "").replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "");
    if (clean) {
      s.oauthManualInput += clean;
      s.statusMessage = "";
      refreshView();
    }
    return true;
  };

  const prepareDiscoveryAuth = async (forceOAuthLogin = false) => {
    const cfg = readConfig().providers[s.providerId];
    const oauthProvider = selectedOAuthProvider(cfg);
    let oauthJsonPath = s.oauthJsonPath || cfg?.oauthJsonPath;
    if (!oauthProvider) {
      return {
        provider: stagedProvider(cfg),
        key: s.apiKey || cfg?.apiKey || readAuthKey(s.providerId) || undefined,
      };
    }

    if (s.oauthJsonRaw) {
      oauthJsonPath = materializeOAuthJson(s.providerId, oauthProvider, s.oauthJsonPath, s.oauthJsonRaw);
      s.oauthJsonPath = oauthJsonPath || "";
      s.oauthJsonRaw = "";
    }

    const provider = stagedProvider(cfg, oauthProvider, oauthJsonPath);
    if (!oauthJsonPath && (forceOAuthLogin || !hasStoredOAuthCredential(s.providerId))) {
      s.discoveryStatus = `Logging in ${s.providerId}...`;
      await loginStoredOAuthProvider(
        s.providerId,
        provider,
        oauthProvider,
        createAuthInteraction(pi, ctx, {
          autoSelectFirst: true,
          manualCodePrompt: promptOAuthManualCode,
        }),
      );
      clearOAuthManualPrompt();
      s.discoveryStatus = "OAuth completed. Discovering models...";
      refreshView();
    }

    s.discoveryStatus = "Discovering models...";
    refreshView();
    const credential = await resolveOAuthCredential(s.providerId, provider, oauthProvider, oauthJsonPath);
    if (!credential?.access) throw new Error(`${s.providerId} OAuth credential is not configured.`);
    return {
      provider,
      oauthProvider,
      accountId: typeof credential.accountId === "string" ? credential.accountId : undefined,
      key: credential.access,
    };
  };

  const doDiscover = async (forceOAuthLogin = false) => {
    try {
      const { provider, oauthProvider, key, accountId } = await prepareDiscoveryAuth(forceOAuthLogin);
      const models =
        oauthProvider === "openai-codex" && key
          ? await discoverCodexOAuthModels(s.providerId, provider, key, accountId)
          : await discoverModels(s.providerId, provider, key);
      const existing = new Set(s.discoveredModels.map((x) => x.id));
      const novel = models
        .filter((x) => !existing.has(x.id))
        .map((m) => ({
          ...m,
          selected: false,
          edited: false,
          input: m.input || ["text"],
          contextWindow: m.contextWindow || 128000,
          maxTokens: m.maxTokens || 16384,
          reasoning: m.reasoning || false,
        }));
      s.discoveredModels = [...s.discoveredModels, ...novel];
      s.discoveryStatus = `Found ${novel.length} new model(s)`;
      s.discoveryLoading = false;
      s.step = "select_models";
    } catch (err) {
      const message = `Failed: ${err instanceof Error ? err.message : String(err)}`;
      s.discoveryStatus = message;
      s.statusMessage = message;
      s.statusType = "error";
      s.step = selectedOAuthProvider(readConfig().providers[s.providerId]) ? "oauth_json_path" : "api_key";
      s.discoveryLoading = false;
    }
  };

  const loadModels = (id: string) => {
    const p = readConfig().providers[id];
    if (!p) {
      s.statusMessage = `Provider "${id}" not found`;
      s.statusType = "error";
      s.step = "choose_provider";
      return;
    }
    s.providerId = id;
    s.providerOriginalId = id;
    s.providerName = p.name || "";
    s.apiType = p.api;
    s.apiTypeIdx = apiChoiceIndex(p.api);
    s.baseUrl = p.baseUrl;
    s.apiKey = p.apiKey || readAuthKey(id) || "";
    s.oauthProviderIdx = OAUTH_PROVIDER_CHOICES.indexOf(normalizeOAuthProvider(p.oauthProvider) || "none");
    if (s.oauthProviderIdx < 0) s.oauthProviderIdx = 0;
    s.oauthJsonPath = p.oauthJsonPath || "";
    s.oauthJsonRaw = "";
    s.discoveredModels = (p.models || []).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      baseUrl: m.baseUrl,
      reasoning: m.reasoning || false,
      input: m.input || ["text"],
      contextWindow: m.contextWindow || 128000,
      maxTokens: m.maxTokens || 16384,
      cost: m.cost,
      headers: m.headers,
      thinkingLevelMap: m.thinkingLevelMap,
      compat: m.compat as any,
      selected: true,
      edited: false,
    }));
    s.modelCursor = 0;
    s.modelFilter = "";
    s.modelFiltering = false;
    s.addingCustom = false;
    s.selectModelsFrom = "edit_models";
    s.step = "select_models";
  };

  const saveModels = async () => {
    const cfg = readConfig();
    const p = cfg.providers[s.providerId] || { baseUrl: s.baseUrl, api: s.apiType, apiKey: s.apiKey, models: [] };
    const models = mergeSelectedModels(p.models || [], s.discoveredModels);
    const oauthProvider = selectedOAuthProvider(p);
    let oauthJsonPath: string | undefined;
    try {
      oauthJsonPath = oauthProvider ? materializeOAuthJson(s.providerId, oauthProvider, s.oauthJsonPath || p.oauthJsonPath, s.oauthJsonRaw) : undefined;
    } catch (err) {
      s.statusMessage = err instanceof Error ? err.message : String(err);
      s.statusType = "error";
      return;
    }
    const apiKey = oauthProvider ? undefined : s.apiKey || p.apiKey || undefined;
    const provider = {
      ...p,
      name: s.providerName.trim() || p.name || undefined,
      baseUrl: s.baseUrl || p.baseUrl,
      api: s.apiType || p.api,
      apiKey,
      oauthProvider,
      oauthJsonPath,
      authHeader: oauthProvider ? p.authHeader : apiKey ? p.authHeader ?? usesAuthHeader(s.apiType) : false,
      models,
    };
    writeAndSync(pi, addProvider(cfg, s.providerId, provider));
    if (oauthJsonPath) s.oauthJsonPath = oauthJsonPath;
    s.oauthJsonRaw = "";
    s.existingProviders = Object.entries(readConfig().providers).map(([id, p]) => ({
      id,
      name: p.name,
      modelCount: p.models?.length || 0,
    }));
    s.statusMessage = `Saved ${models.length} model(s).`;
    s.statusType = "success";
    s.selectModelsFrom = "edit_models";
  };

  const loadConfig = (id: string) => {
    const p = readConfig().providers[id];
    if (!p) return;
    s.providerId = id;
    s.providerOriginalId = id;
    s.providerName = p.name || "";
    s.apiType = p.api;
    s.apiTypeIdx = apiChoiceIndex(p.api);
    s.baseUrl = p.baseUrl;
    s.apiKey = p.apiKey || readAuthKey(id) || "";
    s.mfOAuthProvider = OAUTH_PROVIDER_CHOICES.indexOf(normalizeOAuthProvider(p.oauthProvider) || "none");
    if (s.mfOAuthProvider < 0) s.mfOAuthProvider = 0;
    s.mfOAuthJsonPath = p.oauthJsonPath || "";
    s.mfOAuthJsonRaw = "";
    s.mfAuth = p.authHeader === false ? 2 : p.authHeader === true ? 1 : 0;
    s.mfHeaders = p.headers ? JSON.stringify(p.headers) : "";
    s.mfIdx = 0;
    s.step = "manage_config";
  };

  const saveConfig = async () => {
    const config = readConfig();
    const previousId = s.providerOriginalId || s.providerId;
    const nextId = s.providerId.trim();
    if (!nextId) {
      s.statusMessage = "Provider ID is required.";
      s.statusType = "error";
      return;
    }
    if (nextId !== previousId && config.providers[nextId]) {
      s.statusMessage = `Provider "${nextId}" already exists.`;
      s.statusType = "error";
      return;
    }
    const p = config.providers[previousId];
    if (!p) return;
    let h: Record<string, string> | undefined;
    if (s.mfHeaders.trim()) {
      try {
        h = JSON.parse(s.mfHeaders);
      } catch {
        s.statusMessage = "Invalid JSON";
        s.statusType = "error";
        return;
      }
    }
    const oauthProvider = normalizeOAuthProviderForApi(OAUTH_PROVIDER_CHOICES[s.mfOAuthProvider], s.apiType);
    let oauthJsonPath: string | undefined;
    try {
      oauthJsonPath = oauthProvider ? materializeOAuthJson(nextId, oauthProvider, s.mfOAuthJsonPath, s.mfOAuthJsonRaw) : undefined;
    } catch (err) {
      s.statusMessage = err instanceof Error ? err.message : String(err);
      s.statusType = "error";
      return;
    }
    const apiKey = oauthProvider ? undefined : s.apiKey || undefined;
    const explicitAuthHeader = s.mfAuth === 2 ? false : s.mfAuth === 1 ? true : undefined;
    const nextProvider = {
      ...p,
      name: s.providerName.trim() || undefined,
      baseUrl: s.baseUrl,
      api: s.apiType,
      apiKey,
      oauthProvider,
      oauthJsonPath,
      authHeader: oauthProvider || apiKey ? explicitAuthHeader : false,
      headers: h,
    };
    writeAndSync(
      pi,
      replaceProvider(config, previousId, nextId, nextProvider),
    );
    s.providerId = nextId;
    s.providerOriginalId = nextId;
    if (oauthJsonPath) s.mfOAuthJsonPath = oauthJsonPath;
    s.mfOAuthJsonRaw = "";
    s.existingProviders = Object.entries(readConfig().providers).map(([id, p]) => ({
      id,
      name: p.name,
      modelCount: p.models?.length || 0,
    }));
    s.statusMessage = "Saved automatically.";
    s.statusType = "success";
  };

  const deleteProvider = (id: string) => {
    const cfg = readConfig();
    if (!Object.prototype.hasOwnProperty.call(cfg.providers, id)) {
      s.statusMessage = `Provider "${id}" not found`;
      s.statusType = "error";
      s.step = "choose_provider";
      return;
    }
    writeAndSync(pi, removeProvider(cfg, id));
    s.existingProviders = Object.entries(readConfig().providers).map(([providerId, p]) => ({
      id: providerId,
      name: p.name,
      modelCount: p.models?.length || 0,
    }));
    s.chosenProviderIdx = s.existingProviders.length
      ? Math.min(s.chosenProviderIdx, s.existingProviders.length - 1)
      : -1;
    s.providerId = "";
    s.providerOriginalId = "";
    s.providerName = "";
    s.discoveredModels = [];
    s.statusMessage = `Deleted provider "${id}".`;
    s.statusType = "success";
    s.step = "choose_provider";
  };

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    let cw = 0,
      cl: string[] = [];
    const render = (w: number) => (cl.length && cw === w ? cl : ((cw = w), (cl = renderWizard(s, w, theme)), cl));
    const refresh = () => {
      cl = [];
      tui.requestRender();
    };
    refreshView = refresh;
    function handleInput(d: string) {
      if (handleOAuthManualInput(d)) return;
      const a = handleWizardInput(s, d);
      if (!a) return;
      switch (a.type) {
        case "close":
          done();
          break;
        case "render":
          refresh();
          break;
        case "prefetch_presets":
          refresh();
          prefetchModelCatalog().then(refresh, refresh);
          break;
        case "discover":
          s.discoveryLoading = true;
          s.discoveryStatus = "Contacting API...";
          refresh();
          (async () => {
            await doDiscover(Boolean((a.payload as { forceOAuthLogin?: boolean } | undefined)?.forceOAuthLogin));
            refresh();
          })();
          break;
        case "discover_edit":
          (async () => {
            s.selectModelsFrom = "discover";
            s.discoveryLoading = true;
            s.discoveryStatus = "Contacting API...";
            s.step = "discovering";
            refresh();
            await doDiscover();
            refresh();
          })();
          break;
        case "save":
          (async () => {
            await saveModels();
            refresh();
          })();
          break;
        case "load_models":
          loadModels(a.payload as string);
          refresh();
          break;
        case "load_config":
          loadConfig(a.payload as string);
          refresh();
          break;
        case "save_config":
          (async () => {
            await saveConfig();
            refresh();
          })();
          break;
        case "save_models":
          (async () => {
            await saveModels();
            refresh();
          })();
          break;
        case "delete_provider":
          deleteProvider(a.payload as string);
          refresh();
          break;
        case "review":
          s.step = "review";
          refresh();
          break;
        case "discover_custom":
          (async () => {
            const id = a.payload as string;
            s.statusMessage = `Looking up ${id}...`;
            s.statusType = "info";
            refresh();
            try {
              const found = await recommendModel(id, s.providerId, {
                baseUrl: s.baseUrl,
                api: s.apiType,
                models: [],
              });
              const model = s.discoveredModels.find((item) => item.id === id);
              if (found && model) {
                model.name = found.name;
                model.reasoning = found.reasoning || false;
                model.input = found.input || ["text"];
                model.contextWindow = found.contextWindow || 128000;
                model.maxTokens = found.maxTokens || 16384;
                model.cost = found.cost;
                model.thinkingLevelMap = found.thinkingLevelMap;
                model.compat = found.compat;
                model.suggestedBy = found.suggestedBy;
                s.statusMessage = `Filled ${id} from Pi/model catalog.`;
              } else {
                s.statusMessage = `Model ${id} not in catalog, using defaults.`;
              }
              s.statusType = "success";
            } catch {
              s.statusMessage = "Catalog lookup failed, using defaults.";
              s.statusType = "warning";
            }
            if (s.providerOriginalId) await saveModels();
            refresh();
          })();
          break;
      }
    }
    return {
      render,
      handleInput,
      invalidate: () => {
        cl = [];
      },
    };
  });
  if (s.statusMessage) ctx.ui.notify(s.statusMessage, s.statusType === "error" ? "error" : "info");
}
