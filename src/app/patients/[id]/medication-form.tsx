"use client";

import { useActionState } from "react";
import { addMedication, type SimpleFormState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function MedicationForm({ patientId }: { patientId: string }) {
  const addMedicationForPatient = addMedication.bind(null, patientId);
  const [state, formAction, pending] = useActionState<SimpleFormState, FormData>(
    addMedicationForPatient,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Nombre
        </label>
        <input id="name" name="name" type="text" required className={`${inputClass} w-40`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="dose" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Dosis
        </label>
        <input id="dose" name="dose" type="text" className={`${inputClass} w-28`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="frequency" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Frecuencia
        </label>
        <input id="frequency" name="frequency" type="text" className={`${inputClass} w-32`} />
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
