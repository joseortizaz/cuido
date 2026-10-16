"use client";

import { useActionState } from "react";
import { setRemindersEnabled, type WhatsAppSettingsState } from "./actions";

export function RemindersToggleForm({ enabled, disabled }: { enabled: boolean; disabled: boolean }) {
  const [state, formAction, pending] = useActionState<WhatsAppSettingsState, FormData>(setRemindersEnabled, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={enabled} disabled={disabled} className="mt-1" />
        <span>
          <strong>Enviar recordatorios de citas por WhatsApp</strong> a los pacientes que lo aceptaron.
        </span>
      </label>
      <div>
        <button
          type="submit"
          disabled={pending || disabled}
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </form>
  );
}
