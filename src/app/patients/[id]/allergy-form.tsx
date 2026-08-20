"use client";

import { useActionState } from "react";
import { addAllergy, type SimpleFormState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function AllergyForm({ patientId }: { patientId: string }) {
  const addAllergyForPatient = addAllergy.bind(null, patientId);
  const [state, formAction, pending] = useActionState<SimpleFormState, FormData>(
    addAllergyForPatient,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="substance" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Sustancia
        </label>
        <input id="substance" name="substance" type="text" required className={`${inputClass} w-40`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="reaction" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Reacción
        </label>
        <input id="reaction" name="reaction" type="text" className={`${inputClass} w-40`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="severity" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Severidad
        </label>
        <select id="severity" name="severity" defaultValue="" className={inputClass}>
          <option value="">—</option>
          <option value="leve">Leve</option>
          <option value="moderada">Moderada</option>
          <option value="severa">Severa</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "Agregando…" : "Agregar"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
    </form>
  );
}
