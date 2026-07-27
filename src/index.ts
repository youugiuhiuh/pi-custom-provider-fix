/**
 * pi-custom-provider — Interactive wizard to add/manage custom LLM providers
 * Usage: /provider-setup
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderConfig, ModelConfig, DiscoveredModel } from "./types";
import { usesAuthHeader } from "./types";
import { readConfig, writeConfig, addProvider } from "./models-config";
import { discoverModels } from "./discovery";
import { createWizardState, renderWizard, handleWizardInput } from "./wizard";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("provider-setup", {
    description: "Interactive wizard to add, discover, and manage custom LLM providers",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") { ctx.ui.notify("Provider setup requires interactive mode", "error"); return; }
      await runWizard(ctx);
    },
  });
}

async function runWizard(ctx: ExtensionContext) {
  const cfg = readConfig();
  const existing = Object.entries(cfg.providers).map(([id, p]) => ({ id, modelCount: p.models?.length || 0 }));
  const state = createWizardState(existing);

  const suggestId = () => {
    if (state.providerId) return;
    try {
      const parts = new URL(state.baseUrl).hostname.split(".");
      const skip = new Set(["api","llm","www","com","net","org","ai","cn","io"]);
      for (const p of parts) if (!skip.has(p.toLowerCase())) { state.providerId = p.toLowerCase(); return; }
      state.providerId = parts[0]?.toLowerCase() || "custom";
    } catch { state.providerId = "custom"; }
  };

  const doDiscover = async () => {
    state.discoveryLoading = true; state.discoveryStatus = "Contacting provider API...";
    const prov: ProviderConfig = { baseUrl: state.baseUrl, api: state.apiType, apiKey: state.apiKey || undefined, models: [] };
    try {
      const models = await discoverModels(state.providerId, prov, state.apiKey);
      state.discoveredModels = models.map(m => ({ ...m, selected: true, edited: false, input: m.input || ["text"], contextWindow: m.contextWindow || 128000, maxTokens: m.maxTokens || 16384, reasoning: m.reasoning || false }));
      state.modelAllSelected = true;
      state.discoveryStatus = `Discovered ${models.length} model(s)`;
    } catch (err) {
      state.discoveryStatus = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    state.discoveryLoading = false; state.step = "select_models";
  };

  const doSave = () => {
    const cfg = readConfig();
    const sel = state.discoveredModels.filter(m => m.selected);
    const models: ModelConfig[] = sel.map(m => ({
      id: m.id, name: m.name !== m.id ? m.name : undefined, reasoning: m.reasoning || undefined,
      input: m.input, contextWindow: m.contextWindow, maxTokens: m.maxTokens,
      cost: m.cost, thinkingLevelMap: m.thinkingLevelMap as ModelConfig["thinkingLevelMap"],
    }));
    writeConfig(addProvider(cfg, state.providerId, {
      baseUrl: state.baseUrl, api: state.apiType, apiKey: state.apiKey || undefined,
      authHeader: usesAuthHeader(state.apiType), models,
    }));
    state.statusMessage = `✅ Provider "${state.providerId}" saved with ${models.length} model(s). Use /model to select.`;
    state.statusType = "success";
  };

  const loadProvider = async (id: string) => {
    const cfg = readConfig(); const p = cfg.providers[id]; if (!p) return;
    state.apiType = p.api; state.apiTypeIdx = API_TYPE_INDEX[p.api] ?? 0;
    state.baseUrl = p.baseUrl; state.apiKey = p.apiKey || ""; state.providerId = id;
    // Discovery mode: go straight to discovering
    state.discoveryLoading = true; state.discoveryStatus = "Contacting provider API..."; state.step = "discovering";
    await doDiscover();
  };

  const loadManage = (id: string) => {
    const cfg = readConfig(); const p = cfg.providers[id]; if (!p) return;
    state.providerId = id; state.apiType = p.api; state.apiTypeIdx = API_TYPE_INDEX[p.api] ?? 0;
    state.baseUrl = p.baseUrl; state.apiKey = p.apiKey || "";
    state.manageAuthHeader = p.authHeader === false ? 2 : p.authHeader === true ? 1 : 0;
    state.manageCompatDevRole = p.compat?.supportsDeveloperRole === true ? 1 : p.compat?.supportsDeveloperRole === false ? 2 : 0;
    state.manageCompatReasoningEffort = p.compat?.supportsReasoningEffort === true ? 1 : p.compat?.supportsReasoningEffort === false ? 2 : 0;
    state.manageCompatStrictTools = p.compat?.supportsStrictTools === true ? 1 : p.compat?.supportsStrictTools === false ? 2 : 0;
    state.manageHeaders = p.headers ? JSON.stringify(p.headers) : "";
    state.step = "manage_config";
  };

  const doSaveConfig = () => {
    const cfg = readConfig(); const p = cfg.providers[state.providerId]; if (!p) return;
    const compat: Record<string, boolean> = {};
    if (state.manageCompatDevRole === 1) compat.supportsDeveloperRole = true;
    else if (state.manageCompatDevRole === 2) compat.supportsDeveloperRole = false;
    if (state.manageCompatReasoningEffort === 1) compat.supportsReasoningEffort = true;
    else if (state.manageCompatReasoningEffort === 2) compat.supportsReasoningEffort = false;
    if (state.manageCompatStrictTools === 1) compat.supportsStrictTools = true;
    else if (state.manageCompatStrictTools === 2) compat.supportsStrictTools = false;

    let headers: Record<string, string> | undefined;
    if (state.manageHeaders.trim()) { try { headers = JSON.parse(state.manageHeaders); } catch { state.statusMessage = "Invalid JSON in headers"; state.statusType = "error"; return; } }

    const updated: ProviderConfig = { ...p,
      baseUrl: state.baseUrl, api: state.apiType,
      apiKey: state.apiKey || undefined,
      authHeader: state.manageAuthHeader === 2 ? false : state.manageAuthHeader === 1 ? true : undefined,
      compat: Object.keys(compat).length ? compat : undefined,
      headers,
    };
    writeConfig(addProvider(cfg, state.providerId, updated));
    state.statusMessage = `✅ Provider "${state.providerId}" updated.`;
    state.statusType = "success"; state.step = "main_menu";
  };

  // ── TUI loop ─────────────────────────────────────────────────

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    let cw = 0, cl: string[] = [];
    const render = (w: number) => (cl.length && cw === w) ? cl : (cw = w, cl = renderWizard(state, w, theme), cl);
    const refresh = () => { cl = []; tui.requestRender(); };

    function handleInput(data: string) {
      const a = handleWizardInput(state, data); if (!a) return;
      switch (a.type) {
        case "close": done(); break;
        case "render": refresh(); break;
        case "discover":
          suggestId(); refresh();
          (async () => { await doDiscover(); refresh(); })();
          break;
        case "save": doSave(); refresh(); break;
        case "use_existing":
          (async () => { await loadProvider(a.payload as string); refresh(); })();
          break;
        case "load_provider": loadManage(a.payload as string); refresh(); break;
        case "save_config": doSaveConfig(); refresh(); break;
      }
    }

    return { render, handleInput, invalidate: () => { cl = []; } };
  });

  if (state.statusMessage) ctx.ui.notify(state.statusMessage, state.statusType === "error" ? "error" : "info");
}

const API_TYPE_INDEX: Record<string, number> = {
  "openai-completions": 0, "openai-responses": 1, "anthropic-messages": 2, "google-generative-ai": 3,
  "mistral-conversations": 4, "azure-openai-responses": 5, "openai-codex-responses": 6, "bedrock-converse-stream": 7, "google-vertex": 8,
};
