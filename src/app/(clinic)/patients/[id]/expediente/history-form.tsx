"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { HistorySection } from "@/lib/domain/medical-history";
import type { HistoryFormState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

/**
 * Formulario de la historia general. Sirve para abrir el expediente (todas las secciones, todo opcional)
 * y para completar/corregir una sección (con motivo opcional del ajuste). Los campos son controlados:
 * React 19 vacía los no controlados tras cada envío, también cuando hay un error.
 */
export function HistoryForm({
  action,
  sections,
  initialValues,
  submitLabel,
  cancelHref,
  withReason,
}: {
  action: (prev: HistoryFormState, formData: FormData) => Promise<HistoryFormState>;
  sections: HistorySection[];
  initialValues: Record<string, string>;
  submitLabel: string;
  cancelHref: string;
  withReason: boolean;
}) {
  const [state, formAction, pending] = useActionState<HistoryFormState, FormData>(action, undefined);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [reason, setReason] = useState("");

  return (
    <form action={formAction} className="flex w-full max-w-2xl flex-col gap-6">
      {sections.map((section) => (
        <fieldset key={section.id} className="flex flex-col gap-3 rounded-lg border border-panel-border p-4">
          <legend className="px-1 text-sm font-semibold">{section.title}</legend>
          {section.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              {section.fields.length > 1 && (
                <label htmlFor={field.key} className="text-sm font-medium">
                  {field.label}
                </label>
              )}
              <textarea
                id={field.key}
                name={field.key}
                rows={field.rows ?? 3}
                maxLength={5000}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                aria-label={section.fields.length > 1 ? undefined : field.label}
                className={inputClass}
              />
              {field.hint && <p className="text-xs text-zinc-500">{field.hint}</p>}
            </div>
          ))}
        </fieldset>
      ))}

      {withReason && (
        <div className="flex flex-col gap-1">
          <label htmlFor="reason" className="text-sm font-medium">
            Motivo del ajuste (opcional)
          </label>
          <input
            id="reason"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="Por qué se completa o corrige"
            className={inputClass}
          />
          <p className="text-xs text-zinc-500">
            Cada ajuste queda registrado (quién, cuándo, valor anterior y nuevo) y nunca se borra.
          </p>
        </div>
      )}

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {pending ? "Guardando…" : submitLabel}
        </button>
        <Link href={cancelHref} className="text-sm text-zinc-500 hover:underline">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
