import { Marked, type Tokens } from "marked";

/**
 * Render del Manual del Usuario (content/manual/manual-usuario.md, ver src/lib/manual.ts y
 * scripts/test-manual.ts). Lógica pura, sin sistema de archivos ni Next.
 *
 * - Instancia propia de `Marked`: no toca la configuración global que usa el blog (src/lib/blog.ts).
 * - Títulos `#` (capítulos), `##` (secciones) y `###` con `id` de ancla; el índice sale de `#` y `##`.
 * - Si el documento abre con un `#` «Manual del Usuario», se omite: el título lo pone la página.
 * - Los bloques `> **Importante:** …`, `> **Nota:** …`, `> **Consejo:** …` y `> **Costo adicional:** …`
 *   se muestran como cuadros destacados (ámbar, azul, teal y rojo); el estilo vive en globals.css
 *   (`.manual-callout`). Cualquier otro `>` queda como cita normal.
 * - Las tablas van envueltas para hacer scroll horizontal en móvil.
 *
 * El contenido es propio y versionado en el repositorio (no entrada de usuarios), igual que el blog.
 */

export type ManualTocSection = { id: string; title: string };
export type ManualTocChapter = { id: string; title: string; sections: ManualTocSection[] };
export type RenderedManual = { html: string; toc: ManualTocChapter[] };

export type CalloutKind = "importante" | "nota" | "consejo" | "costo";

const CALLOUT_LABELS: Record<CalloutKind, string> = {
  importante: "Importante",
  nota: "Nota",
  consejo: "Consejo",
  costo: "Costo adicional",
};

const CALLOUT_RE = /^\s*\*\*\s*(Importante|Nota|Consejo|Costo adicional)\s*:?\s*\*\*\s*:?\s*/i;

function calloutKindOf(label: string): CalloutKind {
  const l = label.toLowerCase();
  if (l === "importante") return "importante";
  if (l === "nota") return "nota";
  if (l === "consejo") return "consejo";
  return "costo";
}

/** Texto sin acentos, en minúsculas, con guiones: «1. Introducción» → «1-introduccion». */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plainText(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
}

export function renderManual(markdown: string): RenderedManual {
  const toc: ManualTocChapter[] = [];
  const usedIds = new Map<string, number>();

  function uniqueId(base: string): string {
    const root = base || "seccion";
    const seen = usedIds.get(root) ?? 0;
    usedIds.set(root, seen + 1);
    return seen === 0 ? root : `${root}-${seen + 1}`;
  }

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const inner = this.parser.parseInline(tokens);
        const title = plainText(text);
        const id = uniqueId(slugify(title));
        if (depth === 1) {
          toc.push({ id, title, sections: [] });
        } else if (depth === 2) {
          // Una sección antes del primer capítulo (p. ej. «Cómo usar este manual») entra al índice como entrada propia.
          if (toc.length === 0) toc.push({ id, title, sections: [] });
          else toc[toc.length - 1].sections.push({ id, title });
        }
        const anchor = `<a href="#${id}" class="manual-anchor" aria-label="Enlace a esta sección">#</a>`;
        return `<h${depth} id="${id}" class="scroll-mt-20">${inner}${anchor}</h${depth}>\n`;
      },
      blockquote({ tokens, text }) {
        const match = CALLOUT_RE.exec(text);
        const body = this.parser.parse(tokens);
        if (!match) return `<blockquote>\n${body}</blockquote>\n`;
        const kind = calloutKindOf(match[1]);
        // El rótulo («Importante:») pasa al encabezado del cuadro: se quita del primer párrafo.
        const withoutLabel = body.replace(/^\s*<p>\s*<strong>[^<]*<\/strong>\s*:?\s*/i, "<p>");
        // Sin el rótulo, el texto queda como primera frase del cuadro: empieza con mayúscula.
        const stripped = withoutLabel.replace(/^<p>(\s*)([a-záéíóúñ])/, (_m, sp: string, c: string) => `<p>${sp}${c.toUpperCase()}`);
        return (
          `<aside class="manual-callout manual-callout-${kind}" role="note">` +
          `<p class="manual-callout-title">${escapeHtml(CALLOUT_LABELS[kind])}</p>` +
          `${stripped}</aside>\n`
        );
      },
    },
  });

  const tokens = marked.lexer(markdown);

  // Omite el «# Manual del Usuario» inicial (el título lo pone la página).
  const firstIndex = tokens.findIndex((t) => t.type !== "space");
  const first = tokens[firstIndex];
  if (first && first.type === "heading" && (first as Tokens.Heading).depth === 1) {
    const title = slugify((first as Tokens.Heading).text);
    if (title.startsWith("manual-del-usuario")) tokens.splice(firstIndex, 1);
  }

  let html = marked.parser(tokens);
  html = html.replace(/<table>/g, '<div class="manual-table-scroll"><table>').replace(/<\/table>/g, "</table></div>");

  return { html, toc };
}
