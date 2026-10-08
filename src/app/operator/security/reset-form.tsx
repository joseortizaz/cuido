"use client";

import { useActionState } from "react";
import { resetUserMfa, type ResetMfaState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const buttonClass =
  "rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";

export function ResetMfaForm() {
  const [state, formAction, pending] = useActionState<ResetMfaState, FormData>(resetUserMfa, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="reset_email" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Correo del usuario
        </label>
        <input id="reset_email" name="email" type="email" required className={inputClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="reset_reason" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Motivo y cómo verificaste su identidad
        </label>
        <textarea id="reset_reason" name="reason" rows={3} required minLength={10} className={inputClass} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" /> Verifiqué la identidad de esta persona por un medio
        distinto al correo de la cuenta.
      </label>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
      <div>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Restableciendo…" : "Quitar el 2FA de este usuario"}
        </button>
      </div>
    </form>
  );
}
