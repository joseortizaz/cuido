"use client";

import { useActionState } from "react";
import { addFiscalSequence, type FiscalActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function SequenceForm({
  currentRangeStart,
}: {
  currentRangeStart?: number;
}) {
  const [state, formAction, pending] = useActionState<FiscalActionState, FormData>(
    addFiscalSequence,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="range_start" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Desde
        </label>
        <input
          id="range_start"
          name="range_start"
          type="number"
          min={1}
          required
          defaultValue={currentRangeStart}
          disabled={currentRangeStart !== undefined}
          className={`${inputClass} w-32`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="range_end" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Hasta
        </label>
        <input id="range_end" name="range_end" type="number" min={1} required className={`${inputClass} w-32`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="valid_until" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Vence
        </label>
        <input id="valid_until" name="valid_until" type="date" required className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "Guardando…" : currentRangeStart !== undefined ? "Extender rango" : "Configurar secuencia"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </form>
  );
}
