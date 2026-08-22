"use client";

import Link from "next/link";
import { useActionState } from "react";
import { PasswordInput } from "../_auth/password-input";
import { resetPassword, type ResetPasswordState } from "./actions";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(resetPassword, undefined);

  if (state?.success) {
    return (
      <div className="flex w-full flex-col items-center gap-2 text-center">
        <p className="text-sm text-zinc-700">Tu contraseña se actualizó. Ya puedes iniciar sesión.</p>
        <Link href="/login" className="text-sm font-medium text-brand-teal hover:underline">
          Ir a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-brand-navy">
          Nueva contraseña
        </label>
        <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={8} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-brand-navy">
          Confirmar contraseña
        </label>
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required minLength={8} />
      </div>
      {state?.error && (
        <p className="text-sm text-red-600">
          {state.error}{" "}
          <Link href="/forgot-password" className="font-medium underline">
            Solicitar enlace nuevo
          </Link>
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-linear-to-r from-brand-blue to-brand-teal px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
