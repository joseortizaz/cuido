/**
 * Diagnósticos codificados CIE-11 de una consulta. Lógica pura (sin red ni base), probada en
 * scripts/test-cie11.ts. La base de datos (supabase/migrations/20261127100000_encounter_diagnoses.sql) valida
 * de nuevo todo lo que importa.
 *
 * El texto libre del diagnóstico de la plantilla se conserva tal cual; el código lo COMPLEMENTA.
 */

export const DIAGNOSIS_KINDS = ["presuntivo", "definitivo"] as const;
export type DiagnosisKind = (typeof DIAGNOSIS_KINDS)[number];

export const DIAGNOSIS_KIND_LABELS: Record<DiagnosisKind, string> = {
  presuntivo: "Presuntivo",
  definitivo: "Definitivo",
};

export const MAX_DIAGNOSES_PER_ENCOUNTER = 20;

/** Texto de atribución exigido por la licencia CC BY-ND 3.0 IGO de la OMS. */
export const CIE11_ATTRIBUTION = "CIE-11 © Organización Mundial de la Salud. Se muestra sin modificaciones.";

/** Aviso de privacidad del buscador (Ley 172-13): a la OMS solo viaja lo que se escribe en él. */
export const CIE11_SEARCH_PRIVACY_NOTE = "No escribas datos del paciente en el buscador: lo que escribas se consulta en el catálogo público de la OMS.";

/** Versión de la clasificación que se usa si no hay otra configurada (la última con español: 2026-01). */
export const DEFAULT_ICD_RELEASE = "2026-01";

/**
 * Código MMS de CIE-11: cuatro caracteres (5A11, NE81), con subdivisión opcional (1A00.1, 2C25.Z) y
 * postcoordinación con extensiones unidas por & o / (2C25.Z&XA2UD3). Los capítulos y bloques no tienen código.
 */
export const CIE11_CODE_RE = /^[0-9A-Z][0-9A-Z]{3}(\.[0-9A-Z]{1,2})?([&/][0-9A-Z]{4,6}(\.[0-9A-Z]{1,2})?)*$/;

export function normalizeCie11Code(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidCie11Code(raw: string): boolean {
  const code = normalizeCie11Code(raw);
  return code.length <= 80 && CIE11_CODE_RE.test(code);
}

export function isValidIcdRelease(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{4}-[0-9]{2}$/.test(value);
}

const WHO_URI_PREFIX = "http://id.who.int/icd/release/11/";

/** Las entidades de la OMS se identifican con un URI http://id.who.int/icd/release/11/…; nunca otra cosa. */
export function normalizeEntityUri(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const uri = raw.trim().replace(/^https:\/\//i, "http://");
  if (!uri.startsWith(WHO_URI_PREFIX) || uri.length > 500) return null;
  return uri;
}

/** Quita etiquetas de resaltado (<em>) y entidades HTML básicas de un título de la OMS. */
export function cleanWhoTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Un diagnóstico tal como lo arma el formulario. */
export type DiagnosisDraft = {
  kind: DiagnosisKind;
  code: string;
  title: string;
  /** null = escrito a mano (la API de la OMS no estaba disponible). */
  entityUri: string | null;
  isPrimary: boolean;
  doctorNote: string;
};

/** La forma que espera la base (claves en snake_case). */
export type DiagnosisPayload = {
  kind: DiagnosisKind;
  code: string;
  title: string;
  entity_uri: string | null;
  is_primary: boolean;
  doctor_note: string | null;
};

export function toPayload(d: DiagnosisDraft): DiagnosisPayload {
  return {
    kind: d.kind,
    code: normalizeCie11Code(d.code),
    title: d.title.trim(),
    entity_uri: d.entityUri,
    is_primary: d.isPrimary,
    doctor_note: d.doctorNote.trim() || null,
  };
}

/**
 * Lee y valida la lista de diagnósticos que llega del formulario (JSON en un campo oculto). No confía en el
 * cliente: normaliza, valida y devuelve un error claro; la base vuelve a validar.
 */
export function parseDiagnosesJson(raw: string | null | undefined): { items: DiagnosisPayload[]; error?: string } {
  if (!raw || raw.trim() === "") return { items: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { items: [], error: "Los diagnósticos codificados no se pudieron leer. Vuelve a elegirlos." };
  }
  if (!Array.isArray(data)) return { items: [], error: "Los diagnósticos codificados no tienen el formato esperado." };
  if (data.length > MAX_DIAGNOSES_PER_ENCOUNTER) return { items: [], error: `Máximo ${MAX_DIAGNOSES_PER_ENCOUNTER} diagnósticos codificados por consulta.` };

  const items: DiagnosisPayload[] = [];
  const seen = new Set<string>();
  const primaries = new Set<string>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) return { items: [], error: "Un diagnóstico codificado no es válido." };
    const e = entry as Record<string, unknown>;
    const kind = e.kind;
    if (kind !== "presuntivo" && kind !== "definitivo") return { items: [], error: "Cada diagnóstico codificado debe ser presuntivo o definitivo." };
    const code = typeof e.code === "string" ? normalizeCie11Code(e.code) : "";
    if (!isValidCie11Code(code)) return { items: [], error: `El código «${String(e.code ?? "").slice(0, 30)}» no tiene un formato CIE-11 válido.` };
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (title.length < 1 || title.length > 400) return { items: [], error: `El diagnóstico ${code} necesita su título (hasta 400 caracteres).` };
    const note = typeof e.doctorNote === "string" ? e.doctorNote.trim() : typeof e.doctor_note === "string" ? e.doctor_note.trim() : "";
    if (note.length > 500) return { items: [], error: `La nota del diagnóstico ${code} es demasiado larga (máximo 500 caracteres).` };
    const uriRaw = e.entityUri ?? e.entity_uri;
    const entityUri = uriRaw === null || uriRaw === undefined || uriRaw === "" ? null : normalizeEntityUri(uriRaw);
    if (uriRaw && entityUri === null) return { items: [], error: `La dirección de la OMS del diagnóstico ${code} no es válida.` };
    const isPrimary = Boolean(e.isPrimary ?? e.is_primary);
    const key = `${kind}:${code}`;
    if (seen.has(key)) return { items: [], error: `El código ${code} está repetido como diagnóstico ${kind}.` };
    seen.add(key);
    if (isPrimary) {
      if (primaries.has(kind)) return { items: [], error: `Solo puede haber un diagnóstico ${kind} principal.` };
      primaries.add(kind);
    }
    items.push({ kind, code, title, entity_uri: entityUri, is_primary: isPrimary, doctor_note: note || null });
  }
  return { items };
}

/** Los diagnósticos vigentes de una consulta, con el principal primero y el definitivo antes del presuntivo. */
export function orderDiagnoses<T extends { kind: string; is_primary: boolean; created_at?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "definitivo" ? -1 : 1;
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

/** Códigos separados por «;» para la exportación (los vigentes, definitivos primero). */
export function joinCodes(list: { code: string; kind: string; is_primary: boolean }[]): string {
  return orderDiagnoses(list).map((d) => d.code).join(";");
}
