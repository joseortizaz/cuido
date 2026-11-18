"use client";

import { useActionState, useState } from "react";
import { STUDY_CATEGORIES, STUDY_CATEGORY_LABELS } from "@/lib/domain/study-results";
import { orderStudyFromEncounter, type StudyFormState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

/** Indicar un estudio desde una consulta: queda «pendiente» en el expediente hasta que llegue el resultado. */
export function OrderStudyForm({ patientId, encounterId }: { patientId: string; encounterId: string }) {
  const [state, action, pending] = useActionState<StudyFormState, FormData>(
    orderStudyFromEncounter.bind(null, patientId, encounterId),
    undefined
  );
  const [category, setCategory] = useState("laboratorio");
  const [name, setName] = useState("");
  return (
    <form
      action={async (formData) => {
        await action(formData);
        setName("");
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="order_category" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Categoría
        </label>
        <select id="order_category" name="category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
          {STUDY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {STUDY_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label htmlFor="order_name" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Estudio a indicar
        </label>
        <input id="order_name" name="study_name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="Hemograma, radiografía de tórax…" className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
      >
        {pending ? "Indicando…" : "Indicar estudio"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>}
    </form>
  );
}
