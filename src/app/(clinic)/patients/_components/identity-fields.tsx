"use client";

import { ageLabel } from "@/lib/domain/age";
import {
  DR_PROVINCES,
  EDUCATION_LABELS,
  EDUCATION_LEVELS,
  INFORMANT_LABELS,
  INFORMANT_TYPES,
  MARITAL_LABELS,
  MARITAL_STATUSES,
  MAX_IDENTITY_TEXT,
  RELIGIONS,
  RELIGION_LABELS,
} from "@/lib/domain/patient-identity";

export const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const labelClass = "text-sm font-medium";

/** Todo lo que el formulario de identificación lleva en estado (controlado: no se pierde si el servidor rechaza el envío). */
export type IdentityForm = {
  first_name: string;
  last_name: string;
  national_id: string;
  date_of_birth: string;
  sex: string;
  education_level: string;
  marital_status: string;
  residence: string;
  place_of_origin: string;
  occupation: string;
  informant_type: string;
  informant_name: string;
  religion: string;
  religion_other: string;
};

export const EMPTY_IDENTITY: IdentityForm = {
  first_name: "",
  last_name: "",
  national_id: "",
  date_of_birth: "",
  sex: "",
  education_level: "",
  marital_status: "",
  residence: "",
  place_of_origin: "",
  occupation: "",
  informant_type: "paciente",
  informant_name: "",
  religion: "",
  religion_other: "",
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/**
 * Ficha de identificación del paciente (alta y edición), en dos columnas: Nombre, Apellido, No. Identidad,
 * Fecha de nacimiento, Edad (calculada, solo lectura), Sexo, Escolaridad, Estado civil, Residencia, Procedencia,
 * Ocupación, Religión (solo si quien la llena es administrador o médico) e Informante.
 */
export function IdentityFields({
  value,
  onChange,
  canEditReligion,
  hasReligionOnFile = false,
}: {
  value: IdentityForm;
  onChange: (patch: Partial<IdentityForm>) => void;
  /** Administradores y médicos; recepción no ve ni llena la religión. */
  canEditReligion: boolean;
  /** Ya hay una religión guardada: en la edición no se puede volver a «sin registrar». */
  hasReligionOnFile?: boolean;
}) {
  const age = ageLabel(value.date_of_birth);
  const set = (key: keyof IdentityForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ [key]: e.target.value } as Partial<IdentityForm>);

  return (
    <>
      <datalist id="dr-provinces">
        {DR_PROVINCES.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="first_name" label="Nombre">
          <input id="first_name" name="first_name" type="text" required maxLength={100} value={value.first_name} onChange={set("first_name")} className={inputClass} />
        </Field>
        <Field id="last_name" label="Apellido">
          <input id="last_name" name="last_name" type="text" required maxLength={100} value={value.last_name} onChange={set("last_name")} className={inputClass} />
        </Field>

        <Field id="national_id" label="No. Identidad" hint="Cédula o pasaporte. Opcional.">
          <input id="national_id" name="national_id" type="text" maxLength={40} value={value.national_id} onChange={set("national_id")} className={inputClass} />
        </Field>
        <Field id="date_of_birth" label="Fecha de nacimiento">
          <input id="date_of_birth" name="date_of_birth" type="date" required value={value.date_of_birth} onChange={set("date_of_birth")} className={inputClass} />
        </Field>

        <Field id="age" label="Edad" hint="Se calcula sola con la fecha de nacimiento; no se guarda.">
          <output id="age" aria-live="polite" className={`${inputClass} min-h-[38px] bg-zinc-50 dark:bg-zinc-900`}>
            {age || "—"}
          </output>
        </Field>
        <Field id="sex" label="Sexo">
          <select id="sex" name="sex" required value={value.sex} onChange={set("sex")} className={inputClass}>
            <option value="" disabled>
              Selecciona
            </option>
            <option value="femenino">Femenino</option>
            <option value="masculino">Masculino</option>
          </select>
        </Field>

        <Field id="education_level" label="Escolaridad">
          <select id="education_level" name="education_level" value={value.education_level} onChange={set("education_level")} className={inputClass}>
            <option value="">Sin indicar</option>
            {EDUCATION_LEVELS.map((v) => (
              <option key={v} value={v}>
                {EDUCATION_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="marital_status" label="Estado civil">
          <select id="marital_status" name="marital_status" value={value.marital_status} onChange={set("marital_status")} className={inputClass}>
            <option value="">Sin indicar</option>
            {MARITAL_STATUSES.map((v) => (
              <option key={v} value={v}>
                {MARITAL_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>

        <Field id="residence" label="Residencia" hint="Dónde vive hoy: calle o sector, municipio y provincia.">
          <input id="residence" name="residence" type="text" list="dr-provinces" maxLength={MAX_IDENTITY_TEXT} value={value.residence} onChange={set("residence")} className={inputClass} />
        </Field>
        <Field id="place_of_origin" label="Procedencia" hint="De dónde proviene: municipio, provincia o país.">
          <input id="place_of_origin" name="place_of_origin" type="text" list="dr-provinces" maxLength={MAX_IDENTITY_TEXT} value={value.place_of_origin} onChange={set("place_of_origin")} className={inputClass} />
        </Field>

        <Field id="occupation" label="Ocupación">
          <input id="occupation" name="occupation" type="text" maxLength={MAX_IDENTITY_TEXT} value={value.occupation} onChange={set("occupation")} className={inputClass} />
        </Field>
        {canEditReligion ? (
          <Field id="religion" label="Religión" hint="Dato sensible. Pregúntalo solo si es relevante para la atención. Es opcional.">
            <select id="religion" name="religion" value={value.religion} onChange={set("religion")} className={inputClass}>
              {!hasReligionOnFile && <option value="">Sin indicar</option>}
              {RELIGIONS.map((v) => (
                <option key={v} value={v}>
                  {RELIGION_LABELS[v]}
                </option>
              ))}
            </select>
            {value.religion === "otra" && (
              <input
                aria-label="¿Cuál religión?"
                name="religion_other"
                type="text"
                required
                maxLength={MAX_IDENTITY_TEXT}
                value={value.religion_other}
                onChange={set("religion_other")}
                placeholder="¿Cuál?"
                className={`${inputClass} mt-1`}
              />
            )}
          </Field>
        ) : (
          <div />
        )}

        <Field id="informant_type" label="Informante" hint="Quien da los datos (en niños, adultos mayores o pacientes que no pueden hablar).">
          <select id="informant_type" name="informant_type" value={value.informant_type} onChange={set("informant_type")} className={inputClass}>
            {INFORMANT_TYPES.map((v) => (
              <option key={v} value={v}>
                {INFORMANT_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
        {value.informant_type !== "paciente" ? (
          <Field id="informant_name" label="Nombre del informante">
            <input id="informant_name" name="informant_name" type="text" required maxLength={MAX_IDENTITY_TEXT} value={value.informant_name} onChange={set("informant_name")} className={inputClass} />
          </Field>
        ) : (
          <div />
        )}
      </div>
    </>
  );
}
