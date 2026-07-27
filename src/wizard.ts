// Interactive provider setup wizard — single /provider-setup command
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme, KnownApi, ThinkingLevelMap } from "@earendil-works/pi-coding-agent";
import type { ModelAPI, ModelCost } from "./types";

// ─── Types ───────────────────────────────────────────────────────

export type WizardStep = "main_menu" | "choose_provider" | "api_type" | "base_url" | "api_key" | "provider_id" | "discovering" | "select_models" | "edit_model" | "review" | "manage_config";

export interface WizardModelItem {
  id: string; name: string; reasoning: boolean; input: string[];
  contextWindow: number; maxTokens: number; cost?: ModelCost;
  thinkingLevelMap?: ThinkingLevelMap; selected: boolean; edited: boolean;
}

export interface WizardState {
  step: WizardStep;
  // Main menu
  mainMenuIdx: number;
  // Existing providers
  existingProviders: Array<{ id: string; modelCount: number }>;
  // Choose provider
  chosenProviderIdx: number; // -1 = "create new"
  chooseMode: "discover" | "manage";
  // Config
  apiType: ModelAPI; apiTypeIdx: number;
  baseUrl: string; baseUrlSuggestions: string[]; baseUrlSuggestionIdx: number;
  apiKey: string; providerId: string;
  // Manage config fields
  manageFieldIdx: number;
  manageCompatDevRole: number; manageCompatReasoningEffort: number; manageCompatStrictTools: number;
  manageAuthHeader: number; manageHeaders: string;
  // Models
  discoveredModels: WizardModelItem[];
  modelCursor: number; modelFilter: string; modelShowSelectedOnly: boolean; modelAllSelected: boolean;
  discoveryStatus: string; discoveryLoading: boolean;
  editingModelIdx: number; editFieldIdx: number;
  editContextWindow: string; editMaxTokens: string;
  editReasoning: number; editImageInput: number;
  editCostInput: string; editCostOutput: string;
  // Messages
  statusMessage: string; statusType: "info" | "success" | "error" | "";
}

export interface WizardAction { type: string; payload?: unknown }

// ─── API type data (derived from pi's KnownApi) ──────────────────

// All known APIs minus internal pi-messages
const API_TYPES: ModelAPI[] = ([
  "openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai",
  "mistral-conversations", "azure-openai-responses", "openai-codex-responses",
  "bedrock-converse-stream", "google-vertex",
] as KnownApi[]).filter(a => a !== "pi-messages") as ModelAPI[];

const API_LABELS: Record<string, string> = {
  "openai-completions": "OpenAI Chat Completions — most compatible (Ollama/OpenRouter/Groq/Together/DeepSeek/Fireworks...)",
  "openai-responses": "OpenAI Responses API — newer OpenAI protocol",
  "anthropic-messages": "Anthropic Messages API — Claude models, custom Anthropic proxies",
  "google-generative-ai": "Google Generative AI — Gemini models, AI Studio",
  "mistral-conversations": "Mistral Conversations API — Mistral-specific protocol",
  "azure-openai-responses": "Azure OpenAI Responses — Azure-hosted OpenAI",
  "openai-codex-responses": "OpenAI Codex Responses — Codex CLI plugin protocol",
  "bedrock-converse-stream": "Amazon Bedrock Converse Stream — AWS-hosted models",
  "google-vertex": "Google Vertex AI — enterprise Gemini on GCP",
};

const BASE_URLS: Record<string, string[]> = {
  "openai-completions": ["https://api.openai.com/v1", "http://localhost:11434/v1", "https://openrouter.ai/api/v1", "https://api.deepseek.com/v1", "https://api.groq.com/openai/v1", "https://api.together.xyz/v1", "https://api.mistral.ai/v1", "https://api.fireworks.ai/inference/v1", "https://api.x.ai/v1", "https://api.cerebras.ai/v1", "http://localhost:1234/v1", "http://localhost:8080/v1"],
  "openai-responses": ["https://api.openai.com/v1"],
  "anthropic-messages": ["https://api.anthropic.com"],
  "google-generative-ai": ["https://generativelanguage.googleapis.com/v1beta"],
  "mistral-conversations": ["https://api.mistral.ai/v1"],
  "azure-openai-responses": ["https://YOUR_RESOURCE.openai.azure.com"],
  "openai-codex-responses": ["https://api.openai.com/v1"],
  "bedrock-converse-stream": ["https://bedrock-runtime.REGION.amazonaws.com"],
  "google-vertex": ["https://REGION-aiplatform.googleapis.com/v1"],
};

// ─── Theme helpers ───────────────────────────────────────────────

type Th = ReturnType<typeof makeTheme>;
function makeTheme(t: Theme) {
  return {
    dim: (s: string) => t.fg("dim", s), muted: (s: string) => t.fg("muted", s),
    accent: (s: string) => t.fg("accent", s), success: (s: string) => t.fg("success", s),
    error: (s: string) => t.fg("error", s), warning: (s: string) => t.fg("warning", s),
    bold: (s: string) => t.bold(s), text: (s: string) => t.fg("text", s),
    selectedBg: (s: string) => t.bg("selectedBg", t.fg("text", ` ${s} `)),
  };
}

function ft(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

// ─── Factory ─────────────────────────────────────────────────────

export function createWizardState(existingProviders: Array<{ id: string; modelCount: number }> = []): WizardState {
  return {
    step: "main_menu", mainMenuIdx: 0,
    existingProviders, chosenProviderIdx: existingProviders.length > 0 ? 0 : -1, chooseMode: "discover",
    apiType: "openai-completions", apiTypeIdx: 0,
    baseUrl: "", baseUrlSuggestions: BASE_URLS["openai-completions"], baseUrlSuggestionIdx: 0,
    apiKey: "", providerId: "",
    manageFieldIdx: 0, manageCompatDevRole: 0, manageCompatReasoningEffort: 0, manageCompatStrictTools: 0, manageAuthHeader: 0, manageHeaders: "",
    discoveredModels: [], modelCursor: 0, modelFilter: "", modelShowSelectedOnly: false, modelAllSelected: false,
    discoveryStatus: "", discoveryLoading: false,
    editingModelIdx: -1, editFieldIdx: 0, editContextWindow: "", editMaxTokens: "", editReasoning: 0, editImageInput: 0, editCostInput: "", editCostOutput: "",
    statusMessage: "", statusType: "",
  };
}

// ─── Render ──────────────────────────────────────────────────────

export function renderWizard(state: WizardState, width: number, theme: Theme): string[] {
  const lines: string[] = [];
  const w = Math.max(1, width);
  const th = makeTheme(theme);
  const wrap = (t: string) => { lines.push(...wrapTextWithAnsi(t, w)); };
  const hr = () => { lines.push(th.accent("─".repeat(w))); };

  // Status
  if (state.statusMessage) {
    const c = state.statusType === "error" ? th.error : state.statusType === "success" ? th.success : th.warning;
    wrap(c(`  ${state.statusMessage}`));
  }

  hr();

  switch (state.step) {
    case "main_menu":      renderMainMenu(state, wrap, th); break;
    case "choose_provider":renderChooseProvider(state, wrap, th); break;
    case "api_type":       renderApiType(state, wrap, th); break;
    case "base_url":       renderBaseUrl(state, wrap, th); break;
    case "api_key":        renderApiKey(state, wrap, th); break;
    case "provider_id":    renderProviderId(state, wrap, th); break;
    case "discovering":    renderDiscovering(state, wrap, th); break;
    case "select_models":  renderSelectModels(state, wrap, th); break;
    case "edit_model":     renderEditModel(state, wrap, th); break;
    case "review":         renderReview(state, wrap, th); break;
    case "manage_config":  renderManageConfig(state, wrap, th); break;
  }

  wrap("");
  hr();
  wrap(th.dim(FOOTERS[state.step] || ""));

  return lines;
}

const FOOTERS: Record<WizardStep, string> = {
  main_menu:        "  ↑↓ choose  •  Enter confirm  •  Esc quit",
  choose_provider:  "  ↑↓ select  •  Enter confirm  •  Esc back",
  api_type:         "  ↑↓ navigate  •  Enter confirm  •  Esc back",
  base_url:         "  Type to edit  •  ↑↓ suggestions  •  Enter/Space pick  •  Tab next  •  Esc back",
  api_key:          "  Type key  •  Tab next  •  Esc back",
  provider_id:      "  Type ID  •  Tab discover  •  Esc back",
  discovering:      "  ...",
  select_models:    "  Space=toggle  •  a=all  •  e=edit  •  /=filter  •  s=selected  •  r=rediscover  •  Tab=review  •  Esc=back",
  edit_model:       "  ↑↓ field  •  ←→ toggle  •  type numbers  •  Enter save  •  Esc cancel",
  review:           "  Enter save  •  Esc back",
  manage_config:    "  ↑↓ field  •  ←→ change  •  type to edit  •  Tab save  •  Esc back",
};

// ─── Step renderers ──────────────────────────────────────────────

function menuItem(wrap: (t: string) => void, th: Th, label: string, isCur: boolean) {
  wrap(`${isCur ? th.accent("▶ ") : "  "}${isCur ? th.bold(label) : label}`);
}

function renderMainMenu(s: WizardState, wrap: (t: string) => void, th: Th) {
  wrap(th.bold("  Provider Setup"));
  wrap(th.muted("  Manage custom LLM providers and models."));
  wrap("");
  menuItem(wrap, th, "Add / Discover Models — Add models to a new or existing provider", s.mainMenuIdx === 0);
  if (s.existingProviders.length > 0) {
    menuItem(wrap, th, `Manage Provider Config — Edit API type, base URL, API key, compat, headers`, s.mainMenuIdx === 1);
  } else {
    wrap(th.dim(`  Manage Provider Config — (no providers configured yet)`));
  }
  if (s.existingProviders.length > 0) {
    wrap("");
    wrap(th.muted("  Configured providers:"));
    s.existingProviders.forEach(p => wrap(th.dim(`    • ${p.id} (${p.modelCount} models)`)));
  }
}

function renderChooseProvider(s: WizardState, wrap: (t: string) => void, th: Th) {
  wrap(th.bold(s.chooseMode === "discover" ? "  Add/Discover Models" : "  Manage Provider"));
  wrap(th.muted(s.chooseMode === "discover" ? "  Choose a provider to discover models for, or create a new one." : "  Choose a provider to edit its configuration."));
  wrap("");
  if (s.chooseMode === "discover") {
    menuItem(wrap, th, "➕ Create New Provider", s.chosenProviderIdx === -1);
    s.existingProviders.forEach((p, i) => menuItem(wrap, th, `${p.id} (${p.modelCount} models)`, s.chosenProviderIdx === i));
  } else {
    s.existingProviders.forEach((p, i) => menuItem(wrap, th, `${p.id} (${p.modelCount} models)`, s.chosenProviderIdx === i));
  }
}

function renderApiType(s: WizardState, wrap: (t: string) => void, th: Th) {
  wrap(th.bold("  API Type"));
  wrap(th.muted("  Select the API protocol your provider speaks."));
  wrap("");
  API_TYPES.forEach((api, i) => {
    const isCur = i === s.apiTypeIdx;
    wrap(`${isCur ? th.accent("▶ ") : "  "}${isCur ? th.bold(`${API_LABELS[api]}  (${api})`) : `${API_LABELS[api]}  (${api})`}`);
  });
}

function renderBaseUrl(s: WizardState, wrap: (t: string) => void, th: Th) {
  wrap(th.bold(`  Base URL  (${s.apiType})`));
  wrap(th.muted("  Enter the API endpoint or pick a suggestion."));
  wrap("");
  wrap(th.accent(`  ▶ ${s.baseUrl}${th.dim("█")}`));
  wrap("");
  wrap(th.muted("  Suggestions:"));
  const start = Math.max(0, s.baseUrlSuggestionIdx - 4);
  s.baseUrlSuggestions.slice(start, start + 9).forEach((url, i) => {
    const idx = start + i;
    wrap(`${idx === s.baseUrlSuggestionIdx ? th.accent(" ▶") : "  "} ${idx === s.baseUrlSuggestionIdx ? th.bold(url) : th.dim(url)}`);
  });
}

function renderApiKey(s: WizardState, wrap: (t: string) => void, th: Th) {
  wrap(th.bold("  API Key"));
  wrap(th.muted("  Paste your API key. Supports $ENV_VAR syntax."));
  wrap("");
  wrap(th.accent(`  ▶ ${s.apiKey ? "•".repeat(Math.min(s.apiKey.length, 40)) : "(empty)"}${th.dim("█")}`));
}

function renderProviderId(s: WizardState, wrap: (t: string) => void, th: Th) {
  wrap(th.bold("  Provider ID"));
  wrap(th.muted("  A short unique name (e.g., my-openai, ollama, deepseek)."));
  wrap("");
  wrap(th.accent(`  ▶ ${s.providerId}${th.dim("█")}`));
}

function renderDiscovering(s: WizardState, wrap: (t: string) => void, th: Th) {
  wrap(th.bold("  Discovering Models..."));
  wrap("");
  if (s.discoveryLoading) { wrap(th.muted(`  ${s.discoveryStatus || "Contacting provider API..."}`)); wrap(th.dim("  This may take a few seconds.")); }
  else if (s.discoveryStatus) wrap(th.accent(`  ${s.discoveryStatus}`));
}

function renderSelectModels(s: WizardState, wrap: (t: string) => void, th: Th) {
  const sel = s.discoveredModels.filter(m => m.selected).length;
  wrap(th.bold(`  Select Models (${sel}/${s.discoveredModels.length})`));
  wrap(th.muted("  Space toggle, e edit. Catalog-enriched metadata pre-filled."));
  wrap("");
  const filtered = filteredModels(s);
  if (!filtered.length) { wrap(th.dim("  No models.")); return; }
  const start = Math.max(0, s.modelCursor - 7);
  filtered.slice(start, start + 15).forEach((m, i) => {
    const isCur = start + i === s.modelCursor;
    wrap([
      isCur ? th.accent("▶") : " ", m.selected ? th.success("✓") : th.dim("○"), m.edited ? th.accent("*") : " ",
      m.reasoning ? "🧠" : "  ", m.input.includes("image") ? "🖼️" : "  ",
      isCur ? th.bold(m.id) : m.id, th.dim(` ${ft(m.contextWindow)}ctx`),
      m.cost ? th.dim(` $${m.cost.input}/$${m.cost.output}/M`) : "",
    ].join(""));
  });
  if (filtered.length > 15) wrap(th.dim(`  ... ${s.modelCursor + 1}/${filtered.length}`));
  if (s.modelFilter) { wrap(""); wrap(th.dim(`  Filter: ${s.modelFilter}█`)); }
}

function renderEditModel(s: WizardState, wrap: (t: string) => void, th: Th) {
  const m = s.discoveredModels[s.editingModelIdx]; if (!m) return;
  wrap(th.bold(`  Edit: ${m.id}`));
  wrap("");
  const fields = [
    { l: "Reasoning", v: s.editReasoning === 1 ? "Yes" : "No", t: true },
    { l: "Image Input", v: s.editImageInput === 1 ? "Yes" : "No", t: true },
    { l: "Context Window", v: s.editContextWindow || `${m.contextWindow}`, t: false },
    { l: "Max Tokens", v: s.editMaxTokens || `${m.maxTokens}`, t: false },
    { l: "Cost ($/M input)", v: s.editCostInput || (m.cost ? `${m.cost.input}` : "0"), t: false },
    { l: "Cost ($/M output)", v: s.editCostOutput || (m.cost ? `${m.cost.output}` : "0"), t: false },
  ];
  fields.forEach((f, i) => {
    const focused = i === s.editFieldIdx;
    wrap(`${focused ? th.accent("▶ ") : "  "}${focused ? th.bold(f.l) : f.l}: ${th.accent(f.v)}${focused && f.t ? th.dim(" (← →)") : ""}`);
  });
}

function renderReview(s: WizardState, wrap: (t: string) => void, th: Th) {
  wrap(th.bold("  Review & Save"));
  wrap("");
  wrap(`${th.muted("  Provider:")}  ${th.bold(s.providerId)}`);
  wrap(`${th.muted("  API Type:")}  ${s.apiType}`);
  wrap(`${th.muted("  Base URL:")}  ${s.baseUrl}`);
  wrap(`${th.muted("  API Key:")}   ${s.apiKey ? "•".repeat(Math.min(s.apiKey.length, 20)) : "(not set)"}`);
  const sel = s.discoveredModels.filter(m => m.selected);
  wrap("");
  wrap(`${th.muted("  Models:")}     ${sel.length} selected`);
  sel.slice(0, 8).forEach(m => wrap(`    ${th.success("✓")} ${m.id}${m.edited ? th.accent("*") : ""} ${th.dim(`${ft(m.contextWindow)}ctx / ${ft(m.maxTokens)}out`)}`));
  if (sel.length > 8) wrap(th.dim(`    ... +${sel.length - 8} more`));
  wrap("");
  wrap(th.bold(th.accent("  ▶ Save Provider (Enter)")));
}

function renderManageConfig(s: WizardState, wrap: (t: string) => void, th: Th) {
  wrap(th.bold(`  Manage: ${s.providerId}`));
  wrap("");
  const f = (label: string, value: string, idx: number, hint?: string) => {
    const focused = idx === s.manageFieldIdx;
    wrap(`${focused ? th.accent("▶ ") : "  "}${focused ? th.bold(label) : label}: ${th.accent(value)}${focused && hint ? th.dim(` ${hint}`) : ""}`);
  };

  f("API Type",       API_TYPES[s.apiTypeIdx], 0, "(← →)");
  f("Base URL",        s.baseUrl, 1);
  f("API Key",         s.apiKey ? "•".repeat(Math.min(s.apiKey.length, 20)) : "(not set)", 2);

  const authLabels = ["Auto", "Bearer (Authorization header)", "Custom"];
  f("Auth Method",     authLabels[s.manageAuthHeader], 3, "(← →)");

  const yn = (v: number) => v === 1 ? "Yes" : v === 2 ? "No" : "Auto";
  f("Developer Role",  yn(s.manageCompatDevRole), 4, "(← →)");
  f("Reasoning Effort",yn(s.manageCompatReasoningEffort), 5, "(← →)");
  f("Strict Tools",    yn(s.manageCompatStrictTools), 6, "(← →)");
  f("Custom Headers",  s.manageHeaders || "(none — JSON object)", 7);

  wrap("");
  wrap(s.manageFieldIdx === 8 ? th.bold(th.accent("  ▶ Save Changes (Enter)")) : th.dim("    Save Changes (Tab to select, Enter)"));
}

// ─── Input handling ──────────────────────────────────────────────

export function handleWizardInput(state: WizardState, data: string): WizardAction | null {
  if (matchesKey(data, Key.escape)) return handleEsc(state);
  if (matchesKey(data, "ctrl+c") && state.step === "main_menu") return { type: "close" };

  switch (state.step) {
    case "main_menu":       return handleMainMenu(state, data);
    case "choose_provider": return handleChooseProvider(state, data);
    case "api_type":        return handleApiType(state, data);
    case "base_url":        return handleBaseUrl(state, data);
    case "api_key":         return handleApiKey(state, data);
    case "provider_id":     return handleProviderId(state, data);
    case "select_models":   return handleSelectModels(state, data);
    case "edit_model":      return handleEditModel(state, data);
    case "review":          return handleReview(state, data);
    case "manage_config":   return handleManageConfig(state, data);
    default:                return null;
  }
}

const ESC_BACK: Partial<Record<WizardStep, WizardStep | "close">> = {
  main_menu: "close", choose_provider: "main_menu", api_type: "choose_provider", base_url: "api_type",
  api_key: "base_url", provider_id: "api_key", select_models: "provider_id", edit_model: "select_models",
  review: "select_models", manage_config: "main_menu",
};

function handleEsc(state: WizardState): WizardAction | null {
  const t = ESC_BACK[state.step];
  if (t === "close") return { type: "close" };
  if (t) { state.step = t; state.statusMessage = ""; return { type: "render" }; }
  return null;
}

// ─── Main menu ───────────────────────────────────────────────────

function handleMainMenu(state: WizardState, data: string): WizardAction | null {
  if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
    state.mainMenuIdx = state.mainMenuIdx === 0 ? 1 : 0;
    if (state.mainMenuIdx === 1 && state.existingProviders.length === 0) state.mainMenuIdx = 0;
    return { type: "render" };
  }
  if (matchesKey(data, Key.enter)) {
    if (state.mainMenuIdx === 0) { state.chooseMode = "discover"; state.step = "choose_provider"; return { type: "render" }; }
    if (state.mainMenuIdx === 1) { state.chooseMode = "manage"; state.chosenProviderIdx = 0; state.step = "choose_provider"; return { type: "render" }; }
  }
  return null;
}

// ─── Choose provider ─────────────────────────────────────────────

function handleChooseProvider(state: WizardState, data: string): WizardAction | null {
  const max = state.chooseMode === "discover" ? state.existingProviders.length : state.existingProviders.length - 1;
  if (matchesKey(data, Key.up))   { state.chosenProviderIdx = state.chooseMode === "discover" ? Math.max(-1, state.chosenProviderIdx - 1) : Math.max(0, state.chosenProviderIdx - 1); return { type: "render" }; }
  if (matchesKey(data, Key.down)) { state.chosenProviderIdx = Math.min(max, state.chosenProviderIdx + 1); return { type: "render" }; }
  if (matchesKey(data, Key.enter)) {
    if (state.chooseMode === "discover" && state.chosenProviderIdx === -1) {
      // Create new
      state.step = "api_type"; state.apiTypeIdx = 0; state.apiType = API_TYPES[0];
      state.baseUrlSuggestions = BASE_URLS[state.apiType]; state.baseUrlSuggestionIdx = 0;
      state.baseUrl = ""; state.apiKey = ""; state.providerId = "";
      return { type: "render" };
    }
    // Use existing provider
    const prov = state.existingProviders[state.chosenProviderIdx];
    if (!prov) return null;
    state.providerId = prov.id;
    if (state.chooseMode === "manage") {
      return { type: "load_provider", payload: prov.id };
    }
    // Discovery mode: load provider config then go to discovery
    return { type: "use_existing", payload: prov.id };
  }
  return null;
}

// ─── API type ────────────────────────────────────────────────────

function handleApiType(state: WizardState, data: string): WizardAction | null {
  if (matchesKey(data, Key.up))   { state.apiTypeIdx = Math.max(0, state.apiTypeIdx - 1); return syncApiType(state); }
  if (matchesKey(data, Key.down)) { state.apiTypeIdx = Math.min(API_TYPES.length - 1, state.apiTypeIdx + 1); return syncApiType(state); }
  if (matchesKey(data, Key.enter)) { state.baseUrl = state.baseUrlSuggestions[0] || ""; state.step = "base_url"; return { type: "render" }; }
  return null;
}

function syncApiType(state: WizardState): WizardAction {
  state.apiType = API_TYPES[state.apiTypeIdx];
  state.baseUrlSuggestions = BASE_URLS[state.apiType] || [];
  state.baseUrlSuggestionIdx = 0;
  return { type: "render" };
}

// ─── Base URL ────────────────────────────────────────────────────

function handleBaseUrl(state: WizardState, data: string): WizardAction | null {
  if (matchesKey(data, Key.tab)) return advanceBaseUrl(state);
  if (matchesKey(data, Key.enter) || data === " ") {
    if (state.baseUrlSuggestionIdx < state.baseUrlSuggestions.length) { state.baseUrl = state.baseUrlSuggestions[state.baseUrlSuggestionIdx]; return { type: "render" }; }
    return advanceBaseUrl(state);
  }
  if (matchesKey(data, Key.up))   { state.baseUrlSuggestionIdx = Math.max(0, state.baseUrlSuggestionIdx - 1); return { type: "render" }; }
  if (matchesKey(data, Key.down)) { state.baseUrlSuggestionIdx = Math.min(state.baseUrlSuggestions.length, state.baseUrlSuggestionIdx + 1); return { type: "render" }; }
  return editText(state, "baseUrl", data);
}

function advanceBaseUrl(state: WizardState): WizardAction | null {
  if (!state.baseUrl.trim()) { state.statusMessage = "Base URL is required"; state.statusType = "error"; return { type: "render" }; }
  if (!state.baseUrl.startsWith("http")) { state.statusMessage = "Must start with http:// or https://"; state.statusType = "error"; return { type: "render" }; }
  state.step = "api_key"; state.statusMessage = ""; return { type: "render" };
}

// ─── API Key / Provider ID ───────────────────────────────────────

function handleApiKey(state: WizardState, data: string): WizardAction | null {
  if (matchesKey(data, Key.tab) || matchesKey(data, Key.enter)) { state.step = "provider_id"; state.statusMessage = ""; return { type: "render" }; }
  return editText(state, "apiKey", data);
}

function handleProviderId(state: WizardState, data: string): WizardAction | null {
  if (matchesKey(data, Key.tab) || matchesKey(data, Key.enter)) {
    if (!state.providerId.trim()) { state.statusMessage = "Provider ID is required"; state.statusType = "error"; return { type: "render" }; }
    state.discoveryLoading = true; state.discoveryStatus = "Contacting provider API..."; state.step = "discovering"; state.statusMessage = "";
    return { type: "discover" };
  }
  return editText(state, "providerId", data);
}

// ─── Models ──────────────────────────────────────────────────────

function handleSelectModels(state: WizardState, data: string): WizardAction | null {
  if (matchesKey(data, Key.tab)) {
    if (!state.discoveredModels.some(m => m.selected)) { state.statusMessage = "Select at least one model"; state.statusType = "error"; return { type: "render" }; }
    state.step = "review"; state.statusMessage = ""; return { type: "render" };
  }
  if (data === "e") { const m = curModel(state); if (!m) return null; loadEditModel(state); return { type: "render" }; }
  if (matchesKey(data, Key.up))   { state.modelCursor = Math.max(0, state.modelCursor - 1); return { type: "render" }; }
  if (matchesKey(data, Key.down)) { const f = filteredModels(state); state.modelCursor = Math.min(f.length - 1, state.modelCursor + 1); return { type: "render" }; }
  if (data === " ") { const m = curModel(state); if (m) { m.selected = !m.selected; state.modelAllSelected = state.discoveredModels.every(x => x.selected); } return { type: "render" }; }
  if (data === "a") { state.modelAllSelected = !state.modelAllSelected; state.discoveredModels.forEach(m => m.selected = state.modelAllSelected); return { type: "render" }; }
  if (data === "s") { state.modelShowSelectedOnly = !state.modelShowSelectedOnly; state.modelCursor = 0; return { type: "render" }; }
  if (data === "r") { state.step = "provider_id"; state.statusMessage = ""; return { type: "render" }; }
  if (data === "/") { state.modelFilter = ""; state.modelCursor = 0; return { type: "render" }; }
  if (matchesKey(data, Key.backspace) && state.modelFilter.length > 0) { state.modelFilter = state.modelFilter.slice(0, -1); state.modelCursor = 0; return { type: "render" }; }
  if (data.length === 1 && /[a-zA-Z0-9]/.test(data)) { state.modelFilter += data; state.modelCursor = 0; return { type: "render" }; }
  return null;
}

function curModel(state: WizardState) { return filteredModels(state)[state.modelCursor]; }
function filteredModels(state: WizardState): WizardModelItem[] {
  let m = state.discoveredModels;
  if (state.modelShowSelectedOnly) m = m.filter(x => x.selected);
  if (state.modelFilter) { const l = state.modelFilter.toLowerCase(); m = m.filter(x => x.id.toLowerCase().includes(l)); }
  return m;
}

function loadEditModel(state: WizardState) {
  const m = state.discoveredModels[state.modelCursor]; if (!m) return;
  state.editingModelIdx = state.modelCursor; state.editFieldIdx = 0;
  state.editReasoning = m.reasoning ? 1 : 0; state.editImageInput = m.input.includes("image") ? 1 : 0;
  state.editContextWindow = ""; state.editMaxTokens = ""; state.editCostInput = ""; state.editCostOutput = "";
  state.step = "edit_model";
}

function handleEditModel(state: WizardState, data: string): WizardAction | null {
  if (matchesKey(data, Key.enter)) { applyEdits(state); state.step = "select_models"; return { type: "render" }; }
  if (matchesKey(data, Key.up))   { state.editFieldIdx = Math.max(0, state.editFieldIdx - 1); return { type: "render" }; }
  if (matchesKey(data, Key.down)) { state.editFieldIdx = Math.min(5, state.editFieldIdx + 1); return { type: "render" }; }
  if ((state.editFieldIdx === 0 || state.editFieldIdx === 1) && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) {
    if (state.editFieldIdx === 0) state.editReasoning = 1 - state.editReasoning; else state.editImageInput = 1 - state.editImageInput;
    return { type: "render" };
  }
  const nf = ["editContextWindow", "editMaxTokens", "editCostInput", "editCostOutput"] as const;
  const ni = state.editFieldIdx - 2;
  if (ni >= 0 && ni < nf.length) return editText(state, nf[ni], data);
  return null;
}

function applyEdits(state: WizardState) {
  const m = state.discoveredModels[state.editingModelIdx]; if (!m) return;
  m.reasoning = state.editReasoning === 1;
  m.input = state.editImageInput === 1 ? ["text", "image"] : ["text"];
  if (state.editContextWindow) m.contextWindow = parseInt(state.editContextWindow, 10);
  if (state.editMaxTokens) m.maxTokens = parseInt(state.editMaxTokens, 10);
  if (state.editCostInput || state.editCostOutput) m.cost = { input: state.editCostInput ? parseFloat(state.editCostInput) : (m.cost?.input || 0), output: state.editCostOutput ? parseFloat(state.editCostOutput) : (m.cost?.output || 0), cacheRead: m.cost?.cacheRead || 0, cacheWrite: m.cost?.cacheWrite || 0 };
  m.edited = true;
}

function handleReview(state: WizardState, data: string): WizardAction | null {
  return matchesKey(data, Key.enter) ? { type: "save" } : null;
}

// ─── Manage config ───────────────────────────────────────────────

function handleManageConfig(state: WizardState, data: string): WizardAction | null {
  if (matchesKey(data, Key.tab)) {
    if (state.manageFieldIdx < 8) { state.manageFieldIdx++; return { type: "render" }; }
    return { type: "save_config" };
  }
  if (matchesKey(data, Key.enter) && state.manageFieldIdx === 8) return { type: "save_config" };
  if (matchesKey(data, Key.up))   { state.manageFieldIdx = Math.max(0, state.manageFieldIdx - 1); return { type: "render" }; }
  if (matchesKey(data, Key.down)) { state.manageFieldIdx = Math.min(8, state.manageFieldIdx + 1); return { type: "render" }; }

  // Toggleable fields with their state keys and max values
  const TOGGLES: Record<number, { get: () => number; set: (v: number) => void; max: number }> = {
    0: { get: () => state.apiTypeIdx,      set: v => { state.apiTypeIdx = v; state.apiType = API_TYPES[v]; }, max: API_TYPES.length - 1 },
    3: { get: () => state.manageAuthHeader, set: v => { state.manageAuthHeader = v; }, max: 2 },
    4: { get: () => state.manageCompatDevRole, set: v => { state.manageCompatDevRole = v; }, max: 2 },
    5: { get: () => state.manageCompatReasoningEffort, set: v => { state.manageCompatReasoningEffort = v; }, max: 2 },
    6: { get: () => state.manageCompatStrictTools, set: v => { state.manageCompatStrictTools = v; }, max: 2 },
  };

  const tgl = TOGGLES[state.manageFieldIdx];
  if (tgl && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) {
    const dir = matchesKey(data, Key.right) ? 1 : -1;
    tgl.set(((tgl.get() + dir) % (tgl.max + 1) + (tgl.max + 1)) % (tgl.max + 1));
    return { type: "render" };
  }

  // Text fields
  const TEXT: Record<number, keyof Pick<WizardState, "baseUrl" | "apiKey" | "manageHeaders">> = { 1: "baseUrl", 2: "apiKey", 7: "manageHeaders" };
  if (TEXT[state.manageFieldIdx]) return editText(state, TEXT[state.manageFieldIdx], data);

  return null;
}

// ─── Generic text editing (only for string-valued WizardState fields) ───

type TextField = { [K in keyof WizardState]: WizardState[K] extends string ? K : never }[keyof WizardState];

function editText(state: WizardState, field: TextField, data: string): WizardAction | null {
  if (matchesKey(data, Key.backspace)) { state[field] = state[field].slice(0, -1) as any; return { type: "render" }; }
  if (data.length === 1 && data >= " ") { state[field] += data as any; return { type: "render" }; }
  return null;
}
