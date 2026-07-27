// Test wizard state machine — run: npx tsx src/test.ts
import { createWizardState, renderWizard, handleWizardInput } from "./wizard";
import { Key } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

let failed = 0;
const mockTheme = { fg: (a: string, s: string) => s, bg: (a: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;

function assert(cond: boolean, msg: string) { if (!cond) { console.log(`FAIL: ${msg}`); failed++; } else { console.log(`  OK: ${msg}`); } }

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
  s.step = "api_type"; s.apiTypeIdx = 0; s.apiType = "openai-completions";
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

// ─── Test 6: Model list with edit_models mode ────────────────────
{
  const s = createWizardState([]);
  s.step = "select_models"; s.providerId = "test"; s.selectModelsFrom = "edit_models";
  s.discoveredModels = [
    { id: "m1", name: "m1", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 16384, selected: false, edited: false },
    { id: "m2", name: "m2", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 32000, selected: false, edited: true },
  ];
  s.modelCursor = 0;

  // Enter on model in edit mode → edit
  const a = handleWizardInput(s, mockEnter());
  assert(s.step === "edit_model", "enter on model in edit mode opens editor");

  // e key on model → edit
  s.step = "select_models"; s.modelCursor = 0;
  handleWizardInput(s, "e");
  assert(s.step === "edit_model", "'e' key opens editor");

  // Enter on [+] Add Model → discover_edit
  s.step = "select_models"; s.modelCursor = 2; // f.length position
  const a2 = handleWizardInput(s, mockEnter());
  assert(a2?.type === "discover_edit", "enter on Add Model emits discover_edit");

  // Enter on Edit Config → load_config
  s.step = "select_models"; s.modelCursor = 3; // f.length+1 position
  const a3 = handleWizardInput(s, mockEnter());
  assert(a3?.type === "load_config", "enter on Edit Config emits load_config");
}

// ─── Test 7: Filter mode ─────────────────────────────────────────
{
  const s = createWizardState([]);
  s.step = "select_models"; s.providerId = "test"; s.selectModelsFrom = "discover";
  s.discoveredModels = [
    { id: "gpt-5", name: "gpt-5", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 16384, selected: false, edited: false },
    { id: "claude-4", name: "claude-4", reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 32000, selected: false, edited: false },
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
  handleWizardInput(s, mockEnter());
  assert(s.modelFiltering === false, "enter exits filter mode");
}

// ─── Test 8: Space toggle outside filter ────────────────────────
{
  const s = createWizardState([]);
  s.step = "select_models"; s.selectModelsFrom = "discover";
  s.discoveredModels = [{ id: "m1", name: "m1", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 16384, selected: false, edited: false }];
  s.modelCursor = 0;
  handleWizardInput(s, " ");
  assert(s.discoveredModels[0].selected === true, "space toggles selection");
}

// ─── Test 9: Delete model in edit mode ───────────────────────────
{
  const s = createWizardState([]);
  s.step = "select_models"; s.selectModelsFrom = "edit_models";
  s.discoveredModels = [{ id: "m1", name: "m1", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 16384, selected: false, edited: false }];
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

function mockUp() { return "\x1b[A"; }
function mockTab() { return "\t"; }
function mockEnter() { return "\r"; }
function mockEsc() { return "\x1b"; }
