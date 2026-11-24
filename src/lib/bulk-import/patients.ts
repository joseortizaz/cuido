import ExcelJS from "exceljs";
import Papa from "papaparse";
import {
  EDUCATION_LABELS,
  INFORMANT_LABELS,
  MARITAL_LABELS,
  MAX_IDENTITY_TEXT,
  type EducationLevel,
  type InformantType,
  type MaritalStatus,
} from "@/lib/domain/patient-identity";

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
    education_level: EducationLevel | null;
    marital_status: MaritalStatus | null;
    residence: string | null;
    place_of_origin: string | null;
    occupation: string | null;
    informant_type: InformantType | null;
    informant_name: string | null;
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
  education_level: ["escolaridad"],
  marital_status: ["estado civil"],
  residence: ["residencia"],
  place_of_origin: ["procedencia"],
  occupation: ["ocupacion"],
  informant_type: ["informante"],
  informant_name: ["nombre del informante", "nombre informante"],
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

const OPTIONAL_IDENTITY_FIELDS = [
  "education_level",
  "marital_status",
  "residence",
  "place_of_origin",
  "occupation",
  "informant_type",
  "informant_name",
];

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
  "Escolaridad",
  "Estado civil",
  "Residencia",
  "Procedencia",
  "Ocupación",
  "Informante",
  "Nombre del informante",
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
  "Secundaria completa",
  "Casado/a",
  "Santiago",
  "Moca, Espaillat",
  "Maestra",
  "El mismo paciente",
  "",
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

  // Listas desplegables de las columnas de valores cerrados (J Escolaridad, K Estado civil, O Informante).
  const listOf = (labels: Record<string, string>) => `"${Object.values(labels).join(",")}"`;
  for (let row = 2; row <= 501; row++) {
    sheet.getCell(`J${row}`).dataValidation = { type: "list", allowBlank: true, formulae: [listOf(EDUCATION_LABELS)] };
    sheet.getCell(`K${row}`).dataValidation = { type: "list", allowBlank: true, formulae: [listOf(MARITAL_LABELS)] };
    sheet.getCell(`O${row}`).dataValidation = { type: "list", allowBlank: true, formulae: [listOf(INFORMANT_LABELS)] };
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
    ["Escolaridad", `Opcional. Una de: ${Object.values(EDUCATION_LABELS).join(" · ")}.`],
    ["Estado civil", `Opcional. Una de: ${Object.values(MARITAL_LABELS).join(" · ")}.`],
    ["Residencia", "Opcional. Dónde vive hoy (calle o sector, municipio, provincia). Hasta 200 caracteres."],
    ["Procedencia", "Opcional. De dónde proviene (municipio, provincia o país). Hasta 200 caracteres."],
    ["Ocupación", "Opcional. Hasta 200 caracteres."],
    ["Informante", `Opcional. Quien da los datos. Uno de: ${Object.values(INFORMANT_LABELS).join(" · ")}. Si lo dejas vacío no se registra.`],
    ["Nombre del informante", 'Obligatorio si el informante NO es "El mismo paciente"; si lo es, déjalo vacío.'],
    ["Religión", "No se importa: es un dato sensible y se registra desde la ficha del paciente (solo administradores y médicos)."],
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

  // La religión es un dato sensible (Ley 172-13): no se importa, y se avisa en vez de ignorarla en silencio.
  if (headers.map(normalizeHeader).includes("religion")) {
    return {
      rows: [],
      parseError: "El archivo trae una columna «Religión»: no se importa porque es un dato sensible. Quita esa columna; se registra desde la ficha del paciente (solo administradores y médicos).",
    };
  }

  const headerIndex = buildHeaderIndex(headers);
  const missing = Object.keys(COLUMN_ALIASES).filter(
    (f) =>
      !["national_id", "phone", "email", "allergies", "medications", ...OPTIONAL_IDENTITY_FIELDS].includes(f) &&
      headerIndex[f] === undefined
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

/** Texto sin acentos, minúsculas y sin signos, para comparar `Soltero/a` con `soltero`. */
function foldOption(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** La clave de la lista que corresponde al texto o a la clave escrita; null si está vacío o no coincide. */
function matchList(value: string | undefined, labels: Record<string, string>): string | null {
  const wanted = foldOption(value ?? "");
  if (!wanted) return null;
  for (const [key, label] of Object.entries(labels)) {
    if (foldOption(key) === wanted || foldOption(label) === wanted) return key;
  }
  return null;
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

    // Ficha de identificación (todo opcional). Una lista cerrada solo acepta su texto o su clave; lo que no coincida
    // es un error de la fila (no se adivina).
    const education = matchList(raw.education_level, EDUCATION_LABELS);
    if (raw.education_level && !education) errors.push(`Escolaridad "${raw.education_level}" no es válida. Opciones: ${Object.values(EDUCATION_LABELS).join(", ")}.`);
    const marital = matchList(raw.marital_status, MARITAL_LABELS);
    if (raw.marital_status && !marital) errors.push(`Estado civil "${raw.marital_status}" no es válido. Opciones: ${Object.values(MARITAL_LABELS).join(", ")}.`);
    const informant = matchList(raw.informant_type, INFORMANT_LABELS);
    if (raw.informant_type && !informant) errors.push(`Informante "${raw.informant_type}" no es válido. Opciones: ${Object.values(INFORMANT_LABELS).join(", ")}.`);
    const texts: [string, string, string][] = [
      ["residence", "Residencia", raw.residence],
      ["place_of_origin", "Procedencia", raw.place_of_origin],
      ["occupation", "Ocupación", raw.occupation],
      ["informant_name", "Nombre del informante", raw.informant_name],
    ];
    for (const [, label, value] of texts) {
      if ((value ?? "").length > MAX_IDENTITY_TEXT) errors.push(`${label} es demasiado largo (máximo ${MAX_IDENTITY_TEXT} caracteres).`);
    }
    const informantName = raw.informant_name || null;
    if (informant && informant !== "paciente" && !informantName) errors.push("El nombre del informante es obligatorio cuando el informante no es el mismo paciente.");
    if (informantName && (!informant || informant === "paciente")) errors.push('El nombre del informante solo aplica cuando el informante no es el mismo paciente (columna "Informante").');

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
        education_level: education as EducationLevel | null,
        marital_status: marital as MaritalStatus | null,
        residence: raw.residence || null,
        place_of_origin: raw.place_of_origin || null,
        occupation: raw.occupation || null,
        informant_type: informant as InformantType | null,
        informant_name: informantName,
        allergies: splitList(raw.allergies),
        medications: splitList(raw.medications),
      },
      errors: [],
    };
  });
}
