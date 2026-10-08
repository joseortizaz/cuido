"use client";

import { useActionState } from "react";
import { verifyLoginCode, type MfaChallengeState } from "./actions";

export function MfaChallengeForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<MfaChallengeState, FormData>(verifyLoginCode, undefined);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1">
        <label htmlFor="code" className="text-sm font-medium text-brand-navy">
          Código de verificación
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          autoFocus
          placeholder="123456"
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-brand-teal"
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-linear-to-r from-brand-blue to-brand-teal px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Verificando…" : "Verificar"}
      </button>
    </form>
  );
}
