"use client";

import { useActionState, useState, useTransition } from "react";
import { logPrescriptionPrint, voidPrescription, type RxFormState } from "../actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";
const dangerClass =
  "rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950";

export function VoidPrescriptionForm({ patientId, prescriptionId, disabled }: { patientId: string; prescriptionId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<RxFormState, FormData>(voidPrescription.bind(null, patientId, prescriptionId), undefined);
  const [reason, setReason] = useState("");
  return (
    <form action={action} className="flex flex-col gap-2">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Una receta emitida no se edita. Si tiene un error, anúlala con un motivo y emite otra: la anulada queda en el historial y ya no se puede imprimir.
      </p>
      <label htmlFor="void_rx_reason" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Motivo (obligatorio)
      </label>
      <input id="void_rx_reason" name="reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} max-w-md`} />
      <div>
        <button type="submit" disabled={pending || disabled} className={dangerClass}>
          {pending ? "Anulando…" : "Anular receta"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </form>
  );
}

/** Barra de la hoja de impresión: deja constancia de la impresión y abre el diálogo del navegador. */
export function PrintButton({ patientId, prescriptionId, format }: { patientId: string; prescriptionId: string; format: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await logPrescriptionPrint(patientId, prescriptionId, format);
            if (res.error) {
              setError(res.error);
              return;
            }
            window.print();
          })
        }
      >
        {pending ? "Preparando…" : "Imprimir"}
      </button>
      {error && <span role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>{error}</span>}
    </>
  );
}
