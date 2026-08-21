"use client";

import { useActionState } from "react";
import { recordEligibilityCheck, type InsuranceActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function EligibilityForm({
  patientId,
  patientInsurerId,
}: {
  patientId: string;
  patientInsurerId: string;
}) {
  const recordForPatient = recordEligibilityCheck.bind(null, patientId, patientInsurerId);
  const [state, formAction, pending] = useActionState<InsuranceActionState, FormData>(
    recordForPatient,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="result" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Resultado
        </label>
        <select id="result" name="result" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecciona
          </option>
          <option value="elegible">Elegible</option>
          <option value="no_elegible">No elegible</option>
          <option value="pendiente">Pendiente</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Notas (opcional)
        </label>
        <input id="notes" name="notes" type="text" className={`${inputClass} w-48`} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "Guardando…" : "Verificar elegibilidad"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && (
        <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>
      )}
    </form>
  );
}
