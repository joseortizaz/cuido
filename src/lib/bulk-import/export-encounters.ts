import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../supabase/database.types";
import { parseTemplateSchema, type TemplateField } from "../domain/specialty-template";
import { VITAL_KEYS, VITAL_LABELS } from "../domain/vital-signs";
import { fetchAllPages } from "./fetch-all";

// Deliberadamente SIN `import "server-only"` -- ver la misma nota en
// src/lib/bulk-import/patients.ts.

/**
 * Exportación de consultas por especialidad.
 *
 * Una fila por consulta y UNA COLUMNA POR CAMPO de la plantilla de su
 * especialidad (formato ancho -- el natural para una hoja de cálculo),
 * precedidas de las columnas fijas: id, fecha y hora (en hora de Santo
 * Domingo), paciente, profesional, motivo de consulta y signos vitales.
 *
 * El llamador (Route Handler) lee con el cliente NORMAL del admin autenticado,
 * nunca service_role: el aislamiento entre clínicas y el control de acceso
 * reforzado (Salud Mental: solo el profesional tratante o quien tenga una
 * concesión explícita) lo da RLS ya existente, sin código nuevo de
 * aislamiento. Por eso el archivo incluye únicamente lo que ese admin tiene
 * permiso de leer.
 */

const ENCOUNTER_SELECT =
  "id, encounter_date, chief_complaint, provider_id, specialty_template_id, specialty_data, " +
  "patients(first_name, last_name, national_id), " +
  `vital_signs(${VITAL_KEYS.join(", ")}, recorded_at)`;

type VitalRow = Record<string, number | string | null> & { recorded_at: string };

export type ExportEncounter = {
  id: string;
  encounter_date: string;
  chief_complaint: string | null;
  provider_id: string;
  specialty_template_id: string;
  specialty_data: Json;
  patient: { first_name: string; last_name: string; national_id: string | null } | null;
  vitals: VitalRow[];
};

export type ExportTemplate = { id: string; name: string; schema: Json };

export type ExportCell = string | number;
export type ExportTable = { name: string; headers: string[]; rows: ExportCell[][] };

/** Todas las consultas visibles para el cliente (opcionalmente de una sola plantilla), sin truncar. */
export async function fetchEncounterExportData(
  supabase: SupabaseClient<Database>,
  templateId?: string
): Promise<ExportEncounter[]> {
  const rows = await fetchAllPages(async (from, to) => {
    let query = supabase.from("encounters").select(ENCOUNTER_SELECT);
    if (templateId) query = query.eq("specialty_template_id", templateId);
    // Orden único (fecha, id) y estable: obligatorio para paginar sin repetir ni omitir filas.
    // Los resultados se tipan a mano abajo: el select se arma dinámicamente con VITAL_KEYS.
    return query.order("encounter_date", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });

  return (rows as unknown as RawEncounterRow[]).map((r) => {
    const patient = Array.isArray(r.patients) ? (r.patients[0] ?? null) : r.patients;
    return {
      id: r.id,
      encounter_date: r.encounter_date,
      chief_complaint: r.chief_complaint,
      provider_id: r.provider_id,
      specialty_template_id: r.specialty_template_id,
      specialty_data: r.specialty_data,
      patient: patient ?? null,
      vitals: [...(r.vital_signs ?? [])].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)),
    };
  });
}

type RawEncounterRow = {
  id: string;
  encounter_date: string;
  chief_complaint: string | null;
  provider_id: string;
  specialty_template_id: string;
  specialty_data: Json;
  patients:
    | { first_name: string; last_name: string; national_id: string | null }
    | { first_name: string; last_name: string; national_id: string | null }[]
    | null;
  vital_signs: VitalRow[] | null;
};

/** "YYYY-MM-DD HH:mm" en America/Santo_Domingo. */
export function formatEncounterDateTime(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function formatValue(value: unknown): ExportCell {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Encabezados repetidos reciben " (2)", " (3)"... -- una columna nunca pisa a otra. */
function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
}

const FIXED_HEADERS = [
  "ID de consulta",
  "Fecha y hora",
  "Apellido",
  "Nombre",
  "Cédula o pasaporte",
  "Profesional",
  "Motivo de consulta",
  ...VITAL_KEYS.map((k) => VITAL_LABELS[k]),
];

export const EXTRA_DATA_HEADER = "Datos adicionales";

/**
 * Arma la tabla de UNA especialidad. `emailByUserId` traduce provider_id a
 * correo (auth.users no está expuesto por la Data API; lo resuelve el llamador).
 *
 * Datos guardados con claves que la plantilla ACTUAL ya no tiene (la
 * plantilla pudo cambiar después de guardar la consulta) no se pierden: van en
 * la columna "Datos adicionales" como JSON, que solo aparece si hace falta.
 */
export function buildEncounterTable(
  template: ExportTemplate,
  encounters: ExportEncounter[],
  emailByUserId: Map<string, string>
): ExportTable {
  const fields: TemplateField[] = parseTemplateSchema(template.schema).fields;
  const knownKeys = new Set(fields.map((f) => f.key));

  const extrasByEncounter = encounters.map((e) => {
    const data = (e.specialty_data && typeof e.specialty_data === "object" && !Array.isArray(e.specialty_data)
      ? e.specialty_data
      : {}) as Record<string, Json>;
    const extras: Record<string, Json> = {};
    for (const [k, v] of Object.entries(data)) if (!knownKeys.has(k)) extras[k] = v;
    return Object.keys(extras).length > 0 ? extras : null;
  });
  const hasExtras = extrasByEncounter.some((x) => x !== null);

  const headers = uniqueHeaders([
    ...FIXED_HEADERS,
    ...fields.map((f) => f.label),
    ...(hasExtras ? [EXTRA_DATA_HEADER] : []),
  ]);

  const rows = encounters.map((e, i) => {
    const data = (e.specialty_data && typeof e.specialty_data === "object" && !Array.isArray(e.specialty_data)
      ? e.specialty_data
      : {}) as Record<string, Json>;
    const vitals = e.vitals[0];
    const row: ExportCell[] = [
      e.id,
      formatEncounterDateTime(e.encounter_date),
      e.patient?.last_name ?? "",
      e.patient?.first_name ?? "",
      e.patient?.national_id ?? "",
      emailByUserId.get(e.provider_id) ?? e.provider_id,
      e.chief_complaint ?? "",
      ...VITAL_KEYS.map((k) => formatValue(vitals?.[k])),
      ...fields.map((f) => formatValue(data[f.key])),
    ];
    if (hasExtras) row.push(extrasByEncounter[i] ? JSON.stringify(extrasByEncounter[i]) : "");
    return row;
  });

  return { name: template.name, headers, rows };
}

/** Nombre de hoja válido en Excel: ≤31 caracteres, sin \ / ? * [ ] : y único en el libro. */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, "-").trim().slice(0, 31) || "Hoja";
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Libro con una hoja "Resumen" (especialidad y cantidad de consultas -- para
 * cotejar que no falte nada) y una hoja por especialidad con consultas.
 */
export async function generateEncountersExportXlsx(
  tables: ExportTable[],
  options: { generatedOn: string }
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const used = new Set<string>(["resumen"]);

  const summary = workbook.addWorksheet("Resumen");
  summary.addRow(["Especialidad", "Consultas exportadas"]);
  summary.getRow(1).font = { bold: true };
  summary.columns = [{ width: 48 }, { width: 22 }];
  for (const t of tables) summary.addRow([t.name, t.rows.length]);
  summary.addRow([]);
  summary.addRow(["Total", tables.reduce((n, t) => n + t.rows.length, 0)]);
  summary.lastRow!.font = { bold: true };
  summary.addRow([]);
  summary.addRow([`Exportado el ${options.generatedOn}. Solo incluye las consultas que el usuario que exporta tiene permiso de ver.`]);

  for (const t of tables) {
    const sheet = workbook.addWorksheet(safeSheetName(t.name, used));
    sheet.addRow(t.headers);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach((c, i) => (c.width = i === 0 ? 38 : 22));
    for (const row of t.rows) sheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * CSV de UNA especialidad, con BOM UTF-8 (sin él, Excel lee los acentos como
 * Latin-1) y `escapeFormulae`: una celda que empieza por = + - @ (p. ej. un
 * texto clínico "- sin fiebre") se antepone con ' para que Excel nunca la
 * ejecute como fórmula al abrir el archivo (inyección de fórmulas en CSV).
 */
export function generateEncountersCsv(table: ExportTable): string {
  return "﻿" + Papa.unparse({ fields: table.headers, data: table.rows }, { escapeFormulae: true });
}
