"use client";

import { useActionState } from "react";
import {
  confirmDeletionExport,
  requestDeletion,
  withdrawDeletion,
  type DeletionActionState,
} from "./actions";

const buttonClass =
  "rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";
const dangerButtonClass =
  "rounded-full bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:opacity-50";

function Feedback({ state }: { state: DeletionActionState }) {
  return (
    <>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </>
  );
}

export function RequestForm({ warningText }: { warningText: string }) {
  const [state, formAction, pending] = useActionState<DeletionActionState, FormData>(requestDeletion, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        {warningText}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="accepted" className="mt-1" />
        <span>He leído la advertencia y la acepto.</span>
      </label>
      <div>
        <button type="submit" disabled={pending} className={dangerButtonClass}>
          {pending ? "Registrando…" : "Solicitar la eliminación de los datos"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function ConfirmExportForm({ requestId }: { requestId: string }) {
  const bound = confirmDeletionExport.bind(null, requestId);
  const [state, formAction, pending] = useActionState<DeletionActionState, FormData>(bound, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="verified" className="mt-1" />
        <span>
          Descargué el libro completo, lo abrí y verifiqué que contiene la información que necesito conservar.
        </span>
      </label>
      <div>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Confirmando…" : "Confirmar la descarga"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function WithdrawForm({ requestId }: { requestId: string }) {
  const bound = withdrawDeletion.bind(null, requestId);
  const [state, formAction, pending] = useActionState<DeletionActionState>(bound, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div>
        <button type="submit" disabled={pending} className="text-sm text-zinc-600 underline dark:text-zinc-400">
          {pending ? "Retirando…" : "Desistir de la solicitud"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
