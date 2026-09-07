import type {
  Api,
  AuthCheck,
  AuthInteraction,
  KnownProvider,
  Model,
  OAuthAuth,
  OAuthCredential,
  Provider,
  ProviderHeaders,
} from "@earendil-works/pi-ai";
import * as providerCatalog from "@earendil-works/pi-ai/providers/all";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelConfig, ProviderConfig } from "./types";
import { builtinOAuthProviderConfig, oauthProviderLabel } from "./pi-catalog";

export function looksLikeOAuthJsonText(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const data: unknown = JSON.parse(trimmed);
    return isRecord(data);
  } catch {
    return false;
  }
}

export function importPastedOAuthJson(providerId: string, oauthProvider: KnownProvider, input: string): void {
  const data: unknown = JSON.parse(input);
  if (!isRecord(data)) throw new Error("OAuth JSON must be an object.");
  const id = providerId.trim();
  if (!id) throw new Error("Provider ID is required.");
  writeStoredOAuthCredential(id, credentialFromJson(data, { providerId: id, oauthProvider, fallbackToOAuthProvider: true }));
}

export function readOAuthCredential(
  providerId: string,
  oauthProvider: KnownProvider | undefined,
  oauthJsonPath: string | undefined,
): OAuthCredential | undefined {
  if (!oauthProvider) return undefined;
  const hasExplicitPath = !!oauthJsonPath?.trim();
  try {
    const data = JSON.parse(fs.readFileSync(resolveOAuthJsonPath(oauthJsonPath || defaultStoredOAuthJsonPath()), "utf-8"));
    return credentialFromJson(data, { providerId, oauthProvider, fallbackToOAuthProvider: hasExplicitPath });
  } catch (error) {
    if (hasExplicitPath) throw error;
    return undefined;
  }
}

export async function resolveOAuthCredential(
  providerId: string,
  config: ProviderConfig,
  oauthProvider: KnownProvider,
  oauthJsonPath: string | undefined,
  signal?: AbortSignal,
): Promise<OAuthCredential | undefined> {
  const credential = readOAuthCredential(providerId, oauthProvider, oauthJsonPath);
  if (!credential || !credential.refresh || Date.now() < credential.expires) return credential;
  const oauth = builtinOAuthProvider(providerId, config, oauthProvider).auth.oauth;
  if (!oauth) throw new Error(`${oauthProviderLabel(oauthProvider)} OAuth is not available in this Pi version.`);
  if (oauthJsonPath?.trim()) return refreshOAuthCredentialFile(providerId, oauthProvider, oauthJsonPath, oauth, credential, signal);
  const refreshed = await oauth.refresh(credential, signal);
  writeStoredOAuthCredential(providerId, refreshed);
  return refreshed;
}

export function hasStoredOAuthCredential(providerId: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(defaultStoredOAuthJsonPath(), "utf-8"));
    return isRecord(data) && isRecord(data[providerId]) && data[providerId].type === "oauth";
  } catch {
    return false;
  }
}

export async function loginStoredOAuthProvider(
  providerId: string,
  config: ProviderConfig,
  oauthProvider: KnownProvider,
  interaction: AuthInteraction,
): Promise<void> {
  const oauth = builtinOAuthProvider(providerId, config, oauthProvider).auth.oauth;
  if (!oauth) throw new Error(`${oauthProviderLabel(oauthProvider)} OAuth is not available in this Pi version.`);
  const credential = await oauth.login(interaction);
  writeStoredOAuthCredential(providerId, credential);
}

export function createOAuthBackedProvider(id: string, config: ProviderConfig, oauthProvider: KnownProvider): Provider<Api> {
  const base = builtinOAuthProvider(id, config, oauthProvider);
  const oauth = base.auth.oauth;
  if (!oauth) throw new Error(`${oauthProviderLabel(oauthProvider)} OAuth is not available in this Pi version.`);
  const oauthJsonPath = config.oauthJsonPath?.trim();
  const apiKey = oauthJsonPath ? oauthJsonFileAuth(id, oauthProvider, oauth, oauthJsonPath) : undefined;
  return {
    id,
    name: config.name || base.name || id,
    baseUrl: config.baseUrl || base.baseUrl,
    headers: mergeHeaders(base.headers, config.headers),
    auth: apiKey && oauthJsonPath ? { apiKey } : { oauth },
    getModels: () => config.models.map((model) => toModel(id, config, model)),
    stream: (model, context, options) => base.stream(model, context, options),
    streamSimple: (model, context, options) => base.streamSimple(model, context, options),
  };
}

function mergeHeaders(
  baseHeaders: ProviderHeaders | undefined,
  configHeaders: Record<string, string> | undefined,
): ProviderHeaders | undefined {
  if (!baseHeaders && !configHeaders) return undefined;
  return { ...(baseHeaders || {}), ...(configHeaders || {}) };
}

function builtinOAuthProvider(id: string, config: ProviderConfig, oauthProvider: KnownProvider): Provider<Api> {
  if (oauthProvider === "radius") return providerCatalog.radiusProvider({ id, name: config.name || id, gateway: config.baseUrl });
  const provider = providerCatalog.builtinProviders().find((item) => item.id === oauthProvider);
  if (!provider) throw new Error(`Unsupported OAuth provider: ${oauthProvider}`);
  return provider as Provider<Api>;
}

function oauthJsonFileAuth(
  providerId: string,
  oauthProvider: KnownProvider,
  oauth: OAuthAuth,
  oauthJsonPath: string,
): NonNullable<Provider<Api>["auth"]["apiKey"]> {
  return {
    name: `${oauthProviderLabel(oauthProvider)} OAuth JSON`,
    check: async (): Promise<AuthCheck | undefined> => {
      const credential = await readOAuthCredentialFile(providerId, oauthProvider, oauthJsonPath).catch(() => undefined);
      return credential ? { type: "oauth", source: "OAuth JSON" } : undefined;
    },
    resolve: async () => {
      const credential = await readOAuthCredentialFile(providerId, oauthProvider, oauthJsonPath);
      const current =
        credential.refresh && Date.now() >= credential.expires
          ? await refreshOAuthCredentialFile(providerId, oauthProvider, oauthJsonPath, oauth, credential)
          : credential;
      return {
        auth: await oauth.toAuth(current),
        env: isStringRecord(current.env) ? current.env : undefined,
        source: "OAuth JSON",
      };
    },
  };
}

async function readOAuthCredentialFile(
  providerId: string,
  oauthProvider: KnownProvider,
  oauthJsonPath: string,
): Promise<OAuthCredential> {
  const data = JSON.parse(await fsp.readFile(resolveOAuthJsonPath(oauthJsonPath), "utf-8"));
  return credentialFromJson(data, { providerId, oauthProvider });
}

async function refreshOAuthCredentialFile(
  providerId: string,
  oauthProvider: KnownProvider,
  oauthJsonPath: string,
  oauth: OAuthAuth,
  credential: OAuthCredential,
  signal?: AbortSignal,
): Promise<OAuthCredential> {
  const filePath = resolveOAuthJsonPath(oauthJsonPath);
  const data = JSON.parse(await fsp.readFile(filePath, "utf-8"));
  const refreshed = await oauth.refresh(credential, signal);
  await fsp.writeFile(filePath, JSON.stringify(replaceCredentialInJson(data, refreshed, { providerId, oauthProvider }), null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  return refreshed;
}

function credentialFromJson(
  value: unknown,
  options: { providerId: string; oauthProvider: KnownProvider; fallbackToOAuthProvider?: boolean },
): OAuthCredential {
  const picked = pickCredentialObject(value, options);
  const access = stringValue(picked.access) || stringValue(picked.access_token) || stringValue(picked.token) || stringValue(picked.key);
  if (!access) throw new Error("OAuth JSON is missing access/access_token.");
  const refresh = stringValue(picked.refresh) || stringValue(picked.refresh_token) || "";
  return {
    ...picked,
    type: "oauth",
    access,
    refresh,
    expires: expiresValue(picked),
  };
}

function pickCredentialObject(
  value: unknown,
  options: { providerId: string; oauthProvider: KnownProvider; fallbackToOAuthProvider?: boolean },
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("OAuth JSON must be an object.");
  if (looksLikeCredential(value)) return value;
  const tokens = value.tokens;
  if (isRecord(tokens) && looksLikeCredential(tokens)) return tokens;
  const providerCredential = value[options.providerId];
  if (isRecord(providerCredential) && looksLikeCredential(providerCredential)) return providerCredential;
  if (options.fallbackToOAuthProvider !== false) {
    const oauthCredential = value[options.oauthProvider];
    if (isRecord(oauthCredential) && looksLikeCredential(oauthCredential)) return oauthCredential;
  }
  throw new Error(`OAuth JSON has no credential for "${options.providerId}".`);
}

function replaceCredentialInJson(
  value: unknown,
  credential: OAuthCredential,
  options: { providerId: string; oauthProvider: KnownProvider },
): unknown {
  if (!isRecord(value) || looksLikeCredential(value)) return credential;
  const providerCredential = value[options.providerId];
  if (isRecord(providerCredential) && looksLikeCredential(providerCredential)) {
    return { ...value, [options.providerId]: credential };
  }
  const oauthCredential = value[options.oauthProvider];
  if (isRecord(oauthCredential) && looksLikeCredential(oauthCredential)) {
    return { ...value, [options.oauthProvider]: credential };
  }
  const tokens = value.tokens;
  if (isRecord(tokens) && looksLikeCredential(tokens)) {
    return {
      ...value,
      tokens: {
        ...tokens,
        access_token: credential.access,
        refresh_token: credential.refresh,
        expires_at: credential.expires,
      },
      last_refresh: new Date().toISOString(),
    };
  }
  return value;
}

function looksLikeCredential(value: Record<string, unknown>): boolean {
  return (
    value.type === "oauth" ||
    typeof value.access === "string" ||
    typeof value.access_token === "string" ||
    typeof value.token === "string" ||
    typeof value.key === "string"
  );
}

function expiresValue(value: Record<string, unknown>): number {
  const explicit =
    numberValue(value.expires) ??
    numberValue(value.expires_at) ??
    numberValue(value.expiry_date) ??
    dateValue(value.expires) ??
    dateValue(value.expires_at) ??
    dateValue(value.expiry_date);
  if (explicit !== undefined) return explicit < 10_000_000_000 ? explicit * 1000 : explicit;
  const expiresIn = numberValue(value.expires_in);
  return expiresIn === undefined ? Number.MAX_SAFE_INTEGER : Date.now() + expiresIn * 1000;
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

function resolvePath(input: string): string {
  const expanded = input
    .replace(/^~(?=$|\/)/, os.homedir())
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced, bare) => {
      return process.env[String(braced || bare)] || "";
    });
  return path.resolve(expanded);
}

function resolveOAuthJsonPath(input: string): string {
  const filePath = resolvePath(input);
  if (fs.existsSync(filePath)) return filePath;
  if (path.basename(filePath) === "oauth.json") {
    const authPath = path.join(path.dirname(filePath), "auth.json");
    if (fs.existsSync(authPath)) return authPath;
  }
  const migratedPath = `${filePath}.migrated`;
  if (fs.existsSync(migratedPath)) return migratedPath;
  return filePath;
}

function defaultStoredOAuthJsonPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
  return path.join(agentDir, "auth.json");
}

function writeStoredOAuthCredential(providerId: string, credential: OAuthCredential): void {
  const filePath = defaultStoredOAuthJsonPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "{}");
    if (isRecord(parsed)) data = parsed;
  } catch {}
  data[providerId] = { ...credential, type: "oauth" };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function dateValue(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Date.parse(value);
  return Number.isNaN(n) ? undefined : n;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
