"use client";

import { useActionState } from "react";
import { registerClaimPayment, type ClaimActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

/** Cobro de una reclamación aprobada: un total acumulado y su fecha. */
export function ClaimPaymentForm({
  claimId,
  currentPaid,
  currentPaidOn,
  today,
}: {
  claimId: string;
  currentPaid: number | null;
  currentPaidOn: string | null;
  today: string;
}) {
  const boundAction = registerClaimPayment.bind(null, claimId);
  const [state, formAction, pending] = useActionState<ClaimActionState, FormData>(boundAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="paid_amount"
        type="number"
        min="0"
        step="0.01"
        required
        defaultValue={currentPaid ?? ""}
        placeholder="Total cobrado"
        aria-label="Total cobrado"
        className={`${inputClass} w-32`}
      />
      <input
        name="paid_on"
        type="date"
        required
        max={today}
        defaultValue={currentPaidOn ?? today}
        aria-label="Fecha del cobro"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "…" : currentPaid !== null ? "Actualizar cobro" : "Registrar cobro"}
      </button>
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.success && <span className="text-xs text-green-700 dark:text-green-400">{state.success}</span>}
    </form>
  );
}
