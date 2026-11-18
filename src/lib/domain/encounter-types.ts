/**
 * Tipos de consulta (PR 5 del plan de expediente clínico).
 *
 * Son los valores del enum `encounter_type` de la base
 * (supabase/migrations/20261124100000_encounter_types.sql). Una consulta ya existente
 * tiene tipo null = «sin clasificar». Lógica pura, probada en scripts/test-encounter-types.ts.
 */

export const ENCOUNTER_TYPES = [
  "inicial",
  "seguimiento",
  "prequirurgica",
  "postquirurgica",
  "control",
  "urgencia",
  "alta",
] as const;

export type EncounterType = (typeof ENCOUNTER_TYPES)[number];

export const ENCOUNTER_TYPE_LABELS: Record<EncounterType, string> = {
  inicial: "Inicial",
  seguimiento: "Seguimiento",
  prequirurgica: "Prequirúrgica",
  postquirurgica: "Postquirúrgica",
  control: "Control",
  urgencia: "Urgencia",
  alta: "Alta",
};

export const ENCOUNTER_TYPE_HINTS: Record<EncounterType, string> = {
  inicial: "Primera consulta de esta especialidad o de este caso: pide la línea base de la especialidad.",
  seguimiento: "Evolución desde la última consulta: motivo, evolución, signos vitales, examen dirigido, estudios nuevos, diagnóstico y plan.",
  prequirurgica: "Valoración antes de una cirugía.",
  postquirurgica: "Control después de una cirugía.",
  control: "Control programado de una enfermedad ya conocida.",
  urgencia: "Atención no programada: motivo, enfermedad actual, signos vitales, examen físico, diagnóstico y plan.",
  alta: "Cierre del caso: resumen de la evolución, diagnóstico final, indicaciones y seguimiento.",
};

/** Texto que se muestra para una consulta, incluida la que aún no tiene tipo. */
export function encounterTypeLabel(type: string | null | undefined): string {
  if (!type) return "Sin clasificar";
  return ENCOUNTER_TYPE_LABELS[type as EncounterType] ?? type;
}

export function isEncounterType(value: unknown): value is EncounterType {
  return typeof value === "string" && (ENCOUNTER_TYPES as readonly string[]).includes(value);
}

/** Acepta el valor interno o la etiqueta en español (sin importar mayúsculas ni acentos). */
export function parseEncounterType(value: string | null | undefined): EncounterType | null {
  if (!value) return null;
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase();
  const wanted = norm(value);
  for (const t of ENCOUNTER_TYPES) {
    if (norm(t) === wanted || norm(ENCOUNTER_TYPE_LABELS[t]) === wanted) return t;
  }
  return null;
}

/** La consulta pide la historia de la enfermedad actual (el alta no: pide resumen de la evolución). */
export function asksPresentIllness(type: EncounterType): boolean {
  return type !== "alta";
}

/** Etiqueta de la historia de la enfermedad actual: en seguimiento y control es la evolución. */
export function presentIllnessLabel(type: EncounterType): string {
  return type === "seguimiento" || type === "control" || type === "postquirurgica"
    ? "Evolución (historia de la enfermedad actual)"
    : "Historia de la enfermedad actual";
}

/** Los signos vitales se piden en todas las consultas menos en el alta. */
export function asksVitalSigns(type: EncounterType): boolean {
  return type !== "alta";
}

/**
 * Plantillas quirúrgicas existentes a las que apuntan los tipos quirúrgicos (código de plantilla ->
 * tipo fijo). En esas plantillas no se pregunta el tipo: ya es quirúrgico.
 */
export const FIXED_TYPE_BY_TEMPLATE_CODE: Record<string, EncounterType> = {
  cirugia_general_preoperatorio: "prequirurgica",
  cirugia_general_postoperatoria: "postquirurgica",
  ortopedia_traumatologia_nota_operatoria: "postquirurgica",
};

/** En estas especialidades, el tipo indicado se registra con otra plantilla (la quirúrgica existente). */
export const TEMPLATE_REDIRECT_BY_TYPE: Record<string, Partial<Record<EncounterType, string>>> = {
  ortopedia_traumatologia: { postquirurgica: "ortopedia_traumatologia_nota_operatoria" },
};

/**
 * Diagnóstico que se muestra en el histórico de consultas: el más definitivo que haya escrito el médico
 * (final, definitivo, presuntivo) o cualquier campo «diagnostico…» de la plantilla. Texto libre.
 */
export function summaryDiagnosis(specialtyData: unknown): string | null {
  if (!specialtyData || typeof specialtyData !== "object") return null;
  const data = specialtyData as Record<string, unknown>;
  const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string).trim() : "");
  for (const key of ["diagnostico_final", "diagnostico_definitivo", "diagnostico_presuntivo"]) {
    if (text(key)) return text(key);
  }
  const other = Object.keys(data).find((k) => k.startsWith("diagnostico") && text(k));
  return other ? text(other) : null;
}
