"use client";

import Link from "next/link";
import { useActionState } from "react";
import { PasswordInput } from "../_auth/password-input";
import { signup, type SignupState } from "./actions";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<SignupState, FormData>(signup, undefined);

  if (state?.success) {
    return (
      <div className="flex w-full flex-col items-center gap-2 text-center">
        <p className="text-sm text-zinc-700">
          Revisa tu correo para confirmar la cuenta antes de iniciar sesión.
        </p>
        <Link href="/login" className="text-sm font-medium text-brand-teal hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
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
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-brand-navy">
          Contraseña
        </label>
        <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={8} />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-linear-to-r from-brand-blue to-brand-teal px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Creando cuenta…" : "Crear cuenta"}
      </button>
      <p className="text-center text-sm text-zinc-600">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-brand-teal hover:underline">
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}
