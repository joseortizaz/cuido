"use client";

import { useActionState, useMemo, useState } from "react";
import {
  groupFieldsBySection,
  type TemplateField,
} from "@/lib/domain/specialty-template";
import { createEncounter, type EncounterFormState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const labelClass = "text-sm font-medium";

function DynamicField({
  field,
  isControlling,
  onControlChange,
}: {
  field: TemplateField;
  isControlling: boolean;
  onControlChange: (key: string, value: string) => void;
}) {
  const name = `field-${field.key}`;
  const label = (
    <label htmlFor={name} className={labelClass}>
      {field.label}
      {field.required ? " *" : ""}
    </label>
  );

  switch (field.type) {
    case "textarea":
      return (
        <div className="flex flex-col gap-1">
          {label}
          <textarea id={name} name={name} required={field.required} rows={3} className={inputClass} />
        </div>
      );
    case "number":
      return (
        <div className="flex flex-col gap-1">
          {label}
          <input id={name} name={name} type="number" required={field.required} className={inputClass} />
        </div>
      );
    case "date":
      return (
        <div className="flex flex-col gap-1">
          {label}
          <input id={name} name={name} type="date" required={field.required} className={inputClass} />
        </div>
      );
    case "select":
      return (
        <div className="flex flex-col gap-1">
          {label}
          <select
            id={name}
            name={name}
            required={field.required}
            defaultValue=""
            className={inputClass}
            onChange={isControlling ? (e) => onControlChange(field.key, e.target.value) : undefined}
          >
            <option value="" disabled={field.required}>
              Selecciona
            </option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
    case "text":
    default:
      return (
        <div className="flex flex-col gap-1">
          {label}
          <input id={name} name={name} type="text" required={field.required} className={inputClass} />
        </div>
      );
  }
}

export function EncounterForm({
  patientId,
  templateId,
  fields,
}: {
  patientId: string;
  templateId: string;
  fields: TemplateField[];
}) {
  const boundAction = createEncounter.bind(null, patientId, templateId);
  const [state, formAction, pending] = useActionState<EncounterFormState, FormData>(
    boundAction,
    undefined
  );

  // Claves de los campos que controlan la visibilidad de otros (referenciados
  // por algún `condition.field`), y el valor actual de cada uno, para
  // mostrar/ocultar los campos dependientes en vivo mientras el usuario llena
  // el formulario. El envío real sigue siendo un <form> no controlado — este
  // estado es solo para la visibilidad, no reemplaza los valores del form.
  const controllingKeys = useMemo(
    () => new Set(fields.filter((f) => f.condition).map((f) => f.condition!.field)),
    [fields]
  );
  const [controlValues, setControlValues] = useState<Record<string, string>>({});

  function isVisible(field: TemplateField): boolean {
    if (!field.condition) return true;
    return controlValues[field.condition.field] === field.condition.equals;
  }

  const sections = useMemo(() => groupFieldsBySection(fields), [fields]);

  return (
    <form action={formAction} className="flex w-full max-w-lg flex-col gap-8">
      <div className="flex flex-col gap-1">
        <label htmlFor="chief_complaint" className={labelClass}>
          Motivo de consulta
        </label>
        <input id="chief_complaint" name="chief_complaint" type="text" className={inputClass} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Signos vitales (opcional)
        </legend>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="systolic_bp" className="text-xs text-zinc-600 dark:text-zinc-400">
              PA sistólica
            </label>
            <input id="systolic_bp" name="systolic_bp" type="number" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="diastolic_bp" className="text-xs text-zinc-600 dark:text-zinc-400">
              PA diastólica
            </label>
            <input id="diastolic_bp" name="diastolic_bp" type="number" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="heart_rate" className="text-xs text-zinc-600 dark:text-zinc-400">
              FC (lpm)
            </label>
            <input id="heart_rate" name="heart_rate" type="number" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="respiratory_rate" className="text-xs text-zinc-600 dark:text-zinc-400">
              FR (rpm)
            </label>
            <input id="respiratory_rate" name="respiratory_rate" type="number" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="temperature_celsius" className="text-xs text-zinc-600 dark:text-zinc-400">
              Temp (°C)
            </label>
            <input
              id="temperature_celsius"
              name="temperature_celsius"
              type="number"
              step="0.1"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="oxygen_saturation" className="text-xs text-zinc-600 dark:text-zinc-400">
              SatO₂ (%)
            </label>
            <input id="oxygen_saturation" name="oxygen_saturation" type="number" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="weight_kg" className="text-xs text-zinc-600 dark:text-zinc-400">
              Peso (kg)
            </label>
            <input id="weight_kg" name="weight_kg" type="number" step="0.1" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="height_cm" className="text-xs text-zinc-600 dark:text-zinc-400">
              Talla (cm)
            </label>
            <input id="height_cm" name="height_cm" type="number" step="0.1" className={inputClass} />
          </div>
        </div>
      </fieldset>

      {sections.map(([sectionTitle, sectionFields]) => (
        <fieldset key={sectionTitle ?? "__default"} className="flex flex-col gap-3">
          <legend className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {sectionTitle ?? "Nota de la especialidad"}
          </legend>
          {sectionFields.filter(isVisible).map((field) => (
            <DynamicField
              key={field.key}
              field={field}
              isControlling={controllingKeys.has(field.key)}
              onControlChange={(key, value) =>
                setControlValues((prev) => ({ ...prev, [key]: value }))
              }
            />
          ))}
        </fieldset>
      ))}

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Guardando…" : "Guardar consulta"}
      </button>
    </form>
  );
}
