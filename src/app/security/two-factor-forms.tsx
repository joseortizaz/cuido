"use client";

import { useActionState, useState, useTransition } from "react";
import {
  confirmEnrollment,
  disableTotp,
  startEnrollment,
  type EnrollStartState,
  type SecurityActionState,
} from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const buttonClass =
  "rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";

function CodeField({ id }: { id: string }) {
  return (
    <input
      id={id}
      name="code"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]*"
      maxLength={7}
      required
      placeholder="123456"
      className={inputClass}
    />
  );
}

/** Activar: botón → QR + clave + campo de código. */
export function EnrollPanel() {
  const [start, setStart] = useState<EnrollStartState>(undefined);
  const [starting, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState<SecurityActionState, FormData>(confirmEnrollment, undefined);

  if (!start || !start.factorId) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <button
            type="button"
            disabled={starting}
            onClick={() => startTransition(async () => setStart(await startEnrollment()))}
            className={buttonClass}
          >
            {starting ? "Preparando…" : "Activar verificación en dos pasos"}
          </button>
        </div>
        {start?.error && <p className="text-sm text-red-600">{start.error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        <li>Abre tu app de autenticación y agrega una cuenta nueva.</li>
        <li>Escanea el código QR (o escribe la clave a mano).</li>
        <li>Escribe aquí el código de 6 dígitos que muestra la app para confirmar.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {/* qr_code es un SVG en data: URI generado por Supabase Auth. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={start.qrCode} alt="Código QR para la app de autenticación" width={176} height={176} className="rounded-md bg-white p-2" />
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">¿No puedes escanear? Clave manual:</span>
          <code className="break-all rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-900">{start.secret}</code>
        </div>
      </div>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="factor_id" value={start.factorId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="enroll_code" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Código de verificación
          </label>
          <CodeField id="enroll_code" />
        </div>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <div>
          <button type="submit" disabled={pending} className={buttonClass}>
            {pending ? "Verificando…" : "Confirmar y activar"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Desactivar: exige un código vigente. */
export function DisableForm() {
  const [state, formAction, pending] = useActionState<SecurityActionState, FormData>(disableTotp, undefined);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-zinc-600 hover:underline dark:text-zinc-400">Desactivar</summary>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <p className="text-zinc-600 dark:text-zinc-400">
          Para desactivarla, escribe el código actual de tu app. Tu cuenta quedará protegida solo por la contraseña.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="disable_code" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Código de verificación
          </label>
          <CodeField id="disable_code" />
        </div>
        {state?.error && <p className="text-red-600">{state.error}</p>}
        <div>
          <button type="submit" disabled={pending} className={buttonClass}>
            {pending ? "Desactivando…" : "Desactivar verificación en dos pasos"}
          </button>
        </div>
      </form>
    </details>
  );
}
