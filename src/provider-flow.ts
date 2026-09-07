import type { KnownApi, KnownProvider } from "@earendil-works/pi-ai";
import {
  API_CHOICES,
  apiChoiceAt,
  apiChoiceIndex,
  apiSupportsApiKey,
  defaultApiChoice,
  defaultBaseUrlForOAuth,
  defaultOAuthProviderForApi,
  normalizeOAuthProvider,
  oauthProviderChoicesForApi,
  OAUTH_PROVIDER_CHOICES,
} from "./pi-catalog";

export interface ProviderSetupFields {
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
}

export interface ManagedProviderAuthFields {
  apiType: KnownApi;
  apiTypeIdx: number;
  baseUrl: string;
  mfOAuthProvider: number;
}

export function resetProviderSetup(s: ProviderSetupFields): void {
  const api = defaultApiChoice();
  s.apiType = api;
  s.apiTypeIdx = apiChoiceIndex(api);
  s.baseUrl = "";
  s.apiKey = "";
  s.oauthProviderIdx = 0;
  s.oauthJsonPath = "";
  s.oauthJsonRaw = "";
  s.providerId = "";
  s.providerOriginalId = "";
  s.providerName = "";
}

export function moveSetupApi(s: ProviderSetupFields, delta: number): void {
  s.apiTypeIdx = clampIndex(s.apiTypeIdx + delta, API_CHOICES.length);
  s.apiType = apiChoiceAt(s.apiTypeIdx);
}

export function confirmSetupApi(s: ProviderSetupFields): void {
  setSetupOAuthProvider(s, apiSupportsApiKey(s.apiType) ? "none" : defaultOAuthProviderForApi(s.apiType) || oauthProviderChoicesForApi(s.apiType)[0] || "none");
}

export function selectedSetupOAuthProvider(s: Pick<ProviderSetupFields, "apiType" | "oauthProviderIdx">): KnownProvider | "none" {
  return selectedOAuthProviderForApi(s.apiType, OAUTH_PROVIDER_CHOICES[s.oauthProviderIdx] || "none");
}

export function setSetupOAuthProvider(
  s: Pick<ProviderSetupFields, "baseUrl" | "oauthProviderIdx">,
  provider: KnownProvider | "none",
): void {
  s.oauthProviderIdx = oauthProviderIndex(provider);
  applyOAuthDefaultBaseUrl(s, provider);
}

export function moveSetupOAuthProvider(s: ProviderSetupFields, delta: number): void {
  const choices = oauthProviderChoicesForApi(s.apiType);
  const current = Math.max(0, choices.indexOf(selectedSetupOAuthProvider(s)));
  setSetupOAuthProvider(s, choices[clampIndex(current + delta, choices.length)] || "none");
}

export function setManagedApiChoice(s: ManagedProviderAuthFields, index: number): void {
  s.apiTypeIdx = clampIndex(index, API_CHOICES.length);
  s.apiType = apiChoiceAt(s.apiTypeIdx);
  setManagedOAuthProvider(s, selectedManagedOAuthProvider(s));
}

export function selectedManagedOAuthProvider(
  s: Pick<ManagedProviderAuthFields, "apiType" | "mfOAuthProvider">,
): KnownProvider | "none" {
  return selectedOAuthProviderForApi(s.apiType, OAUTH_PROVIDER_CHOICES[s.mfOAuthProvider] || "none");
}

export function moveManagedOAuthProvider(s: ManagedProviderAuthFields, delta: number): void {
  const choices = oauthProviderChoicesForApi(s.apiType);
  const current = Math.max(0, choices.indexOf(selectedManagedOAuthProvider(s)));
  setManagedOAuthProvider(s, choices[clampIndex(current + delta, choices.length)] || "none");
}

export function setManagedOAuthProvider(
  s: Pick<ManagedProviderAuthFields, "baseUrl" | "mfOAuthProvider">,
  provider: KnownProvider | "none",
): void {
  s.mfOAuthProvider = oauthProviderIndex(provider);
  applyOAuthDefaultBaseUrl(s, provider);
}

function selectedOAuthProviderForApi(api: KnownApi, selected: KnownProvider | "none"): KnownProvider | "none" {
  const choices = oauthProviderChoicesForApi(api);
  return choices.includes(selected) ? selected : choices[0] || "none";
}

function oauthProviderIndex(provider: KnownProvider | "none"): number {
  const index = OAUTH_PROVIDER_CHOICES.indexOf(provider);
  return index >= 0 ? index : 0;
}

function applyOAuthDefaultBaseUrl(s: { baseUrl: string }, provider: KnownProvider | "none"): void {
  const oauthProvider = normalizeOAuthProvider(provider);
  const baseUrl = oauthProvider ? defaultBaseUrlForOAuth(oauthProvider) : undefined;
  if (baseUrl && shouldReplaceOAuthBaseUrl(s.baseUrl)) s.baseUrl = baseUrl;
}

function shouldReplaceOAuthBaseUrl(current: string): boolean {
  const value = current.trim();
  if (!value) return true;
  return OAUTH_PROVIDER_CHOICES.some((provider) => {
    const oauthProvider = normalizeOAuthProvider(provider);
    const baseUrl = oauthProvider ? defaultBaseUrlForOAuth(oauthProvider) : undefined;
    return !!baseUrl && sameBaseUrl(value, baseUrl);
  });
}

function sameBaseUrl(a: string, b: string): boolean {
  return normalizeBaseUrl(a) === normalizeBaseUrl(b);
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), index));
}
