import { readFileSync, readdirSync } from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";

/**
 * "Avances en Salud" (/blog) — sin CMS. Cada post es un archivo Markdown
 * en content/blog/, con frontmatter (title, date, excerpt). El nombre del
 * archivo (sin extensión) es el slug de la URL -- ver content/blog/README.md
 * para el formato exacto y por qué esta carpeta empieza vacía de posts.
 *
 * Leído desde el sistema de archivos en request/build time -- no hay tabla
 * en Supabase para esto, es contenido editorial de la landing, no un dato
 * clínico ni multi-tenant.
 */

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

export type BlogPostMeta = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
};

export type BlogPost = BlogPostMeta & { html: string };

function listPostFiles(): string[] {
  let files: string[];
  try {
    files = readdirSync(BLOG_DIR);
  } catch {
    return [];
  }
  return files.filter((f) => f.endsWith(".md") && f !== "README.md");
}

export function getAllPosts(): BlogPostMeta[] {
  return listPostFiles()
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      const raw = readFileSync(path.join(BLOG_DIR, file), "utf8");
      const { data } = matter(raw);
      return {
        slug,
        title: String(data.title ?? slug),
        date: String(data.date ?? ""),
        excerpt: String(data.excerpt ?? ""),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostBySlug(slug: string): BlogPost | null {
  const file = path.join(BLOG_DIR, `${slug}.md`);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  return {
    slug,
    title: String(data.title ?? slug),
    date: String(data.date ?? ""),
    excerpt: String(data.excerpt ?? ""),
    html: marked.parse(content, { async: false }) as string,
  };
}
