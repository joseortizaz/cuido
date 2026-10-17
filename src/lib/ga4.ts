/**
 * Reglas puras de Google Analytics 4 (scripts/test-ga4.ts). El componente que lo carga está en
 * src/app/_components/ga4.tsx.
 *
 * GA4 solo mide visitas (page_view) al sitio PÚBLICO de captación. Nunca debe cargarse ni enviar
 * eventos en el área con datos de pacientes, así que la lista de rutas es una LISTA PERMITIDA: una
 * ruta nueva queda fuera de GA4 hasta que se agregue aquí a propósito.
 */

/**
 * ID de medición de GA4 (`G-XXXXXXXX`). Se escribe dentro de un script y de una URL, así que no se
 * acepta nada que no sea exactamente ese formato.
 */
export function parseGaId(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  return value && /^G-[A-Z0-9]{4,20}$/.test(value) ? value : null;
}

/**
 * Páginas públicas informativas donde sí se mide. Se excluyen a propósito las pantallas con
 * formularios de acceso (/login, /signup, /forgot-password, /reset-password) y todo lo autenticado
 * ((clinic): /dashboard, /patients, /appointments, /settings…; /operator, /security, /onboarding…).
 */
const GA_PATHS = ["/", "/privacidad", "/terminos", "/eliminacion-datos", "/normativa", "/blog"];

export function isGaPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return GA_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
}
