/**
 * Regenera el PDF del Manual del Usuario a partir de su fuente única (content/manual/manual-usuario.md).
 *
 *   npm run manual:pdf
 *
 * Usa el MISMO render que la página /manual (src/lib/manual-render.ts), así el PDF y la web dicen lo mismo,
 * y Chrome/Chromium instalado para imprimir a PDF (sin dependencias nuevas). Solo se corre a mano cuando
 * cambia el contenido (no corre en CI ni en el build); el .md y el PDF se commitean juntos.
 *
 * Chrome se busca en las rutas habituales; si está en otra parte: CHROME_PATH="…/chrome" npm run manual:pdf
 * Requiere Chrome/Chromium 131 o posterior (numeración de páginas con @page).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { renderManual } from "../../src/lib/manual-render";

const ROOT = process.cwd();
const MD = path.join(ROOT, "content", "manual", "manual-usuario.md");
const OUT = path.join(ROOT, "content", "manual", "Manual-del-Usuario-Cuido.pdf");
const LOGO = path.join(ROOT, "public", "Logo Cuido.png");

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("No encontré Chrome/Chromium. Indique su ruta con CHROME_PATH.");
  return found;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CSS = `
@page { size: A4; margin: 20mm 18mm 22mm 18mm; @bottom-center { content: counter(page); font: 9pt Arial, sans-serif; color: #555; } }
@page :first { margin: 0; @bottom-center { content: none; } }
* { box-sizing: border-box; }
html { color-scheme: light; }
body { margin: 0; font: 10.5pt/1.5 Arial, Helvetica, sans-serif; color: #111; background: #fff; }
.cover { height: 297mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: #0a4f8a; color: #fff; break-after: page; padding: 20mm; }
.cover img { width: 62mm; background: #fff; padding: 6mm; border-radius: 6mm; margin-bottom: 14mm; }
.cover h1 { font-size: 30pt; margin: 0 0 4mm; border: 0; padding: 0; color: #fff; break-before: auto; }
.cover p { font-size: 13pt; margin: 1mm 0; color: #dbeafe; }
.toc { break-after: page; }
.toc h2.toc-title { font-size: 18pt; color: #0a4f8a; border-bottom: 0.5mm solid #0a4f8a; padding-bottom: 2mm; margin: 0 0 5mm; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li.ch { margin-top: 3mm; font-weight: 700; }
.toc li.ch a { color: #0a4f8a; text-decoration: none; }
.toc ul { list-style: none; margin: 1mm 0 0; padding: 0 0 0 5mm; font-weight: 400; font-size: 9.5pt; }
.toc ul a { color: #222; text-decoration: none; }
h1 { font-size: 20pt; color: #0a4f8a; border-bottom: 0.5mm solid #0a4f8a; padding-bottom: 2mm; margin: 0 0 5mm; break-before: page; break-after: avoid; }
h2 { font-size: 14pt; color: #0a4f8a; margin: 7mm 0 2mm; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 5mm 0 1.5mm; break-after: avoid; }
p { margin: 0 0 2.5mm; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin: 0 0 1mm; }
a { color: #0a4f8a; }
.manual-anchor { display: none; }
code { font-family: Consolas, "Courier New", monospace; background: #f1f5f9; padding: 0 1mm; border-radius: 1mm; }
hr { display: none; }
.manual-table-wrap { margin: 2mm 0 4mm; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
th, td { border: 0.3mm solid #bbb; padding: 1.6mm 2.2mm; vertical-align: top; text-align: left; }
th { background: #e8f1fa; }
tr { break-inside: avoid; }
blockquote { margin: 3mm 0; padding: 2.5mm 4mm; border-left: 1.2mm solid #94a3b8; background: #f8fafc; break-inside: avoid; }
blockquote p:last-child { margin-bottom: 0; }
.manual-callout { margin: 3mm 0; padding: 2.5mm 4mm; border-left: 1.2mm solid #94a3b8; break-inside: avoid; }
.manual-callout p { margin: 0 0 1.5mm; }
.manual-callout p:last-child { margin-bottom: 0; }
.manual-callout-title { font-weight: 700; text-transform: uppercase; letter-spacing: .04em; font-size: 8.5pt; }
.manual-callout-importante { border-color: #d97706; background: #fffbeb; }
.manual-callout-nota { border-color: #2563eb; background: #eff6ff; }
.manual-callout-consejo { border-color: #0d9488; background: #f0fdfa; }
.manual-callout-costo { border-color: #dc2626; background: #fef2f2; }
`;

function main() {
  const { content } = matter(readFileSync(MD, "utf8"));
  const manual = renderManual(content);
  const logo = existsSync(LOGO) ? `data:image/png;base64,${readFileSync(LOGO).toString("base64")}` : "";
  const today = new Date().toLocaleDateString("es-DO", { year: "numeric", month: "long", timeZone: "America/Santo_Domingo" });

  const toc = manual.toc
    .map(
      (c) =>
        `<li class="ch"><a href="#${c.id}">${esc(c.title)}</a>` +
        (c.sections.length ? `<ul>${c.sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join("")}</ul>` : "") +
        `</li>`
    )
    .join("");

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Manual del Usuario — Cuido</title><style>${CSS}</style></head><body>
<section class="cover">${logo ? `<img src="${logo}" alt="Cuido">` : ""}<h1>Manual del Usuario</h1><p>Plataforma de gestión clínica</p><p>Narnia Tech Solution, SRL</p><p>${esc(today)}</p></section>
<section class="toc"><h2 class="toc-title">Contenido</h2><ol>${toc}</ol></section>
${manual.html}
</body></html>`;

  const dir = mkdtempSync(path.join(tmpdir(), "cuido-manual-"));
  const htmlPath = path.join(dir, "manual.html");
  try {
    writeFileSync(htmlPath, html, "utf8");
    execFileSync(
      findChrome(),
      [
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        `--user-data-dir=${path.join(dir, "profile")}`,
        `--print-to-pdf=${OUT}`,
        pathToFileUrl(htmlPath),
      ],
      { stdio: "pipe", timeout: 120_000 }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`PDF generado: ${path.relative(ROOT, OUT)} (${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

function pathToFileUrl(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${normalized}`;
}

main();
