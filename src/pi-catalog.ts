import type { Api, KnownApi, KnownProvider, Model, Provider } from "@earendil-works/pi-ai";
import * as providerCatalog from "@earendil-works/pi-ai/providers/all";
import { DEFAULT_RADIUS_GATEWAY, getRadiusModelsFromConfig } from "@earendil-works/pi-ai/providers/radius-config";

export const API_CHOICES: KnownApi[] = loadApiChoices();
export const OAUTH_PROVIDER_CHOICES: Array<KnownProvider | "none"> = ["none", ...loadOAuthProviderChoices()];

export function apiLabel(api: KnownApi): string {
  return humanizeId(api);
}

export function apiChoiceIndex(api: KnownApi): number {
  const index = API_CHOICES.indexOf(api);
  return index >= 0 ? index : 0;
}

export function apiChoiceAt(index: number): KnownApi {
  return API_CHOICES[Math.max(0, Math.min(API_CHOICES.length - 1, index))] || API_CHOICES[0];
}

export function defaultApiChoice(): KnownApi {
  return (API_CHOICES.includes("openai-completions") ? "openai-completions" : API_CHOICES[0]) as KnownApi;
}

export function oauthProviderLabel(provider: KnownProvider | "none" | undefined): string {
  if (!provider || provider === "none") return "API Key";
  const builtin = builtinOAuthProviderConfig(provider);
  return builtin?.name || provider;
}

export function normalizeOAuthProvider(value: unknown): KnownProvider | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "none") return undefined;
  return OAUTH_PROVIDER_CHOICES.includes(value as KnownProvider | "none") ? (value as KnownProvider) : undefined;
}

export function normalizeOAuthProviderForApi(value: unknown, api: KnownApi): KnownProvider | undefined {
  const provider = normalizeOAuthProvider(value);
  return provider && oauthProviderSupportsApi(provider, api) ? provider : undefined;
}

export function defaultOAuthProviderForApi(api: KnownApi): KnownProvider | undefined {
  const providers = loadOAuthProviderChoices().filter((provider) => oauthProviderSupportsApi(provider, api));
  return providers.length === 1 ? providers[0] : undefined;
}

export function oauthProviderChoicesForApi(api: KnownApi): Array<KnownProvider | "none"> {
  const providers = loadOAuthProviderChoices().filter((provider) => oauthProviderSupportsApi(provider, api));
  return apiSupportsApiKey(api) ? ["none", ...providers] : providers;
}

export function apiSupportsApiKey(api: KnownApi): boolean {
  return providerCatalog
    .builtinProviders()
    .some((provider) => !!provider.auth?.apiKey && provider.getModels().some((model) => model.api === api));
}

export function oauthProviderSupportsApi(provider: KnownProvider, api: KnownApi): boolean {
  return (
    !!builtinOAuthProviderConfig(provider)
      ?.getModels()
      .some((model) => model.api === api) || dynamicOAuthProviderApi(provider) === api
  );
}

export function defaultApiForOAuth(provider: KnownProvider | undefined): KnownApi | undefined {
  if (!provider) return undefined;
  const model = builtinOAuthProviderConfig(provider)
    ?.getModels()
    .find((item) => typeof item.api === "string");
  return (model?.api as KnownApi | undefined) || dynamicOAuthProviderApi(provider);
}

export function defaultBaseUrlForOAuth(provider: KnownProvider | undefined): string | undefined {
  if (!provider) return undefined;
  return builtinOAuthProviderConfig(provider)?.baseUrl || dynamicOAuthProviderBaseUrl(provider);
}

export function builtinOAuthProviderConfig(oauthProvider: KnownProvider): Provider<Api> | undefined {
  const provider = providerCatalog.builtinProviders().find((item) => item.id === oauthProvider && item.auth?.oauth);
  return provider as Provider<Api> | undefined;
}

function loadOAuthProviderChoices(): KnownProvider[] {
  return providerCatalog
    .builtinProviders()
    .filter((provider) => provider.auth?.oauth)
    .map((provider) => provider.id as KnownProvider);
}

function loadApiChoices(): KnownApi[] {
  const seen = new Set<KnownApi>();
  for (const provider of providerCatalog.builtinProviders()) {
    for (const model of provider.getModels()) {
      if (typeof model.api === "string") seen.add(model.api as KnownApi);
    }
  }
  const radiusModel = probeRadiusModel();
  if (radiusModel) seen.add(radiusModel.api as KnownApi);
  return [...seen];
}

function dynamicOAuthProviderApi(provider: KnownProvider): KnownApi | undefined {
  if (provider !== "radius") return undefined;
  return probeRadiusModel()?.api as KnownApi | undefined;
}

function dynamicOAuthProviderBaseUrl(provider: KnownProvider): string | undefined {
  return provider === "radius" ? DEFAULT_RADIUS_GATEWAY : undefined;
}

function probeRadiusModel(): Model<"pi-messages"> | undefined {
  return getRadiusModelsFromConfig("__probe__", {
    baseUrl: "",
    models: [
      {
        id: "__probe__",
        name: "__probe__",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1,
        maxTokens: 1,
      },
    ],
  })[0];
}

function humanizeId(id: string): string {
  const acronyms = new Set(["api", "ai", "aws", "url", "id", "json", "oauth"]);
  return id
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((word) =>
      acronyms.has(word.toLowerCase()) ? word.toUpperCase() : `${word[0]?.toUpperCase() || ""}${word.slice(1)}`,
    )
    .join(" ");
}
