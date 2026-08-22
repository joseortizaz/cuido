"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(
    requestPasswordReset,
    undefined
  );

  if (state?.success) {
    return (
      <div className="flex w-full flex-col items-center gap-2 text-center">
        <p className="text-sm text-zinc-700">
          Si el correo tiene una cuenta registrada, te enviamos un enlace para restablecer tu contraseña.
        </p>
        <Link href="/login" className="text-sm font-medium text-brand-teal hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <p className="text-sm text-zinc-600">
        Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-brand-navy">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-teal"
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-linear-to-r from-brand-blue to-brand-teal px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Enviando…" : "Enviar enlace"}
      </button>
      <p className="text-center text-sm text-zinc-600">
        <Link href="/login" className="font-medium text-brand-teal hover:underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </form>
  );
}
