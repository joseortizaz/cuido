/**
 * Landing pública (src/app/_landing/) — sección aparte del resto de la app.
 * Carpeta con prefijo `_` = Next.js la excluye del enrutamiento (no crea
 * ninguna ruta), solo componentes importados por src/app/page.tsx.
 *
 * Correo temporal (ver CLAUDE.md — sin dominio propio todavía). Todo botón
 * "Solicitar demo" abre un mailto, sin formulario ni backend: esto es para
 * la presentación a la clínica piloto, no un flujo de captación real.
 */
export const CONTACT_EMAIL = "info@narniats.com";
export const DEMO_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Solicitud de demo - Cuido"
)}`;

/**
 * Logo subido por el usuario a public/ (archivo con espacio en el nombre,
 * de ahí el %20) — usado tal cual, sin regenerar ni editar. 1254×1254px,
 * RGB opaco (sin canal alfa, fondo blanco de fábrica) — ver LandingFooter
 * para el ajuste que eso implica sobre fondo navy oscuro.
 */
export const CUIDO_LOGO_SRC = "/Logo%20Cuido.png";
