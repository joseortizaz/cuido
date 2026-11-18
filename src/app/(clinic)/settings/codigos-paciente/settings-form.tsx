"use client";

import { useActionState, useState } from "react";
import { patientCodeFormatError, renderPatientCode } from "@/lib/domain/patient-code";
import { savePatientCodeSettings, type PatientCodeSettingsState } from "./actions";

const inputClass =
  "rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export function PatientCodeSettingsForm({
  initialFormat,
  initialStart,
  initialResetYearly,
  nextCode,
  year,
  disabled,
}: {
  initialFormat: string;
  initialStart: number;
  initialResetYearly: boolean;
  /** Siguiente código real según el formato guardado (lo calcula la base de datos). */
  nextCode: string;
  year: string;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState<PatientCodeSettingsState, FormData>(
    savePatientCodeSettings,
    undefined
  );
  const [format, setFormat] = useState(initialFormat);
  const [resetYearly, setResetYearly] = useState(initialResetYearly);
  const [start, setStart] = useState(String(initialStart));

  const formatError = patientCodeFormatError(format.trim(), resetYearly);
  const startNumber = Number.parseInt(start, 10);
  const startValid = Number.isInteger(startNumber) && startNumber >= 1;
  const example = !formatError && startValid ? renderPatientCode(format.trim(), year, startNumber) : null;
  const changed = format.trim() !== initialFormat || resetYearly !== initialResetYearly || startNumber !== initialStart;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="format" className="text-sm font-medium">
          Formato del código
        </label>
        <input
          id="format"
          name="format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          disabled={disabled}
          maxLength={30}
          spellCheck={false}
          className={`${inputClass} max-w-xs font-mono`}
        />
        <p className="text-xs text-zinc-500">
          Usa <code>{"{AAAA}"}</code> para el año y <code>{"{NNNN}"}</code> para el número (cada N es un dígito, con ceros a
          la izquierda). Puedes agregar texto fijo, por ejemplo <code>{"CL-{AAAA}-{NNNN}"}</code>.
        </p>
        {formatError && <p className="text-sm text-red-600 dark:text-red-400">{formatError}</p>}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="reset_yearly"
          checked={resetYearly}
          onChange={(e) => setResetYearly(e.target.checked)}
          disabled={disabled}
          className="mt-1"
        />
        <span>Reiniciar la numeración cada año (el formato debe incluir el año).</span>
      </label>

      <div className="flex flex-col gap-1">
        <label htmlFor="start_number" className="text-sm font-medium">
          Número inicial
        </label>
        <input
          id="start_number"
          name="start_number"
          type="number"
          min={1}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          disabled={disabled}
          className={`${inputClass} w-32`}
        />
        <p className="text-xs text-zinc-500">
          Con qué número arranca cada periodo. No puede ser menor que el último número ya usado.
        </p>
      </div>

      <div className="rounded-lg border border-panel-border bg-panel-surface p-3 text-sm">
        <p>
          Próximo paciente (con el formato guardado):{" "}
          <strong className="font-mono">{nextCode}</strong>
        </p>
        {changed && (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            Con los cambios, el primer paciente nuevo tendría:{" "}
            <strong className="font-mono">{example ?? "—"}</strong>
          </p>
        )}
      </div>

      <p className="text-xs text-zinc-500">
        Cambiar el formato afecta solo a los pacientes nuevos: los códigos ya asignados no cambian ni se reutilizan.
      </p>

      <div>
        <button
          type="submit"
          disabled={pending || disabled || !!formatError || !startValid}
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {pending ? "Guardando…" : "Guardar formato"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </form>
  );
}
