"use client";

import { useActionState } from "react";
import { createClaim, type ClaimActionState } from "@/app/(clinic)/claims/actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

type InsurerOption = { id: string; insurer_name: string; affiliate_number: string };

export function ClaimForm({
  patientId,
  encounterId,
  insurers,
}: {
  patientId: string;
  encounterId: string;
  insurers: InsurerOption[];
}) {
  const createForEncounter = createClaim.bind(null, patientId, encounterId);
  const [state, formAction, pending] = useActionState<ClaimActionState, FormData>(
    createForEncounter,
    undefined
  );

  if (insurers.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        El paciente no tiene una aseguradora registrada — regístrala en su ficha antes de reclamar.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="patient_insurer_id" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Aseguradora
        </label>
        <select id="patient_insurer_id" name="patient_insurer_id" required className={inputClass}>
          {insurers.map((i) => (
            <option key={i.id} value={i.id}>
              {i.insurer_name} — {i.affiliate_number}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="claimed_amount" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Monto reclamado (opcional)
        </label>
        <input
          id="claimed_amount"
          name="claimed_amount"
          type="number"
          min="0"
          step="0.01"
          className={`${inputClass} w-32`}
        />
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
        className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Guardando…" : "Registrar reclamación"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && (
        <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>
      )}
    </form>
  );
}
