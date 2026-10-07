/**
 * Términos y Condiciones de Servicio -- versión vigente y aceptación en el
 * registro. Módulo PURO (sin Next ni Supabase) para poder probarlo
 * (scripts/test-terms-acceptance.ts).
 *
 * El texto de los términos vive en src/app/terminos/page.tsx. Al publicar una
 * versión nueva: subir TERMS_VERSION y TERMS_EFFECTIVE_LABEL aquí y cambiar el
 * texto de la página; los registros nuevos guardarán la versión que aceptaron.
 */

export const TERMS_VERSION = "4";
export const TERMS_EFFECTIVE_LABEL = "7 de octubre de 2026";
export const TERMS_PATH = "/terminos";

/** ¿Marcó la casilla de aceptación? (un checkbox HTML marcado envía "on"). */
export function hasAcceptedTerms(value: FormDataEntryValue | null): boolean {
  return value === "on";
}

/**
 * Lo que se guarda con la cuenta al registrarse (user_metadata de Supabase Auth):
 * qué versión de los términos aceptó y cuándo. No requiere tabla nueva.
 */
export function termsAcceptanceMetadata(now: Date = new Date()): {
  terms_version: string;
  terms_accepted_at: string;
} {
  return { terms_version: TERMS_VERSION, terms_accepted_at: now.toISOString() };
}
