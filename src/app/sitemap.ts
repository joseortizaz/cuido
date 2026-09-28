import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";

// Mismo dominio verificado que src/app/layout.tsx (metadataBase) -- ver
// la nota ahí sobre la discrepancia con CLAUDE.md ("cuido.com").
const BASE_URL = "https://cuido.net";

/**
 * Convención de archivo especial de Next.js App Router (mismo patrón que
 * manifest.ts) -- se sirve automáticamente en /sitemap.xml.
 *
 * Solo rutas públicas realmente enlazadas desde la landing/footer
 * (confirmado contra src/app/_landing/header.tsx y footer.tsx) -- nunca
 * rutas autenticadas (/dashboard, /appointments, /operator, etc.): no
 * tiene sentido indexarlas y además robots.ts ya las bloquea, así que
 * listarlas aquí sería contradictorio.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ["", "/normativa", "/privacidad", "/eliminacion-datos", "/blog"].map(
    (route) => ({
      url: `${BASE_URL}${route}`,
      lastModified: new Date(),
    })
  );

  const posts = getAllPosts().map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date),
  }));

  return [...staticRoutes, ...posts];
}
