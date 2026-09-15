// Test wizard state machine — run: npx tsx src/test.ts
import { createWizardState, renderWizard, handleWizardInput } from "./wizard";
import { importConfig, mergeSelectedModels, removeProvider, replaceProvider } from "./models-config";
import { listModelPresets, prefetchModelCatalog, recommendModels, toModelCost } from "./discovery";
import { importPastedOAuthJson, readOAuthCredential } from "./oauth";
import { syncConfiguredProviders } from "./provider-registry";
import { API_CHOICES, OAUTH_PROVIDER_CHOICES, oauthProviderSupportsApi } from "./pi-catalog";
import { setManagedApiChoice } from "./provider-flow";
import { createAuthInteraction } from "./index";
import { Key } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { KnownApi } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

// ─── Test 4: API type → base_url → provider_id → auth ───────────
{
  const s = createWizardState([]);
  s.step = "api_type";
  s.apiTypeIdx = 0;
  s.apiType = "openai-completions";
  handleWizardInput(s, mockEnter());
  assert(s.step === "base_url", "api_type -> base_url");

  s.baseUrl = "https://api.openai.com/v1";
  handleWizardInput(s, mockEnter());
  assert(s.step === "provider_id", "base_url -> provider_id before auth");

  s.providerId = "my-test";
  handleWizardInput(s, mockTab());
  assert(s.step === "oauth_provider", "provider_id -> oauth_provider so auth mode is explicit");

  handleWizardInput(s, mockEnter());
  assert(s.step === "api_key", "OAuth Provider None -> api_key");

  const a = handleWizardInput(s, mockTab());
  assert(s.step === "discovering", "api_key -> discovering");
  assert(a?.type === "discover", "emits discover action");
}

// ─── OAuth API enters OAuth provider selection ──────────────────
{
  const s = createWizardState([]);
  s.step = "api_type";
  s.apiType = "openai-codex-responses";
  handleWizardInput(s, mockEnter());
  assert(s.step === "base_url", "OAuth API -> base_url");
  s.baseUrl = "https://chatgpt.com/backend-api";
  handleWizardInput(s, mockEnter());
  assert(s.step === "provider_id", "OAuth API base_url -> provider_id");
  s.providerId = "codex-test";
  handleWizardInput(s, mockEnter());
  assert(s.step === "oauth_provider", "OAuth API provider_id -> oauth_provider");
  assert(s.oauthProviderIdx > 0, "OAuth API selects a default OAuth provider");
  const rendered = renderWizard(s, 100, mockTheme).join("\n");
  assert(rendered.includes("OpenAI Codex"), "Codex API shows OpenAI Codex OAuth provider");
  assert(!rendered.includes("None"), "Codex API hides None because it has no API-key auth");
  assert(!rendered.includes("API Key"), "Codex API hides API key auth because it is not supported");
  assert(!rendered.includes("xAI"), "Codex API hides OAuth providers that do not support Codex API");
}

// ─── API-key APIs default to API key even when OAuth exists ──────
{
  const s = createWizardState([]);
  s.step = "api_type";
  s.apiType = "openai-completions";
  s.apiTypeIdx = API_CHOICES.indexOf("openai-completions");
  handleWizardInput(s, mockEnter());
  s.baseUrl = "https://api.openai.com/v1";
  handleWizardInput(s, mockEnter());
  s.providerId = "openai-key-provider";
  handleWizardInput(s, mockEnter());
  assert(s.step === "oauth_provider", "API-key API still shows auth mode selection");
  assert(OAUTH_PROVIDER_CHOICES[s.oauthProviderIdx] === "none", "API-key API defaults to None instead of OAuth");
  assert(renderWizard(s, 100, mockTheme).join("\n").includes("API Key"), "API-key API labels the non-OAuth choice clearly");
  handleWizardInput(s, mockEnter());
  assert(s.step === "api_key", "default None continues to API key input");
}

// ─── APIs with several OAuth providers are still selectable ─────
{
  const s = createWizardState([]);
  s.step = "api_type";
  s.apiType = "anthropic-messages";
  handleWizardInput(s, mockEnter());
  s.baseUrl = "https://api.anthropic.com";
  handleWizardInput(s, mockEnter());
  s.providerId = "anthropic-test";
  handleWizardInput(s, mockEnter());
  assert(s.step === "oauth_provider", "multi-provider OAuth API still reaches OAuth provider selection");
  handleWizardInput(s, mockDown());
  const provider = OAUTH_PROVIDER_CHOICES[s.oauthProviderIdx];
  assert(provider !== "none", "can choose a Pi OAuth provider for a shared API type");
  assert(oauthProviderSupportsApi(provider, "anthropic-messages"), "chosen OAuth provider supports the current API type");
}

// ─── OAuth provider can use a JSON credential path ───────────────
{
  const s = createWizardState([]);
  s.step = "oauth_provider";
  s.apiType = "openai-completions";
  s.providerId = "oauth-json-test";
  handleWizardInput(s, mockDown());
  assert(s.oauthProviderIdx > 0, "oauth provider selector moves through supported providers");
  assert(oauthProviderSupportsApi(OAUTH_PROVIDER_CHOICES[s.oauthProviderIdx], "openai-completions"), "oauth provider supports the selected API");
  handleWizardInput(s, mockEnter());
  assert(s.step === "oauth_json_path", "oauth provider -> oauth_json_path");
  for (const c of "~/.pi/agent/auth.json") handleWizardInput(s, c);
  const a = handleWizardInput(s, mockEnter());
  assert(s.step === "discovering" && s.oauthJsonPath.endsWith("auth.json"), "oauth JSON path discovers after provider id");
  assert(a?.type === "discover", "OAuth JSON path uses file-backed discovery");
  assert(!(a?.payload as any)?.forceOAuthLogin, "OAuth JSON path does not force browser login");
}

// ─── OAuth API default URL replaces another OAuth default URL ────
{
  const s = createWizardState([]);
  const codexIndex = API_CHOICES.indexOf("openai-codex-responses");
  if (codexIndex >= 0) {
    s.step = "api_type";
    s.apiTypeIdx = codexIndex;
    s.apiType = "openai-codex-responses";
    s.baseUrl = "https://api.x.ai/v1";
    handleWizardInput(s, mockEnter());
    assert(s.baseUrl === "https://chatgpt.com/backend-api", "Codex API replaces stale xAI OAuth default URL");
  }
}

// ─── OAuth API keeps a custom base URL ──────────────────────────
{
  const s = createWizardState([]);
  const codexIndex = API_CHOICES.indexOf("openai-codex-responses");
  if (codexIndex >= 0) {
    s.step = "api_type";
    s.apiTypeIdx = codexIndex;
    s.apiType = "openai-codex-responses";
    s.baseUrl = "https://proxy.example.test/codex";
    handleWizardInput(s, mockEnter());
    assert(s.baseUrl === "https://proxy.example.test/codex", "Codex API keeps a custom base URL");
  }
}

// ─── Manage config API change follows OAuth default URL rules ───
{
  const codexIndex = API_CHOICES.indexOf("openai-codex-responses");
  if (codexIndex >= 0) {
    const s = {
      apiType: "openai-completions" as KnownApi,
      apiTypeIdx: 0,
      baseUrl: "https://api.x.ai/v1",
      mfOAuthProvider: 0,
    };
    setManagedApiChoice(s, codexIndex);
    assert(s.baseUrl === "https://chatgpt.com/backend-api", "managed API change replaces stale OAuth default URL");
  }
}

// ─── Empty OAuth JSON path uses stored OAuth when available ─────
{
  const s = createWizardState([]);
  s.step = "oauth_provider";
  s.apiType = "openai-codex-responses";
  s.providerId = "codex-new";
  handleWizardInput(s, mockEnter());
  const a = handleWizardInput(s, mockEnter());
  assert(a?.type === "discover", "empty OAuth JSON path starts the unified auth/discovery action");
  assert(!(a?.payload as any)?.forceOAuthLogin, "empty OAuth JSON path does not force re-login");
  assert(s.step === "discovering", "empty OAuth JSON path starts discovery");
  assert(s.statusType !== "error", "empty OAuth JSON path does not error");
}

// ─── OAuth login requires a Provider ID ─────────────────────────
{
  const s = createWizardState([]);
  s.step = "oauth_json_path";
  s.apiType = "openai-codex-responses";
  s.providerId = "";
  const a = handleWizardInput(s, mockEnter());
  assert(a?.type === "render", "OAuth JSON cannot discover without provider id");
  assert(s.step === "provider_id", "missing provider id returns to Provider ID step");
  assert(s.statusType === "error", "missing provider id is shown as an error");
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

// ─── Provider rename preserves settings and unrelated providers ─
{
  const provider = {
    name: "Old Name",
    baseUrl: "https://example.test",
    api: "openai-completions" as const,
    apiKey: "secret",
    models: [],
  };
  const config = { providers: { old: provider, keep: { ...provider, name: "Keep" } } };
  const result = replaceProvider(config, "old", "renamed", { ...provider, name: "New Name" });
  assert(!result.providers.old, "provider rename removes the previous ID");
  assert(result.providers.renamed?.name === "New Name", "provider rename saves the display name");
  assert(result.providers.renamed?.apiKey === "secret", "provider rename preserves the API key");
  assert(result.providers.keep?.name === "Keep", "provider rename preserves unrelated providers");
}

// ─── Existing provider text fields edit safely before saving ─────
{
  const s = createWizardState([]);
  s.step = "manage_config";
  s.providerId = "provider-a";
  s.providerOriginalId = "provider-a";

  s.mfIdx = 1;
  const nameEdit = handleWizardInput(s, mockEnter());
  assert(nameEdit?.type === "render" && s.mfEditing, "enter starts provider name editing");
  handleWizardInput(s, "A");
  const nameSave = handleWizardInput(s, mockEnter());
  assert(nameSave?.type === "save_config" && s.providerName === "A", "provider name saves after confirm");

  s.mfIdx = 4;
  handleWizardInput(s, mockEnter());
  handleWizardInput(s, "k");
  const keySave = handleWizardInput(s, mockEnter());
  assert(keySave?.type === "save_config" && s.apiKey === "k", "provider API key saves after confirm");

  s.mfIdx = 2;
  const apiAction = handleWizardInput(s, "\x1b[C");
  assert(apiAction?.type === "save_config", "provider API type auto-saves when changed");

  s.mfIdx = 0;
  handleWizardInput(s, mockEnter());
  handleWizardInput(s, mockBackspace());
  const idSave = handleWizardInput(s, mockEnter());
  assert(idSave?.type === "save_config" && s.providerId === "provider-", "provider ID rename saves after confirm");
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

// ─── Config import does not infer OAuth from API type ───────────
{
  const config = importConfig(
    JSON.stringify({
      providers: {
        "codex-with-key": {
          baseUrl: "https://example.test",
          api: "openai-codex-responses",
          apiKey: "sk-test",
          models: [],
        },
      },
    }),
  );
  const provider = config.providers["codex-with-key"];
  assert(provider?.apiKey === "sk-test", "API key is preserved for Codex API when OAuth was not selected");
  assert(!provider?.oauthProvider, "OAuth provider is not inferred from API type");
}

// ─── Empty API-key providers do not request auth headers ─────────
{
  const config = importConfig(
    JSON.stringify({
      providers: {
        dgx: {
          baseUrl: "http://int0v.cd.zzdt.qihoo.net:18888/v1",
          api: "openai-completions",
          authHeader: true,
          models: [],
        },
      },
    }),
  );
  assert(config.providers.dgx?.authHeader === false, "empty API-key provider disables Authorization header");
}

// ─── Pi catalog choices come from installed pi-ai ───────────────
{
  const piOAuthProviders = builtinProviders()
    .filter((provider) => provider.auth?.oauth)
    .map((provider) => provider.id)
    .sort();
  const pluginOAuthProviders = OAUTH_PROVIDER_CHOICES.filter((provider) => provider !== "none").sort();
  assert(
    JSON.stringify(pluginOAuthProviders) === JSON.stringify(piOAuthProviders),
    "OAuth provider choices exactly match Pi providers with auth.oauth",
  );
  assert(API_CHOICES.includes("pi-messages"), "API choices include Pi's dynamic Radius API");
  assert(OAUTH_PROVIDER_CHOICES.includes("openai-codex"), "OAuth choices include Pi's OpenAI Codex provider");
}

// ─── OAuth JSON auth path does not expose login ─────────────────
{
  let registered: any;
  const pi = {
    registerProvider(provider: unknown) {
      registered = provider;
    },
    unregisterProvider() {},
  };
  syncConfiguredProviders(pi as any, {
    providers: {
      "codex-json": {
        baseUrl: "https://chatgpt.com/backend-api",
        api: "openai-codex-responses",
        oauthProvider: "openai-codex",
        oauthJsonPath: "/tmp/oauth.json",
        headers: { "X-Test": "1" },
        models: [],
      },
    },
  });
  assert(!!registered?.auth?.apiKey, "OAuth JSON path registers file-backed auth");
  assert(!registered?.auth?.oauth, "OAuth JSON path does not register browser login");
  assert(registered?.headers?.["X-Test"] === "1", "OAuth provider registration preserves custom headers");
}

// ─── Configured API-key providers are registered immediately ─────
{
  let registered: any;
  const pi = {
    registerProvider(provider: unknown) {
      registered = provider;
    },
    unregisterProvider() {},
  };
  syncConfiguredProviders(pi as any, {
    providers: {
      dgx: {
        baseUrl: "http://int0v.cd.zzdt.qihoo.net:18888/v1",
        api: "openai-completions",
        authHeader: true,
        models: [
          {
            id: "deepseek-v4-flash-0731",
            name: "DeepSeek V4 Flash 0731",
            reasoning: true,
            input: ["text"],
            contextWindow: 1000000,
            maxTokens: 384000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  });
  assert(registered?.id === "dgx", "configured API-key provider is registered as a runtime provider");
  assert(registered?.getModels?.()[0]?.id === "deepseek-v4-flash-0731", "configured API-key provider exposes configured models");
  assert(!!registered?.auth?.apiKey, "configured API-key provider reports configured auth");
  const resolved = await registered?.auth?.apiKey?.resolve?.({});
  assert(resolved?.auth?.apiKey === "unused", "configured API-key provider supplies a placeholder key to Pi API implementations");
  assert(resolved?.auth?.headers?.Authorization === null, "configured API-key provider suppresses the Authorization header");
}

// ─── Explicit OAuth JSON path failures are surfaced ─────────────
{
  let threw = false;
  try {
    readOAuthCredential("codex-json", "openai-codex", "/tmp/pi-custom-provider-missing-oauth-json-file.json");
  } catch {
    threw = true;
  }
  assert(threw, "missing explicit OAuth JSON file throws instead of falling back to API-key discovery");
}

// ─── Pasted OAuth JSON imports into Pi auth.json ─────────────────
{
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-custom-provider-auth-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    importPastedOAuthJson(
      "codex-pasted",
      "openai-codex",
      JSON.stringify({
        tokens: {
          access_token: "access-from-paste",
          refresh_token: "refresh-from-paste",
          expires_at: 1798790400000,
        },
      }),
    );
    const auth = JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf-8"));
    assert(auth["codex-pasted"]?.type === "oauth", "pasted OAuth JSON is stored as Pi OAuth");
    assert(auth["codex-pasted"]?.access === "access-from-paste", "pasted OAuth JSON is stored under provider id");
    assert(!fs.existsSync(path.join(agentDir, "oauth-json")), "pasted OAuth JSON does not create plugin-owned credential files");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
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
  const supportedApis = new Set<KnownApi>([
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
      model: provider.getModels().find((model) => supportedApis.has(model.api as KnownApi) && model.compat),
    }))
    .find((entry) => entry.model);

  assert(!!source?.model, "pi-ai exposes a model with compatibility recommendations");
  if (source?.model && source.provider.baseUrl) {
    const candidates = recommendModels([{ id: source.model.id, name: source.model.id }], "custom-provider", {
      baseUrl: source.provider.baseUrl,
      api: source.model.api as KnownApi,
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

  const toggle = handleWizardInput(s, " ");
  assert(toggle?.type === "save_models", "space auto-saves model selection for an existing provider");
  assert(s.discoveredModels[0].selected === true, "space selects the highlighted existing model");

  const selectAll = handleWizardInput(s, "a");
  assert(selectAll?.type === "save_models", "select all auto-saves for an existing provider");
  assert(
    s.discoveredModels.every((model) => model.selected),
    "select all selects every model",
  );

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

// ─── Existing provider filter selection auto-saves ──────────────
{
  const s = createWizardState([]);
  s.step = "select_models";
  s.selectModelsFrom = "edit_models";
  s.discoveredModels = [
    {
      id: "gpt-existing",
      name: "gpt-existing",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: true,
      edited: false,
    },
  ];
  handleWizardInput(s, "/");
  handleWizardInput(s, "g");
  const toggle = handleWizardInput(s, " ");
  assert(toggle?.type === "save_models", "space auto-saves an existing provider while filtering");
  assert(s.discoveredModels[0].selected === false, "filtered space toggles the visible model");
}

// ─── API discovery for an existing provider also auto-saves ─────
{
  const s = createWizardState([]);
  s.step = "select_models";
  s.providerId = "existing-provider";
  s.providerOriginalId = "existing-provider";
  s.selectModelsFrom = "discover";
  s.discoveredModels = [
    {
      id: "api-discovered-model",
      name: "api-discovered-model",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: false,
      edited: false,
    },
  ];
  const toggle = handleWizardInput(s, " ");
  assert(toggle?.type === "save_models", "API-discovered selection auto-saves for an existing provider");
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

// ─── Test 11: Model editor writes compat as one JSON object ──────
{
  const s = createWizardState([]);
  s.step = "edit_model";
  s.editingModelIdx = 0;
  s.editFieldIdx = 6;
  s.selectModelsFrom = "edit_models";
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
  for (const char of '{"supportsStore":true}') handleWizardInput(s, char);
  const save = handleWizardInput(s, mockEnter());
  assert(save?.type === "save_models", "compatibility JSON saves existing provider models");
  assert(s.step === "edit_model", "valid compatibility JSON returns to model editing");
  assert(s.discoveredModels[0].compat?.supportsStore === true, "saves compatibility JSON");
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

  // Multi-word filters must match across the "provider / model-id" separator.
  assert(
    listModelPresets("openai-completions", "deepseek-v4-flash", "4 flash").length > 0,
    "multi-word preset filters match across the label separator",
  );
  // Region variants are the same model on another endpoint, so they rank as exact matches
  // against the remote catalog. Asserted at the end of this file, after the local-preset
  // checks below, because warming the catalog changes which preset ranks first.

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
  const presetSave = handleWizardInput(s, mockEnter());
  assert(s.step === "edit_model", "enter applies the selected preset and returns to model editing");
  assert(presetSave?.type === "save_models", "applying a preset auto-saves an existing model");
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

  assert(s.step === "edit_model", "auto-saving a preset keeps the editor open for further changes");
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

  handleWizardInput(s, mockEnter());
  handleWizardInput(s, "e");
  s.editFieldIdx = 6;
  handleWizardInput(s, mockEnter());
  handleWizardInput(s, "\x15");
  assert(!s.discoveredModels[0].compat, "Ctrl+U clears all compatibility overrides before saving");
}

// ─── Invalid compat JSON stays in the editor ────────────────────
{
  const s = createWizardState([]);
  s.step = "edit_model";
  s.apiType = "openai-completions";
  s.editingModelIdx = 0;
  s.editFieldIdx = 6;
  s.discoveredModels = [
    {
      id: "custom-openrouter-model",
      name: "custom-openrouter-model",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
      selected: true,
      edited: false,
    },
  ];
  handleWizardInput(s, mockEnter());
  handleWizardInput(s, "{");
  handleWizardInput(s, mockEnter());
  assert(s.step === "edit_compat" && !!s.compatJsonError, "invalid compat JSON stays open with an error");
  handleWizardInput(s, mockBackspace());
  for (const char of '{"openRouterRouting":{"only":["deepinfra"]}}') handleWizardInput(s, char);
  handleWizardInput(s, mockEnter());
  assert(s.step === "edit_model", "valid compat JSON returns to model editing");
  assert(
    JSON.stringify(s.compatDraft.openRouterRouting) === '{"only":["deepinfra"]}',
    "JSON compat values are applied as objects",
  );
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

// ─── OAuth prompt callback race ─────────────────────────────────
{
  const abort = new AbortController();
  let inputCalled = false;
  const auth = createAuthInteraction(
    { exec: async () => undefined } as any,
    {
      ui: {
        select: async () => undefined,
        input: async () => {
          inputCalled = true;
          return "manual-code";
        },
        notify: () => {},
      },
    } as any,
    50,
  );
  const prompt = auth
    .prompt({ type: "manual_code", message: "Paste callback", signal: abort.signal })
    .then(() => false, () => true);
  setTimeout(() => abort.abort(), 5);
  assert(await prompt, "manual OAuth prompt rejects when callback wins");
  assert(!inputCalled, "manual OAuth input is not opened before the delay");
}

{
  const abort = new AbortController();
  let inputCalled = false;
  let signalForwarded = false;
  const auth = createAuthInteraction(
    { exec: async () => undefined } as any,
    {
      ui: {
        select: async () => undefined,
        input: async (_title: string, _placeholder?: string, opts?: { signal?: AbortSignal }) => {
          inputCalled = true;
          signalForwarded = opts?.signal === abort.signal;
          return "manual-code";
        },
        notify: () => {},
      },
    } as any,
    5,
  );
  const value = await auth.prompt({ type: "manual_code", message: "Paste callback", signal: abort.signal });
  assert(value === "manual-code", "manual OAuth prompt still works after the delay");
  assert(inputCalled, "manual OAuth input opens after the delay");
  assert(signalForwarded, "manual OAuth input receives Pi's abort signal");
}

{
  let selectCalled = false;
  const auth = createAuthInteraction(
    { exec: async () => undefined } as any,
    {
      ui: {
        select: async () => {
          selectCalled = true;
          return undefined;
        },
        input: async () => undefined,
        notify: () => {},
      },
    } as any,
    { autoSelectFirst: true },
  );
  const value = await auth.prompt({
    type: "select",
    message: "Choose login method",
    options: [
      { id: "browser", label: "Browser login" },
      { id: "device_code", label: "Device code" },
    ],
  });
  assert(value === "browser", "OAuth login auto-selects the first Pi auth method inside the wizard");
  assert(!selectCalled, "OAuth login does not open a nested select dialog inside the wizard");
}

{
  let inputCalled = false;
  let customManualCalled = false;
  const auth = createAuthInteraction(
    { exec: async () => undefined } as any,
    {
      ui: {
        select: async () => undefined,
        input: async () => {
          inputCalled = true;
          return undefined;
        },
        notify: () => {},
      },
    } as any,
    {
      manualCodePromptDelayMs: 5,
      manualCodePrompt: async (_prompt, delayMs) => {
        customManualCalled = delayMs === 5;
        return "manual-code";
      },
    },
  );
  const value = await auth.prompt({ type: "manual_code", message: "Paste callback" });
  assert(value === "manual-code", "OAuth manual fallback can be handled by the wizard");
  assert(customManualCalled, "OAuth manual fallback receives the configured delay");
  assert(!inputCalled, "OAuth manual fallback does not open a nested input dialog inside the wizard");
}

// ─── Remote catalog: models.dev fills gaps pi-ai does not ship ──
// Runs last: warming the catalog changes which preset ranks first, so the
// local-preset assertions above must execute against the cold (bundled) catalog.
{
  const cold = listModelPresets("openai-completions", "deepseek-v4.1-flash@eu");
  await prefetchModelCatalog();
  const warm = listModelPresets("openai-completions", "deepseek-v4.1-flash@eu");
  if (warm.length > cold.length) {
    assert(
      warm.some((preset) => preset.modelId === "deepseek-v4.1-flash@eu" && preset.recommended),
      "remote catalog supplies region-suffixed presets with exact-match ranking",
    );
    assert(
      warm.some((preset) => preset.modelId.includes("4.1") && preset.modelId.includes("flash")),
      "remote catalog exposes models absent from pi-ai (deepseek-v4.1-flash)",
    );
  } else {
    console.log("  SKIP: models.dev catalog unavailable (offline); remote preset lookup not asserted");
  }
}

// ─── Result ──────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "ALL TESTS PASSED" : `${failed} TESTS FAILED`}`);
process.exitCode = failed > 0 ? 1 : 0;

function mockUp() {
  return "\x1b[A";
}
function mockDown() {
  return "\x1b[B";
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
function mockBackspace() {
  return "\x7f";
}
