import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { Database } from "@/lib/supabase/database.types";

// Deliberadamente SIN `import "server-only"` -- ver la misma nota en
// src/lib/bulk-import/patients.ts.

type Patient = Pick<
  Database["public"]["Tables"]["patients"]["Row"],
  "id" | "first_name" | "last_name" | "national_id" | "date_of_birth" | "sex" | "phone" | "email"
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

const PATIENT_HEADERS = ["Nombre", "Apellido", "Cédula o pasaporte", "Fecha de nacimiento", "Sexo", "Teléfono", "Correo"];

function patientRow(p: Patient): (string | null)[] {
  return [p.first_name, p.last_name, p.national_id, p.date_of_birth, p.sex, p.phone, p.email];
}

export async function generatePatientsExportXlsx(
  patients: Patient[],
  allergies: Allergy[],
  medications: Medication[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const patientNameById = new Map(patients.map((p) => [p.id, `${p.first_name} ${p.last_name}`]));

  const patientsSheet = workbook.addWorksheet("Pacientes");
  patientsSheet.addRow(PATIENT_HEADERS);
  patientsSheet.getRow(1).font = { bold: true };
  patientsSheet.views = [{ state: "frozen", ySplit: 1 }];
  patientsSheet.columns.forEach((c) => (c.width = 22));
  for (const p of patients) patientsSheet.addRow(patientRow(p));

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

export function generatePatientsExportCsv(patients: Patient[]): string {
  return Papa.unparse({
    fields: PATIENT_HEADERS,
    data: patients.map(patientRow),
  });
}
