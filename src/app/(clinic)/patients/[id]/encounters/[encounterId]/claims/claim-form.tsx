"use client";

import { useActionState } from "react";
import { createClaim, type ClaimActionState } from "@/app/(clinic)/claims/actions";
import { formatMoney } from "@/lib/domain/claims";
import type { DocumentOption } from "@/app/(clinic)/claims/claim-details-form";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

type InsurerOption = { id: string; insurer_name: string; affiliate_number: string };

export function ClaimForm({
  patientId,
  encounterId,
  insurers,
  documents,
  referenceDiagnoses,
}: {
  patientId: string;
  encounterId: string;
  insurers: InsurerOption[];
  documents: DocumentOption[];
  referenceDiagnoses: string[];
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
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="patient_insurer_id" className={labelClass}>
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
          <label htmlFor="claimed_amount" className={labelClass}>
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
          <label htmlFor="fiscal_document_id" className={labelClass}>
            Comprobante fiscal (e-CF)
          </label>
          <select id="fiscal_document_id" name="fiscal_document_id" className={inputClass}>
            <option value="">Sin vincular</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.e_ncf ?? "Sin e-NCF"} — {formatMoney(d.monto_total)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="authorization_number" className={labelClass}>
            No. de autorización (opcional)
          </label>
          <input id="authorization_number" name="authorization_number" type="text" className={`${inputClass} w-40`} />
        </div>
      </div>

      <fieldset className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="px-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Diagnóstico codificado (opcional aquí; obligatorio para marcarla como enviada)
        </legend>
        {referenceDiagnoses.length > 0 && (
          <p className="w-full text-xs text-zinc-500">Diagnóstico del médico: {referenceDiagnoses.join(" · ")}</p>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="dx_system" className={labelClass}>
            Sistema
          </label>
          <select id="dx_system" name="dx_system" defaultValue="CIE-10" className={inputClass}>
            <option value="CIE-10">CIE-10</option>
            <option value="CIE-11">CIE-11</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dx_code" className={labelClass}>
            Código
          </label>
          <input id="dx_code" name="dx_code" type="text" placeholder="J00, E11.9" className={`${inputClass} w-32`} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dx_description" className={labelClass}>
            Descripción
          </label>
          <input id="dx_description" name="dx_description" type="text" className={`${inputClass} w-56`} />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="notes" className={labelClass}>
            Notas (opcional)
          </label>
          <input id="notes" name="notes" type="text" className={`${inputClass} w-64`} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {pending ? "Guardando…" : "Registrar reclamación"}
        </button>
      </div>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && (
        <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>
      )}
    </form>
  );
}
