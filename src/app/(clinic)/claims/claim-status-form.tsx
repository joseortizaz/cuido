"use client";

import { useActionState, useState } from "react";
import { updateClaimStatus, type ClaimActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function ClaimStatusForm({ claimId, currentStatus }: { claimId: string; currentStatus: string }) {
  const boundAction = updateClaimStatus.bind(null, claimId);
  const [state, formAction, pending] = useActionState<ClaimActionState, FormData>(boundAction, undefined);
  const [status, setStatus] = useState(currentStatus);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <select
        name="status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className={inputClass}
      >
        <option value="pendiente">Pendiente</option>
        <option value="enviada">Enviada</option>
        <option value="aprobada">Aprobada</option>
        <option value="rechazada">Rechazada</option>
      </select>
      {status === "rechazada" && (
        <input
          name="rejection_reason"
          type="text"
          required
          placeholder="Motivo de rechazo"
          className={`${inputClass} w-40`}
        />
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "…" : "Actualizar"}
      </button>
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
    </form>
  );
}
