// Test wizard state machine — run: npx tsx src/test.ts
import { createWizardState, renderWizard, handleWizardInput } from "./wizard";
import { mergeSelectedModels, removeProvider } from "./models-config";
import { listModelPresets, recommendModels, toModelCost } from "./discovery";
import { Key } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ModelAPI } from "./types";
import { mergeProviderCompat, providerCompatKeys } from "./types";

let failed = 0;
const mockTheme = {
  fg: (a: string, s: string) => s,
  bg: (a: string, s: string) => s,
  bold: (s: string) => s,
} as unknown as Theme;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.log(`FAIL: ${msg}`);
    failed++;
  } else {
    console.log(`  OK: ${msg}`);
  }
}

// ─── Test 1: Startup shows choose_provider with Create New ───────
{
  const s = createWizardState([{ id: "test-provider", modelCount: 3 }]);
  assert(s.step === "choose_provider", "starts at choose_provider");
  assert(s.chosenProviderIdx === 0, "cursor on first provider");
  assert(s.existingProviders.length === 1, "has one existing provider");
}

// ─── Test 2: Navigate to Create New ─────────────────────────────
{
  const s = createWizardState([{ id: "test", modelCount: 1 }]);
  handleWizardInput(s, mockUp());
  assert(s.chosenProviderIdx === -1, "cursor on Create New");
}

// ─── Test 3: Select Create New → api_type step ──────────────────
{
  const s = createWizardState([]);
  const a = handleWizardInput(s, mockEnter());
  assert(s.step === "api_type", "enters api_type after Create New");
}

// ─── Test 4: API type → base_url → api_key → provider_id ────────
{
  const s = createWizardState([]);
  s.step = "api_type";
  s.apiTypeIdx = 0;
  s.apiType = "openai-completions";
  handleWizardInput(s, mockEnter());
  assert(s.step === "base_url", "api_type -> base_url");

  s.baseUrl = "https://api.openai.com/v1";
  handleWizardInput(s, mockEnter());
  assert(s.step === "api_key", "base_url -> api_key");

  handleWizardInput(s, mockTab());
  assert(s.step === "provider_id", "api_key -> provider_id");

  s.providerId = "my-test";
  const a = handleWizardInput(s, mockTab());
  assert(s.step === "discovering", "provider_id -> discovering");
  assert(a?.type === "discover", "emits discover action");
}

// ─── Test 5: Select existing provider emits load_models ──────────
{
  const s = createWizardState([{ id: "existing", modelCount: 5 }]);
  s.chosenProviderIdx = 0;
  const a = handleWizardInput(s, mockEnter());
  assert(a?.type === "load_models", "selects existing provider");
  assert(a?.payload === "existing", "payload is provider id");
}

// ─── Delete provider requires confirmation ──────────────────────
{
  const s = createWizardState([
    { id: "keep", modelCount: 1 },
    { id: "remove-me", modelCount: 2 },
  ]);
  s.chosenProviderIdx = 1;
  const prompt = handleWizardInput(s, "d");
  assert(prompt?.type === "render", "delete key opens provider confirmation");
  assert(s.step === "confirm_delete_provider", "shows provider deletion confirmation");
  assert(s.providerId === "remove-me", "confirmation targets selected provider");

  const cancel = handleWizardInput(s, mockEsc());
  assert(cancel?.type === "render" && s.step === "choose_provider", "escape cancels provider deletion");

  handleWizardInput(s, "d");
  const confirm = handleWizardInput(s, mockEnter());
  assert(confirm?.type === "delete_provider", "enter confirms provider deletion");
  assert(confirm?.payload === "remove-me", "delete action includes provider id");
}

// ─── Create New cannot be deleted ───────────────────────────────
{
  const s = createWizardState([{ id: "existing", modelCount: 1 }]);
  s.chosenProviderIdx = -1;
  const a = handleWizardInput(s, "d");
  assert(a === null && s.step === "choose_provider", "delete is ignored on Create New");
}

// ─── Provider deletion preserves other providers ────────────────
{
  const provider = { baseUrl: "https://example.test", api: "openai-completions" as const, models: [] };
  const config = { providers: { keep: provider, "remove-me": provider } };
  const result = removeProvider(config, "remove-me");
  assert(!result.providers["remove-me"], "selected provider is removed from config");
  assert(result.providers.keep === provider, "other providers remain in config");
  assert(config.providers["remove-me"] === provider, "provider removal does not mutate input config");
}

// ─── Model selection is the persisted source of truth ───────────
{
  const existing = [{ id: "remove", reasoning: true }, { id: "edit", name: "Old", futureField: "keep" } as any];
  const selected = mergeSelectedModels(existing, [
    {
      id: "edit",
      name: "Edited",
      reasoning: false,
      input: ["text"],
      contextWindow: 200000,
      maxTokens: 32000,
      selected: true,
      edited: true,
    },
    {
      id: "new",
      name: "new",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: true,
      edited: false,
    },
  ]);
  assert(!selected.some((model) => model.id === "remove"), "deselected or deleted models are removed on save");
  assert(
    (selected.find((model) => model.id === "edit") as any)?.futureField === "keep",
    "editing preserves unknown fields",
  );
  assert(
    selected.some((model) => model.id === "new"),
    "selected recommendations are added on save",
  );
}

// ─── Catalog pricing satisfies Pi's current schema ──────────────
{
  const cost = toModelCost({ input: 0.07, output: 0.14, cache_read: 0.0014 });
  assert(cost?.cacheWrite === 0, "missing cacheWrite is normalized to zero");
  assert(
    ["input", "output", "cacheRead", "cacheWrite"].every((key) => Object.hasOwn(cost!, key)),
    "normalized cost contains every required rate",
  );

  const tiered = toModelCost({ input: 1, output: 2, tiers: [{ tier: { type: "context", size: 200000 }, input: 3 }] });
  assert(
    tiered?.tiers?.[0].output === 0 && tiered.tiers[0].cacheWrite === 0,
    "tier pricing also contains every required rate",
  );
}

// ─── Provider compat follows each pi-ai API schema ──────────────
{
  assert(providerCompatKeys("openai-completions").strict === "supportsStrictMode", "OpenAI uses strict mode");
  assert(providerCompatKeys("anthropic-messages").strict === "supportsStrictTools", "Anthropic uses strict tools");
  const compat = mergeProviderCompat({ futurePiField: "keep", supportsStrictTools: true }, "openai-completions", {
    developerRole: 0,
    reasoningEffort: 0,
    strict: 2,
  });
  assert(compat?.futurePiField === "keep", "saving compat preserves fields the wizard does not manage");
  assert(compat?.supportsStrictMode === false, "provider compat writes the API-specific strict field");
  assert(!Object.hasOwn(compat!, "supportsStrictTools"), "stale strict fields are removed when the API changes");
}

// ─── Catalog URL suggestions preserve distinct full model IDs ───
{
  const catalog = {
    anthropic: { id: "anthropic", name: "Anthropic", models: { "not-selected": {} } },
    openrouter: {
      id: "openrouter",
      name: "OpenRouter",
      models: { "vendor-a/shared": {}, "vendor-b/shared": {} },
    },
  };
  const candidates = recommendModels(
    [],
    "anthropic",
    {
      baseUrl: "https://openrouter.ai/api/v1",
      api: "openai-completions",
      models: [],
    },
    catalog,
  );
  assert(
    candidates.every((model) => model.suggestedBy === "base-url"),
    "base URL produces selectable suggestions",
  );
  assert(
    candidates.some((model) => model.id === "vendor-a/shared") &&
      candidates.some((model) => model.id === "vendor-b/shared"),
    "models with the same leaf id are not incorrectly deduplicated",
  );
}

// ─── Pi recommendations: model id first, URL suggestions second ──
{
  const supportedApis = new Set<ModelAPI>([
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
    "mistral-conversations",
    "azure-openai-responses",
    "openai-codex-responses",
    "bedrock-converse-stream",
    "google-vertex",
  ]);
  const source = builtinProviders()
    .filter((provider) => provider.baseUrl)
    .map((provider) => ({
      provider,
      model: provider.getModels().find((model) => supportedApis.has(model.api as ModelAPI) && model.compat),
    }))
    .find((entry) => entry.model);

  assert(!!source?.model, "pi-ai exposes a model with compatibility recommendations");
  if (source?.model && source.provider.baseUrl) {
    const candidates = recommendModels([{ id: source.model.id, name: source.model.id }], "custom-provider", {
      baseUrl: source.provider.baseUrl,
      api: source.model.api as ModelAPI,
      models: [],
    });
    assert(candidates[0]?.suggestedBy === "model-id", "model-id match stays first in candidate list");
    assert(
      JSON.stringify(candidates[0]?.compat) === JSON.stringify(source.model.compat),
      "model-id match applies pi-ai compat recommendations",
    );
    assert(
      candidates.some((model) => model.suggestedBy === "base-url"),
      "base URL adds selectable suggestions",
    );
  }
}

// ─── Test 6: Model list with edit_models mode ────────────────────
{
  const s = createWizardState([]);
  s.step = "select_models";
  s.providerId = "test";
  s.selectModelsFrom = "edit_models";
  s.discoveredModels = [
    {
      id: "m1",
      name: "m1",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: false,
      edited: false,
    },
    {
      id: "m2",
      name: "m2",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 32000,
      selected: false,
      edited: true,
    },
  ];
  s.modelCursor = 0;

  // Enter on model in edit mode → edit
  const a = handleWizardInput(s, mockEnter());
  assert(s.step === "edit_model", "enter on model in edit mode opens editor");

  // e key on model → edit
  s.step = "select_models";
  s.modelCursor = 0;
  handleWizardInput(s, "e");
  assert(s.step === "edit_model", "'e' key opens editor");

  // Enter on [+] Add Model → discover_edit
  s.step = "select_models";
  s.modelCursor = 2; // f.length position
  const a2 = handleWizardInput(s, mockEnter());
  assert(a2?.type === "discover_edit", "enter on Add Model emits discover_edit");

  // Enter on Edit Config → load_config
  s.step = "select_models";
  s.modelCursor = 3; // f.length+1 position
  const a3 = handleWizardInput(s, mockEnter());
  assert(a3?.type === "load_config", "enter on Edit Config emits load_config");
}

// ─── Test 7: Filter mode ─────────────────────────────────────────
{
  const s = createWizardState([]);
  s.step = "select_models";
  s.providerId = "test";
  s.selectModelsFrom = "discover";
  s.discoveredModels = [
    {
      id: "gpt-5",
      name: "gpt-5",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: false,
      edited: false,
    },
    {
      id: "claude-4",
      name: "claude-4",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 32000,
      selected: false,
      edited: false,
    },
  ];
  s.modelCursor = 0;

  // Enter filter mode
  handleWizardInput(s, "/");
  assert(s.modelFiltering === true, "enters filter mode");
  assert(s.modelFilter === "", "filter starts empty");

  // Type filter text
  handleWizardInput(s, "g");
  handleWizardInput(s, "p");
  assert(s.modelFilter === "gp", "filter accumulates characters");

  // Space in filter mode toggles selection
  handleWizardInput(s, " ");
  assert(s.discoveredModels[0].selected === true, "space toggles selection in filter mode");

  // Enter exits filter mode
  const filterAction = handleWizardInput(s, mockEnter());
  assert(s.modelFiltering === false, "enter exits filter mode");
  assert(filterAction?.type === "render", "exiting a filter does not save configuration");
}

// ─── Test 8: Space toggle outside filter ────────────────────────
{
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "discover";
  s.discoveredModels = [
    {
      id: "m1",
      name: "m1",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: false,
      edited: false,
    },
  ];
  s.modelCursor = 0;
  handleWizardInput(s, " ");
  assert(s.discoveredModels[0].selected === true, "space toggles selection");
}

// ─── Test 11: Model editor configures compat without JSON ────────
{
  const s = createWizardState([]);
  s.step = "edit_model";
  s.editingModelIdx = 0;
  s.editFieldIdx = 6;
  s.discoveredModels = [
    {
      id: "m1",
      name: "m1",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: true,
      edited: false,
    },
  ];
  handleWizardInput(s, mockEnter());
  assert(s.step === "edit_compat", "opens compatibility editor");
  handleWizardInput(s, "\x1b[C");
  const save = handleWizardInput(s, mockEnter());
  assert(save?.type === "render" && s.step === "select_models", "enter saves and exits compatibility editing");
  assert(s.discoveredModels[0].compat?.supportsStore === true, "saves compatibility toggle without JSON");
}

// ─── Complete model presets are ranked and explicitly applied ──
{
  const presets = listModelPresets("openai-completions", "360-deepseek-v4-flash");
  assert(
    presets.some((preset) => preset.modelId === "deepseek-v4-flash" && preset.recommended),
    "vendor-prefixed model IDs suggest the matching pi-ai model preset",
  );
  const expected = listModelPresets("openai-completions", "360-deepseek-v4-flash", "deepseek-v4-flash")[0];
  assert(!!expected, "the DeepSeek model preset can be filtered");

  const s = createWizardState([]);
  s.step = "select_models";
  s.apiType = "openai-completions";
  s.selectModelsFrom = "edit_models";
  s.discoveredModels = [
    {
      id: "360-deepseek-v4-flash",
      name: "360-deepseek-v4-flash",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: true,
      edited: false,
    },
  ];

  handleWizardInput(s, "e");
  handleWizardInput(s, "p");
  assert(s.step === "model_preset", "p opens the complete model preset picker");
  handleWizardInput(s, "/");
  for (const char of "deepseek-v4-flash") handleWizardInput(s, char);
  handleWizardInput(s, mockEnter());
  assert(s.step === "edit_model", "enter applies the selected preset and returns to model editing");
  assert(s.editReasoning === (expected?.model.reasoning ? 1 : 0), "preset copies reasoning support");
  assert(s.editImageInput === (expected?.model.input.includes("image") ? 1 : 0), "preset copies input modalities");
  assert(s.editContextWindow === String(expected?.model.contextWindow), "preset copies the context window");
  assert(s.editMaxTokens === String(expected?.model.maxTokens), "preset copies the output token limit");
  assert(s.editCostInput === String(expected?.model.cost?.input ?? ""), "preset copies input pricing");
  assert(s.editCostOutput === String(expected?.model.cost?.output ?? ""), "preset copies output pricing");
  assert(
    JSON.stringify(s.compatDraft) === JSON.stringify(expected?.model.compat || {}),
    "preset copies explicit pi-ai compat values",
  );
  assert(
    s.editThinkingMap === (expected?.model.thinkingLevelMap ? JSON.stringify(expected.model.thinkingLevelMap) : ""),
    "preset copies the thinking-level map",
  );
  assert(s.modelPresetLabel.includes("deepseek-v4-flash"), "the applied model preset remains visible");

  const save = handleWizardInput(s, mockEnter());
  assert(save?.type === "save_models", "saving a preset writes an existing provider immediately");
  assert(s.step === "select_models", "saving a preset returns to the model list");
  assert(s.discoveredModels[0].id === "360-deepseek-v4-flash", "applying a preset preserves the callable model ID");
  assert(s.discoveredModels[0].name === expected?.model.name, "saving writes the preset model name");
  assert(s.discoveredModels[0].contextWindow === expected?.model.contextWindow, "saving writes preset limits");
  assert(
    JSON.stringify(s.discoveredModels[0].cost) === JSON.stringify(expected?.model.cost),
    "saving writes the complete preset cost metadata",
  );
  assert(
    JSON.stringify(s.discoveredModels[0].compat) === JSON.stringify(expected?.model.compat),
    "saving writes preset compatibility metadata",
  );

  handleWizardInput(s, "e");
  s.editFieldIdx = 6;
  handleWizardInput(s, mockEnter());
  handleWizardInput(s, "p");
  handleWizardInput(s, mockEsc());
  assert(s.step === "edit_compat", "escaping a preset opened from compatibility returns to compatibility");
  handleWizardInput(s, "x");
  handleWizardInput(s, mockEnter());
  assert(!s.discoveredModels[0].compat, "x clears all compatibility overrides before saving");
}

// ─── Filtered model actions target the visible item ─────────────
{
  const item = (id: string) => ({
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 16384,
    selected: true,
    edited: false,
  });
  const editState = createWizardState([]);
  editState.step = "select_models";
  editState.selectModelsFrom = "edit_models";
  editState.discoveredModels = [item("first"), item("second")];
  editState.modelFilter = "second";
  editState.modelCursor = 0;
  handleWizardInput(editState, "e");
  assert(editState.editingModelIdx === 1, "filtered edit resolves the visible model's source index");

  const deleteState = createWizardState([]);
  deleteState.step = "select_models";
  deleteState.selectModelsFrom = "edit_models";
  deleteState.discoveredModels = [item("first"), item("second")];
  deleteState.modelFilter = "second";
  deleteState.modelCursor = 0;
  handleWizardInput(deleteState, "d");
  assert(
    deleteState.discoveredModels.length === 1 && deleteState.discoveredModels[0].id === "first",
    "filtered delete removes the visible model",
  );
}

// ─── Test 9: Delete model in edit mode ───────────────────────────
{
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "edit_models";
  s.discoveredModels = [
    {
      id: "m1",
      name: "m1",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: false,
      edited: false,
    },
  ];
  s.modelCursor = 0;
  const a = handleWizardInput(s, "d");
  assert(a?.type === "save_models", "delete emits save_models");
  assert(s.discoveredModels.length === 0, "model removed");
}

// ─── Test 10: Esc chain ──────────────────────────────────────────
{
  const s = createWizardState([]);
  s.step = "api_type";
  handleWizardInput(s, mockEsc());
  assert(s.step === "choose_provider", "esc from api_type → choose_provider");

  s.step = "select_models";
  const a = handleWizardInput(s, mockEsc());
  assert(s.step === "choose_provider", "esc from select_models → choose_provider");

  s.step = "manage_config";
  handleWizardInput(s, mockEsc());
  assert(s.step === "select_models", "esc from manage_config → select_models");
}

// ─── Result ──────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "ALL TESTS PASSED" : `${failed} TESTS FAILED`}`);
process.exitCode = failed > 0 ? 1 : 0;

function mockUp() {
  return "\x1b[A";
}
function mockTab() {
  return "\t";
}
function mockEnter() {
  return "\r";
}
function mockEsc() {
  return "\x1b";
}
