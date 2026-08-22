"use client";

import { useActionState } from "react";
import { revokeSensitiveAccess, type SensitiveAccessActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function RevokeAccessForm({ patientId, grantId }: { patientId: string; grantId: string }) {
  const boundAction = revokeSensitiveAccess.bind(null, patientId, grantId);
  const [state, formAction, pending] = useActionState<SensitiveAccessActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="reason"
        type="text"
        required
        placeholder="Motivo de revocación"
        className={`${inputClass} w-40`}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        {pending ? "…" : "Revocar"}
      </button>
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}
