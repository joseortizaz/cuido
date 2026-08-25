import ExcelJS from "exceljs";
import Papa from "papaparse";
import { buildZodSchemaForTemplate, type TemplateField } from "@/lib/domain/specialty-template";

/**
 * Importación masiva de consultas por especialidad (Fase 2 de 2, reusa
 * bulk_import_batches de Fase 1 -- ver
 * supabase/migrations/20260825100000_bulk_import_batches.sql, sin
 * migración nueva). Formato campo/valor LARGO: cada fila del archivo es
 * UN campo de UNA consulta, no una consulta completa -- varias filas se
 * agrupan por (Cédula, Fecha de la consulta) en una sola consulta al
 * importar.
 *
 * Alcance confirmado con el usuario: solo campos de tipo texto,
 * textarea y número, sin `condition` (campos condicionales quedan
 * fuera). Selects y campos condicionales se detectan y se excluyen
 * explícitamente de la plantilla descargable (con motivo, en la hoja
 * de Instrucciones) -- nunca fallan en silencio si alguien los escribe
 * de todas formas, dan error claro en el preview.
 *
 * La especialidad NO es una columna del archivo: se elige antes de
 * descargar la plantilla (mismo picker que /encounters/new) y queda
 * fija para todo el archivo en bulk_import_batches.specialty_template_id
 * -- repetirla por fila sería redundante y permitiría una fila
 * contradictoria con la especialidad real que se está validando.
 *
 * Deliberadamente SIN `import "server-only"` -- mismo motivo que
 * src/lib/bulk-import/patients.ts.
 */

export const ENCOUNTER_ROW_LIMIT = 500;

export function isImportableField(field: TemplateField): boolean {
  return (field.type === "text" || field.type === "textarea" || field.type === "number") && !field.condition;
}

function exclusionReason(field: TemplateField): string {
  if (field.condition) {
    return `no soportado: solo aplica condicionalmente (depende de "${field.condition.field}").`;
  }
  if (field.type === "select") return "no soportado: es un campo de lista cerrada (select).";
  if (field.type === "date") return "no soportado en esta versión (campo de fecha).";
  return "no soportado en esta versión.";
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Plantilla descargable
// ---------------------------------------------------------------------------

const HUMAN_HEADERS = ["Cédula o pasaporte del paciente", "Fecha de la consulta", "Médico (correo)", "Campo", "Valor"] as const;

export async function generateEncounterImportTemplateXlsx(
  specialtyName: string,
  fields: TemplateField[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet("Consultas");
  sheet.addRow([...HUMAN_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((c) => (c.width = 26));

  const importable = fields.filter(isImportableField);
  const excluded = fields.filter((f) => !isImportableField(f));

  const instructions = workbook.addWorksheet("Instrucciones");
  instructions.columns = [{ width: 34 }, { width: 60 }];
  instructions.addRow([`Especialidad: ${specialtyName}`, ""]);
  instructions.addRow(["", ""]);
  instructions.addRow(["Cómo llenar", ""]);
  instructions.addRow([
    "Formato campo/valor",
    'Cada fila es UN campo de UNA consulta. Las filas con la misma "Cédula" y "Fecha de la consulta" se agrupan en una sola consulta al importar -- una fila por campo que quieras llenar.',
  ]);
  instructions.addRow(["Cédula o pasaporte del paciente", "Obligatorio. El paciente debe existir ya en la clínica (esta importación no crea pacientes)."]);
  instructions.addRow(["Fecha de la consulta", "Obligatorio. Formato AAAA-MM-DD, igual en todas las filas de la misma consulta."]);
  instructions.addRow(["Médico (correo)", "Opcional. Si se deja vacío, la consulta queda a nombre de quien importa."]);
  instructions.addRow(["Campo", 'Debe ser exactamente uno de los nombres listados abajo en "Campos disponibles".']);
  instructions.addRow(["Valor", "El valor de ese campo para esa consulta."]);
  instructions.addRow(["", ""]);

  instructions.addRow([`Campos disponibles de ${specialtyName}`, ""]).font = { bold: true };
  if (importable.length === 0) {
    instructions.addRow(["(Ninguno -- esta especialidad no tiene campos de texto/número importables todavía.)", ""]);
  }
  for (const field of importable) {
    instructions.addRow([field.label, field.required ? "Requerido" : "Opcional"]);
  }

  instructions.addRow(["", ""]);
  instructions.addRow([`Campos NO soportados de ${specialtyName} (no los uses en "Campo")`, ""]).font = { bold: true };
  if (excluded.length === 0) {
    instructions.addRow(["(Ninguno -- todos los campos de esta especialidad son importables.)", ""]);
  }
  for (const field of excluded) {
    instructions.addRow([field.label, exclusionReason(field)]);
  }
  instructions.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

export type EncounterImportRawRow = {
  rowNumber: number;
  nationalId: string;
  scheduledAt: string;
  providerEmail: string;
  fieldLabel: string;
  value: string;
};

const COLUMN_ALIASES: Record<string, string[]> = {
  nationalId: ["cedula o pasaporte del paciente", "cedula o pasaporte", "cedula"],
  scheduledAt: ["fecha de la consulta", "fecha"],
  providerEmail: ["medico (correo)", "medico"],
  fieldLabel: ["campo"],
  value: ["valor"],
};

function buildHeaderIndex(headers: string[]): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const index: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const pos = normalized.findIndex((h) => aliases.includes(h));
    if (pos !== -1) index[field] = pos;
  }
  return index;
}

export async function parseEncounterImportFile(
  buffer: Buffer,
  fileName: string
): Promise<{ rows: EncounterImportRawRow[]; parseError?: string }> {
  const isCsv = fileName.toLowerCase().endsWith(".csv");

  let headers: string[];
  let dataRows: string[][];

  if (isCsv) {
    const text = buffer.toString("utf8");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    if (parsed.errors.length > 0) {
      return { rows: [], parseError: `No se pudo leer el CSV: ${parsed.errors[0].message}` };
    }
    [headers, ...dataRows] = parsed.data;
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { rows: [], parseError: "El archivo no tiene ninguna hoja." };
    const allRows: string[][] = [];
    sheet.eachRow((row) => {
      allRows.push(row.values ? (row.values as unknown[]).slice(1).map((v) => (v == null ? "" : String(v))) : []);
    });
    [headers, ...dataRows] = allRows;
  }

  if (!headers) return { rows: [], parseError: "El archivo está vacío." };

  const headerIndex = buildHeaderIndex(headers);
  const missing = ["nationalId", "scheduledAt", "fieldLabel", "value"].filter((f) => headerIndex[f] === undefined);
  if (missing.length > 0) {
    return {
      rows: [],
      parseError: `Faltan columnas obligatorias en el archivo (${missing.join(", ")}). Usa la plantilla descargable.`,
    };
  }

  const rows: EncounterImportRawRow[] = dataRows
    .filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""))
    .map((r, i): EncounterImportRawRow => ({
      rowNumber: i + 2,
      nationalId: String(r[headerIndex.nationalId] ?? "").trim(),
      scheduledAt: String(r[headerIndex.scheduledAt] ?? "").trim(),
      providerEmail: headerIndex.providerEmail === undefined ? "" : String(r[headerIndex.providerEmail] ?? "").trim(),
      fieldLabel: String(r[headerIndex.fieldLabel] ?? "").trim(),
      value: String(r[headerIndex.value] ?? "").trim(),
    }));

  return { rows };
}

// ---------------------------------------------------------------------------
// Agrupación y validación
// ---------------------------------------------------------------------------

export type EncounterImportGroup = {
  groupKey: string;
  rowNumbers: number[];
  nationalId: string;
  scheduledAt: string;
  providerEmail: string;
  /** Campo (tal como lo escribió el admin, en label) -> Valor. */
  fields: Record<string, string>;
  /**
   * SOLO errores estructurales de agrupación (médico inconsistente entre
   * filas, campo repetido dentro de la misma consulta) -- deterministos
   * a partir de las filas crudas, no dependen del estado de la base.
   * `validateEncounterGroups` los usa como semilla y SIEMPRE construye su
   * propio arreglo de errores completo a partir de esta semilla -- nunca
   * a partir de un `errors` ya combinado con validaciones de base de una
   * corrida anterior (eso duplicaría mensajes si se llama dos veces,
   * como pasa entre el preview y la confirmación).
   */
  structuralErrors: string[];
};

/** Agrupa filas crudas por (Cédula, Fecha) -- puramente determinístico, no depende de la base. */
export function groupEncounterRows(rawRows: EncounterImportRawRow[]): EncounterImportGroup[] {
  const groups = new Map<string, EncounterImportGroup>();
  const order: string[] = [];

  for (const row of rawRows) {
    const key = `${row.nationalId}|${row.scheduledAt}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        groupKey: key,
        rowNumbers: [],
        nationalId: row.nationalId,
        scheduledAt: row.scheduledAt,
        providerEmail: "",
        fields: {},
        structuralErrors: [],
      };
      groups.set(key, group);
      order.push(key);
    }
    group.rowNumbers.push(row.rowNumber);

    if (row.providerEmail) {
      if (group.providerEmail && group.providerEmail !== row.providerEmail) {
        group.structuralErrors.push(
          `Filas de esta consulta tienen "Médico" distinto ("${group.providerEmail}" vs. "${row.providerEmail}") -- debe ser el mismo en todas las filas.`
        );
      }
      group.providerEmail = row.providerEmail;
    }

    if (row.fieldLabel in group.fields) {
      group.structuralErrors.push(`El campo "${row.fieldLabel}" está repetido en esta consulta (fila ${row.rowNumber}).`);
      continue;
    }
    group.fields[row.fieldLabel] = row.value;
  }

  return order.map((k) => groups.get(k)!);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type EncounterImportValidationContext = {
  importableFields: TemplateField[];
  /** field.label normalizado -> TemplateField, para resolver "Campo" del archivo. */
  allFieldsByNormalizedLabel: Map<string, TemplateField>;
  existingPatientIdByNationalId: Map<string, string>;
  clinicMemberIdByEmail: Map<string, string>;
  importingAdminId: string;
  specialtyIsSensitive: boolean;
};

export type EncounterImportValidatedGroup = EncounterImportGroup & {
  /** Errores completos (estructurales + validación contra la base) de ESTA corrida -- para mostrar en el preview. */
  errors: string[];
  /** Solo presente si el grupo es válido -- listo para insertar. */
  resolved?: {
    patientId: string;
    providerId: string;
    specialtyData: Record<string, unknown>;
  };
};

/**
 * Valida cada grupo contra el estado ACTUAL pasado en `ctx` (el llamador
 * decide si ese estado es "de preview" o "recién refrescado para
 * confirmar" -- esta función en sí no toca la base). Nunca crea el
 * paciente si no existe -- a diferencia de la importación de pacientes
 * de Fase 1, aquí el paciente debe existir ya.
 */
export function validateEncounterGroups(
  groups: EncounterImportGroup[],
  ctx: EncounterImportValidationContext
): EncounterImportValidatedGroup[] {
  return groups.map((group): EncounterImportValidatedGroup => {
    const errors = [...group.structuralErrors];

    if (!group.nationalId) errors.push("Cédula o pasaporte del paciente es requerido.");
    if (!group.scheduledAt) errors.push("Fecha de la consulta es requerida.");
    else if (!isValidCalendarDate(group.scheduledAt)) {
      errors.push("Fecha de la consulta debe tener formato AAAA-MM-DD y ser una fecha válida.");
    }

    const patientId = group.nationalId ? ctx.existingPatientIdByNationalId.get(group.nationalId) : undefined;
    if (group.nationalId && !patientId) {
      errors.push(`No existe ningún paciente con la cédula/pasaporte "${group.nationalId}" en esta clínica.`);
    }

    let providerId = ctx.importingAdminId;
    if (group.providerEmail) {
      const resolved = ctx.clinicMemberIdByEmail.get(group.providerEmail.toLowerCase());
      if (!resolved) {
        errors.push(`No se encontró ningún miembro de la clínica con el correo "${group.providerEmail}".`);
      } else if (ctx.specialtyIsSensitive && resolved !== ctx.importingAdminId) {
        errors.push(
          'Especialidad sensible: el médico debe ser quien realiza la importación. Deja la columna "Médico" vacía o usa tu propio correo.'
        );
      } else {
        providerId = resolved;
      }
    }

    // Todo campo importable arranca en "" (no `undefined`) -- mismo
    // patrón que createEncounter arma rawSpecialtyData desde FormData
    // (patients/[id]/encounters/new/[templateId]/actions.ts): un campo
    // requerido ausente del archivo debe dar el mensaje de
    // buildZodSchemaForTemplate ("X es requerido."), no el mensaje
    // interno de Zod ("expected string, received undefined") que sale
    // si la clave falta del todo en vez de estar vacía.
    const rawSpecialtyData: Record<string, unknown> = {};
    for (const field of ctx.importableFields) {
      rawSpecialtyData[field.key] = "";
    }

    // Resuelve cada "Campo" (label) del archivo a su TemplateField real.
    for (const [label, value] of Object.entries(group.fields)) {
      const field = ctx.allFieldsByNormalizedLabel.get(normalizeHeader(label));
      if (!field) {
        errors.push(`El campo "${label}" no existe en esta especialidad.`);
        continue;
      }
      if (!isImportableField(field)) {
        errors.push(`El campo "${label}" ${exclusionReason(field)}`);
        continue;
      }
      rawSpecialtyData[field.key] = value;
    }

    if (Object.keys(group.fields).length === 0) {
      errors.push("Esta consulta no tiene ningún campo.");
    }

    if (errors.length > 0) {
      return { ...group, errors };
    }

    const validation = buildZodSchemaForTemplate(ctx.importableFields).safeParse(rawSpecialtyData);
    if (!validation.success) {
      const messages = validation.error.issues.map((issue) => issue.message);
      return { ...group, errors: messages };
    }

    return {
      ...group,
      errors: [],
      resolved: {
        patientId: patientId!,
        providerId,
        specialtyData: validation.data as Record<string, unknown>,
      },
    };
  });
}
