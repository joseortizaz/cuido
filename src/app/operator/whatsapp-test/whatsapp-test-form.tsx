"use client";

import { useActionState } from "react";
import { sendTestWhatsAppMessage, type WhatsAppTestActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

const buttonClass =
  "rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";

/**
 * Formulario de envío MANUAL de validación -- pensado para probar
 * "hello_world" (u otra plantilla ya aprobada en la cuenta de PRUEBA de
 * Meta), no para uso operativo real. `hello_world` no tiene variables,
 * por eso el campo de variables queda vacío por default y es opcional
 * -- se deja para cuando se pruebe una plantilla con parámetros más
 * adelante (p. ej. "recordatorio_cita", pendiente de aprobación en la
 * cuenta real).
 */
export function WhatsAppTestForm() {
  const [state, formAction, pending] = useActionState<WhatsAppTestActionState, FormData>(
    sendTestWhatsAppMessage,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="to" className="text-sm font-medium">
          Número destino (formato internacional, ej. +18095551234)
        </label>
        <input id="to" name="to" type="text" required className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="template_name" className="text-sm font-medium">
          Nombre de la plantilla
        </label>
        <input
          id="template_name"
          name="template_name"
          type="text"
          required
          defaultValue="hello_world"
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="language_code" className="text-sm font-medium">
          Código de idioma
        </label>
        <input
          id="language_code"
          name="language_code"
          type="text"
          required
          defaultValue="en_US"
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="body_parameters" className="text-sm font-medium">
          Variables de la plantilla (separadas por coma, opcional — &quot;hello_world&quot; no usa ninguna)
        </label>
        <input id="body_parameters" name="body_parameters" type="text" className={inputClass} />
      </div>

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}

      <button type="submit" disabled={pending} className={`${buttonClass} self-start`}>
        {pending ? "Enviando…" : "Enviar mensaje de prueba"}
      </button>
    </form>
  );
}
