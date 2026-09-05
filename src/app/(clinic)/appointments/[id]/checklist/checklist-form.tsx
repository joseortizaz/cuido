"use client";

import { useActionState } from "react";
import { updateSurgicalChecklist, type ChecklistActionState } from "./actions";

const OPTIONS = [
  { value: "pendiente", label: "Pendiente" },
  { value: "si", label: "Sí" },
  { value: "no", label: "No" },
] as const;

const selectClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const labelClass = "text-sm font-medium";

export function ChecklistForm({
  appointmentId,
  evaluacionCardiovascular,
  analiticasSangre,
  implantesAprobadosSeguro,
}: {
  appointmentId: string;
  evaluacionCardiovascular: string;
  analiticasSangre: string;
  implantesAprobadosSeguro: string;
}) {
  const boundAction = updateSurgicalChecklist.bind(null, appointmentId);
  const [state, formAction, pending] = useActionState<ChecklistActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="evaluacion_cardiovascular" className={labelClass}>
          Evaluación cardiovascular
        </label>
        <select
          id="evaluacion_cardiovascular"
          name="evaluacion_cardiovascular"
          defaultValue={evaluacionCardiovascular}
          className={selectClass}
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="analiticas_sangre" className={labelClass}>
          Analíticas de sangre
        </label>
        <select
          id="analiticas_sangre"
          name="analiticas_sangre"
          defaultValue={analiticasSangre}
          className={selectClass}
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="implantes_aprobados_seguro" className={labelClass}>
          Materiales/implantes aprobados por el seguro
        </label>
        <select
          id="implantes_aprobados_seguro"
          name="implantes_aprobados_seguro"
          defaultValue={implantesAprobadosSeguro}
          className={selectClass}
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Guardando…" : "Guardar checklist"}
      </button>
    </form>
  );
}
