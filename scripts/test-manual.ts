/**
 * Prueba del Manual del Usuario (src/lib/manual-render.ts, lógica pura) y de que /manual quede fuera de
 * buscadores: `disallow` en robots.txt y ausente del sitemap. El contenido real es de content/manual/;
 * aquí se usa un texto de ejemplo con cada elemento que el render debe soportar.
 */

import { readFileSync } from "fs";
import path from "path";
import { renderManual, slugify } from "../src/lib/manual-render";

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push(name);
  }
}

const SAMPLE = `# Manual del Usuario

# 1. Introducción

Texto con **negrita** y un [enlace](https://cuido.net).

## 1.1 Primeros pasos

> **Importante:** guarda tu contraseña.

> **Nota:** esto es una nota.

> **Consejo:** usa la agenda semanal.

> **Costo adicional:** WhatsApp se cobra aparte.

> Una cita normal, sin rótulo.

## 1.2 Roles

| Rol | Puede |
|---|---|
| Admin | Todo |
| Médico | Clínico |

# 2. Facturación & e-CF

## 2.1 Primeros pasos

### 2.1.1 Detalle
`;

console.log("\nIdentificadores:");
check("sin acentos ni signos", slugify("1. Introducción") === "1-introduccion" && slugify("Facturación & e-CF") === "facturacion-y-e-cf", `${slugify("1. Introducción")} | ${slugify("Facturación & e-CF")}`);

const { html, toc } = renderManual(SAMPLE);

console.log("\nTítulo y capítulos:");
check("no duplica el H1 «Manual del Usuario»", !/Manual del Usuario/.test(html) && !html.includes("manual-del-usuario"), "quedó el título");
check("capítulos (#) con id de ancla", html.includes('<h1 id="1-introduccion"') && html.includes('<h1 id="2-facturacion-y-e-cf"'), html.slice(0, 200));
check("secciones (##) con id y enlace de ancla", html.includes('<h2 id="1-1-primeros-pasos"') && html.includes('href="#1-1-primeros-pasos"'), "");
check("títulos repetidos no repiten el id", html.includes('id="2-1-primeros-pasos"') && !/id="primeros-pasos"/.test(html) && new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])).size === [...html.matchAll(/ id="([^"]+)"/g)].length, "ids duplicados");
check("índice: 2 capítulos, con sus secciones", toc.length === 2 && toc[0].title === "1. Introducción" && toc[0].sections.length === 2 && toc[1].sections.length === 1 && toc[1].sections[0].id === "2-1-primeros-pasos", JSON.stringify(toc));
check("el índice no incluye los ###", !JSON.stringify(toc).includes("Detalle"), "");

console.log("\nCuadros destacados:");
for (const [kind, label] of [["importante", "Importante"], ["nota", "Nota"], ["consejo", "Consejo"], ["costo", "Costo adicional"]] as const) {
  check(`${label}`, html.includes(`class="manual-callout manual-callout-${kind}"`) && html.includes(`<p class="manual-callout-title">${label}</p>`), "");
}
check("el rótulo pasa al encabezado (no se repite en el texto)", !/<strong>Importante:?<\/strong>/.test(html) && html.includes("<p>guarda tu contraseña.</p>"), html.match(/manual-callout-importante[\s\S]*?<\/aside>/)?.[0] ?? "");
check("una cita sin rótulo sigue siendo <blockquote>", html.includes("<blockquote>") && html.includes("Una cita normal"), "");
check("exactamente 4 cuadros", (html.match(/<aside /g) ?? []).length === 4, String((html.match(/<aside /g) ?? []).length));

console.log("\nTablas y texto:");
check("tabla envuelta para scroll horizontal", html.includes('<div class="manual-table-scroll"><table>') && html.includes("</table></div>"), "");
check("negrita y enlaces se conservan", html.includes("<strong>negrita</strong>") && html.includes('<a href="https://cuido.net">enlace</a>'), "");

console.log("\nSin H1 inicial / con otro título:");
const other = renderManual("# Otro título\n\nTexto");
check("un primer H1 distinto SÍ se conserva como capítulo", other.html.includes("Otro título") && other.toc.length === 1, JSON.stringify(other.toc));
const empty = renderManual("");
check("documento vacío no falla", empty.html.trim() === "" && empty.toc.length === 0, "");

console.log("\nBuscadores:");
const robots = readFileSync(path.join(process.cwd(), "src", "app", "robots.ts"), "utf8");
check('robots.ts: "/manual" en disallow', /"\/manual"/.test(robots), "");
const sitemap = readFileSync(path.join(process.cwd(), "src", "app", "sitemap.ts"), "utf8");
check("sitemap.ts no menciona /manual", !/manual/.test(sitemap), "");
const page = readFileSync(path.join(process.cwd(), "src", "app", "(clinic)", "manual", "page.tsx"), "utf8");
check("la página declara noindex", /index:\s*false/.test(page), "");

if (failures.length > 0) {
  console.error(`\nFALLÓ: ${failures.length} verificación(es) no pasaron.`);
  process.exit(1);
}
console.log("\nOK: Manual del Usuario (render, índice, cuadros y exclusión de buscadores) verificado.");
