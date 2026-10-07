"use client";

import { useActionState, useState } from "react";
import { registerInsurer, type InsuranceActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function InsurerForm({ patientId, catalog }: { patientId: string; catalog: { id: string; name: string }[] }) {
  const [choice, setChoice] = useState(catalog[0]?.id ?? "otra");
  const registerForPatient = registerInsurer.bind(null, patientId);
  const [state, formAction, pending] = useActionState<InsuranceActionState, FormData>(
    registerForPatient,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="insurer_name" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Aseguradora (ARS)
        </label>
        <select
          id="insurer_id"
          name="insurer_id"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className={`${inputClass} w-48`}
        >
          {catalog.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
          <option value="otra">Otra aseguradora (escribir)</option>
        </select>
      </div>
      {choice === "otra" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="insurer_name" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Nombre de la aseguradora
          </label>
          <input id="insurer_name" name="insurer_name" type="text" required className={`${inputClass} w-40`} />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="affiliate_number" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Número de afiliado
        </label>
        <input
          id="affiliate_number"
          name="affiliate_number"
          type="text"
          required
          className={`${inputClass} w-40`}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "Guardando…" : "Registrar aseguradora"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && (
        <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>
      )}
    </form>
  );
}
