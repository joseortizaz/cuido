/**
 * Landing pública (src/app/_landing/) — sección aparte del resto de la app.
 * Carpeta con prefijo `_` = Next.js la excluye del enrutamiento (no crea
 * ninguna ruta), solo componentes importados por src/app/page.tsx (y
 * reutilizados por src/app/blog y src/app/normativa para header/footer
 * consistentes).
 *
 * Correo temporal (ver CLAUDE.md — sin dominio propio todavía).
 */
export const CONTACT_EMAIL = "info@narniats.com";

/**
 * Ancla del formulario "Contáctenos" dentro de la landing ("/"). Todo botón
 * "Solicitar demo" apunta aquí -- ya NO abre un mailto directo (eso cambió
 * en el rediseño: ahora existe un formulario real en esa sección). Usamos
 * la ruta absoluta con hash (no solo "#contactenos") porque header/footer
 * se reutilizan en /blog y /normativa, donde un hash relativo no
 * navegaría de vuelta a "/".
 */
export const CONTACT_ANCHOR = "/#contactenos";
export const ABOUT_ANCHOR = "/#quienes-somos";

/**
 * Logo subido por el usuario a public/ (archivo con espacio en el nombre,
 * de ahí el %20) — usado tal cual, sin regenerar ni editar. 1254×1254px,
 * RGB opaco (sin canal alfa, fondo blanco de fábrica) — ver LandingFooter
 * para el ajuste que eso implica sobre fondo navy oscuro.
 */
export const CUIDO_LOGO_SRC = "/Logo%20Cuido.png";
