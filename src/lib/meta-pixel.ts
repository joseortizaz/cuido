/**
 * Reglas puras del Meta Pixel (scripts/test-meta-pixel.ts). El componente que lo carga está en
 * src/app/_components/meta-pixel.tsx.
 *
 * El píxel solo mide visitas (PageView) al sitio PÚBLICO de captación. Nunca debe cargarse ni
 * disparar eventos en el área con datos de pacientes, así que la lista de rutas es una LISTA
 * PERMITIDA: una ruta nueva queda fuera del píxel hasta que se agregue aquí a propósito.
 */

/** ID del píxel de Meta: solo dígitos (se escribe dentro de un script, así que no se acepta nada más). */
export function parseMetaPixelId(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  return value && /^\d{10,20}$/.test(value) ? value : null;
}

/**
 * Páginas públicas informativas donde sí se mide. Se excluyen a propósito las pantallas con
 * formularios de acceso (/login, /signup, /forgot-password, /reset-password) y todo lo autenticado
 * (/dashboard, /patients, /appointments, /settings, /operator, /security, /onboarding…).
 */
const PIXEL_PATHS = ["/", "/privacidad", "/terminos", "/eliminacion-datos", "/normativa", "/blog"];

export function isMetaPixelPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return PIXEL_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
}
