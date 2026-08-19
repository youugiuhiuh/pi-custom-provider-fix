import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderConfig } from "./types";
import { mergeProviderCompat, providerCompatKeys, usesAuthHeader } from "./types";
import { readConfig, writeConfig, addProvider, removeProvider, mergeSelectedModels } from "./models-config";
import { discoverModels, recommendModel } from "./discovery";
import { createWizardState, renderWizard, handleWizardInput } from "./wizard";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("provider-setup", {
    description: "Manage custom LLM providers and models",
    handler: async (_a, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("TUI only", "error");
        return;
      }
      await run(ctx);
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
function tri(v: unknown): number {
  return v === true ? 1 : v === false ? 2 : 0;
}
const IDX: Record<string, number> = {
  "openai-completions": 0,
  "openai-responses": 1,
  "anthropic-messages": 2,
  "google-generative-ai": 3,
  "mistral-conversations": 4,
  "azure-openai-responses": 5,
  "openai-codex-responses": 6,
  "bedrock-converse-stream": 7,
  "google-vertex": 8,
};

async function run(ctx: ExtensionContext) {
  const cfg = readConfig();
  const existing = Object.entries(cfg.providers).map(([id, p]) => ({ id, modelCount: p.models?.length || 0 }));
  const s = createWizardState(existing);

  const toModels = () =>
    s.discoveredModels
      .filter((m) => m.selected)
      .map((m) => ({
        id: m.id,
        name: m.name !== m.id ? m.name : undefined,
        reasoning: m.reasoning || undefined,
        input: m.input,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        cost: m.cost,
        thinkingLevelMap: m.thinkingLevelMap as any,
        compat: m.compat as any,
      }));

  const doDiscover = async () => {
    const cfg = readConfig().providers[s.providerId];
    const key = readAuthKey(s.providerId) || s.apiKey || cfg?.apiKey || undefined;
    try {
      const models = await discoverModels(s.providerId, { baseUrl: s.baseUrl, api: s.apiType, models: [] }, key);
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
    } catch (err) {
      s.discoveryStatus = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    s.discoveryLoading = false;
    s.step = "select_models";
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
    s.apiType = p.api;
    s.apiTypeIdx = IDX[p.api] ?? 0;
    s.baseUrl = p.baseUrl;
    s.apiKey = p.apiKey || "";
    s.discoveredModels = (p.models || []).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      reasoning: m.reasoning || false,
      input: m.input || ["text"],
      contextWindow: m.contextWindow || 128000,
      maxTokens: m.maxTokens || 16384,
      cost: m.cost,
      thinkingLevelMap: m.thinkingLevelMap,
      compat: m.compat as any,
      selected: true,
      edited: false,
    }));
    s.modelCursor = 0;
    s.selectModelsFrom = "edit_models";
    s.step = "select_models";
  };

  const saveModels = () => {
    const cfg = readConfig();
    const p = cfg.providers[s.providerId] || { baseUrl: s.baseUrl, api: s.apiType, apiKey: s.apiKey, models: [] };
    const models = mergeSelectedModels(p.models || [], s.discoveredModels);
    writeConfig(
      addProvider(cfg, s.providerId, {
        ...p,
        models,
      }),
    );
    s.existingProviders = Object.entries(readConfig().providers).map(([id, p]) => ({
      id,
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
    s.apiType = p.api;
    s.apiTypeIdx = IDX[p.api] ?? 0;
    s.baseUrl = p.baseUrl;
    s.apiKey = p.apiKey || "";
    s.mfAuth = p.authHeader === false ? 2 : p.authHeader === true ? 1 : 0;
    const keys = providerCompatKeys(p.api);
    s.mfDevRole = tri(keys.developerRole ? p.compat?.[keys.developerRole] : undefined);
    s.mfReasonEffort = tri(keys.reasoningEffort ? p.compat?.[keys.reasoningEffort] : undefined);
    s.mfStrict = tri(keys.strict ? p.compat?.[keys.strict] : undefined);
    s.mfHeaders = p.headers ? JSON.stringify(p.headers) : "";
    s.mfIdx = 0;
    s.step = "manage_config";
  };

  const saveConfig = () => {
    const p = readConfig().providers[s.providerId];
    if (!p) return;
    const c = mergeProviderCompat(p.compat, s.apiType, {
      developerRole: s.mfDevRole,
      reasoningEffort: s.mfReasonEffort,
      strict: s.mfStrict,
    });
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
    writeConfig(
      addProvider(readConfig(), s.providerId, {
        ...p,
        baseUrl: s.baseUrl,
        api: s.apiType,
        apiKey: s.apiKey || p.apiKey,
        authHeader: s.mfAuth === 2 ? false : s.mfAuth === 1 ? true : undefined,
        compat: c,
        headers: h,
      }),
    );
    s.existingProviders = Object.entries(readConfig().providers).map(([id, p]) => ({
      id,
      modelCount: p.models?.length || 0,
    }));
    s.statusMessage = "Config saved.";
    s.statusType = "success";
    s.step = "select_models";
  };

  const deleteProvider = (id: string) => {
    const cfg = readConfig();
    if (!Object.prototype.hasOwnProperty.call(cfg.providers, id)) {
      s.statusMessage = `Provider "${id}" not found`;
      s.statusType = "error";
      s.step = "choose_provider";
      return;
    }
    writeConfig(removeProvider(cfg, id));
    s.existingProviders = Object.entries(readConfig().providers).map(([providerId, p]) => ({
      id: providerId,
      modelCount: p.models?.length || 0,
    }));
    s.chosenProviderIdx = s.existingProviders.length
      ? Math.min(s.chosenProviderIdx, s.existingProviders.length - 1)
      : -1;
    s.providerId = "";
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
    function handleInput(d: string) {
      const a = handleWizardInput(s, d);
      if (!a) return;
      switch (a.type) {
        case "close":
          done();
          break;
        case "render":
          refresh();
          break;
        case "discover":
          s.discoveryLoading = true;
          s.discoveryStatus = "Contacting API...";
          refresh();
          (async () => {
            await doDiscover();
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
          (() => {
            const sel = s.discoveredModels.filter((m) => m.selected);
            writeConfig(
              addProvider(readConfig(), s.providerId, {
                baseUrl: s.baseUrl,
                api: s.apiType,
                apiKey: s.apiKey || readConfig().providers[s.providerId]?.apiKey || undefined,
                authHeader: usesAuthHeader(s.apiType),
                models: toModels(),
              }),
            );
            s.existingProviders = Object.entries(readConfig().providers).map(([id, p]) => ({
              id,
              modelCount: p.models?.length || 0,
            }));
            s.statusMessage = `Saved ${sel.length} model(s).`;
            s.statusType = "success";
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
          saveConfig();
          refresh();
          break;
        case "save_models":
          saveModels();
          refresh();
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
