"use client";

import { useActionState } from "react";
import { inviteMember, type TeamActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

/**
 * `seats` solo llega para clínicas con cupo de médicos (included_clinician_seats
 * no es null) -- la barrera real es el trigger seat_limit de la base; esto es
 * cortesía para que el admin no tenga que adivinar por qué una invitación
 * falla. Cuentan los roles admin y médico; recepción no consume cupo.
 */
export function InviteForm({ seats }: { seats: { used: number; included: number } | null }) {
  const noRoom = seats !== null && seats.used >= seats.included;
  const [state, formAction, pending] = useActionState<TeamActionState, FormData>(
    inviteMember,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className={`${inputClass} w-56`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="role" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Rol
        </label>
        <select
          id="role"
          name="role"
          required
          defaultValue={noRoom ? "recepcion" : "medico"}
          className={inputClass}
        >
          <option value="admin" disabled={noRoom}>
            Admin
          </option>
          <option value="medico" disabled={noRoom}>
            Médico
          </option>
          <option value="recepcion">Recepción</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Invitando…" : "Invitar"}
      </button>
      {seats && (
        <p className="w-full text-xs text-zinc-500">
          Médicos incluidos en tu plan (admin y médico): {seats.used} de {seats.included}.
          {noRoom &&
            " Ya no hay cupo: para agregar otro médico, contacta a Narnia (info@narniats.com / WhatsApp 829-374-8878)."}
        </p>
      )}
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && (
        <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>
      )}
    </form>
  );
}
