import type { MetadataRoute } from "next";

/**
 * Convención de archivo especial de Next.js App Router (mismo patrón que
 * manifest.ts/sitemap.ts) -- se sirve automáticamente en /robots.txt.
 *
 * `disallow` cubre toda ruta que vive detrás de auth (src/app/(clinic)/*
 * -- appointments, billing, claims, dashboard, patients, profile,
 * settings, team -- más operator/onboarding y las páginas del flujo de
 * autenticación) -- deja abierto solo landing/blog/normativa/privacidad/
 * términos/eliminación de datos, que es exactamente lo que expone sitemap.ts.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/appointments",
          "/patients",
          "/billing",
          "/claims",
          "/team",
          "/settings",
          "/profile",
          "/operator",
          "/onboarding",
          "/login",
          "/signup",
          "/auth",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: "https://cuido.net/sitemap.xml",
  };
}
