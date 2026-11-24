/**
 * Historia general del expediente clínico: secciones y campos.
 *
 * Los `key` son las columnas de patient_medical_history
 * (supabase/migrations/20261122100000_patient_record_and_history.sql) y, a la vez, el `field` que queda
 * en cada revisión; las etiquetas son lo que ve el médico. Lógica pura, probada en scripts/test-medical-history.ts.
 *
 * No existe «antecedentes personales» como campo aparte: lo patológico y lo no patológico lo cubren.
 */

export const HISTORY_FIELD_KEYS = [
  "family_history",
  "pathological_history",
  "non_pathological_history",
  "surgical_history",
  "gyneco_obstetric_history",
  "toxic_tobacco",
  "toxic_alcohol",
  "toxic_other_substances",
  "diet_habits",
  "physical_activity",
  "vaccines",
  "other_notes",
] as const;

export type HistoryFieldKey = (typeof HISTORY_FIELD_KEYS)[number];

export type HistoryField = { key: HistoryFieldKey; label: string; hint?: string; rows?: number };

export type HistorySection = {
  /** Identificador estable (se usa en la URL de «Completar / corregir»). */
  id: string;
  title: string;
  fields: HistoryField[];
  /** Solo se muestra a pacientes de este sexo (p. ej. ginecoobstétricos «cuando aplique»). */
  onlyForSex?: "femenino";
};

export const HISTORY_SECTIONS: HistorySection[] = [
  {
    id: "heredofamiliares",
    title: "Antecedentes heredofamiliares",
    fields: [
      {
        key: "family_history",
        label: "Antecedentes heredofamiliares",
        hint: "Enfermedades de padres, hermanos y abuelos (diabetes, hipertensión, cáncer, cardiopatías…).",
      },
    ],
  },
  {
    id: "patologicos",
    title: "Antecedentes patológicos",
    fields: [
      {
        key: "pathological_history",
        label: "Antecedentes patológicos",
        hint: "Enfermedades crónicas y previas, hospitalizaciones, traumatismos, transfusiones.",
      },
    ],
  },
  {
    id: "no-patologicos",
    title: "Antecedentes no patológicos",
    fields: [
      {
        key: "non_pathological_history",
        label: "Antecedentes no patológicos",
        hint: "Vivienda, convivencia y otros datos de contexto. La ocupación, la escolaridad y el estado civil ya están en la ficha del paciente.",
      },
    ],
  },
  {
    id: "quirurgicos",
    title: "Antecedentes quirúrgicos",
    fields: [
      {
        key: "surgical_history",
        label: "Antecedentes quirúrgicos",
        hint: "Cirugías previas, fecha aproximada y complicaciones.",
      },
    ],
  },
  {
    id: "gineco-obstetricos",
    title: "Antecedentes ginecoobstétricos",
    onlyForSex: "femenino",
    fields: [
      {
        key: "gyneco_obstetric_history",
        label: "Antecedentes ginecoobstétricos",
        hint: "Menarquia, ciclos, gestas, partos, cesáreas, abortos, método de planificación.",
      },
    ],
  },
  {
    id: "toxicos",
    title: "Hábitos tóxicos",
    fields: [
      { key: "toxic_tobacco", label: "Tabaco", rows: 2 },
      { key: "toxic_alcohol", label: "Alcohol", rows: 2 },
      { key: "toxic_other_substances", label: "Otras sustancias", rows: 2 },
    ],
  },
  {
    id: "habitos",
    title: "Hábitos alimentarios y actividad física",
    fields: [
      { key: "diet_habits", label: "Hábitos alimentarios", rows: 2 },
      { key: "physical_activity", label: "Actividad física", rows: 2 },
    ],
  },
  {
    id: "vacunas",
    title: "Vacunas",
    fields: [{ key: "vaccines", label: "Vacunas", hint: "Texto libre: vacunas recibidas y pendientes." }],
  },
  {
    id: "otros",
    title: "Otros",
    fields: [{ key: "other_notes", label: "Otros antecedentes o notas generales" }],
  },
];

/** Etiqueta de cada campo (para mostrar las revisiones). */
export const HISTORY_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  HISTORY_SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, s.fields.length > 1 ? `${s.title}: ${f.label}` : f.label]))
);

/** Secciones que corresponden a un paciente (los ginecoobstétricos solo cuando aplican). */
export function sectionsForSex(sex: string | null | undefined): HistorySection[] {
  return HISTORY_SECTIONS.filter((s) => !s.onlyForSex || s.onlyForSex === sex);
}

export function findSection(id: string): HistorySection | undefined {
  return HISTORY_SECTIONS.find((s) => s.id === id);
}

export type HistoryValues = Partial<Record<HistoryFieldKey, string | null>>;

/** Una sección sin ningún dato escrito. */
export function isSectionEmpty(section: HistorySection, values: HistoryValues): boolean {
  return section.fields.every((f) => !(values[f.key] ?? "").trim());
}

/**
 * Del formulario, solo los campos de las secciones indicadas (cadena vacía = dejar el campo vacío).
 * Nunca incluye claves que no sean de la historia.
 */
export function pickHistoryChanges(formData: FormData, sections: HistorySection[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of sections) {
    for (const field of section.fields) {
      const raw = formData.get(field.key);
      if (typeof raw === "string") out[field.key] = raw.trim();
    }
  }
  return out;
}
