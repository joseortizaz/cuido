"use client";

import { useActionState } from "react";
import { grantSensitiveAccess, type SensitiveAccessActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function GrantAccessForm({
  patientId,
  sensitiveSpecialties,
  clinicMembers,
}: {
  patientId: string;
  sensitiveSpecialties: { id: string; name: string }[];
  clinicMembers: { userId: string; label: string }[];
}) {
  const grantForPatient = grantSensitiveAccess.bind(null, patientId);
  const [state, formAction, pending] = useActionState<SensitiveAccessActionState, FormData>(
    grantForPatient,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="specialty_template_id" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Especialidad
        </label>
        <select id="specialty_template_id" name="specialty_template_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecciona
          </option>
          {sensitiveSpecialties.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="target_user_id" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Otorgar a
        </label>
        <select id="target_user_id" name="target_user_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecciona
          </option>
          {clinicMembers.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="reason" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Motivo
        </label>
        <input id="reason" name="reason" type="text" required className={`${inputClass} w-48`} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "Otorgando…" : "Otorgar acceso"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && (
        <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>
      )}
    </form>
  );
}
