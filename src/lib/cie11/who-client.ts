import { cleanWhoTitle, DEFAULT_ICD_RELEASE, isValidIcdRelease, normalizeEntityUri } from "@/lib/domain/encounter-diagnoses";

/**
 * Cliente de la API de CIE-11 de la OMS (ICD-API), SOLO para el servidor (deliberadamente SIN `import "server-only"`, para
 * poder probarlo con tsx; solo lo importa la ruta /api/cie11/search y las credenciales no llevan prefijo NEXT_PUBLIC_). Las credenciales nunca llegan al
 * navegador: el buscador del médico llama a nuestra ruta (/api/cie11/search) y esta consulta la OMS.
 *
 *   ICD_CLIENT_ID, ICD_CLIENT_SECRET   credenciales de la aplicación registrada en https://icd.who.int/icdapi
 *   ICD_RELEASE                        versión de la clasificación (por defecto 2026-01, la última con español)
 *   ICD_API_BASE_URL, ICD_TOKEN_URL    solo para pruebas (servidor simulado); por defecto, los de la OMS
 *
 * Privacidad (Ley 172-13): a la OMS solo viaja el texto que el médico escribe en el buscador; nunca el nombre,
 * el código ni ningún dato del paciente, ni cookies ni sesión. Licencia CC BY-ND 3.0 IGO: no se redistribuye
 * ni se altera la clasificación; no se guarda ninguna respuesta de búsqueda (lo único que se persiste es el
 * diagnóstico elegido, con su título oficial sin modificar) y el token solo se guarda en memoria.
 */

export type Cie11Result = { code: string; title: string; entityUri: string; isLeaf: boolean };

export type Cie11SearchOutcome =
  | { status: "ok"; results: Cie11Result[] }
  | { status: "unavailable"; reason: "not_configured" | "auth" | "upstream" | "timeout" };

const DEFAULT_API_BASE = "https://id.who.int";
const DEFAULT_TOKEN_URL = "https://icdaccessmanagement.who.int/connect/token";
const DEFAULT_TIMEOUT_MS = 6000;
const MAX_RESULTS = 10;

/** Tiempo máximo de espera a la OMS (ICD_TIMEOUT_MS solo para pruebas). */
function timeoutMs(): number {
  const n = Number(process.env.ICD_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 50 ? n : DEFAULT_TIMEOUT_MS;
}

function config() {
  const clientId = process.env.ICD_CLIENT_ID?.trim();
  const clientSecret = process.env.ICD_CLIENT_SECRET?.trim();
  const releaseEnv = process.env.ICD_RELEASE?.trim();
  return {
    clientId,
    clientSecret,
    release: isValidIcdRelease(releaseEnv) ? releaseEnv : DEFAULT_ICD_RELEASE,
    apiBase: (process.env.ICD_API_BASE_URL?.trim() || DEFAULT_API_BASE).replace(/\/+$/, ""),
    tokenUrl: process.env.ICD_TOKEN_URL?.trim() || DEFAULT_TOKEN_URL,
  };
}

/** ¿Hay credenciales? Sin ellas la búsqueda se desactiva (el médico escribe el código a mano). */
export function isCie11Configured(): boolean {
  const c = config();
  return Boolean(c.clientId && c.clientSecret);
}

/** Versión de la clasificación que se consulta y se guarda con cada diagnóstico. */
export function getIcdRelease(): string {
  return config().release;
}

// ---------------------------------------------------------------------------
// Token (OAuth 2, client credentials), en memoria del servidor hasta cerca de su vencimiento.
// ---------------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

/** Solo para pruebas. */
export function resetCie11TokenCache(): void {
  cachedToken = null;
  inflight = null;
}

async function requestToken(): Promise<string | null> {
  const c = config();
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "icdapi_access" }).toString(),
    signal: AbortSignal.timeout(timeoutMs()),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string" || json.access_token === "") return null;
  const ttl = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3600;
  // Se renueva un minuto antes de que venza.
  cachedToken = { value: json.access_token, expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000 };
  return cachedToken.value;
}

async function getToken(forceRenew = false): Promise<string | null> {
  if (!forceRenew && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!inflight) {
    inflight = requestToken().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

type WhoEntity = { id?: unknown; title?: unknown; theCode?: unknown; isLeaf?: unknown };

/** Convierte la respuesta de la OMS en lo único que ve nuestro cliente: código, título, URI y si es hoja. */
export function mapWhoSearchResponse(json: unknown): Cie11Result[] {
  const entities = (json as { destinationEntities?: unknown })?.destinationEntities;
  if (!Array.isArray(entities)) return [];
  const out: Cie11Result[] = [];
  const seen = new Set<string>();
  for (const raw of entities as WhoEntity[]) {
    const code = typeof raw?.theCode === "string" ? raw.theCode.trim().toUpperCase() : "";
    // Capítulos y bloques no tienen código: no se pueden elegir como diagnóstico.
    if (!code || seen.has(code)) continue;
    const title = cleanWhoTitle(raw.title);
    const entityUri = normalizeEntityUri(raw.id);
    if (!title || !entityUri) continue;
    seen.add(code);
    out.push({ code, title, entityUri, isLeaf: raw.isLeaf === true });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

async function callSearch(token: string, q: string): Promise<Response> {
  const c = config();
  const params = new URLSearchParams({
    q,
    useFlexisearch: "true",
    flatResults: "false",
    highlightingEnabled: "false",
    medicalCodingMode: "true",
  });
  return fetch(`${c.apiBase}/icd/release/11/${encodeURIComponent(c.release)}/mms/search?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "es",
      "API-Version": "v2",
    },
    signal: AbortSignal.timeout(timeoutMs()),
    cache: "no-store",
  });
}

/**
 * Busca en CIE-11 (MMS, español). Nunca lanza: devuelve «unavailable» con el motivo para que la interfaz ofrezca
 * la entrada manual. El texto buscado no se registra.
 */
export async function searchCie11(query: string): Promise<Cie11SearchOutcome> {
  if (!isCie11Configured()) return { status: "unavailable", reason: "not_configured" };
  try {
    let token = await getToken();
    if (!token) return { status: "unavailable", reason: "auth" };
    let res = await callSearch(token, query);
    if (res.status === 401) {
      // El token pudo vencer o revocarse: se renueva una sola vez.
      cachedToken = null;
      token = await getToken(true);
      if (!token) return { status: "unavailable", reason: "auth" };
      res = await callSearch(token, query);
      if (res.status === 401) return { status: "unavailable", reason: "auth" };
    }
    if (!res.ok) return { status: "unavailable", reason: "upstream" };
    return { status: "ok", results: mapWhoSearchResponse(await res.json()) };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    return { status: "unavailable", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "upstream" };
  }
}
