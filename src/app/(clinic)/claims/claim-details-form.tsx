"use client";

import { useActionState } from "react";
import { updateClaimDetails, type ClaimActionState } from "./actions";
import { formatMoney } from "@/lib/domain/claims";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export type DocumentOption = { id: string; e_ncf: string | null; monto_total: number; status: string };

/** Comprobante fiscal (e-CF) vinculado y número de autorización de la ARS. */
export function ClaimDetailsForm({
  claimId,
  documents,
  currentDocumentId,
  currentAuthorization,
}: {
  claimId: string;
  documents: DocumentOption[];
  currentDocumentId: string | null;
  currentAuthorization: string | null;
}) {
  const boundAction = updateClaimDetails.bind(null, claimId);
  const [state, formAction, pending] = useActionState<ClaimActionState, FormData>(boundAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <select
        name="fiscal_document_id"
        defaultValue={currentDocumentId ?? ""}
        aria-label="Comprobante fiscal (e-CF)"
        className={inputClass}
      >
        <option value="">Sin comprobante vinculado</option>
        {documents.map((d) => (
          <option key={d.id} value={d.id}>
            {d.e_ncf ?? "Sin e-NCF"} — {formatMoney(d.monto_total)}
          </option>
        ))}
      </select>
      <input
        name="authorization_number"
        type="text"
        defaultValue={currentAuthorization ?? ""}
        placeholder="No. de autorización"
        aria-label="Número de autorización"
        className={`${inputClass} w-40`}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "…" : "Guardar"}
      </button>
      {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
      {state?.success && <span className="text-xs text-green-700 dark:text-green-400">{state.success}</span>}
    </form>
  );
}
