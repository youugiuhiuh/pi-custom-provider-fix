// pi-custom-provider wizard
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ModelAPI, ModelCost, ThinkingLevelMap } from "./types";
import { providerCompatKeys } from "./types";

export type WizardStep =
  | "choose_provider"
  | "confirm_delete_provider"
  | "api_type"
  | "base_url"
  | "api_key"
  | "provider_id"
  | "discovering"
  | "select_models"
  | "edit_model"
  | "edit_compat"
  | "review"
  | "manage_config";

export interface WizardModelItem {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  cost?: ModelCost;
  thinkingLevelMap?: ThinkingLevelMap;
  compat?: Record<string, unknown>;
  suggestedBy?: "api" | "model-id" | "base-url";
  selected: boolean;
  edited: boolean;
}

export interface WizardState {
  step: WizardStep;
  existingProviders: Array<{ id: string; modelCount: number }>;
  chosenProviderIdx: number;
  apiType: ModelAPI;
  apiTypeIdx: number;
  baseUrl: string;
  apiKey: string;
  providerId: string;
  mfIdx: number;
  mfAuth: number;
  mfDevRole: number;
  mfReasonEffort: number;
  mfStrict: number;
  mfHeaders: string;
  discoveredModels: WizardModelItem[];
  modelCursor: number;
  modelFilter: string;
  modelFiltering: boolean;
  selectModelsFrom: "discover" | "edit_models";
  addingCustom: boolean;
  discoveryStatus: string;
  discoveryLoading: boolean;
  editingModelIdx: number;
  editFieldIdx: number;
  editContextWindow: string;
  editMaxTokens: string;
  editReasoning: number;
  editImageInput: number;
  editCostInput: string;
  editCostOutput: string;
  editThinkingMap: string;
  compatFieldIdx: number;
  compatDraft: Record<string, unknown>;
  statusMessage: string;
  statusType: "info" | "success" | "warning" | "error" | "";
}

export interface WizardAction {
  type: string;
  payload?: unknown;
}

const APIS: ModelAPI[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
  "azure-openai-responses",
  "openai-codex-responses",
  "bedrock-converse-stream",
  "google-vertex",
];
const AL: Record<string, string> = {
  "openai-completions": "OpenAI Chat Completions [Key]",
  "openai-responses": "OpenAI Responses [Key]",
  "anthropic-messages": "Anthropic Messages [Key]",
  "google-generative-ai": "Google Generative AI [Key]",
  "mistral-conversations": "Mistral Conversations [Key]",
  "azure-openai-responses": "Azure OpenAI Responses [Key]",
  "openai-codex-responses": "OpenAI Codex Responses [OAuth]",
  "bedrock-converse-stream": "Amazon Bedrock [AWS]",
  "google-vertex": "Google Vertex AI [OAuth]",
};

type CompatControl = { key: string; label: string; values: Array<boolean | string | undefined> };
const BOOL: Array<boolean | undefined> = [undefined, true, false];
const OPENAI_COMPLETIONS_COMPAT: CompatControl[] = [
  { key: "supportsStore", label: "Store requests", values: BOOL },
  { key: "supportsDeveloperRole", label: "Developer role", values: BOOL },
  { key: "supportsReasoningEffort", label: "Reasoning effort", values: BOOL },
  { key: "supportsUsageInStreaming", label: "Streaming usage", values: BOOL },
  { key: "maxTokensField", label: "Max tokens field", values: [undefined, "max_tokens", "max_completion_tokens"] },
  { key: "requiresToolResultName", label: "Tool result name", values: BOOL },
  { key: "requiresAssistantAfterToolResult", label: "Assistant after tool", values: BOOL },
  { key: "requiresThinkingAsText", label: "Thinking as text", values: BOOL },
  { key: "requiresReasoningContentOnAssistantMessages", label: "Reasoning content replay", values: BOOL },
  {
    key: "thinkingFormat",
    label: "Thinking format",
    values: [
      undefined,
      "openai",
      "openrouter",
      "together",
      "deepseek",
      "zai",
      "qwen",
      "chat-template",
      "qwen-chat-template",
      "string-thinking",
      "ant-ling",
    ],
  },
  { key: "cacheControlFormat", label: "Cache control", values: [undefined, "anthropic"] },
  { key: "supportsOpenAIGrammarTools", label: "OpenAI grammar tools", values: BOOL },
  { key: "supportsStrictMode", label: "Strict tool schema", values: BOOL },
  { key: "sendSessionAffinityHeaders", label: "Session affinity headers", values: BOOL },
  {
    key: "sessionAffinityFormat",
    label: "Session affinity format",
    values: [undefined, "openai", "openai-nosession", "openrouter"],
  },
  { key: "deferredToolsMode", label: "Deferred tools mode", values: [undefined, "kimi"] },
  { key: "supportsLongCacheRetention", label: "Long cache retention", values: BOOL },
];

const OPENAI_RESPONSES_COMPAT: CompatControl[] = [
  { key: "supportsDeveloperRole", label: "Developer role", values: BOOL },
  {
    key: "sessionAffinityFormat",
    label: "Session affinity format",
    values: [undefined, "openai", "openai-nosession", "openrouter"],
  },
  { key: "supportsLongCacheRetention", label: "Long cache retention", values: BOOL },
  { key: "supportsStrictMode", label: "Strict tool schema", values: BOOL },
  { key: "supportsOpenAIGrammarTools", label: "OpenAI grammar tools", values: BOOL },
  { key: "supportsToolSearch", label: "Native tool search", values: BOOL },
  { key: "supportsExplicitPromptCacheMode", label: "Explicit prompt cache", values: BOOL },
];

const ANTHROPIC_COMPAT: CompatControl[] = [
  { key: "supportsEagerToolInputStreaming", label: "Eager tool input streaming", values: BOOL },
  { key: "supportsCacheControlOnTools", label: "Cache control on tools", values: BOOL },
  { key: "supportsTemperature", label: "Temperature", values: BOOL },
  { key: "forceAdaptiveThinking", label: "Adaptive thinking", values: BOOL },
  { key: "allowEmptySignature", label: "Allow empty signature", values: BOOL },
  { key: "supportsStrictTools", label: "Strict tool schema", values: BOOL },
  { key: "supportsToolReferences", label: "Tool references", values: BOOL },
  { key: "supportsLongCacheRetention", label: "Long cache retention", values: BOOL },
  { key: "sendSessionAffinityHeaders", label: "Session affinity headers", values: BOOL },
];

const BEDROCK_COMPAT: CompatControl[] = [{ key: "supportsStrictMode", label: "Strict tool schema", values: BOOL }];

function compatControls(api: ModelAPI): CompatControl[] {
  if (api === "anthropic-messages") return ANTHROPIC_COMPAT;
  if (api === "openai-completions") return OPENAI_COMPLETIONS_COMPAT;
  if (api === "openai-responses" || api === "azure-openai-responses" || api === "openai-codex-responses") {
    return OPENAI_RESPONSES_COMPAT;
  }
  if (api === "bedrock-converse-stream") return BEDROCK_COMPAT;
  return [];
}
function compatValue(v: unknown): string {
  return v === undefined ? "Auto" : v === true ? "Yes" : v === false ? "No" : String(v);
}

type Th = ReturnType<typeof mkTh>;
function mkTh(t: Theme) {
  return {
    dim: (s: string) => t.fg("dim", s),
    muted: (s: string) => t.fg("muted", s),
    accent: (s: string) => t.fg("accent", s),
    success: (s: string) => t.fg("success", s),
    error: (s: string) => t.fg("error", s),
    warning: (s: string) => t.fg("warning", s),
    bold: (s: string) => t.bold(s),
  };
}
function ft(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
}

export function createWizardState(existing: Array<{ id: string; modelCount: number }> = []): WizardState {
  return {
    step: "choose_provider",
    existingProviders: existing,
    chosenProviderIdx: existing.length > 0 ? 0 : -1,
    apiType: "openai-completions",
    apiTypeIdx: 0,
    baseUrl: "",
    apiKey: "",
    providerId: "",
    mfIdx: 0,
    mfAuth: 0,
    mfDevRole: 0,
    mfReasonEffort: 0,
    mfStrict: 0,
    mfHeaders: "",
    discoveredModels: [],
    modelCursor: 0,
    modelFilter: "",
    modelFiltering: false,
    selectModelsFrom: "discover",
    addingCustom: false,
    discoveryStatus: "",
    discoveryLoading: false,
    editingModelIdx: -1,
    editFieldIdx: 0,
    editContextWindow: "",
    editMaxTokens: "",
    editReasoning: 0,
    editImageInput: 0,
    editCostInput: "",
    editCostOutput: "",
    editThinkingMap: "",
    compatFieldIdx: 0,
    compatDraft: {},
    statusMessage: "",
    statusType: "",
  };
}

// ─── Render ──────────────────────────────────────────────────────

export function renderWizard(s: WizardState, w: number, t: Theme): string[] {
  const L: string[] = [],
    W = Math.max(1, w),
    th = mkTh(t);
  const wr = (x: string) => {
    L.push(...wrapTextWithAnsi(x, W));
  };
  const hr = () => {
    L.push(th.accent("-".repeat(W)));
  };

  if (s.statusMessage) {
    const c = s.statusType === "error" ? th.error : s.statusType === "success" ? th.success : th.warning;
    wr(c(`  ${s.statusMessage}`));
  }
  hr();

  switch (s.step) {
    case "choose_provider":
      rChoose(s, wr, th);
      break;
    case "confirm_delete_provider":
      rDeleteProvider(s, wr, th);
      break;
    case "select_models":
      rModels(s, wr, th);
      break;
    case "discovering":
      rDisc(s, wr, th);
      break;
    case "api_type":
      rApi(s, wr, th);
      break;
    case "base_url":
      rUrl(s, wr, th);
      break;
    case "api_key":
      rKey(s, wr, th);
      break;
    case "provider_id":
      rPid(s, wr, th);
      break;
    case "edit_model":
      rEdit(s, wr, th);
      break;
    case "edit_compat":
      rCompat(s, wr, th);
      break;
    case "review":
      rRev(s, wr, th);
      break;
    case "manage_config":
      rCfg(s, wr, th);
      break;
  }
  wr("");
  hr();
  wr(footer(s, th));
  return L;
}

function footer(s: WizardState, th: Th): string {
  const m: Record<string, string> = {
    choose_provider: "Arrows: select  |  Enter: confirm  |  d: delete  |  Esc: quit",
    confirm_delete_provider: "Enter: delete permanently  |  Esc: cancel",
    api_type: "Arrows: navigate  |  Enter: confirm  |  Esc: back",
    base_url: "Type URL  |  Enter/Tab: next  |  Esc: back",
    api_key: "Type key  |  Tab: next  |  Esc: back",
    provider_id: "Type ID  |  Tab: discover  |  Esc: back",
    discovering: "...",
    select_models:
      "Enter: save  |  Space: toggle  |  n: add custom  |  /: filter  |  d: delete  |  e: edit  |  Esc: back",
    edit_model: "Arrows: field  |  L/R: toggle  |  type: edit  |  Enter: save  |  Esc: cancel",
    edit_compat: "Arrows: select  |  L/R: change  |  Enter: save  |  Esc: back",
    review: "Enter: save  |  Esc: back",
    manage_config: "Arrows: field  |  L/R: toggle  |  Enter: save  |  Esc: back",
  };
  if (s.modelFiltering || s.modelFilter) return th.accent(`  ${s.modelFilter}_`) + "\n" + th.dim(m[s.step] || "");
  return th.dim(m[s.step] || "");
}

function rChoose(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  Providers"));
  w("");
  const mi = (l: string, c: boolean) => w(`${c ? th.accent("> ") : "  "}${c ? th.bold(l) : l}`);
  mi("[+] Create New Provider", s.chosenProviderIdx === -1);
  s.existingProviders.forEach((p, i) => mi(`${p.id} (${p.modelCount} models)`, s.chosenProviderIdx === i));
}

function rDeleteProvider(s: WizardState, w: (t: string) => void, th: Th) {
  const provider = s.existingProviders.find((p) => p.id === s.providerId);
  w(th.bold(th.error("  Delete Provider?")));
  w("");
  w(`  ${th.bold(s.providerId)}`);
  if (provider) w(th.muted(`  ${provider.modelCount} model(s) will be removed from the configuration.`));
  w("");
  w(th.error("  This cannot be undone."));
  w("");
  w(th.bold(th.error("  > Delete (Enter)")));
}

function rModels(s: WizardState, w: (t: string) => void, th: Th) {
  const f = getF(s);
  w(th.bold(`  Models: ${s.providerId}`));
  w("");
  if (!f.length) {
    w(th.dim("  (no models)"));
    w("");
    mi(w, th, "[+] Add Model", s.modelCursor === 0);
    if (s.selectModelsFrom === "edit_models") mi(w, th, "Edit Config", s.modelCursor === 1);
    return;
  }
  const start = Math.max(0, s.modelCursor - 5);
  f.slice(start, start + 10).forEach((m, i) => {
    const cur = start + i === s.modelCursor && s.modelCursor < f.length;
    const sel = m.selected ? th.success("● ") : th.dim("○ ");
    const source =
      m.suggestedBy === "model-id" ? "ID" : m.suggestedBy === "base-url" ? "URL" : m.suggestedBy === "api" ? "API" : "";
    w(
      `${cur ? th.accent("> ") : "  "}${sel}${cur ? th.bold(m.id) : m.id}  ${th.dim(`${ft(m.contextWindow)}${source ? `  [${source}]` : ""}`)}`,
    );
  });
  w("");
  mi(w, th, "[+] Add Model", s.modelCursor === f.length);
  if (s.selectModelsFrom === "edit_models") mi(w, th, "Edit Config", s.modelCursor === f.length + 1);
}

function mi(w: (t: string) => void, th: Th, l: string, c: boolean) {
  w(`${c ? th.accent("> ") : "  "}${c ? th.bold(l) : l}`);
}
function getF(s: WizardState) {
  return s.modelFilter
    ? s.discoveredModels.filter((x) => x.id.toLowerCase().includes(s.modelFilter.toLowerCase()))
    : s.discoveredModels;
}

function rDisc(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  Discovering..."));
  w("");
  if (s.discoveryLoading) w(th.muted(`  ${s.discoveryStatus || "Contacting API..."}`));
  else if (s.discoveryStatus) w(th.accent(`  ${s.discoveryStatus}`));
}
function rApi(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  API Type"));
  w("");
  APIS.forEach((a, i) => {
    const c = i === s.apiTypeIdx;
    w(`${c ? th.accent("> ") : "  "}${c ? th.bold(AL[a]) : AL[a]}`);
  });
}
function rUrl(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold(`  Base URL  (${s.apiType})`));
  w("");
  w(th.accent(`  > ${s.baseUrl}|`));
}
function rKey(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  API Key"));
  w("");
  w(th.accent(`  > ${s.apiKey ? "*".repeat(Math.min(s.apiKey.length, 40)) : "(empty)"}|`));
}
function rPid(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  Provider ID"));
  w("");
  w(th.accent(`  > ${s.providerId}|`));
}

function rEdit(s: WizardState, w: (t: string) => void, th: Th) {
  const m = s.discoveredModels[s.editingModelIdx];
  if (!m) return;
  w(th.bold(`  Edit: ${m.id}`));
  w("");
  const fl = (l: string, v: string, t: boolean, i: number) => {
    const f = i === s.editFieldIdx;
    w(`${f ? th.accent("> ") : "  "}${f ? th.bold(l) : l}: ${th.accent(v)}${f && t ? th.dim(" \u2190\u2192") : ""}`);
  };
  fl("Reasoning", s.editReasoning ? "Yes" : "No", true, 0);
  fl("Image Input", s.editImageInput ? "Yes" : "No", true, 1);
  fl("Context Window", s.editContextWindow || String(m.contextWindow), false, 2);
  fl("Max Tokens", s.editMaxTokens || String(m.maxTokens), false, 3);
  fl("Cost ($/M in)", s.editCostInput || (m.cost ? String(m.cost.input) : "0"), false, 4);
  fl("Cost ($/M out)", s.editCostOutput || (m.cost ? String(m.cost.output) : "0"), false, 5);
  const compatFields = compatControls(s.apiType);
  const compatLabel = compatFields.length ? (Object.keys(m.compat || {}).length ? "Configure" : "Auto") : "N/A";
  fl("Compatibility", compatLabel, compatFields.length > 0, 6);
  fl(
    "Thinking (JSON)",
    s.editThinkingMap || (m.thinkingLevelMap ? JSON.stringify(m.thinkingLevelMap) : "(auto)"),
    false,
    7,
  );
}

function rCompat(s: WizardState, w: (t: string) => void, th: Th) {
  const fields = compatControls(s.apiType),
    model = s.discoveredModels[s.editingModelIdx];
  w(th.bold(`  Compatibility: ${model?.id || s.providerId}`));
  w("");
  if (!fields.length) {
    w(th.muted(`  ${s.apiType} has no model compat overrides in pi-ai.`));
    return;
  }
  const start = Math.max(0, Math.min(s.compatFieldIdx - 4, Math.max(0, fields.length - 10)));
  fields.slice(start, start + 10).forEach((field, i) => {
    const idx = start + i,
      selected = idx === s.compatFieldIdx;
    const value = compatValue(s.compatDraft[field.key]);
    w(
      `${selected ? th.accent("> ") : "  "}${selected ? th.bold(field.label) : field.label}: ${th.accent(value)}${selected ? th.dim(" ←→") : ""}`,
    );
  });
  w("");
  w(th.muted("Auto leaves Pi's built-in behavior unchanged."));
}

function rRev(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  Review & Save"));
  w("");
  w(`${th.muted("  Provider:")}  ${th.bold(s.providerId)}`);
  w(`${th.muted("  API:")}       ${s.apiType}`);
  w(`${th.muted("  URL:")}       ${s.baseUrl}`);
  const sel = s.discoveredModels.filter((m) => m.selected);
  w(`${th.muted("  Models:")}     ${sel.length} selected`);
  sel
    .slice(0, 8)
    .forEach((m) => w(`    ${th.success("*")} ${m.id} ${th.dim(`${ft(m.contextWindow)} / ${ft(m.maxTokens)}`)}`));
  w("");
  w(th.bold(th.accent("  > Save (Enter)")));
}

function rCfg(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold(`  Edit Config: ${s.providerId}`));
  w("");
  const fl = (l: string, v: string, i: number, h?: string) => {
    const f = i === s.mfIdx;
    w(`${f ? th.accent("> ") : "  "}${f ? th.bold(l) : l}: ${th.accent(v)}${f && h ? th.dim(` ${h}`) : ""}`);
  };
  fl("API Type", APIS[s.apiTypeIdx], 0, "\u2190\u2192");
  fl("Base URL", s.baseUrl, 1);
  fl("API Key", s.apiKey ? "*".repeat(Math.min(s.apiKey.length, 20)) : "(not set)", 2);
  const al = ["Auto", "Bearer", "Custom"];
  fl("Auth Method", al[s.mfAuth], 3, "\u2190\u2192");
  const yn = (v: number) => (v === 1 ? "Yes" : v === 2 ? "No" : "Auto");
  const compat = providerCompatKeys(s.apiType);
  fl("Dev Role", compat.developerRole ? yn(s.mfDevRole) : "N/A", 4, compat.developerRole ? "\u2190\u2192" : undefined);
  fl(
    "Reasoning Effort",
    compat.reasoningEffort ? yn(s.mfReasonEffort) : "N/A",
    5,
    compat.reasoningEffort ? "\u2190\u2192" : undefined,
  );
  fl("Strict Tools", compat.strict ? yn(s.mfStrict) : "N/A", 6, compat.strict ? "\u2190\u2192" : undefined);
  fl("Headers (JSON)", s.mfHeaders || "(none)", 7);
  w("");
  w(th.bold(th.accent("  > Save (Enter)")));
}

// ─── Input ───────────────────────────────────────────────────────

export function handleWizardInput(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.escape)) return esc(s);
  if (matchesKey(d, "ctrl+c") && s.step === "choose_provider") return { type: "close" };
  switch (s.step) {
    case "choose_provider":
      return hChoose(s, d);
    case "confirm_delete_provider":
      return matchesKey(d, Key.enter) || d === "\r" ? { type: "delete_provider", payload: s.providerId } : null;
    case "select_models":
      return hModels(s, d);
    case "api_type":
      return hApi(s, d);
    case "base_url":
      return hUrl(s, d);
    case "api_key":
      return hKey(s, d);
    case "provider_id":
      return hPid(s, d);
    case "edit_model":
      return hEdit(s, d);
    case "edit_compat":
      return hCompat(s, d);
    case "review":
      return matchesKey(d, Key.enter) || d === "\r" ? { type: "save" } : null;
    case "manage_config":
      return hCfg(s, d);
    default:
      return null;
  }
}

const BACK: Record<string, string> = {
  confirm_delete_provider: "choose_provider",
  api_type: "choose_provider",
  base_url: "api_type",
  api_key: "base_url",
  provider_id: "api_key",
  edit_model: "select_models",
  edit_compat: "edit_model",
  review: "select_models",
  manage_config: "select_models",
};

function esc(s: WizardState): WizardAction | null {
  if (s.step === "select_models") {
    s.step = "choose_provider";
    s.statusMessage = "";
    return { type: "render" };
  }
  if (s.step === "choose_provider") return { type: "close" };
  const t = BACK[s.step];
  if (t === "close") return { type: "close" };
  if (t) {
    s.step = t as WizardStep;
    s.statusMessage = "";
    return { type: "render" };
  }
  return null;
}

function hChoose(s: WizardState, d: string): WizardAction | null {
  const max = s.existingProviders.length;
  if (matchesKey(d, Key.up)) {
    s.chosenProviderIdx = Math.max(-1, s.chosenProviderIdx - 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.down)) {
    s.chosenProviderIdx = Math.min(max - 1, s.chosenProviderIdx + 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.enter) || d === "\r") {
    if (s.chosenProviderIdx === -1) {
      s.step = "api_type";
      s.apiTypeIdx = 0;
      s.apiType = APIS[0];
      s.baseUrl = "";
      s.apiKey = "";
      s.providerId = "";
      return { type: "render" };
    }
    const p = s.existingProviders[s.chosenProviderIdx];
    if (!p) return null;
    s.providerId = p.id;
    return { type: "load_models", payload: p.id };
  }
  if (d.toLowerCase() === "d" && s.chosenProviderIdx >= 0) {
    const p = s.existingProviders[s.chosenProviderIdx];
    if (!p) return null;
    s.providerId = p.id;
    s.step = "confirm_delete_provider";
    s.statusMessage = "";
    return { type: "render" };
  }
  return null;
}

function hModels(s: WizardState, d: string): WizardAction | null {
  const f = getF(s);
  const total = f.length + (s.selectModelsFrom === "edit_models" ? 2 : 1);

  if (s.modelFiltering) {
    if (matchesKey(d, Key.escape)) {
      s.modelFiltering = false;
      s.modelFilter = "";
      s.modelCursor = 0;
      return { type: "render" };
    }
    if (matchesKey(d, Key.enter) || d === "\r") {
      if (s.addingCustom) {
        s.addingCustom = false;
        const id = s.modelFilter.trim() || "custom-model";
        s.discoveredModels.push({
          id,
          name: id,
          reasoning: false,
          input: ["text"],
          contextWindow: 128000,
          maxTokens: 16384,
          selected: true,
          edited: true,
        });
        s.modelFilter = "";
        s.modelFiltering = false;
        s.modelCursor = s.discoveredModels.length - 1;
        return { type: "discover_custom", payload: id };
      }
      s.modelFiltering = false;
      return { type: "render" };
    }
    if (matchesKey(d, Key.up)) {
      s.modelCursor = Math.max(0, s.modelCursor - 1);
      return { type: "render" };
    }
    if (matchesKey(d, Key.down)) {
      s.modelCursor = Math.min(total - 1, s.modelCursor + 1);
      return { type: "render" };
    }
    if (matchesKey(d, Key.backspace)) {
      s.modelFilter = s.modelFilter.slice(0, -1);
      if (!s.modelFilter) s.modelFiltering = false;
      s.modelCursor = 0;
      return { type: "render" };
    }
    if (d === " ") {
      const m = f[s.modelCursor];
      if (m && s.modelCursor < f.length) {
        m.selected = !m.selected;
      }
      return { type: "render" };
    }
    const clean = d.replace(/\x1b\[[0-9;]*[~a-zA-Z]/g, "").replace(/[\x00-\x1f\x7f]/g, "");
    if (clean) {
      s.modelFilter += clean;
      s.modelCursor = 0;
      return { type: "render" };
    }
    return null;
  }

  if (matchesKey(d, Key.up)) {
    s.modelCursor = Math.max(0, s.modelCursor - 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.down)) {
    s.modelCursor = Math.min(total - 1, s.modelCursor + 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.enter) || d === "\r") {
    if (s.modelCursor === f.length) {
      return s.selectModelsFrom === "edit_models" ? { type: "discover_edit" } : { type: "save_models" };
    }
    if (s.modelCursor === f.length + 1 && s.selectModelsFrom === "edit_models")
      return { type: "load_config", payload: s.providerId };
    if (s.modelCursor < f.length) {
      if (s.selectModelsFrom === "discover") {
        return { type: "save_models" };
      }
      if (s.selectModelsFrom === "edit_models") {
        s.editingModelIdx = s.discoveredModels.indexOf(f[s.modelCursor]);
        ldEdit(s);
        return { type: "render" };
      }
    }
  }
  if (d === " ") {
    const m = f[s.modelCursor];
    if (m && s.modelCursor < f.length) {
      m.selected = !m.selected;
    }
    return { type: "render" };
  }
  if (d === "a") {
    s.discoveredModels.forEach((m) => (m.selected = true));
    return { type: "render" };
  }
  if (d === "n") {
    s.statusMessage = "Type model ID, Enter to add";
    s.statusType = "info";
    s.modelFiltering = true;
    s.modelFilter = "";
    s.addingCustom = true;
    return { type: "render" };
  }
  if (d === "/") {
    s.modelFiltering = true;
    s.modelFilter = "";
    return { type: "render" };
  }
  if (d === "e" && s.modelCursor < f.length) {
    s.editingModelIdx = s.discoveredModels.indexOf(f[s.modelCursor]);
    ldEdit(s);
    return { type: "render" };
  }
  if (d === "d" && s.selectModelsFrom === "edit_models" && f.length > 0 && s.modelCursor < f.length) {
    const index = s.discoveredModels.indexOf(f[s.modelCursor]);
    if (index >= 0) s.discoveredModels.splice(index, 1);
    s.modelCursor = Math.max(0, s.modelCursor - 1);
    return { type: "save_models" };
  }
  return null;
}

function ldEdit(s: WizardState) {
  const m = s.discoveredModels[s.editingModelIdx];
  if (!m) return;
  s.editFieldIdx = 0;
  s.editReasoning = m.reasoning ? 1 : 0;
  s.editImageInput = m.input.includes("image") ? 1 : 0;
  s.editContextWindow = "";
  s.editMaxTokens = "";
  s.editCostInput = "";
  s.editCostOutput = "";
  s.editThinkingMap = "";
  s.compatFieldIdx = 0;
  s.compatDraft = { ...(m.compat || {}) };
  s.step = "edit_model";
}

function hEdit(s: WizardState, d: string): WizardAction | null {
  if (s.editFieldIdx === 6 && (matchesKey(d, Key.enter) || d === "\r")) {
    if (!compatControls(s.apiType).length) return { type: "render" };
    s.step = "edit_compat";
    return { type: "render" };
  }
  if (matchesKey(d, Key.enter) || d === "\r") {
    applyE(s);
    s.step = "select_models";
    return s.selectModelsFrom === "edit_models" ? { type: "save_models" } : { type: "render" };
  }
  if (matchesKey(d, Key.up)) {
    s.editFieldIdx = Math.max(0, s.editFieldIdx - 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.down)) {
    s.editFieldIdx = Math.min(7, s.editFieldIdx + 1);
    return { type: "render" };
  }
  if ((s.editFieldIdx === 0 || s.editFieldIdx === 1) && (matchesKey(d, Key.left) || matchesKey(d, Key.right))) {
    if (s.editFieldIdx === 0) s.editReasoning = 1 - s.editReasoning;
    else s.editImageInput = 1 - s.editImageInput;
    return { type: "render" };
  }
  const nf = ["editContextWindow", "editMaxTokens", "editCostInput", "editCostOutput", "editThinkingMap"] as const;
  const ni = s.editFieldIdx === 7 ? 4 : s.editFieldIdx - 2;
  if (ni >= 0 && ni < nf.length) return ed(s, nf[ni], d);
  return null;
}

function hCompat(s: WizardState, d: string): WizardAction | null {
  const fields = compatControls(s.apiType),
    current = fields[s.compatFieldIdx];
  if (matchesKey(d, Key.enter) || d === "\r") {
    s.step = "edit_model";
    return { type: "render" };
  }
  if (matchesKey(d, Key.up)) {
    s.compatFieldIdx = Math.max(0, s.compatFieldIdx - 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.down)) {
    s.compatFieldIdx = Math.min(fields.length - 1, s.compatFieldIdx + 1);
    return { type: "render" };
  }
  if (current && (matchesKey(d, Key.left) || matchesKey(d, Key.right))) {
    const currentIndex = Math.max(
      0,
      current.values.findIndex((v) => v === s.compatDraft[current.key]),
    );
    const direction = matchesKey(d, Key.right) ? 1 : -1;
    const value = current.values[(currentIndex + direction + current.values.length) % current.values.length];
    if (value === undefined) delete s.compatDraft[current.key];
    else s.compatDraft[current.key] = value;
    return { type: "render" };
  }
  return null;
}
function applyE(s: WizardState) {
  const m = s.discoveredModels[s.editingModelIdx];
  if (!m) return;
  m.reasoning = s.editReasoning === 1;
  m.input = s.editImageInput === 1 ? ["text", "image"] : ["text"];
  const pos = (v: string) => {
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  };
  const cost = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const contextWindow = s.editContextWindow ? pos(s.editContextWindow) : undefined;
  const maxTokens = s.editMaxTokens ? pos(s.editMaxTokens) : undefined;
  if (contextWindow) m.contextWindow = contextWindow;
  if (maxTokens) m.maxTokens = maxTokens;
  if (s.editCostInput || s.editCostOutput) {
    const input = s.editCostInput ? cost(s.editCostInput) : m.cost?.input || 0;
    const output = s.editCostOutput ? cost(s.editCostOutput) : m.cost?.output || 0;
    if (input !== undefined && output !== undefined)
      m.cost = { input, output, cacheRead: m.cost?.cacheRead || 0, cacheWrite: m.cost?.cacheWrite || 0 };
  }
  if (Object.keys(s.compatDraft).length) m.compat = { ...s.compatDraft };
  else delete m.compat;
  if (s.editThinkingMap.trim())
    try {
      const v = JSON.parse(s.editThinkingMap);
      if (isRecord(v) && Object.values(v).every((x) => typeof x === "string" || x === null))
        m.thinkingLevelMap = v as ThinkingLevelMap;
    } catch {}
  m.edited = true;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function hApi(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.up)) {
    s.apiTypeIdx = Math.max(0, s.apiTypeIdx - 1);
    s.apiType = APIS[s.apiTypeIdx];
    return { type: "render" };
  }
  if (matchesKey(d, Key.down)) {
    s.apiTypeIdx = Math.min(APIS.length - 1, s.apiTypeIdx + 1);
    s.apiType = APIS[s.apiTypeIdx];
    return { type: "render" };
  }
  if (matchesKey(d, Key.enter) || d === "\r") {
    s.step = "base_url";
    return { type: "render" };
  }
  return null;
}
function hUrl(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.enter) || d === "\r" || matchesKey(d, Key.tab)) {
    if (!s.baseUrl.trim()) {
      s.statusMessage = "Required";
      s.statusType = "error";
      return { type: "render" };
    }
    s.step = "api_key";
    s.statusMessage = "";
    return { type: "render" };
  }
  return ed(s, "baseUrl", d);
}
function hKey(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.tab) || matchesKey(d, Key.enter) || d === "\r") {
    s.step = "provider_id";
    s.statusMessage = "";
    return { type: "render" };
  }
  return ed(s, "apiKey", d);
}
function hPid(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.tab) || matchesKey(d, Key.enter) || d === "\r") {
    if (!s.providerId.trim()) {
      s.statusMessage = "Required";
      s.statusType = "error";
      return { type: "render" };
    }
    s.discoveryLoading = true;
    s.discoveryStatus = "Contacting API...";
    s.step = "discovering";
    s.statusMessage = "";
    return { type: "discover" };
  }
  return ed(s, "providerId", d);
}

function hCfg(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.tab) || matchesKey(d, Key.enter) || d === "\r") return { type: "save_config" };
  if (matchesKey(d, Key.up)) {
    s.mfIdx = Math.max(0, s.mfIdx - 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.down)) {
    s.mfIdx = Math.min(7, s.mfIdx + 1);
    return { type: "render" };
  }
  const TG: Record<number, { get: () => number; set: (v: number) => void; max: number }> = {
    0: {
      get: () => s.apiTypeIdx,
      set: (v) => {
        s.apiTypeIdx = v;
        s.apiType = APIS[v];
      },
      max: APIS.length - 1,
    },
    3: {
      get: () => s.mfAuth,
      set: (v) => {
        s.mfAuth = v;
      },
      max: 2,
    },
  };
  const compat = providerCompatKeys(s.apiType);
  if (compat.developerRole) TG[4] = { get: () => s.mfDevRole, set: (v) => (s.mfDevRole = v), max: 2 };
  if (compat.reasoningEffort) TG[5] = { get: () => s.mfReasonEffort, set: (v) => (s.mfReasonEffort = v), max: 2 };
  if (compat.strict) TG[6] = { get: () => s.mfStrict, set: (v) => (s.mfStrict = v), max: 2 };
  const t = TG[s.mfIdx];
  if (t && (matchesKey(d, Key.left) || matchesKey(d, Key.right))) {
    const dir = matchesKey(d, Key.right) ? 1 : -1;
    t.set((((t.get() + dir) % (t.max + 1)) + (t.max + 1)) % (t.max + 1));
    return { type: "render" };
  }
  const TX: Record<number, TextField> = { 1: "baseUrl", 2: "apiKey", 7: "mfHeaders" };
  if (TX[s.mfIdx]) return ed(s, TX[s.mfIdx], d);
  return null;
}

type TextField =
  | "baseUrl"
  | "apiKey"
  | "providerId"
  | "mfHeaders"
  | "editContextWindow"
  | "editMaxTokens"
  | "editCostInput"
  | "editCostOutput"
  | "editThinkingMap"
  | "modelFilter"
  | "discoveryStatus"
  | "statusMessage";
function ed(s: WizardState, f: TextField, d: string): WizardAction | null {
  if (matchesKey(d, Key.backspace)) {
    (s as any)[f] = (s as any)[f].slice(0, -1);
    return { type: "render" };
  }
  const clean = d.replace(/\x1b\[[0-9;]*[~a-zA-Z]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  if (clean) {
    (s as any)[f] += clean;
    return { type: "render" };
  }
  return null;
}
