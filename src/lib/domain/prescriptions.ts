/**
 * Recetas digitales (PR 7 del plan de expediente clínico): renglones del formulario, número, edad y formato de
 * impresión. Lógica pura, probada en scripts/test-prescriptions.ts. La base de datos
 * (supabase/migrations/20261126100000_prescriptions.sql) valida de nuevo todo lo que importa.
 */

export const MAX_RX_ITEMS = 30;

export type RxItem = {
  medication: string;
  dose?: string;
  route?: string;
  frequency?: string;
  duration?: string;
  quantity?: string;
  instructions?: string;
};

const OPTIONAL_FIELDS = ["dose", "route", "frequency", "duration", "quantity", "instructions"] as const;

/** Lee los renglones del formulario (`rx_medication_0`, `rx_dose_0`, …). Las filas vacías se ignoran. */
export function parseRxItemsFromForm(formData: FormData): { items: RxItem[]; error?: string } {
  const items: RxItem[] = [];
  for (let i = 0; i < MAX_RX_ITEMS; i++) {
    const medication = String(formData.get(`rx_medication_${i}`) ?? "").trim();
    const rest: Partial<Record<(typeof OPTIONAL_FIELDS)[number], string>> = {};
    let anyOther = false;
    for (const field of OPTIONAL_FIELDS) {
      const v = String(formData.get(`rx_${field}_${i}`) ?? "").trim();
      if (v) {
        rest[field] = v;
        anyOther = true;
      }
    }
    if (!medication && !anyOther) continue;
    if (!medication) return { items, error: `El renglón ${i + 1} tiene datos pero no el nombre del medicamento.` };
    if (medication.length > 200) return { items, error: `El nombre «${medication.slice(0, 20)}…» es demasiado largo (máximo 200).` };
    for (const field of OPTIONAL_FIELDS) {
      const max = field === "instructions" ? 500 : 200;
      if ((rest[field] ?? "").length > max) return { items, error: `«${medication}»: el campo es demasiado largo (máximo ${max}).` };
    }
    items.push({ medication, ...rest });
  }
  if (items.length === 0) return { items, error: "Agrega al menos un medicamento." };
  return { items };
}

/** Número de receta como se imprime: N.º 000123. */
export function formatRxNumber(n: number): string {
  return String(n).padStart(6, "0");
}

/** Edad al momento de emitir la receta: años, o meses si es menor de 2 años. */
export function patientAgeLabel(dateOfBirth: string, at: string | Date): string {
  const dob = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  const ref = new Date(typeof at === "string" ? at : at.toISOString());
  const refDr = new Date(ref.getTime() - 4 * 3600_000); // hora de Santo Domingo (UTC-4 todo el año)
  let months = (refDr.getUTCFullYear() - dob.getUTCFullYear()) * 12 + (refDr.getUTCMonth() - dob.getUTCMonth());
  if (refDr.getUTCDate() < dob.getUTCDate()) months -= 1;
  if (months < 0) months = 0;
  if (months < 24) return `${months} ${months === 1 ? "mes" : "meses"}`;
  return `${Math.floor(months / 12)} años`;
}

export const PRINT_FORMATS = ["a6", "a4"] as const;
export type PrintFormat = (typeof PRINT_FORMATS)[number];

export function isPrintFormat(value: unknown): value is PrintFormat {
  return typeof value === "string" && (PRINT_FORMATS as readonly string[]).includes(value);
}

/** Una línea con lo recetado, para la lista del expediente. */
export function summarizeRxItems(items: { medication: string; dose?: string | null }[]): string {
  return items.map((i) => (i.dose ? `${i.medication} ${i.dose}` : i.medication)).join(", ");
}

export type Letterhead = {
  name: string;
  address?: string | null;
  phones?: string | null;
  email?: string | null;
  rnc?: string | null;
  logo_path?: string | null;
};

// ---------------------------------------------------------------------------
// Logo del timbrado
// ---------------------------------------------------------------------------

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Tipo real de la imagen del logo por sus primeros bytes (PNG o JPG). */
export function sniffLogoMime(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}

// ---------------------------------------------------------------------------
// Paginación de la hoja A6
// ---------------------------------------------------------------------------
// Los medicamentos que no caben en una hoja pasan a la siguiente, que repite el timbrado arriba y el pie (médico,
// firma y sello) abajo. La paginación se calcula AQUÍ (con una estimación conservadora de cuántas líneas ocupa cada
// renglón) y no con el navegador: así la receta se ve y se imprime igual en cualquier impresora y ninguna hoja se desborda.

/** Alto disponible (mm) para renglones en una hoja A6, entre el encabezado y el pie. Conservador. */
export const RX_PAGE_BODY_MM = 68;

const CHARS_DETAIL = 66;
const CHARS_NAME = 50;
const CHARS_INSTR = 72;
const lines = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));

export type RxLayoutItem = {
  medication: string;
  dose?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  quantity?: string | null;
  instructions?: string | null;
};

/** Texto de la línea de detalle de un renglón (dosis · vía · frecuencia · duración · cantidad). */
export function rxItemDetail(it: RxLayoutItem): string {
  return [it.dose, it.route, it.frequency, it.duration, it.quantity ? `Cant.: ${it.quantity}` : null].filter(Boolean).join(" · ");
}

/** Alto estimado (mm) de un renglón impreso. */
export function estimateItemHeightMm(it: RxLayoutItem): number {
  const detail = rxItemDetail(it);
  return 3.4 + lines(`99. ${it.medication}`, CHARS_NAME) * 4.4 + (detail ? lines(detail, CHARS_DETAIL) * 3.9 : 0) + (it.instructions ? lines(it.instructions, CHARS_INSTR) * 3.6 : 0);
}

export function estimateNotesHeightMm(notes: string): number {
  return 4 + lines(`Indicaciones: ${notes}`, CHARS_DETAIL) * 3.9;
}

export type RxPage<T extends RxLayoutItem> = { items: T[]; notes: string | null; startIndex: number };

/** Reparte los renglones (y las indicaciones generales, al final) en hojas A6. Siempre devuelve al menos una. */
export function paginateRx<T extends RxLayoutItem>(items: T[], notes: string | null, bodyMm: number = RX_PAGE_BODY_MM): RxPage<T>[] {
  const pages: RxPage<T>[] = [];
  let current: T[] = [];
  let used = 0;
  let start = 0;
  items.forEach((it, i) => {
    const h = estimateItemHeightMm(it);
    if (current.length > 0 && used + h > bodyMm) {
      pages.push({ items: current, notes: null, startIndex: start });
      current = [];
      used = 0;
      start = i;
    }
    current.push(it);
    used += h;
  });
  if (notes) {
    const h = estimateNotesHeightMm(notes);
    if (current.length > 0 && used + h > bodyMm) {
      pages.push({ items: current, notes: null, startIndex: start });
      pages.push({ items: [], notes, startIndex: items.length });
      return pages;
    }
  }
  pages.push({ items: current, notes: notes ?? null, startIndex: start });
  return pages;
}
