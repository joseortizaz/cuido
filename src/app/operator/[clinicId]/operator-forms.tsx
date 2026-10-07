"use client";

import { useActionState } from "react";
import {
  addClinicInternalNote,
  extendClinicTrial,
  registerClinicPayment,
  setClinicAccessExempt,
  setClinicActiveStatus,
  setClinicClinicianSeats,
  setClinicPlanPeriod,
  updateClinicPlan,
  type OperatorActionState,
} from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

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
      <label htmlFor="reason" className={labelClass}>
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

/** Modelo de negocio y condiciones. El precio/periodo/vencimiento se fijan en PlanPeriodForm. */
export function PlanForm({
  clinicId,
  currentBusinessModel,
  currentConditions,
}: {
  clinicId: string;
  currentBusinessModel: string;
  currentConditions: string | null;
}) {
  const boundAction = updateClinicPlan.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="business_model" className={labelClass}>
          Modelo de negocio
        </label>
        <select
          id="business_model"
          name="business_model"
          defaultValue={currentBusinessModel}
          className={`${inputClass} self-start`}
        >
          <option value="modelo_c">Modelo C</option>
          <option value="modelo_e">Modelo E</option>
          <option value="modelo_f">Modelo F</option>
        </select>
      </div>
      <label htmlFor="conditions" className={labelClass}>
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
        {pending ? "Guardando…" : "Actualizar modelo y condiciones"}
      </button>
      <FormFeedback state={state} />
    </form>
  );
}

export function PlanPeriodForm({
  clinicId,
  currentPeriod,
  currentAmount,
  today,
}: {
  clinicId: string;
  currentPeriod: number | null;
  currentAmount: number | null;
  today: string;
}) {
  const boundAction = setClinicPlanPeriod.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="period_days" className={labelClass}>
          Periodo
        </label>
        <select id="period_days" name="period_days" defaultValue={currentPeriod ?? 30} className={inputClass}>
          <option value="30">30 días</option>
          <option value="90">90 días</option>
          <option value="180">180 días</option>
          <option value="365">365 días</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="plan_amount" className={labelClass}>
          Monto del plan (RD$, opcional)
        </label>
        <input
          id="plan_amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          defaultValue={currentAmount ?? ""}
          className={`${inputClass} w-40`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="start_on" className={labelClass}>
          Inicio del plan
        </label>
        <input id="start_on" name="start_on" type="date" required defaultValue={today} className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Guardando…" : "Fijar plan"}
      </button>
      <p className="w-full text-xs text-zinc-500">
        Vencimiento = inicio + periodo. Reemplaza el vencimiento anterior; para extenderlo con un pago usa
        «Registrar pago».
      </p>
      <FormFeedback state={state} />
    </form>
  );
}

export function PaymentForm({
  clinicId,
  hasPlan,
  today,
}: {
  clinicId: string;
  hasPlan: boolean;
  today: string;
}) {
  const boundAction = registerClinicPayment.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="paid_on" className={labelClass}>
          Fecha de pago
        </label>
        <input id="paid_on" name="paid_on" type="date" required defaultValue={today} className={inputClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="payment_amount" className={labelClass}>
          Monto (RD$)
        </label>
        <input
          id="payment_amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
          className={`${inputClass} w-40`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="payment_note" className={labelClass}>
          Nota (opcional)
        </label>
        <input id="payment_note" name="note" type="text" className={`${inputClass} w-56`} />
      </div>
      <button type="submit" disabled={pending || !hasPlan} className={buttonClass}>
        {pending ? "Registrando…" : "Registrar pago"}
      </button>
      <p className="w-full text-xs text-zinc-500">
        {hasPlan
          ? "Nuevo vencimiento = vencimiento anterior + periodo (pagar tarde no regala días). Si la clínica ya estaba en solo lectura, cuenta desde la fecha de pago."
          : "Primero fija el plan (periodo e inicio) para poder registrar un pago."}
      </p>
      <FormFeedback state={state} />
    </form>
  );
}

export function ExtendTrialForm({ clinicId }: { clinicId: string }) {
  const boundAction = extendClinicTrial.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="trial_days" className={labelClass}>
          Días a extender
        </label>
        <input
          id="trial_days"
          name="days"
          type="number"
          min="1"
          max="365"
          step="1"
          required
          className={`${inputClass} w-28`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="trial_reason" className={labelClass}>
          Motivo
        </label>
        <input id="trial_reason" name="reason" type="text" required className={`${inputClass} w-72`} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Guardando…" : "Extender prueba"}
      </button>
      <p className="w-full text-xs text-zinc-500">
        Suma desde el fin actual si la prueba sigue corriendo; desde hoy si ya había vencido.
      </p>
      <FormFeedback state={state} />
    </form>
  );
}

export function ExemptForm({ clinicId, isExempt }: { clinicId: string; isExempt: boolean }) {
  const boundAction = setClinicAccessExempt.bind(null, clinicId, !isExempt);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="exempt_reason" className={labelClass}>
          Motivo ({isExempt ? "por qué quitar la exención" : "piloto, demo, acuerdo especial…"})
        </label>
        <input id="exempt_reason" name="reason" type="text" required className={`${inputClass} w-80`} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Guardando…" : isExempt ? "Quitar exención" : "Marcar como exenta"}
      </button>
      <p className="w-full text-xs text-zinc-500">
        Una clínica exenta nunca pasa a solo lectura por fechas (la suspensión manual sigue aplicando).
      </p>
      <FormFeedback state={state} />
    </form>
  );
}

export function SeatsForm({ clinicId, currentSeats }: { clinicId: string; currentSeats: number | null }) {
  const boundAction = setClinicClinicianSeats.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<OperatorActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="seats" className={labelClass}>
          Médicos incluidos (vacío = ilimitado)
        </label>
        <input
          id="seats"
          name="seats"
          type="number"
          min="0"
          step="1"
          defaultValue={currentSeats ?? ""}
          className={`${inputClass} w-32`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="seats_reason" className={labelClass}>
          Motivo
        </label>
        <input id="seats_reason" name="reason" type="text" required className={`${inputClass} w-72`} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Guardando…" : "Fijar cupo"}
      </button>
      <p className="w-full text-xs text-zinc-500">
        Cuentan admin y médico; recepción no consume cupo. Súbelo tras confirmar el pago del médico adicional.
      </p>
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
      <label htmlFor="note" className={labelClass}>
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
