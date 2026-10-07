"use client";

import { useActionState } from "react";
import { saveInsurer, type InsurerActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const buttonClass =
  "rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";

export function InsurerForm({
  insurerId,
  name,
  aliases,
  isActive,
}: {
  insurerId: string | null;
  name: string;
  aliases: string[];
  isActive: boolean;
}) {
  const bound = saveInsurer.bind(null, insurerId);
  const [state, formAction, pending] = useActionState<InsurerActionState, FormData>(bound, undefined);
  const idSuffix = insurerId ?? "new";

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={`name_${idSuffix}`} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Nombre
        </label>
        <input id={`name_${idSuffix}`} name="name" type="text" required defaultValue={name} className={`${inputClass} w-52`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`aliases_${idSuffix}`} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Alias (separados por coma)
        </label>
        <input
          id={`aliases_${idSuffix}`}
          name="aliases"
          type="text"
          defaultValue={aliases.join(", ")}
          className={`${inputClass} w-64`}
        />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="is_active" defaultChecked={isActive} /> Activa
      </label>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Guardando…" : insurerId ? "Guardar" : "Agregar"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </form>
  );
}
