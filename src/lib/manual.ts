import { readFileSync } from "fs";
import path from "path";
import matter from "gray-matter";
import { renderManual, type RenderedManual } from "./manual-render";

/**
 * Manual del Usuario para las clínicas suscritas (/manual y /manual/pdf, dentro de src/app/(clinic)/).
 *
 * Fuente única: content/manual/manual-usuario.md. El PDF para imprimir (content/manual/Manual-del-Usuario-Cuido.pdf)
 * se regenera desde ese mismo .md con scripts/manual/build.py (a mano, cuando cambie el contenido; no corre
 * en CI ni en el build). Ambos archivos se commitean juntos.
 *
 * Los archivos viven en content/ (NO en public/): solo se entregan a quien tiene sesión y clínica activa.
 * Se leen del sistema de archivos como el blog (src/lib/blog.ts); next.config.ts los declara para el despliegue.
 */

const MANUAL_DIR = path.join(process.cwd(), "content", "manual");
export const MANUAL_MD_FILE = "manual-usuario.md";
export const MANUAL_PDF_FILE = "Manual-del-Usuario-Cuido.pdf";

export type Manual = RenderedManual & { updated?: string };

/** El manual renderizado, o null si el archivo no está (la página muestra un aviso en vez de fallar). */
export function getManual(): Manual | null {
  let raw: string;
  try {
    raw = readFileSync(path.join(MANUAL_DIR, MANUAL_MD_FILE), "utf8");
  } catch {
    return null;
  }
  const { data, content } = matter(raw);
  return {
    ...renderManual(content),
    updated: data.updated ? String(data.updated) : data.date ? String(data.date) : undefined,
  };
}

/** Bytes del PDF para imprimir, o null si no está. */
export function getManualPdf(): Buffer | null {
  try {
    return readFileSync(path.join(MANUAL_DIR, MANUAL_PDF_FILE));
  } catch {
    return null;
  }
}
