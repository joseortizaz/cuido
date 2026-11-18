/**
 * Guardia: el código que corre en el NAVEGADOR no puede leer variables NEXT_PUBLIC_* de forma dinámica.
 *
 * Next.js solo sustituye `process.env.NEXT_PUBLIC_X` cuando se escribe literalmente; `process.env[name]`
 * (lo que hace src/lib/supabase/env.ts, pensado para el servidor) devuelve `undefined` en el navegador. Esto ya
 * rompió la subida de archivos de estudios (el cliente de Supabase del navegador nunca había sido usado), y no lo
 * detecta ninguna prueba de servidor: lo detecta esta, leyendo el código fuente de todos los archivos «use client».
 */

import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src");
const files: string[] = [];
(function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
})(root);

const problems: string[] = [];
let clientFiles = 0;
for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  if (!/^\s*["']use client["']/.test(raw)) continue;
  // Sin comentarios: una explicación que mencione process.env[...] no es una lectura.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  clientFiles++;
  const rel = path.relative(process.cwd(), file);
  if (/process\.env\s*\[/.test(src)) problems.push(`${rel}: lee process.env[...] de forma dinámica (en el navegador sería undefined).`);
  if (/from\s+["'][^"']*supabase\/env["']/.test(src)) problems.push(`${rel}: importa supabase/env (lectura dinámica, solo para el servidor).`);
}

const client = fs.readFileSync(path.join(root, "lib/supabase/client.ts"), "utf8");
if (!client.includes("process.env.NEXT_PUBLIC_SUPABASE_URL") || !client.includes("process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
  problems.push("src/lib/supabase/client.ts debe leer process.env.NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY con su nombre literal.");
}

console.log(`Archivos «use client» revisados: ${clientFiles}`);
if (problems.length > 0) {
  console.error("\n✗ Lecturas de entorno que no funcionan en el navegador:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("✓ Ningún archivo del navegador lee variables de entorno de forma dinámica.");
