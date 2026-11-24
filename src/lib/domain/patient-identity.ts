/**
 * Ficha de identificación del paciente: listas cerradas, límites y lectura/validación del formulario. Lógica
 * pura (sin red ni base), probada en scripts/test-patient-identity.ts. La base de datos
 * (supabase/migrations/20261128100000_patient_identity.sql) vuelve a validar todo con CHECK.
 *
 * La RELIGIÓN es un dato sensible (Ley 172-13): NO vive en `patients` (que recepción lee) sino en
 * `patient_religion`, solo para administradores y médicos.
 */

export const MAX_IDENTITY_TEXT = 200;

export const EDUCATION_LEVELS = [
  "sin_escolaridad",
  "primaria_incompleta",
  "primaria_completa",
  "secundaria_incompleta",
  "secundaria_completa",
  "tecnico",
  "universitaria_incompleta",
  "universitaria_completa",
  "posgrado",
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export const EDUCATION_LABELS: Record<EducationLevel, string> = {
  sin_escolaridad: "Sin escolaridad",
  primaria_incompleta: "Primaria incompleta",
  primaria_completa: "Primaria completa",
  secundaria_incompleta: "Secundaria incompleta",
  secundaria_completa: "Secundaria completa",
  tecnico: "Técnico",
  universitaria_incompleta: "Universitaria incompleta",
  universitaria_completa: "Universitaria completa",
  posgrado: "Posgrado",
};

export const MARITAL_STATUSES = ["soltero", "casado", "union_libre", "separado", "divorciado", "viudo"] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export const MARITAL_LABELS: Record<MaritalStatus, string> = {
  soltero: "Soltero/a",
  casado: "Casado/a",
  union_libre: "Unión libre",
  separado: "Separado/a",
  divorciado: "Divorciado/a",
  viudo: "Viudo/a",
};

export const INFORMANT_TYPES = ["paciente", "madre_padre", "conyuge", "hijo", "otro_familiar", "acompanante", "otro"] as const;
export type InformantType = (typeof INFORMANT_TYPES)[number];
export const INFORMANT_LABELS: Record<InformantType, string> = {
  paciente: "El mismo paciente",
  madre_padre: "Madre/padre",
  conyuge: "Cónyuge o pareja",
  hijo: "Hijo/a",
  otro_familiar: "Otro familiar",
  acompanante: "Acompañante",
  otro: "Otro",
};

export const RELIGIONS = ["catolica", "evangelica_cristiana", "adventista", "testigo_jehova", "otra", "ninguna", "prefiere_no_decir"] as const;
export type Religion = (typeof RELIGIONS)[number];
export const RELIGION_LABELS: Record<Religion, string> = {
  catolica: "Católica",
  evangelica_cristiana: "Evangélica / cristiana",
  adventista: "Adventista",
  testigo_jehova: "Testigo de Jehová",
  otra: "Otra",
  ninguna: "Ninguna",
  prefiere_no_decir: "Prefiere no decir",
};

/** Las 32 provincias (con el Distrito Nacional): sugerencias para Procedencia y Residencia; el campo es de texto libre. */
export const DR_PROVINCES = [
  "Azua", "Bahoruco", "Barahona", "Dajabón", "Distrito Nacional", "Duarte", "El Seibo", "Elías Piña", "Espaillat",
  "Hato Mayor", "Hermanas Mirabal", "Independencia", "La Altagracia", "La Romana", "La Vega", "María Trinidad Sánchez",
  "Monseñor Nouel", "Monte Cristi", "Monte Plata", "Pedernales", "Peravia", "Puerto Plata", "Samaná", "San Cristóbal",
  "San José de Ocoa", "San Juan", "San Pedro de Macorís", "Sánchez Ramírez", "Santiago", "Santiago Rodríguez",
  "Santo Domingo", "Valverde",
] as const;

export function isEducationLevel(v: unknown): v is EducationLevel {
  return typeof v === "string" && (EDUCATION_LEVELS as readonly string[]).includes(v);
}
export function isMaritalStatus(v: unknown): v is MaritalStatus {
  return typeof v === "string" && (MARITAL_STATUSES as readonly string[]).includes(v);
}
export function isInformantType(v: unknown): v is InformantType {
  return typeof v === "string" && (INFORMANT_TYPES as readonly string[]).includes(v);
}
export function isReligion(v: unknown): v is Religion {
  return typeof v === "string" && (RELIGIONS as readonly string[]).includes(v);
}

/** Texto limpio: sin espacios sobrantes; vacío = null. */
export function cleanText(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s === "" ? null : s;
}

/** Texto de la lista (o el valor tal cual si es uno viejo), para mostrar en pantalla. */
export function labelOf<T extends string>(labels: Record<T, string>, value: string | null | undefined): string {
  if (!value) return "";
  return (labels as Record<string, string>)[value] ?? value;
}

/** Los datos de identificación que viven en `patients` (todos opcionales). */
export type IdentityValues = {
  education_level: EducationLevel | null;
  marital_status: MaritalStatus | null;
  residence: string | null;
  place_of_origin: string | null;
  occupation: string | null;
  informant_type: InformantType | null;
  informant_name: string | null;
};

export type ReligionValue = { religion: Religion; religion_other: string | null };

/**
 * Lee los campos de identificación de un formulario (`education_level`, `marital_status`, `residence`,
 * `place_of_origin`, `occupation`, `informant_type`, `informant_name`) y valida las listas cerradas, las
 * longitudes y la regla del informante: si no es el mismo paciente, el nombre es obligatorio; si lo es, no se guarda.
 */
export function parseIdentityFromForm(formData: FormData): { values: IdentityValues; error?: string } {
  const empty: IdentityValues = {
    education_level: null,
    marital_status: null,
    residence: null,
    place_of_origin: null,
    occupation: null,
    informant_type: null,
    informant_name: null,
  };
  const educationRaw = String(formData.get("education_level") ?? "");
  const maritalRaw = String(formData.get("marital_status") ?? "");
  const informantRaw = String(formData.get("informant_type") ?? "paciente") || "paciente";
  if (educationRaw && !isEducationLevel(educationRaw)) return { values: empty, error: "Elige una escolaridad de la lista." };
  if (maritalRaw && !isMaritalStatus(maritalRaw)) return { values: empty, error: "Elige un estado civil de la lista." };
  if (!isInformantType(informantRaw)) return { values: empty, error: "Elige un informante de la lista." };

  const texts: [keyof IdentityValues, string][] = [
    ["residence", "La residencia"],
    ["place_of_origin", "La procedencia"],
    ["occupation", "La ocupación"],
    ["informant_name", "El nombre del informante"],
  ];
  const values: IdentityValues = {
    education_level: educationRaw ? (educationRaw as EducationLevel) : null,
    marital_status: maritalRaw ? (maritalRaw as MaritalStatus) : null,
    residence: cleanText(formData.get("residence")),
    place_of_origin: cleanText(formData.get("place_of_origin")),
    occupation: cleanText(formData.get("occupation")),
    informant_type: informantRaw,
    informant_name: cleanText(formData.get("informant_name")),
  };
  for (const [key, label] of texts) {
    const v = values[key];
    if (typeof v === "string" && v.length > MAX_IDENTITY_TEXT) {
      return { values, error: `${label} es demasiado largo (máximo ${MAX_IDENTITY_TEXT} caracteres).` };
    }
  }
  if (values.informant_type === "paciente") {
    values.informant_name = null;
  } else if (!values.informant_name) {
    return { values, error: "Indica el nombre del informante (quien da los datos si no es el mismo paciente)." };
  }
  return { values };
}

/** Religión del formulario (`religion`, `religion_other`); null = no se indicó. Solo la leen administradores y médicos. */
export function parseReligionFromForm(formData: FormData): { value: ReligionValue | null; error?: string } {
  const raw = String(formData.get("religion") ?? "");
  if (!raw) return { value: null };
  if (!isReligion(raw)) return { value: null, error: "Elige una religión de la lista." };
  const other = cleanText(formData.get("religion_other"));
  if (raw === "otra") {
    if (!other) return { value: null, error: "Indica cuál es la religión." };
    if (other.length > MAX_IDENTITY_TEXT) return { value: null, error: `La religión es demasiado larga (máximo ${MAX_IDENTITY_TEXT} caracteres).` };
    return { value: { religion: raw, religion_other: other } };
  }
  return { value: { religion: raw, religion_other: null } };
}

/** Para el campo de la ficha: «Religión: Otra (Bahá'í)». */
export function religionDisplay(r: { religion: string; religion_other: string | null } | null | undefined): string {
  if (!r) return "";
  const base = labelOf(RELIGION_LABELS, r.religion);
  return r.religion === "otra" && r.religion_other ? `${base}: ${r.religion_other}` : base;
}
