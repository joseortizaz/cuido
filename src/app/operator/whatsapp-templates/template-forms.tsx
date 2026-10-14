"use client";

import { useActionState } from "react";
import { createWhatsAppTemplate, syncTemplates, type TemplateActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const buttonClass =
  "rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";

export function SyncForm() {
  const [state, formAction, pending] = useActionState<TemplateActionState, FormData>(syncTemplates, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Sincronizando…" : "Sincronizar con Meta"}
      </button>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </form>
  );
}

export function CreateTemplateForm() {
  const [state, formAction, pending] = useActionState<TemplateActionState, FormData>(
    createWhatsAppTemplate,
    undefined
  );
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="tpl_name" className="text-sm font-medium">
            Nombre (minúsculas, números y _)
          </label>
          <input id="tpl_name" name="name" type="text" required placeholder="recordatorio_cita_v2" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="tpl_language" className="text-sm font-medium">
            Idioma
          </label>
          <input id="tpl_language" name="language" type="text" required defaultValue="es" className={inputClass} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="tpl_body" className="text-sm font-medium">
          Cuerpo (variables {"{{1}}"}, {"{{2}}"}… sin ir al inicio ni al final)
        </label>
        <textarea id="tpl_body" name="body" rows={4} required className={inputClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="tpl_examples" className="text-sm font-medium">
          Ejemplos de las variables (uno por línea, en orden)
        </label>
        <textarea id="tpl_examples" name="examples" rows={3} className={inputClass} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="tpl_footer" className="text-sm font-medium">
            Pie (opcional, hasta 60 caracteres)
          </label>
          <input id="tpl_footer" name="footer" type="text" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="tpl_buttons" className="text-sm font-medium">
            Botones de respuesta rápida (uno por línea, máx. 3)
          </label>
          <textarea id="tpl_buttons" name="buttons" rows={3} className={inputClass} />
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
      <div>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Enviando a Meta…" : "Crear plantilla de utilidad"}
        </button>
      </div>
    </form>
  );
}
