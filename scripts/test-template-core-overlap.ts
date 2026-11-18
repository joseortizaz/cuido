/**
 * Guardia contra campos duplicados entre las plantillas de especialidad y el
 * núcleo de la consulta.
 *
 * Todo formulario de consulta ya pide, en su parte fija, datos que viven en
 * columnas de `encounters` (hoy: "Motivo de consulta" = chief_complaint). Una
 * plantilla que los repite obliga al médico a escribirlos dos veces y ensucia
 * la exportación ("Motivo de consulta (2)"). Este test lee TODAS las plantillas
 * activas (las que sembraron las migraciones) y falla si alguna repite un
 * campo reservado.
 *
 * Al agregar una columna común nueva a `encounters` (p. ej. present_illness,
 * "Historia de la enfermedad actual", en el plan de tipos de consulta), se
 * agrega aquí su clave y etiqueta en RESERVED -- y las plantillas que la
 * repitan se corrigen en esa misma migración.
 *
 * Datos de solo lectura del catálogo global; no crea ni borra nada.
 * Requiere: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 */

import { config as loadDotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadDotenv({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

/** Campos del núcleo de la consulta: clave de plantilla prohibida y etiqueta prohibida. */
const RESERVED: { keys: string[]; labels: string[]; core: string }[] = [
  {
    keys: ["motivo_consulta", "chief_complaint", "motivo_de_consulta"],
    labels: ["motivo de consulta"],
    core: "Motivo de consulta (encounters.chief_complaint)",
  },
];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

type Field = { key: string; label: string };

async function main() {
  const db = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
  const { data, error } = await db.from("specialty_templates").select("code, name, is_active, schema");
  if (error || !data) throw new Error(`No se pudieron leer las plantillas: ${error?.message}`);

  const active = data.filter((t) => t.is_active);
  console.log(`Plantillas activas revisadas: ${active.length}`);

  const problems: string[] = [];
  for (const t of active) {
    const fields = ((t.schema as { fields?: Field[] }).fields ?? []) as Field[];
    const seen = new Set<string>();
    for (const f of fields) {
      if (seen.has(f.key)) problems.push(`${t.code}: la clave "${f.key}" está repetida dentro de la misma plantilla`);
      seen.add(f.key);
      for (const r of RESERVED) {
        if (r.keys.includes(f.key) || r.labels.includes(normalize(f.label))) {
          problems.push(`${t.code}: el campo "${f.label}" (${f.key}) repite ${r.core}`);
        }
      }
    }
  }

  if (problems.length > 0) {
    console.log("\n✗ Campos duplicados con el núcleo de la consulta:");
    for (const p of problems) console.log("  - " + p);
    process.exit(1);
  }
  console.log("✓ Ninguna plantilla activa repite campos del núcleo de la consulta ni tiene claves repetidas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
