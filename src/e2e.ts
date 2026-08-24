// E2E test: run with `npx tsx src/e2e.ts`
import { createWizardState, handleWizardInput } from "./wizard";
import { readConfig, writeConfig, addProvider, replaceProvider } from "./models-config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-custom-provider-e2e-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = testDir;

let ok = 0,
  fail = 0;
function t(name: string, fn: () => boolean) {
  try {
    if (fn()) {
      ok++;
    } else {
      console.log("FAIL:", name);
      fail++;
    }
  } catch (e: any) {
    console.log("CRASH:", name, e.message);
    fail++;
  }
}

const ENTER = "\r",
  ESC = "\x1b",
  UP = "\x1b[A",
  DOWN = "\x1b[B",
  LEFT = "\x1b[D";
const M = (id: string, sel = false) => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 16384,
  selected: sel,
  edited: false,
});

// ─── Setup ───────────────────────────────────────────────────────
writeConfig({ providers: {} });

// ─── 1. CREATE provider with apiKey ──────────────────────────────
t("CREATE: wizard saves apiKey", () => {
  const s = createWizardState([]);
  s.step = "api_type";
  handleWizardInput(s, ENTER);
  s.baseUrl = "https://test.com/v1";
  handleWizardInput(s, ENTER);
  for (const c of "sk-test-key-123") handleWizardInput(s, c);
  handleWizardInput(s, ENTER);
  for (const c of "test-prov") handleWizardInput(s, c);
  handleWizardInput(s, ENTER); // discover

  // Simulate discovered models + save
  s.discoveredModels = [M("m1", true), M("m2", false)];
  s.discoveryLoading = false;
  s.step = "review";
  handleWizardInput(s, ENTER); // save action

  // Execute save
  writeConfig(
    addProvider(readConfig(), s.providerId, {
      baseUrl: s.baseUrl,
      api: s.apiType,
      apiKey: s.apiKey || readConfig().providers[s.providerId]?.apiKey || undefined,
      authHeader: true,
      models: s.discoveredModels
        .filter((m) => m.selected)
        .map((m) => ({
          id: m.id,
          input: m.input,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
        })),
    }),
  );

  const p = readConfig().providers["test-prov"];
  return p.apiKey === "sk-test-key-123";
});

// ─── 2. READ: apiKey persisted ───────────────────────────────────
t("READ: apiKey in file after re-enter", () => {
  const p = readConfig().providers["test-prov"];
  return p?.apiKey === "sk-test-key-123";
});

// ─── 3. BUG: apiKey NOT lost when s.apiKey empty ─────────────────
t("BUG FIX: apiKey preserved when s.apiKey empty", () => {
  const cfg = readConfig();
  const p = cfg.providers["test-prov"];
  const emptyApiKey = "";
  writeConfig(
    addProvider(cfg, "test-prov", {
      ...p,
      baseUrl: p.baseUrl,
      api: p.api,
      apiKey: emptyApiKey || cfg.providers["test-prov"]?.apiKey || undefined,
      models: p.models || [],
    }),
  );
  return readConfig().providers["test-prov"].apiKey === "sk-test-key-123";
});

// ─── 4. ADD MODEL: apiKey available for discovery ────────────────
t("ADD MODEL: apiKey loadable from config", () => {
  const p = readConfig().providers["test-prov"];
  const loadedApiKey = p.apiKey || "";
  return loadedApiKey === "sk-test-key-123";
});

// ─── 5. EDIT CONFIG: save preserves apiKey ───────────────────────
t("EDIT CONFIG: apiKey survives config save", () => {
  const cfg = readConfig();
  const p = cfg.providers["test-prov"];
  const s_apiKey = p.apiKey || "";
  writeConfig(
    addProvider(cfg, "test-prov", {
      ...p,
      baseUrl: "https://changed.com",
      api: p.api,
      apiKey: s_apiKey || p.apiKey,
      models: p.models || [],
    }),
  );
  return readConfig().providers["test-prov"].apiKey === "sk-test-key-123";
});

// ─── 6. SAVE MODELS: {...p} preserves apiKey ─────────────────────
t("SAVE MODELS: {...p} preserves apiKey", () => {
  const cfg = readConfig();
  const p = cfg.providers["test-prov"];
  writeConfig(
    addProvider(cfg, "test-prov", {
      ...p,
      models: [M("new-model")].map((m) => ({
        id: m.id,
        input: m.input,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
      })),
    }),
  );
  return readConfig().providers["test-prov"].apiKey === "sk-test-key-123";
});

// ─── 7. FILTER + Space + Enter saves selected ────────────────────
t("FILTER: Space toggles in filter mode", () => {
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "discover";
  s.discoveredModels = [M("a"), M("b")];
  s.modelCursor = 0;
  handleWizardInput(s, "/");
  if (s.modelFiltering !== true) return false;
  handleWizardInput(s, " ");
  if (s.discoveredModels[0].selected !== true) return false;
  if (s.modelFilter !== "") return false; // space NOT appended
  return true;
});

t("EDIT MODELS: Space selection auto-saves", () => {
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "edit_models";
  s.discoveredModels = [M("existing", true)];
  s.modelCursor = 0;
  const action = handleWizardInput(s, " ");
  return action?.type === "save_models" && s.discoveredModels[0].selected === false;
});

t("ADD MODEL: API-discovered selection auto-saves", () => {
  const s = createWizardState([]);
  s.step = "select_models";
  s.providerId = "existing";
  s.providerOriginalId = "existing";
  s.selectModelsFrom = "discover";
  s.discoveredModels = [M("api-model", false)];
  s.modelCursor = 0;
  const action = handleWizardInput(s, " ");
  return action?.type === "save_models" && s.discoveredModels[0].selected === true;
});

// ─── 8. DISCOVERY: Enter saves only selected ─────────────────────
t("DISCOVERY: Enter saves selected only", () => {
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "discover";
  s.discoveredModels = [M("a", false), M("b", true)];
  s.modelCursor = 0;
  const a = handleWizardInput(s, ENTER);
  if (a?.type !== "save_models") return false;
  const selected = s.discoveredModels.filter((m) => m.selected);
  return selected.length === 1 && selected[0].id === "b";
});

// ─── 9. DELETE: d removes model ──────────────────────────────────
t("DELETE: removes correct model", () => {
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "edit_models";
  s.discoveredModels = [M("keep"), M("delete")];
  s.modelCursor = 1;
  const a = handleWizardInput(s, "d");
  return a?.type === "save_models" && s.discoveredModels.length === 1 && s.discoveredModels[0].id === "keep";
});

// ─── 10. EDIT MODEL: toggle reasoning ────────────────────────────
t("EDIT: toggle reasoning + auto-save", () => {
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "edit_models";
  s.discoveredModels = [M("m1")];
  s.modelCursor = 0;
  handleWizardInput(s, ENTER);
  if (s.step !== "edit_model") return false;
  const toggleAction = handleWizardInput(s, LEFT); // toggle reasoning + save
  s.editFieldIdx = 2;
  const textAction = handleWizardInput(s, "\x7f"); // 128000 -> 12800 + save
  return (
    toggleAction?.type === "save_models" &&
    textAction?.type === "save_models" &&
    s.discoveredModels[0].reasoning === true &&
    s.discoveredModels[0].contextWindow === 12800
  );
});

// ─── 11. ESC chain ───────────────────────────────────────────────
t("ESC: navigation chain", () => {
  const cases: [string, string][] = [
    ["api_type", "choose_provider"],
    ["base_url", "api_type"],
    ["api_key", "base_url"],
    ["provider_id", "api_key"],
    ["edit_model", "select_models"],
    ["review", "select_models"],
    ["manage_config", "select_models"],
  ];
  return cases.every(([from, to]) => {
    const s = createWizardState([]);
    s.step = from as any;
    s.providerId = "x";
    s.discoveredModels = [M("m")];
    handleWizardInput(s, ESC);
    return s.step === to;
  });
});

// ─── 12. Add Model triggers discover_edit ────────────────────────
t("ADD MODEL: triggers discover_edit", () => {
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "edit_models";
  s.discoveredModels = [M("m1")];
  s.modelCursor = 1; // on [+] Add Model
  const a = handleWizardInput(s, ENTER);
  return a?.type === "discover_edit";
});

// ─── 13. Edit Config triggers load_config ────────────────────────
t("EDIT CONFIG: triggers load_config", () => {
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "edit_models";
  s.discoveredModels = [M("m1")];
  s.modelCursor = 2; // on Edit Config
  const a = handleWizardInput(s, ENTER);
  return a?.type === "load_config";
});

// ─── 14. Provider list refreshes ─────────────────────────────────
t("REFRESH: provider list after save", () => {
  const cfg = readConfig();
  const list = Object.entries(cfg.providers).map(([id, p]) => ({ id, modelCount: p.models?.length || 0 }));
  return list.some((p) => p.id === "test-prov");
});

// ─── 15. Provider metadata can be renamed and updated ───────────
t("EDIT PROVIDER: rename and display name persist", () => {
  const cfg = readConfig();
  const provider = cfg.providers["test-prov"];
  writeConfig(
    replaceProvider(cfg, "test-prov", "renamed-provider", {
      ...provider,
      name: "Renamed Provider",
      apiKey: "updated-key",
    }),
  );
  const updated = readConfig();
  return (
    !updated.providers["test-prov"] &&
    updated.providers["renamed-provider"]?.name === "Renamed Provider" &&
    updated.providers["renamed-provider"]?.apiKey === "updated-key"
  );
});

// ─── Cleanup ─────────────────────────────────────────────────────
if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
fs.rmSync(testDir, { recursive: true, force: true });

console.log(`\n${ok}/${ok + fail} passed${fail > 0 ? `, ${fail} FAILED` : ""}`);
process.exitCode = fail > 0 ? 1 : 0;
