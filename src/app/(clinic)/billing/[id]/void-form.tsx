"use client";

import { useActionState } from "react";
import { voidFiscalDocument, retrySignFiscalDocument, type BillingActionState } from "../actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function VoidForm({ fiscalDocumentId }: { fiscalDocumentId: string }) {
  const boundAction = voidFiscalDocument.bind(null, fiscalDocumentId);
  const [state, formAction, pending] = useActionState<BillingActionState, FormData>(boundAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="reason" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Motivo de anulación
      </label>
      <textarea id="reason" name="reason" required rows={2} className={inputClass} />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        {pending ? "…" : "Anular e-CF"}
      </button>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </form>
  );
}

export function RetrySignForm({ fiscalDocumentId }: { fiscalDocumentId: string }) {
  const boundAction = retrySignFiscalDocument.bind(null, fiscalDocumentId);
  const [state, formAction, pending] = useActionState<BillingActionState, FormData>(boundAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "…" : "Firmar y enviar"}
      </button>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </form>
  );
}
