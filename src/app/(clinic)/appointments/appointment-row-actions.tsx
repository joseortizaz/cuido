"use client";

import Link from "next/link";
import { useActionState } from "react";
import { updateAppointmentStatus, type AppointmentActionState } from "./actions";

const STATUS_OPTIONS = [
  { value: "pendiente", label: "Pendiente" },
  { value: "confirmada", label: "Confirmada" },
  { value: "completada", label: "Completada" },
  { value: "cancelada", label: "Cancelada" },
  { value: "no_show", label: "No-show" },
] as const;

/**
 * Cambio de estado manual (admin/recepción) + "Convertir a consulta"
 * (admin/médico). Ambos se muestran u ocultan según el rol y el estado
 * de la cita ya en el servidor (page.tsx pasa `canManage`/`canConvert`
 * ya calculados) -- este componente no vuelve a decidir permisos, solo
 * los refleja.
 */
export function AppointmentRowActions({
  appointmentId,
  currentStatus,
  canManage,
  convertHref,
  checklistHref,
}: {
  appointmentId: string;
  currentStatus: string;
  canManage: boolean;
  convertHref: string | null;
  checklistHref?: string | null;
}) {
  const boundAction = updateAppointmentStatus.bind(null, appointmentId);
  const [state, formAction, pending] = useActionState<AppointmentActionState, FormData>(
    boundAction,
    undefined
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canManage && (
        <form action={formAction} className="flex items-center gap-1.5">
          <select
            name="status"
            defaultValue={currentStatus}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {pending ? "…" : "Actualizar"}
          </button>
        </form>
      )}
      {convertHref && (
        <Link
          href={convertHref}
          className="rounded-full bg-brand-teal/10 px-2.5 py-1 text-xs font-medium text-brand-teal hover:bg-brand-teal/20"
        >
          Convertir a consulta
        </Link>
      )}
      {checklistHref && (
        <Link
          href={checklistHref}
          className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
        >
          Checklist prequirúrgico
        </Link>
      )}
      {state?.error && <p className="w-full text-xs text-red-600 dark:text-red-400">{state.error}</p>}
    </div>
  );
}
