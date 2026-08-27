import type { MetadataRoute } from "next";

/**
 * Convención de archivo especial de Next.js App Router -- se sirve
 * automáticamente en /manifest.webmanifest y Next.js agrega el
 * <link rel="manifest"> por sí solo (no hace falta declararlo a mano
 * en metadata de layout.tsx). Da soporte de "añadir a pantalla de
 * inicio" en Android con el ícono real de Cuido -- iOS usa
 * apple-touch-icon.png por separado (ver metadata.icons.apple en
 * layout.tsx), Android/Chrome usa este manifest.
 *
 * theme_color/background_color reusan los tokens de marca ya
 * establecidos en globals.css (--color-brand-blue/--color-brand-bg) --
 * mismos valores, no inventados aparte.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cuido",
    short_name: "Cuido",
    description: "Gestión clínica multiespecialidad",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#2563eb",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
