/**
 * Resultados de estudios y analíticas (PR 6 del plan de expediente clínico): categorías, estados, valores con
 * unidad y rango de referencia, y validación de los archivos adjuntos. Lógica pura, probada en
 * scripts/test-study-results.ts. La base de datos (supabase/migrations/20261125100000_study_results.sql) valida de
 * nuevo todo lo que importa; esto existe para dar el error en pantalla y para no subir un archivo que Storage
 * va a rechazar.
 */

export const STUDY_CATEGORIES = ["laboratorio", "imagen", "cardiologia", "patologia", "otro"] as const;
export type StudyCategory = (typeof STUDY_CATEGORIES)[number];

export const STUDY_CATEGORY_LABELS: Record<StudyCategory, string> = {
  laboratorio: "Laboratorio",
  imagen: "Imagen",
  cardiologia: "Cardiología (ECG, eco)",
  patologia: "Patología",
  otro: "Otro",
};

export const STUDY_STATUSES = ["pendiente", "recibido", "anulado"] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export const STUDY_STATUS_LABELS: Record<StudyStatus, string> = {
  pendiente: "Pendiente",
  recibido: "Recibido",
  anulado: "Anulado",
};

export function isStudyCategory(value: unknown): value is StudyCategory {
  return typeof value === "string" && (STUDY_CATEGORIES as readonly string[]).includes(value);
}

export function isStudyStatus(value: unknown): value is StudyStatus {
  return typeof value === "string" && (STUDY_STATUSES as readonly string[]).includes(value);
}

/** Etiqueta de cada campo, para mostrar las revisiones de un resultado. */
export const STUDY_FIELD_LABELS: Record<string, string> = {
  category: "Categoría",
  study_name: "Estudio",
  ordered_at: "Fecha de indicación",
  performed_at: "Fecha de realización",
  result_text: "Resultado",
  result_values: "Valores",
  interpretation: "Interpretación",
  status: "Estado",
  encounter_id: "Consulta",
};

// ---------------------------------------------------------------------------
// Valores del resultado
// ---------------------------------------------------------------------------

export type StudyValue = { name: string; value: string; unit?: string; reference_range?: string };

export const MAX_STUDY_VALUES = 100;

/**
 * Lee las filas de valores del formulario (`value_name_0`, `value_value_0`, `value_unit_0`, `value_range_0`, …).
 * Las filas completamente vacías se ignoran; una fila con nombre pero sin valor (o al revés) es un error.
 */
export function parseStudyValuesFromForm(formData: FormData): { values: StudyValue[]; error?: string } {
  const values: StudyValue[] = [];
  for (let i = 0; i < MAX_STUDY_VALUES; i++) {
    const name = String(formData.get(`value_name_${i}`) ?? "").trim();
    const value = String(formData.get(`value_value_${i}`) ?? "").trim();
    const unit = String(formData.get(`value_unit_${i}`) ?? "").trim();
    const range = String(formData.get(`value_range_${i}`) ?? "").trim();
    if (!name && !value && !unit && !range) continue;
    if (!name) return { values, error: `La fila ${i + 1} de valores necesita un nombre.` };
    if (!value) return { values, error: `El valor «${name}» necesita un resultado.` };
    if (name.length > 100) return { values, error: `El nombre «${name.slice(0, 20)}…» es demasiado largo (máximo 100).` };
    if (value.length > 200) return { values, error: `El resultado de «${name}» es demasiado largo (máximo 200).` };
    if (unit.length > 30) return { values, error: `La unidad de «${name}» es demasiado larga (máximo 30).` };
    if (range.length > 100) return { values, error: `El rango de referencia de «${name}» es demasiado largo (máximo 100).` };
    values.push({ name, value, ...(unit ? { unit } : {}), ...(range ? { reference_range: range } : {}) });
  }
  return { values };
}

// ---------------------------------------------------------------------------
// Archivos adjuntos
// ---------------------------------------------------------------------------

export const MAX_STUDY_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_STUDY_FILES = 10;
export const ALLOWED_STUDY_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type StudyMimeType = (typeof ALLOWED_STUDY_MIME_TYPES)[number];

/** Tipo real del archivo según sus primeros bytes (la extensión y el tipo declarado se pueden falsificar). */
export function sniffStudyMime(bytes: Uint8Array): StudyMimeType | null {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

/** Error legible si el archivo no se puede adjuntar, o null si está bien. */
export function validateStudyFile(file: { name: string; size: number; bytes: Uint8Array }): string | null {
  if (file.size === 0) return `«${file.name}» está vacío.`;
  if (file.size > MAX_STUDY_FILE_BYTES) return `«${file.name}» pasa de 10 MB.`;
  const real = sniffStudyMime(file.bytes);
  if (!real) return `«${file.name}» no es un PDF, JPG o PNG válido.`;
  return null;
}

/** Nombre apto para la ruta de Storage: sin carpetas, sin caracteres raros y de longitud acotada. */
export function sanitizeStudyFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "archivo";
  const cleaned = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_");
  const trimmed = cleaned.length > 100 ? cleaned.slice(-100) : cleaned;
  return trimmed || "archivo";
}

/** {clinic_id}/{patient_id}/{study_id}/{uuid}-{nombre}: la genera siempre el servidor. */
export function buildStudyStoragePath(clinicId: string, patientId: string, studyId: string, uuid: string, fileName: string): string {
  return `${clinicId}/${patientId}/${studyId}/${uuid}-${sanitizeStudyFileName(fileName)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
