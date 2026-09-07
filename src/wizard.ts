// pi-custom-provider wizard
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Api, KnownApi, Model, ModelCost, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { listModelPresets, type ModelPreset } from "./discovery";
import {
  API_CHOICES,
  apiChoiceIndex,
  apiLabel,
  defaultApiChoice,
  oauthProviderChoicesForApi,
  oauthProviderLabel,
  OAUTH_PROVIDER_CHOICES,
} from "./pi-catalog";
import {
  confirmSetupApi,
  moveManagedOAuthProvider,
  moveSetupApi,
  moveSetupOAuthProvider,
  resetProviderSetup,
  selectedManagedOAuthProvider,
  selectedSetupOAuthProvider,
  setManagedApiChoice,
  setSetupOAuthProvider,
} from "./provider-flow";
import { looksLikeOAuthJsonText } from "./oauth";

export type WizardStep =
  | "choose_provider"
  | "confirm_delete_provider"
  | "api_type"
  | "base_url"
  | "oauth_provider"
  | "oauth_json_path"
  | "api_key"
  | "provider_id"
  | "discovering"
  | "select_models"
  | "edit_model"
  | "edit_compat"
  | "model_preset"
  | "review"
  | "manage_config";

export interface WizardModelItem {
  id: string;
  name: string;
  baseUrl?: string;
  reasoning: boolean;
  input: Model<Api>["input"];
  contextWindow: number;
  maxTokens: number;
  cost?: ModelCost;
  thinkingLevelMap?: ThinkingLevelMap;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  suggestedBy?: "api" | "model-id" | "base-url";
  selected: boolean;
  edited: boolean;
}

export interface WizardState {
  step: WizardStep;
  existingProviders: Array<{ id: string; name?: string; modelCount: number }>;
  chosenProviderIdx: number;
  apiType: KnownApi;
  apiTypeIdx: number;
  baseUrl: string;
  apiKey: string;
  oauthProviderIdx: number;
  oauthJsonPath: string;
  oauthJsonRaw: string;
  providerId: string;
  providerOriginalId: string;
  providerName: string;
  mfIdx: number;
  mfOAuthProvider: number;
  mfOAuthJsonPath: string;
  mfOAuthJsonRaw: string;
  mfAuth: number;
  mfHeaders: string;
  mfEditing: boolean;
  mfEditValue: string;
  discoveredModels: WizardModelItem[];
  modelCursor: number;
  modelFilter: string;
  modelFiltering: boolean;
  selectModelsFrom: "discover" | "edit_models";
  addingCustom: boolean;
  discoveryStatus: string;
  discoveryLoading: boolean;
  oauthManualVisible: boolean;
  oauthManualMessage: string;
  oauthManualPlaceholder: string;
  oauthManualInput: string;
  editingModelIdx: number;
  editFieldIdx: number;
  editContextWindow: string;
  editMaxTokens: string;
  editReasoning: number;
  editImageInput: number;
  editCostInput: string;
  editCostOutput: string;
  editThinkingMap: string;
  compatDraft: Record<string, unknown>;
  compatJsonDraft: string;
  compatJsonError: string;
  modelPresetCursor: number;
  modelPresetFilter: string;
  modelPresetFiltering: boolean;
  modelPresetLabel: string;
  modelPresetDraft?: ModelPreset["model"];
  statusMessage: string;
  statusType: "info" | "success" | "warning" | "error" | "";
}

export interface WizardAction {
  type: string;
  payload?: unknown;
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

export function createWizardState(
  existing: Array<{ id: string; name?: string; modelCount: number }> = [],
): WizardState {
  const defaultApi = defaultApiChoice();
  return {
    step: "choose_provider",
    existingProviders: existing,
    chosenProviderIdx: existing.length > 0 ? 0 : -1,
    apiType: defaultApi,
    apiTypeIdx: apiChoiceIndex(defaultApi),
    baseUrl: "",
    apiKey: "",
    oauthProviderIdx: 0,
    oauthJsonPath: "",
    oauthJsonRaw: "",
    providerId: "",
    providerOriginalId: "",
    providerName: "",
    mfIdx: 0,
    mfOAuthProvider: 0,
    mfOAuthJsonPath: "",
    mfOAuthJsonRaw: "",
    mfAuth: 0,
    mfHeaders: "",
    mfEditing: false,
    mfEditValue: "",
    discoveredModels: [],
    modelCursor: 0,
    modelFilter: "",
    modelFiltering: false,
    selectModelsFrom: "discover",
    addingCustom: false,
    discoveryStatus: "",
    discoveryLoading: false,
    oauthManualVisible: false,
    oauthManualMessage: "",
    oauthManualPlaceholder: "",
    oauthManualInput: "",
    editingModelIdx: -1,
    editFieldIdx: 0,
    editContextWindow: "",
    editMaxTokens: "",
    editReasoning: 0,
    editImageInput: 0,
    editCostInput: "",
    editCostOutput: "",
    editThinkingMap: "",
    compatDraft: {},
    compatJsonDraft: "",
    compatJsonError: "",
    modelPresetCursor: 0,
    modelPresetFilter: "",
    modelPresetFiltering: false,
    modelPresetLabel: "Custom / saved",
    modelPresetDraft: undefined,
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
    case "oauth_provider":
      rOAuthProvider(s, wr, th);
      break;
    case "oauth_json_path":
      rOAuthJsonPath(s, wr, th);
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
    case "model_preset":
      rModelPreset(s, wr, th);
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
  if (s.step === "manage_config" && s.mfEditing) {
    return th.dim("Type value  |  Ctrl+U: clear  |  Enter: save  |  Esc: cancel");
  }
  const m: Record<string, string> = {
    choose_provider: "Arrows: select  |  Enter: confirm  |  d: delete  |  Esc: quit",
    confirm_delete_provider: "Enter: delete permanently  |  Esc: cancel",
    api_type: "Arrows: navigate  |  Enter: confirm  |  Esc: back",
    base_url: "Type URL  |  Enter/Tab: next  |  Esc: back",
    oauth_provider: "Arrows: choose OAuth provider  |  Enter/Tab: next  |  Esc: back",
    oauth_json_path: "Paste OAuth JSON, type external path, or leave empty for Pi OAuth  |  Enter/Tab: discover  |  Esc: back",
    api_key: "Type key  |  Enter/Tab: discover  |  Esc: back",
    provider_id: "Type ID  |  Enter/Tab: next  |  Esc: back",
    discovering: "...",
    select_models:
      s.selectModelsFrom === "edit_models"
        ? "Auto-save  |  Space: toggle  |  a: select all  |  n: add custom  |  /: filter  |  d: delete  |  e: edit"
        : s.providerOriginalId
          ? "Auto-save  |  Space: toggle  |  a: select all  |  /: filter  |  e: edit  |  Esc: back"
          : "Enter: save  |  Space: toggle  |  a: select all  |  n: add custom  |  /: filter  |  Esc: back",
    edit_model: "Auto-save  |  p: preset  |  Arrows: field  |  L/R: toggle  |  type: edit  |  Enter/Esc: done",
    edit_compat: "Type JSON object  |  Ctrl+U: clear  |  Enter: save  |  Esc: back",
    model_preset: "Arrows: select  |  /: filter  |  Enter: apply model  |  Esc: back",
    review: "Enter: save  |  Esc: back",
    manage_config: "Arrows: field  |  Enter: edit/done  |  L/R: toggle  |  Esc: done",
  };
  if (s.step === "discovering" && s.oauthManualVisible) {
    return th.dim("Paste redirect URL/code  |  Enter: submit  |  Ctrl+U: clear  |  Esc: cancel");
  }
  if (s.step === "select_models" && (s.modelFiltering || s.modelFilter)) {
    return th.accent(`  ${s.modelFilter}_`) + "\n" + th.dim(m[s.step] || "");
  }
  if (s.step === "model_preset" && s.modelPresetFiltering) {
    return th.accent(`  ${s.modelPresetFilter}_`) + "\n" + th.dim(m[s.step] || "");
  }
  return th.dim(m[s.step] || "");
}

function rChoose(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  Providers"));
  w("");
  const mi = (l: string, c: boolean) => w(`${c ? th.accent("> ") : "  "}${c ? th.bold(l) : l}`);
  mi("[+] Create New Provider", s.chosenProviderIdx === -1);
  s.existingProviders.forEach((p, i) =>
    mi(
      `${p.name && p.name !== p.id ? `${p.name} [${p.id}]` : p.id} (${p.modelCount} models)`,
      s.chosenProviderIdx === i,
    ),
  );
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
    const emptyMessage =
      s.discoveredModels.length > 0 && s.modelFilter ? `  (no models match "${s.modelFilter}")` : "  (no models)";
    w(th.dim(emptyMessage));
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
  if (s.oauthManualVisible) {
    w("");
    w(th.warning("  Manual OAuth fallback"));
    if (s.oauthManualMessage) w(th.muted(`  ${s.oauthManualMessage}`));
    if (s.oauthManualPlaceholder) w(th.muted(`  Expected: ${s.oauthManualPlaceholder}`));
    w(th.accent(`  > ${s.oauthManualInput}|`));
  }
}
function rApi(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  API Type"));
  w("");
  API_CHOICES.forEach((a, i) => {
    const c = i === s.apiTypeIdx;
    w(`${c ? th.accent("> ") : "  "}${c ? th.bold(apiLabel(a)) : apiLabel(a)}`);
  });
}
function rUrl(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold(`  Base URL  (${s.apiType})`));
  w("");
  w(th.accent(`  > ${s.baseUrl}|`));
}
function rOAuthProvider(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  OAuth Provider"));
  w("");
  oauthProviderChoicesForApi(s.apiType).forEach((provider) => {
    const c = provider === selectedSetupOAuthProvider(s);
    w(`${c ? th.accent("> ") : "  "}${c ? th.bold(oauthProviderLabel(provider)) : oauthProviderLabel(provider)}`);
  });
}
function rOAuthJsonPath(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold(`  OAuth JSON  (${oauthProviderLabel(selectedSetupOAuthProvider(s))})`));
  w("");
  w(th.accent(`  > ${oauthJsonDisplay(s.oauthJsonPath, s.oauthJsonRaw)}|`));
  w("");
  w(th.muted("  Empty uses Pi OAuth for this provider. Pasted JSON is imported into Pi auth.json."));
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
  w(`  Preset: ${th.accent(s.modelPresetLabel)}`);
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
  const compatLabel = Object.keys(s.compatDraft).length ? "Configured" : "Auto";
  fl("Compatibility", compatLabel, false, 6);
  fl(
    "Thinking (JSON)",
    s.editThinkingMap || (m.thinkingLevelMap ? JSON.stringify(m.thinkingLevelMap) : "(auto)"),
    false,
    7,
  );
}

function rCompat(s: WizardState, w: (t: string) => void, th: Th) {
  const model = s.discoveredModels[s.editingModelIdx];
  w(th.bold(`  Compatibility: ${model?.id || s.providerId}`));
  w(th.muted(`  ${s.apiType} · model.compat JSON`));
  w("");
  w(th.accent(`  > ${s.compatJsonDraft}|`));
  if (s.compatJsonError) {
    w("");
    w(th.error(`  ${s.compatJsonError}`));
  }
}

function modelPresetChoices(s: WizardState): ModelPreset[] {
  const model = s.discoveredModels[s.editingModelIdx];
  return listModelPresets(s.apiType, model?.id || "", s.modelPresetFilter);
}

function rModelPreset(s: WizardState, w: (t: string) => void, th: Th) {
  const model = s.discoveredModels[s.editingModelIdx],
    choices = modelPresetChoices(s);
  w(th.bold(`  Choose Model Preset: ${model?.id || s.providerId}`));
  w(th.muted(`  ${s.apiType} · complete model metadata from installed pi-ai`));
  w("");
  if (!choices.length) {
    w(th.dim("  (no matching presets)"));
    return;
  }
  const start = Math.max(0, Math.min(s.modelPresetCursor - 5, Math.max(0, choices.length - 10)));
  choices.slice(start, start + 10).forEach((preset, index) => {
    const selected = start + index === s.modelPresetCursor;
    const suggested = preset.recommended ? th.success(" [Suggested]") : "";
    w(`${selected ? th.accent("> ") : "  "}${selected ? th.bold(preset.label) : preset.label}${suggested}`);
  });
}

function rRev(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold("  Review & Save"));
  w("");
  w(`${th.muted("  Provider:")}  ${th.bold(s.providerId)}`);
  w(`${th.muted("  API:")}       ${s.apiType}`);
  w(`${th.muted("  URL:")}       ${s.baseUrl}`);
  const oauthProvider = selectedSetupOAuthProvider(s);
  if (oauthProvider !== "none") {
    const json = s.oauthJsonRaw ? "pasted OAuth JSON -> Pi auth.json" : s.oauthJsonPath;
    w(`${th.muted("  OAuth:")}     ${oauthProviderLabel(oauthProvider)}${json ? ` (${json})` : ""}`);
  }
  const sel = s.discoveredModels.filter((m) => m.selected);
  w(`${th.muted("  Models:")}     ${sel.length} selected`);
  sel
    .slice(0, 8)
    .forEach((m) => w(`    ${th.success("*")} ${m.id} ${th.dim(`${ft(m.contextWindow)} / ${ft(m.maxTokens)}`)}`));
  w("");
  w(th.bold(th.accent("  > Save (Enter)")));
}

function rCfg(s: WizardState, w: (t: string) => void, th: Th) {
  w(th.bold(`  Edit Provider: ${s.providerName || s.providerId}`));
  w(th.success("  Changes are saved when confirmed."));
  w("");
  const fl = (l: string, v: string, i: number, h?: string) => {
    const f = i === s.mfIdx;
    const editing = f && s.mfEditing;
    const value = editing ? `${s.mfEditValue}_` : v;
    w(`${f ? th.accent("> ") : "  "}${f ? th.bold(l) : l}: ${th.accent(value)}${f && h ? th.dim(` ${h}`) : ""}`);
  };
  fl("Provider ID", s.providerId, 0);
  fl("Display Name", s.providerName || "(same as ID)", 1);
  fl("API Type", s.apiType, 2, "\u2190\u2192");
  fl("Base URL", s.baseUrl, 3);
  fl("API Key", s.apiKey ? "*".repeat(Math.min(s.apiKey.length, 20)) : "(not set)", 4);
  fl("OAuth Provider", oauthProviderLabel(OAUTH_PROVIDER_CHOICES[s.mfOAuthProvider]), 5, "\u2190\u2192");
  fl("OAuth JSON", oauthJsonDisplay(s.mfOAuthJsonPath, s.mfOAuthJsonRaw, "(not set)"), 6);
  const al = ["Auto", "Bearer", "Custom"];
  fl("Auth Method", al[s.mfAuth], 7, "\u2190\u2192");
  fl("Headers (JSON)", s.mfHeaders || "(none)", 8);
}

// ─── Input ───────────────────────────────────────────────────────

export function handleWizardInput(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.escape) && s.step === "model_preset" && s.modelPresetFiltering) {
    s.modelPresetFiltering = false;
    s.modelPresetFilter = "";
    s.modelPresetCursor = 0;
    return { type: "render" };
  }
  if (matchesKey(d, Key.escape) && s.step === "manage_config" && s.mfEditing) return hCfg(s, d);
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
    case "oauth_provider":
      return hOAuthProvider(s, d);
    case "oauth_json_path":
      return hOAuthJsonPath(s, d);
    case "api_key":
      return hKey(s, d);
    case "provider_id":
      return hPid(s, d);
    case "edit_model":
      return hEdit(s, d);
    case "edit_compat":
      return hCompat(s, d);
    case "model_preset":
      return hModelPreset(s, d);
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
  provider_id: "base_url",
  oauth_provider: "provider_id",
  oauth_json_path: "oauth_provider",
  api_key: "oauth_provider",
  edit_model: "select_models",
  edit_compat: "edit_model",
  review: "select_models",
  manage_config: "select_models",
};

function esc(s: WizardState): WizardAction | null {
  if (s.step === "model_preset") {
    s.step = "edit_model";
    s.statusMessage = "";
    return { type: "render" };
  }
  if (s.step === "select_models") {
    s.step = "choose_provider";
    s.statusMessage = "";
    return { type: "render" };
  }
  if (s.step === "api_key" && selectedSetupOAuthProvider(s) !== "none") {
    s.step = "oauth_json_path";
    s.statusMessage = "";
    return { type: "render" };
  }
  if (s.step === "choose_provider") return { type: "close" };
  if (s.step === "manage_config" && s.providerOriginalId) s.providerId = s.providerOriginalId;
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
      resetProviderSetup(s);
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
        return modelSelectionAction(s);
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
      return modelSelectionAction(s);
    }
    return { type: "render" };
  }
  if (d === "a") {
    s.discoveredModels.forEach((m) => (m.selected = true));
    return modelSelectionAction(s);
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

function modelSelectionAction(s: WizardState): WizardAction {
  return isExistingProviderSession(s) ? { type: "save_models" } : { type: "render" };
}

function isExistingProviderSession(s: WizardState): boolean {
  return s.selectModelsFrom === "edit_models" || Boolean(s.providerOriginalId);
}

function ldEdit(s: WizardState) {
  const m = s.discoveredModels[s.editingModelIdx];
  if (!m) return;
  s.editFieldIdx = 0;
  s.editReasoning = m.reasoning ? 1 : 0;
  s.editImageInput = m.input.includes("image") ? 1 : 0;
  s.editContextWindow = String(m.contextWindow);
  s.editMaxTokens = String(m.maxTokens);
  s.editCostInput = m.cost ? String(m.cost.input) : "";
  s.editCostOutput = m.cost ? String(m.cost.output) : "";
  s.editThinkingMap = m.thinkingLevelMap ? JSON.stringify(m.thinkingLevelMap) : "";
  s.compatDraft = { ...(m.compat || {}) };
  s.compatJsonDraft = "";
  s.compatJsonError = "";
  s.modelPresetCursor = 0;
  s.modelPresetFilter = "";
  s.modelPresetFiltering = false;
  s.modelPresetLabel = "Custom / saved";
  s.modelPresetDraft = undefined;
  s.step = "edit_model";
}

function hEdit(s: WizardState, d: string): WizardAction | null {
  if (d.toLowerCase() === "p") return openModelPresetPicker(s);
  if (s.editFieldIdx === 6 && (matchesKey(d, Key.enter) || d === "\r")) {
    s.compatJsonDraft = Object.keys(s.compatDraft).length ? JSON.stringify(s.compatDraft) : "";
    s.compatJsonError = "";
    s.step = "edit_compat";
    return { type: "render" };
  }
  if (matchesKey(d, Key.enter) || d === "\r") {
    return saveEditedModel(s);
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
    s.modelPresetLabel = "Custom";
    return autosaveEditedModel(s);
  }
  const nf = ["editContextWindow", "editMaxTokens", "editCostInput", "editCostOutput", "editThinkingMap"] as const;
  const ni = s.editFieldIdx === 7 ? 4 : s.editFieldIdx - 2;
  if (ni >= 0 && ni < nf.length) {
    const action = ed(s, nf[ni], d);
    if (action) {
      s.modelPresetLabel = "Custom";
      return autosaveEditedModel(s);
    }
    return null;
  }
  return null;
}

function hCompat(s: WizardState, d: string): WizardAction | null {
  if (d === "\x15") {
    s.compatDraft = {};
    s.compatJsonDraft = "";
    s.compatJsonError = "";
    s.modelPresetLabel = "Custom";
    return autosaveEditedModel(s);
  }
  if (matchesKey(d, Key.enter) || d === "\r") {
    if (!applyCompatJsonDraft(s, true)) return { type: "render" };
    s.step = "edit_model";
    s.modelPresetLabel = "Custom";
    return autosaveEditedModel(s);
  }
  s.compatJsonError = "";
  const action = ed(s, "compatJsonDraft", d);
  if (action) s.modelPresetLabel = "Custom";
  return action;
}

function applyCompatJsonDraft(s: WizardState, showError: boolean): boolean {
  const input = s.compatJsonDraft.trim();
  if (!input) {
    s.compatDraft = {};
  } else {
    try {
      const value: unknown = JSON.parse(input);
      if (!isRecord(value)) throw new Error("Value must be a JSON object");
      s.compatDraft = value;
    } catch (error) {
      if (showError) s.compatJsonError = error instanceof Error ? error.message : "Invalid JSON object";
      return false;
    }
  }
  s.compatJsonError = "";
  s.modelPresetLabel = "Custom";
  return true;
}

function openModelPresetPicker(s: WizardState): WizardAction {
  s.modelPresetCursor = 0;
  s.modelPresetFilter = "";
  s.modelPresetFiltering = false;
  s.step = "model_preset";
  return { type: "render" };
}

function hModelPreset(s: WizardState, d: string): WizardAction | null {
  const choices = modelPresetChoices(s);
  if (matchesKey(d, Key.up)) {
    s.modelPresetCursor = Math.max(0, s.modelPresetCursor - 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.down)) {
    s.modelPresetCursor = Math.min(Math.max(0, choices.length - 1), s.modelPresetCursor + 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.enter) || d === "\r") {
    const preset = choices[s.modelPresetCursor];
    if (!preset) return null;
    applyModelPreset(s, preset);
    s.modelPresetCursor = 0;
    s.modelPresetFilter = "";
    s.modelPresetFiltering = false;
    s.editFieldIdx = 0;
    s.step = "edit_model";
    return autosaveEditedModel(s);
  }
  if (d === "/" && !s.modelPresetFiltering) {
    s.modelPresetCursor = 0;
    s.modelPresetFilter = "";
    s.modelPresetFiltering = true;
    return { type: "render" };
  }
  if (!s.modelPresetFiltering) return null;
  if (matchesKey(d, Key.backspace)) {
    s.modelPresetFilter = s.modelPresetFilter.slice(0, -1);
    s.modelPresetCursor = 0;
    return { type: "render" };
  }
  const clean = d.replace(/\x1b\[[0-9;]*[~a-zA-Z]/g, "").replace(/[\x00-\x1f\x7f]/g, "");
  if (!clean) return null;
  s.modelPresetFilter += clean;
  s.modelPresetCursor = 0;
  return { type: "render" };
}

function applyModelPreset(s: WizardState, preset: ModelPreset): void {
  const model = preset.model;
  s.editReasoning = model.reasoning ? 1 : 0;
  s.editImageInput = model.input.includes("image") ? 1 : 0;
  s.editContextWindow = String(model.contextWindow);
  s.editMaxTokens = String(model.maxTokens);
  s.editCostInput = model.cost ? String(model.cost.input) : "";
  s.editCostOutput = model.cost ? String(model.cost.output) : "";
  s.editThinkingMap = model.thinkingLevelMap ? JSON.stringify(model.thinkingLevelMap) : "";
  s.compatDraft = { ...(model.compat || {}) };
  s.modelPresetLabel = preset.label;
  s.modelPresetDraft = model;
}

function saveEditedModel(s: WizardState): WizardAction {
  applyE(s);
  s.step = "select_models";
  return s.selectModelsFrom === "edit_models" ? { type: "save_models" } : { type: "render" };
}

function autosaveEditedModel(s: WizardState): WizardAction {
  applyE(s);
  return s.selectModelsFrom === "edit_models" ? { type: "save_models" } : { type: "render" };
}

function applyE(s: WizardState) {
  const m = s.discoveredModels[s.editingModelIdx];
  if (!m) return;
  if (s.modelPresetDraft) m.name = s.modelPresetDraft.name;
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
  if (s.modelPresetDraft) {
    if (s.modelPresetDraft.cost) {
      const input = cost(s.editCostInput),
        output = cost(s.editCostOutput);
      m.cost = {
        ...s.modelPresetDraft.cost,
        input: input ?? s.modelPresetDraft.cost.input,
        output: output ?? s.modelPresetDraft.cost.output,
        tiers: s.modelPresetDraft.cost.tiers?.map((entry) => ({ ...entry })),
      };
    } else {
      delete m.cost;
    }
  } else if (s.editCostInput || s.editCostOutput) {
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
  else delete m.thinkingLevelMap;
  m.edited = true;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function hApi(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.up)) {
    moveSetupApi(s, -1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.down)) {
    moveSetupApi(s, 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.enter) || d === "\r") {
    s.step = "base_url";
    confirmSetupApi(s);
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
    s.step = "provider_id";
    s.statusMessage = "";
    return { type: "render" };
  }
  return ed(s, "baseUrl", d);
}
function hOAuthProvider(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.up) || matchesKey(d, Key.left)) {
    moveSetupOAuthProvider(s, -1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.down) || matchesKey(d, Key.right)) {
    moveSetupOAuthProvider(s, 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.tab) || matchesKey(d, Key.enter) || d === "\r") {
    const selected = selectedSetupOAuthProvider(s);
    setSetupOAuthProvider(s, selected);
    s.step = selected === "none" ? "api_key" : "oauth_json_path";
    s.statusMessage = "";
    return { type: "render" };
  }
  return null;
}
function hOAuthJsonPath(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.tab) || matchesKey(d, Key.enter) || d === "\r") {
    if (!s.providerId.trim()) {
      s.step = "provider_id";
      s.statusMessage = "Provider ID is required before OAuth login.";
      s.statusType = "error";
      return { type: "render" };
    }
    const shouldUseStoredOAuth = !s.oauthJsonPath.trim() && !s.oauthJsonRaw.trim();
    s.discoveryLoading = true;
    s.discoveryStatus = shouldUseStoredOAuth ? "Checking OAuth..." : "Contacting API...";
    s.step = "discovering";
    s.statusMessage = "";
    return { type: "discover" };
  }
  if (matchesKey(d, Key.backspace) && s.oauthJsonRaw) {
    s.oauthJsonRaw = "";
    s.statusMessage = "";
    return { type: "render" };
  }
  const clean = cleanTextInput(d);
  if (!clean) return ed(s, "oauthJsonPath", d);
  const next = s.oauthJsonPath + clean;
  if (looksLikeOAuthJsonText(next)) {
    s.oauthJsonRaw = next.trim();
    s.oauthJsonPath = "";
    s.statusMessage = "OAuth JSON pasted. It will be imported into Pi auth.json.";
    s.statusType = "success";
    return { type: "render" };
  }
  s.oauthJsonRaw = "";
  s.oauthJsonPath = next;
  return { type: "render" };
}
function hKey(s: WizardState, d: string): WizardAction | null {
  if (matchesKey(d, Key.tab) || matchesKey(d, Key.enter) || d === "\r") {
    s.discoveryLoading = true;
    s.discoveryStatus = "Contacting API...";
    s.step = "discovering";
    s.statusMessage = "";
    return { type: "discover" };
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
    s.step = "oauth_provider";
    s.statusMessage = "";
    return { type: "render" };
  }
  return ed(s, "providerId", d);
}

function hCfg(s: WizardState, d: string): WizardAction | null {
  if (s.mfEditing) {
    if (matchesKey(d, Key.escape)) {
      s.mfEditing = false;
      s.mfEditValue = "";
      s.statusMessage = "";
      return { type: "render" };
    }
    if (matchesKey(d, Key.tab) || matchesKey(d, Key.enter) || d === "\r") {
      commitManageTextField(s);
      s.mfEditing = false;
      s.mfEditValue = "";
      return { type: "save_config" };
    }
    if (d === "\x15") {
      s.mfEditValue = "";
      return { type: "render" };
    }
    const clean = cleanTextInput(d);
    const field = manageTextField(s.mfIdx);
    if (field === "mfOAuthJsonPath" && clean && looksLikeOAuthJsonText(s.mfEditValue + clean)) {
      s.mfOAuthJsonRaw = (s.mfEditValue + clean).trim();
      s.mfOAuthJsonPath = "";
      s.mfEditing = false;
      s.mfEditValue = "";
      s.statusMessage = "OAuth JSON pasted. It will be imported into Pi auth.json.";
      s.statusType = "success";
      return { type: "save_config" };
    }
    return ed(s, "mfEditValue", d);
  }
  if (matchesKey(d, Key.tab) || matchesKey(d, Key.enter) || d === "\r") {
    if (manageTextField(s.mfIdx)) {
      s.mfEditing = true;
      s.mfEditValue = getManageTextValue(s, s.mfIdx);
      s.statusMessage = "";
      return { type: "render" };
    }
    if (s.providerOriginalId) s.providerId = s.providerOriginalId;
    s.step = "select_models";
    return { type: "render" };
  }
  if (matchesKey(d, Key.up)) {
    s.mfIdx = Math.max(0, s.mfIdx - 1);
    return { type: "render" };
  }
  if (matchesKey(d, Key.down)) {
    s.mfIdx = Math.min(8, s.mfIdx + 1);
    return { type: "render" };
  }
  const TG: Record<number, { get: () => number; set: (v: number) => void; max: number }> = {
    2: {
      get: () => s.apiTypeIdx,
      set: (v) => {
        setManagedApiChoice(s, v);
      },
      max: API_CHOICES.length - 1,
    },
    5: {
      get: () => Math.max(0, oauthProviderChoicesForApi(s.apiType).indexOf(selectedManagedOAuthProvider(s))),
      set: (v) => {
        const current = Math.max(0, oauthProviderChoicesForApi(s.apiType).indexOf(selectedManagedOAuthProvider(s)));
        moveManagedOAuthProvider(s, v - current);
      },
      max: oauthProviderChoicesForApi(s.apiType).length - 1,
    },
    7: {
      get: () => s.mfAuth,
      set: (v) => {
        s.mfAuth = v;
      },
      max: 2,
    },
  };
  const t = TG[s.mfIdx];
  if (t && (matchesKey(d, Key.left) || matchesKey(d, Key.right))) {
    const dir = matchesKey(d, Key.right) ? 1 : -1;
    t.set((((t.get() + dir) % (t.max + 1)) + (t.max + 1)) % (t.max + 1));
    return { type: "save_config" };
  }
  if (manageTextField(s.mfIdx)) {
    const clean = cleanTextInput(d);
    if (clean) {
      if (s.mfIdx === 6 && looksLikeOAuthJsonText(clean)) {
        s.mfOAuthJsonRaw = clean.trim();
        s.mfOAuthJsonPath = "";
        s.statusMessage = "OAuth JSON pasted. It will be imported into Pi auth.json.";
        s.statusType = "success";
        return { type: "save_config" };
      }
      s.mfEditing = true;
      s.mfEditValue = getManageTextValue(s, s.mfIdx) + clean;
      return { type: "render" };
    }
  }
  return null;
}

function manageTextField(index: number): TextField | undefined {
  const fields: Record<number, TextField> = {
    0: "providerId",
    1: "providerName",
    3: "baseUrl",
    4: "apiKey",
    6: "mfOAuthJsonPath",
    8: "mfHeaders",
  };
  return fields[index];
}

function getManageTextValue(s: WizardState, index: number): string {
  const field = manageTextField(index);
  return field ? String((s as any)[field] || "") : "";
}

function commitManageTextField(s: WizardState): void {
  const field = manageTextField(s.mfIdx);
  if (!field) return;
  if (field === "mfOAuthJsonPath" && looksLikeOAuthJsonText(s.mfEditValue)) {
    s.mfOAuthJsonRaw = s.mfEditValue.trim();
    s.mfOAuthJsonPath = "";
    s.statusMessage = "OAuth JSON pasted. It will be imported into Pi auth.json.";
    s.statusType = "success";
    return;
  }
  if (field === "mfOAuthJsonPath") s.mfOAuthJsonRaw = "";
  (s as any)[field] = s.mfEditValue;
}

type TextField =
  | "baseUrl"
  | "apiKey"
  | "oauthJsonPath"
  | "providerId"
  | "providerName"
  | "mfOAuthJsonPath"
  | "mfHeaders"
  | "mfEditValue"
  | "editContextWindow"
  | "editMaxTokens"
  | "editCostInput"
  | "editCostOutput"
  | "editThinkingMap"
  | "compatJsonDraft"
  | "modelFilter"
  | "discoveryStatus"
  | "statusMessage";
function ed(s: WizardState, f: TextField, d: string): WizardAction | null {
  if (matchesKey(d, Key.backspace)) {
    (s as any)[f] = (s as any)[f].slice(0, -1);
    return { type: "render" };
  }
  const clean = cleanTextInput(d);
  if (clean) {
    (s as any)[f] += clean;
    return { type: "render" };
  }
  return null;
}

function cleanTextInput(d: string): string {
  return d.replace(/\x1b\[[0-9;]*[~a-zA-Z]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function oauthJsonDisplay(pathValue: string, rawValue: string, empty = "(empty)"): string {
  if (rawValue) return "(pasted OAuth JSON)";
  return pathValue || empty;
}
