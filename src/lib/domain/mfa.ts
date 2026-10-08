/**
 * Autenticación de dos pasos (app de autenticación / TOTP). Lógica pura, sin Next ni
 * Supabase, para probarla sin base de datos (scripts/test-mfa.ts).
 */

/** Mínimo de caracteres del motivo al restablecer el 2FA de un usuario (igual que mfa_reset_log). */
export const RESET_REASON_MIN_LENGTH = 10;

/** Ruta de la pantalla donde se pide el código tras la contraseña. */
export const MFA_CHALLENGE_PATH = "/login/mfa";

/**
 * Normaliza lo que escribe el usuario: las apps muestran «123 456» y los teclados móviles
 * agregan espacios. Devuelve solo los dígitos.
 */
export function normalizeTotpCode(raw: unknown): string {
  return String(raw ?? "").replace(/[\s-]/g, "");
}

/** Un código TOTP son exactamente 6 dígitos. */
export function isValidTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * ¿Hay que pedir el segundo paso? Sí cuando el usuario tiene un factor VERIFICADO y su sesión
 * todavía es aal1 (entró solo con la contraseña). Un factor a medias (sin verificar) no cuenta.
 * El mismo criterio aplica la base de datos con mfa_satisfied().
 */
export function needsMfaChallenge(currentLevel: string | null | undefined, hasVerifiedFactor: boolean): boolean {
  return hasVerifiedFactor && currentLevel !== "aal2";
}

/**
 * Destino seguro tras verificar el código: solo rutas internas (nada de //otro-sitio ni
 * esquemas), y nunca volver a la propia pantalla del código.
 *
 * Los navegadores quitan tabuladores y saltos de línea de las URL (una barra, un tabulador y otra
 * barra se vuelven "//"), así que se rechaza cualquier carácter de control o barra invertida, no
 * solo el prefijo "//".
 */
const SAFE_PATH = new RegExp("^/(?![/\\\\])[^\\u0000-\\u001f\\u007f\\\\]*$");

export function safeNextPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string") return fallback;
  if (!SAFE_PATH.test(next)) return fallback;
  if (next === MFA_CHALLENGE_PATH || next.startsWith(`${MFA_CHALLENGE_PATH}?`)) return fallback;
  return next;
}

export function resetReasonError(reason: unknown): string | null {
  const text = String(reason ?? "").trim();
  if (text.length < RESET_REASON_MIN_LENGTH) {
    return `Escribe el motivo del restablecimiento (al menos ${RESET_REASON_MIN_LENGTH} caracteres): cómo verificaste la identidad.`;
  }
  return null;
}
