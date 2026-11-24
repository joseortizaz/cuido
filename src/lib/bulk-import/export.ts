import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAllPages } from "./fetch-all";
import {
  EDUCATION_LABELS,
  INFORMANT_LABELS,
  MARITAL_LABELS,
  labelOf,
  religionDisplay,
} from "@/lib/domain/patient-identity";

// Deliberadamente SIN `import "server-only"` -- ver la misma nota en
// src/lib/bulk-import/patients.ts.

type Patient = Pick<
  Database["public"]["Tables"]["patients"]["Row"],
  | "id"
  | "record_number"
  | "is_test"
  | "voided_at"
  | "first_name"
  | "last_name"
  | "national_id"
  | "date_of_birth"
  | "sex"
  | "phone"
  | "email"
  | "education_level"
  | "marital_status"
  | "residence"
  | "place_of_origin"
  | "occupation"
  | "informant_type"
  | "informant_name"
>;
type Allergy = Pick<
  Database["public"]["Tables"]["allergies"]["Row"],
  "patient_id" | "substance" | "reaction" | "severity" | "status"
>;
type Medication = Pick<
  Database["public"]["Tables"]["medications"]["Row"],
  "patient_id" | "name" | "dose" | "frequency" | "status" | "started_at" | "discontinued_at"
>;

/**
 * Exportación de pacientes -- a diferencia de importar, exportar no
 * tiene el problema de "cómo llenar esto a mano", así que el .xlsx sí
 * lleva el detalle estructurado completo de alergias/medicamentos en
 * hojas separadas (severidad, reacción, dosis, frecuencia) en vez del
 * resumen por nombre que usa la plantilla de importación. El .csv se
 * queda solo con el núcleo demográfico, aplanado -- mismo criterio.
 *
 * El llamador (Route Handler) es responsable de que las filas ya vengan
 * filtradas por RLS (cliente normal del admin autenticado, nunca
 * service_role) -- este módulo solo arma el archivo, no vuelve a
 * chequear pertenencia de clínica.
 */

const PATIENT_HEADERS = [
  "Código",
  "Nombre",
  "Apellido",
  "Cédula o pasaporte",
  "Fecha de nacimiento",
  "Sexo",
  "Teléfono",
  "Correo",
  "Estado",
  "Escolaridad",
  "Estado civil",
  "Residencia",
  "Procedencia",
  "Ocupación",
  "Informante",
  "Nombre del informante",
];

/** La religión es un dato sensible (Ley 172-13): NO sale en las exportaciones salvo que el administrador la pida expresamente. */
const RELIGION_HEADER = "Religión";

export type ReligionByPatient = Map<string, { religion: string; religion_other: string | null }>;

/** Las claves de las listas cerradas salen con su texto en español. */
function identityCells(p: Patient): (string | null)[] {
  return [
    p.education_level ? labelOf(EDUCATION_LABELS, p.education_level) : null,
    p.marital_status ? labelOf(MARITAL_LABELS, p.marital_status) : null,
    p.residence,
    p.place_of_origin,
    p.occupation,
    p.informant_type ? labelOf(INFORMANT_LABELS, p.informant_type) : null,
    p.informant_name,
  ];
}

function patientRow(p: Patient, religion?: ReligionByPatient): (string | null)[] {
  const row = [
    p.record_number,
    p.first_name,
    p.last_name,
    p.national_id,
    p.date_of_birth,
    p.sex,
    p.phone,
    p.email,
    p.voided_at ? "Anulado" : "",
    ...identityCells(p),
  ];
  if (religion) row.push(religionDisplay(religion.get(p.id)) || null);
  return row;
}

const headersFor = (religion?: ReligionByPatient) => (religion ? [...PATIENT_HEADERS, RELIGION_HEADER] : PATIENT_HEADERS);

export async function generatePatientsExportXlsx(
  patients: Patient[],
  allergies: Allergy[],
  medications: Medication[],
  religion?: ReligionByPatient
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const patientNameById = new Map(patients.map((p) => [p.id, `${p.first_name} ${p.last_name}`]));

  const patientsSheet = workbook.addWorksheet("Pacientes");
  patientsSheet.addRow(headersFor(religion));
  patientsSheet.getRow(1).font = { bold: true };
  patientsSheet.views = [{ state: "frozen", ySplit: 1 }];
  patientsSheet.columns.forEach((c) => (c.width = 22));
  for (const p of patients) patientsSheet.addRow(patientRow(p, religion));

  const allergiesSheet = workbook.addWorksheet("Alergias");
  allergiesSheet.addRow(["Paciente", "Sustancia", "Reacción", "Severidad", "Estado"]);
  allergiesSheet.getRow(1).font = { bold: true };
  allergiesSheet.columns.forEach((c) => (c.width = 22));
  for (const a of allergies) {
    allergiesSheet.addRow([patientNameById.get(a.patient_id) ?? a.patient_id, a.substance, a.reaction, a.severity, a.status]);
  }

  const medicationsSheet = workbook.addWorksheet("Medicamentos");
  medicationsSheet.addRow(["Paciente", "Medicamento", "Dosis", "Frecuencia", "Estado", "Inicio", "Descontinuado"]);
  medicationsSheet.getRow(1).font = { bold: true };
  medicationsSheet.columns.forEach((c) => (c.width = 22));
  for (const m of medications) {
    medicationsSheet.addRow([
      patientNameById.get(m.patient_id) ?? m.patient_id,
      m.name,
      m.dose,
      m.frequency,
      m.status,
      m.started_at,
      m.discontinued_at,
    ]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * BOM UTF-8 (sin él, Excel lee los acentos como Latin-1) y `escapeFormulae`: una
 * celda que empieza por = + - @ se antepone con ' para que Excel nunca la
 * ejecute como fórmula al abrir el archivo (inyección de fórmulas en CSV).
 */
export function generatePatientsExportCsv(patients: Patient[], religion?: ReligionByPatient): string {
  return (
    "﻿" +
    Papa.unparse(
      {
        fields: headersFor(religion),
        data: patients.map((p) => patientRow(p, religion)),
      },
      { escapeFormulae: true }
    )
  );
}

/**
 * Lee TODOS los pacientes (y, para el .xlsx, sus alergias y medicamentos) de la
 * clínica del cliente, sin truncar.
 *
 * Dos problemas de la versión anterior de la ruta, corregidos aquí:
 *  - PostgREST corta cada respuesta en 1000 filas sin dar error: con más de
 *    1000 pacientes el archivo salía truncado en silencio. Ahora se pagina.
 *  - Las alergias y medicamentos se pedían con `.in("patient_id", <todos los
 *    ids>)`; con miles de ids la URL supera el límite y la consulta fallaba en
 *    silencio, exportando hojas vacías. Ahora se leen paginadas y sin filtro
 *    por id: el aislamiento por clínica lo da RLS (cliente normal del admin,
 *    nunca service_role), igual que antes.
 */
export async function fetchPatientsExportData(
  supabase: SupabaseClient<Database>,
  options: { withDetail: boolean }
): Promise<{ patients: Patient[]; allergies: Allergy[]; medications: Medication[] }> {
  const allPatients = await fetchAllPages<Patient>(async (from, to) =>
    supabase
      .from("patients")
      .select(
        "id, record_number, is_test, voided_at, first_name, last_name, national_id, date_of_birth, sex, phone, email, education_level, marital_status, residence, place_of_origin, occupation, informant_type, informant_name"
      )
      .order("last_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  // Los pacientes de prueba (datos ficticios) no se exportan; los anulados sí, marcados en «Estado».
  const patients = allPatients.filter((p) => !p.is_test);
  if (!options.withDetail) return { patients, allergies: [], medications: [] };
  const kept = new Set(patients.map((p) => p.id));

  const [allergies, medications] = await Promise.all([
    fetchAllPages<Allergy>(async (from, to) =>
      supabase
        .from("allergies")
        .select("id, patient_id, substance, reaction, severity, status")
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllPages<Medication>(async (from, to) =>
      supabase
        .from("medications")
        .select("id, patient_id, name, dose, frequency, status, started_at, discontinued_at")
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);
  return {
    patients,
    allergies: allergies.filter((a) => kept.has(a.patient_id)),
    medications: medications.filter((m) => kept.has(m.patient_id)),
  };
}

/** Religión de los pacientes indicados (solo se llama cuando el administrador la pide expresamente). RLS: admin y médicos. */
export async function fetchReligionByPatient(
  supabase: SupabaseClient<Database>,
  patientIds: string[]
): Promise<ReligionByPatient> {
  const kept = new Set(patientIds);
  const rows = await fetchAllPages<{ patient_id: string; religion: string; religion_other: string | null }>(async (from, to) =>
    supabase
      .from("patient_religion")
      .select("patient_id, religion, religion_other")
      .order("patient_id", { ascending: true })
      .range(from, to)
  );
  const map: ReligionByPatient = new Map();
  for (const r of rows) if (kept.has(r.patient_id)) map.set(r.patient_id, { religion: r.religion, religion_other: r.religion_other });
  return map;
}
