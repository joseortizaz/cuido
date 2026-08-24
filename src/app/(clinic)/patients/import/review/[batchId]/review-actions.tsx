"use client";

import { useActionState } from "react";
import { confirmImportBatch, cancelImportBatch, type BatchActionState } from "./actions";

export function ReviewActions({ batchId, hasValidRows }: { batchId: string; hasValidRows: boolean }) {
  const boundConfirm = confirmImportBatch.bind(null, batchId);
  const [state, formAction, pending] = useActionState<BatchActionState, FormData>(boundConfirm, undefined);

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <div className="flex gap-3">
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending || !hasValidRows}
            className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {pending ? "Importando…" : "Confirmar importación"}
          </button>
        </form>
        <form action={cancelImportBatch.bind(null, batchId)}>
          <button
            type="submit"
            className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Cancelar
          </button>
        </form>
      </div>
    </div>
  );
}
