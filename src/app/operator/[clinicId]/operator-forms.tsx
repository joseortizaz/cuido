"use client";

import { useActionState } from "react";
import {
  addClinicInternalNote,
  setClinicActiveStatus,
  updateClinicPaymentStatus,
  updateClinicPlan,
  type OperatorActionState,
} from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

const buttonClass =
  "rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";

function FormFeedback({ state }: { state: OperatorActionState }) {
  return (
    <>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && (
        <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>
      )}
    </>
  );
}

export function ActiveStatusForm({
  clinicId,
  isActive,
}: {
  clinicId: string;
  isActive: boolean;
}) {
  const boundAction = setClinicActiveStatus.bind(null, clinicId, !isActive);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="reason" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Motivo ({isActive ? "por qué desactivarla" : "por qué reactivarla"})
      </label>
      <textarea id="reason" name="reason" required rows={2} className={inputClass} />
      <button
        type="submit"
        disabled={pending}
        className={
          isActive
            ? "self-start rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            : `self-start ${buttonClass}`
        }
      >
        {pending ? "…" : isActive ? "Desactivar clínica" : "Activar clínica"}
      </button>
      <FormFeedback state={state} />
    </form>
  );
}

export function PlanForm({
  clinicId,
  currentBusinessModel,
  currentPrice,
  currentConditions,
}: {
  clinicId: string;
  currentBusinessModel: string;
  currentPrice: number | null;
  currentConditions: string | null;
}) {
  const boundAction = updateClinicPlan.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="business_model" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Modelo de negocio
          </label>
          <select
            id="business_model"
            name="business_model"
            defaultValue={currentBusinessModel}
            className={inputClass}
          >
            <option value="modelo_c">Modelo C</option>
            <option value="modelo_e">Modelo E</option>
            <option value="modelo_f">Modelo F</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="price" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Precio (RD$)
          </label>
          <input
            id="price"
            name="price"
            type="number"
            step="0.01"
            min="0"
            defaultValue={currentPrice ?? ""}
            className={`${inputClass} w-32`}
          />
        </div>
      </div>
      <label htmlFor="conditions" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Condiciones negociadas
      </label>
      <textarea
        id="conditions"
        name="conditions"
        rows={2}
        defaultValue={currentConditions ?? ""}
        className={inputClass}
      />
      <button type="submit" disabled={pending} className={`self-start ${buttonClass}`}>
        {pending ? "Guardando…" : "Actualizar plan"}
      </button>
      <FormFeedback state={state} />
    </form>
  );
}

export function PaymentStatusForm({
  clinicId,
  currentPaymentStatus,
  currentDueDate,
}: {
  clinicId: string;
  currentPaymentStatus: string;
  currentDueDate: string | null;
}) {
  const boundAction = updateClinicPaymentStatus.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="payment_status" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Estado de pago
        </label>
        <select
          id="payment_status"
          name="payment_status"
          defaultValue={currentPaymentStatus}
          className={inputClass}
        >
          <option value="al_dia">Al día</option>
          <option value="pendiente">Pendiente</option>
          <option value="vencido">Vencido</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="next_payment_due_on"
          className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
        >
          Próximo pago
        </label>
        <input
          id="next_payment_due_on"
          name="next_payment_due_on"
          type="date"
          defaultValue={currentDueDate ?? ""}
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Guardando…" : "Actualizar pago"}
      </button>
      <FormFeedback state={state} />
    </form>
  );
}

export function NoteForm({ clinicId }: { clinicId: string }) {
  const boundAction = addClinicInternalNote.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="note" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Nueva nota interna (no visible para la clínica)
      </label>
      <textarea id="note" name="note" required rows={2} className={inputClass} />
      <button type="submit" disabled={pending} className={`self-start ${buttonClass}`}>
        {pending ? "Guardando…" : "Agregar nota"}
      </button>
      <FormFeedback state={state} />
    </form>
  );
}
