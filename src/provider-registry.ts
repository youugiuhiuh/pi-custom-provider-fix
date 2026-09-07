import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, ApiKeyAuth, AuthCheck, AuthResult, Model, Provider, ProviderStreams } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { getApiProvider, registerBuiltInApiProviders } from "@earendil-works/pi-ai/compat";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeOAuthProvider } from "./pi-catalog";
import { createOAuthBackedProvider } from "./oauth";
import type { ModelConfig, ModelsConfig, ProviderConfig } from "./types";

const registeredProviders = new Set<string>();

export function syncConfiguredProviders(pi: ExtensionAPI, config: ModelsConfig): void {
  const next = new Set(Object.keys(config.providers));

  for (const id of registeredProviders) {
    if (!next.has(id)) {
      pi.unregisterProvider(id);
      registeredProviders.delete(id);
    }
  }

  for (const [id, provider] of Object.entries(config.providers)) {
    const oauthProvider = normalizeOAuthProvider(provider.oauthProvider);
    if (oauthProvider) {
      pi.registerProvider(createOAuthBackedProvider(id, provider, oauthProvider));
    } else {
      registerApiKeyProvider(pi, id, provider);
    }
    registeredProviders.add(id);
  }
}

function registerApiKeyProvider(pi: ExtensionAPI, id: string, provider: ProviderConfig): void {
  const apiKey = provider.apiKey?.trim() || readStoredApiKey(id);
  if (apiKey) {
    pi.registerProvider(id, {
      name: provider.name || id,
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey,
      headers: provider.headers,
      authHeader: provider.authHeader,
      models: provider.models.map((model) => toProviderModelConfig(provider, model)),
    });
    return;
  }

  pi.registerProvider(createConfiguredApiKeyProvider(id, provider));
}

function createConfiguredApiKeyProvider(id: string, config: ProviderConfig): Provider<Api> {
  return createProvider({
    id,
    name: config.name || id,
    baseUrl: config.baseUrl,
    headers: config.headers,
    auth: { apiKey: configuredApiKeyAuth(config.name || id) },
    models: config.models.map((model) => toModel(id, config, model)),
    api: apiStreams(config.api),
  });
}

function configuredApiKeyAuth(name: string): ApiKeyAuth {
  return {
    name: `${name} API`,
    check: async (): Promise<AuthCheck> => ({ type: "api_key", source: "provider config" }),
    resolve: async (): Promise<AuthResult> => ({
      auth: {
        apiKey: "unused",
        headers: { Authorization: null },
      },
      source: "provider config",
    }),
  };
}

function readStoredApiKey(providerId: string): string | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(agentDir(), "auth.json"), "utf-8"));
    const key = data?.[providerId]?.type === "api_key" ? data[providerId].key : undefined;
    return typeof key === "string" && key.trim() ? key : undefined;
  } catch {
    return undefined;
  }
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function toProviderModelConfig(provider: ProviderConfig, model: ModelConfig) {
  return {
    id: model.id,
    name: model.name || model.id,
    api: model.api || provider.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning || false,
    thinkingLevelMap: model.thinkingLevelMap,
    input: normalizeInput(model.input),
    cost: model.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow || 128000,
    maxTokens: model.maxTokens || 16384,
    headers: model.headers,
    compat: model.compat,
  };
}

function toModel(providerId: string, provider: ProviderConfig, model: ModelConfig): Model<Api> {
  return {
    id: model.id,
    name: model.name || model.id,
    api: (model.api || provider.api) as Api,
    provider: providerId,
    baseUrl: model.baseUrl || provider.baseUrl,
    reasoning: model.reasoning || false,
    thinkingLevelMap: model.thinkingLevelMap,
    input: normalizeInput(model.input),
    cost: model.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow || 128000,
    maxTokens: model.maxTokens || 16384,
    headers: model.headers,
    compat: model.compat,
  };
}

function normalizeInput(input: string[] | undefined): ("text" | "image")[] {
  const normalized = (input || ["text"]).filter((value): value is "text" | "image" => value === "text" || value === "image");
  return normalized.length ? normalized : ["text"];
}

function apiStreams(api: Api): ProviderStreams {
  registerBuiltInApiProviders();
  const provider = getApiProvider(api);
  if (!provider) throw new Error(`No Pi API provider registered for api: ${api}`);
  return provider;
}
