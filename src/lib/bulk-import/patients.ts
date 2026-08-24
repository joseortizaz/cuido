import ExcelJS from "exceljs";
import Papa from "papaparse";

/**
 * Importación masiva de pacientes -- plantilla descargable, parseo de
 * .xlsx/.csv subido, y validación fila por fila ANTES de escribir nada
 * en la base (ver bulk_import_batches,
 * supabase/migrations/20260825100000_bulk_import_batches.sql).
 *
 * Deliberadamente SIN `import "server-only"` -- mismo motivo que
 * src/lib/supabase/admin.ts: ese guard revienta fuera del bundler de
 * Next.js con la condición "react-server" activa (falla incluso al
 * importarlo desde un script vía tsx). Aquí no hay ningún secreto que
 * proteger (a diferencia de admin.ts con la service_role key) -- la
 * garantía real de que esto nunca llega a un bundle de cliente es
 * estructural: usa `Buffer` y exceljs, que dependen de módulos nativos
 * de Node (fs, stream) que no se pueden empaquetar para el navegador —
 * intentarlo falla en build, no en runtime silenciosamente.
 *
 * Alergias/medicamentos se importan solo por NOMBRE (lista separada por
 * ";" en una sola celda) -- trade-off explícito documentado en el
 * diseño: no captura severidad/reacción/dosis/frecuencia estructurada,
 * el admin la completa a mano después si hace falta.
 *
 * Reglas de validación espejo de las de creación manual
 * (src/app/(clinic)/patients/new/actions.ts): nombre/apellido/fecha de
 * nacimiento/sexo requeridos, sexo debe ser exactamente
 * "femenino"/"masculino". Se agrega lo que el formulario manual no
 * necesita porque el navegador ya lo garantiza (formato de fecha,
 * viniendo de una celda de Excel/CSV en vez de un <input type="date">).
 */

export const PATIENT_ROW_LIMIT = 500;

export type PatientImportRawRow = Record<string, string>;

export type PatientImportValidatedRow = {
  rowNumber: number;
  data: {
    first_name: string;
    last_name: string;
    national_id: string | null;
    date_of_birth: string;
    sex: "femenino" | "masculino";
    phone: string | null;
    email: string | null;
    allergies: string[];
    medications: string[];
  } | null;
  errors: string[];
};

// Encabezados aceptados por columna (normalizados: minúsculas, sin
// acentos, recortados) -- unos pocos alias razonables, no un mapeo
// exhaustivo. Igual para .xlsx y .csv: el formato de pacientes es plano,
// no hace falta el truco de fila oculta con field.key que sí usa la
// plantilla de consultas por especialidad (ver encounters.ts).
const COLUMN_ALIASES: Record<string, string[]> = {
  first_name: ["nombre"],
  last_name: ["apellido"],
  national_id: ["cedula o pasaporte", "cedula", "pasaporte"],
  date_of_birth: ["fecha de nacimiento"],
  sex: ["sexo"],
  phone: ["telefono"],
  email: ["correo"],
  allergies: ["alergias"],
  medications: ["medicamentos activos", "medicamentos"],
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .trim()
    .toLowerCase();
}

function buildHeaderIndex(headers: string[]): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const index: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const pos = normalized.findIndex((h) => aliases.includes(h));
    if (pos !== -1) index[field] = pos;
  }
  return index;
}

const HUMAN_HEADERS = [
  "Nombre",
  "Apellido",
  "Cédula o pasaporte",
  "Fecha de nacimiento",
  "Sexo",
  "Teléfono",
  "Correo",
  "Alergias",
  "Medicamentos activos",
] as const;

const EXAMPLE_ROW = [
  "María",
  "Pérez",
  "00112345678",
  "1985-04-12",
  "femenino",
  "8095551234",
  "maria.perez@example.com",
  "Penicilina; Mariscos",
  "Losartán 50mg",
];

/**
 * Workbook .xlsx con hoja "Pacientes" (SOLO encabezados, sin fila de
 * ejemplo -- ver nota abajo) e "Instrucciones".
 *
 * Deliberadamente sin fila de ejemplo en la hoja de datos: al probar el
 * ida-y-vuelta real (generar → llenar → subir → parsear) se confirmó
 * que si el admin no la borra antes de subir el archivo, se cuela como
 * un paciente fantasma (todo lo que aparece en la hoja de datos después
 * del encabezado se interpreta como una fila real). El ejemplo vive
 * solo en la hoja "Instrucciones", donde es puramente ilustrativo.
 */
export async function generatePatientImportTemplateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet("Pacientes");
  sheet.addRow([...HUMAN_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((col) => {
    col.width = 22;
  });
  for (let row = 2; row <= 501; row++) {
    sheet.getCell(`E${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"femenino,masculino"'],
    };
  }

  const instructions = workbook.addWorksheet("Instrucciones");
  instructions.columns = [{ width: 28 }, { width: 70 }];
  instructions.addRows([
    ["Columna", "Instrucciones"],
    ["Nombre", "Obligatorio."],
    ["Apellido", "Obligatorio."],
    ["Cédula o pasaporte", "Opcional. Si la incluyes, no puede repetirse entre pacientes."],
    ["Fecha de nacimiento", "Obligatorio. Formato AAAA-MM-DD (ej. 1985-04-12)."],
    ["Sexo", 'Obligatorio. Exactamente "femenino" o "masculino".'],
    ["Teléfono", "Opcional."],
    ["Correo", "Opcional."],
    ["Alergias", 'Opcional. Nombres separados por ";" (ej. "Penicilina; Mariscos"). No captura severidad/reacción — se completa después desde la ficha del paciente si hace falta.'],
    ["Medicamentos activos", 'Opcional. Nombres separados por ";" (ej. "Losartán 50mg; Metformina 850mg"). No captura dosis/frecuencia estructurada — se completa después.'],
    ["", ""],
    ["Ejemplo (solo ilustrativo — no lo copies a la hoja Pacientes)", ""],
  ]);
  instructions.addRow(HUMAN_HEADERS as unknown as string[]);
  instructions.addRow(EXAMPLE_ROW);
  instructions.getRow(1).font = { bold: true };
  instructions.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Solo encabezados, sin fila de ejemplo -- mismo motivo que la .xlsx
 * (ver nota en generatePatientImportTemplateXlsx), y el .csv no tiene
 * dónde poner un ejemplo puramente ilustrativo sin arriesgar que se
 * suba tal cual como una fila de datos real.
 */
export function generatePatientImportTemplateCsv(): string {
  return Papa.unparse({ fields: [...HUMAN_HEADERS], data: [] });
}

/** Parsea el archivo subido (por extensión) a filas crudas (string a string). */
export async function parsePatientImportFile(
  buffer: Buffer,
  fileName: string
): Promise<{ rows: PatientImportRawRow[]; parseError?: string }> {
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
    // Cast: desajuste de tipos entre el Buffer de este proyecto y el que
    // espera el .d.ts de exceljs (versión de @types/node distinta,
    // mismo Buffer en runtime).
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
  const missing = Object.keys(COLUMN_ALIASES).filter(
    (f) => !["national_id", "phone", "email", "allergies", "medications"].includes(f) && headerIndex[f] === undefined
  );
  if (missing.length > 0) {
    return {
      rows: [],
      parseError: `Faltan columnas obligatorias en el archivo: ${missing.join(", ")}. Usa la plantilla descargable.`,
    };
  }

  const rows: PatientImportRawRow[] = dataRows
    .filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""))
    .map((r) => {
      const row: PatientImportRawRow = {};
      for (const field of Object.keys(COLUMN_ALIASES)) {
        const pos = headerIndex[field];
        row[field] = pos === undefined ? "" : String(r[pos] ?? "").trim();
      }
      return row;
    });

  return { rows };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function splitList(value: string): string[] {
  return value
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Valida cada fila cruda: campos requeridos, formato de fecha/sexo, y
 * duplicados de cédula -- tanto DENTRO del archivo (dos filas con la
 * misma cédula) como CONTRA la base (ya existe un paciente con esa
 * cédula en la clínica -- ver índice único
 * patients_clinic_national_id_idx). No inserta nada -- solo produce el
 * detalle fila por fila que se guarda en bulk_import_batches.rows para
 * el preview.
 */
export function validatePatientRows(
  rawRows: PatientImportRawRow[],
  existingNationalIds: Set<string>
): PatientImportValidatedRow[] {
  const seenInFile = new Set<string>();

  return rawRows.map((raw, i): PatientImportValidatedRow => {
    const rowNumber = i + 2; // fila 1 = encabezado
    const errors: string[] = [];

    const firstName = raw.first_name;
    const lastName = raw.last_name;
    if (!firstName) errors.push("Nombre es requerido.");
    if (!lastName) errors.push("Apellido es requerido.");

    const dateOfBirth = raw.date_of_birth;
    if (!dateOfBirth) errors.push("Fecha de nacimiento es requerida.");
    else if (!isValidCalendarDate(dateOfBirth)) {
      errors.push("Fecha de nacimiento debe tener formato AAAA-MM-DD y ser una fecha válida.");
    }

    const sexRaw = raw.sex.toLowerCase();
    if (sexRaw !== "femenino" && sexRaw !== "masculino") {
      errors.push('Sexo debe ser exactamente "femenino" o "masculino".');
    }

    const nationalId = raw.national_id || null;
    if (nationalId) {
      if (seenInFile.has(nationalId)) {
        errors.push(`La cédula/pasaporte "${nationalId}" está repetida en este archivo.`);
      }
      if (existingNationalIds.has(nationalId)) {
        errors.push(`Ya existe un paciente con la cédula/pasaporte "${nationalId}" en esta clínica.`);
      }
      seenInFile.add(nationalId);
    }

    if (errors.length > 0) {
      return { rowNumber, data: null, errors };
    }

    return {
      rowNumber,
      data: {
        first_name: firstName,
        last_name: lastName,
        national_id: nationalId,
        date_of_birth: dateOfBirth,
        sex: sexRaw as "femenino" | "masculino",
        phone: raw.phone || null,
        email: raw.email || null,
        allergies: splitList(raw.allergies),
        medications: splitList(raw.medications),
      },
      errors: [],
    };
  });
}
