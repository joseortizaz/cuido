"use client";

import { useActionState, useState } from "react";
import { updateProfessionalProfile, type RxFormState } from "@/app/(clinic)/patients/[id]/prescriptions/actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function ProfessionalForm({
  initial,
  disabled,
}: {
  initial: { name: string; title: string; exequatur: string };
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<RxFormState, FormData>(updateProfessionalProfile, undefined);
  const [f, setF] = useState(initial);
  return (
    <form action={action} className="flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="professional_name" className="text-sm font-medium">
          Nombre como saldrá en la receta
        </label>
        <input id="professional_name" name="professional_name" required minLength={3} maxLength={120} value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="Dr. Juan Pérez" disabled={disabled} className={inputClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="professional_title" className="text-sm font-medium">
          Especialidad (opcional)
        </label>
        <input id="professional_title" name="professional_title" maxLength={120} value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} placeholder="Medicina Interna y Nutrición Clínica" disabled={disabled} className={inputClass} />
        <p className="text-xs text-zinc-500">Texto libre: así figura debajo de tu nombre.</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="exequatur" className="text-sm font-medium">
          Exequátur
        </label>
        <input id="exequatur" name="exequatur" required minLength={3} maxLength={30} value={f.exequatur} onChange={(e) => setF((p) => ({ ...p, exequatur: e.target.value }))} disabled={disabled} className={inputClass} />
      </div>
      <p className="text-xs text-zinc-500">
        Estos datos se imprimen al pie de cada receta y quedan copiados en la receta al emitirla (si los cambias, las recetas ya emitidas no cambian).
      </p>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
      <div>
        <button
          type="submit"
          disabled={pending || disabled}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}
