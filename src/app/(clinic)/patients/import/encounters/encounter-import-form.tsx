"use client";

import { useActionState, useState } from "react";
import { uploadEncounterImport, type UploadEncounterImportState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function EncounterImportForm({ templates }: { templates: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<UploadEncounterImportState, FormData>(
    uploadEncounterImport,
    undefined
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="specialty_template_id" className="text-sm font-medium">
          Especialidad
        </label>
        <select
          id="specialty_template_id"
          name="specialty_template_id"
          required
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          className={inputClass}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {selectedTemplateId && (
          // <a> normal, no <Link>: descarga un archivo (Route Handler), no navega a una página.
          <a
            href={`/patients/import/template/encounters/${selectedTemplateId}`}
            className="mt-1 self-start text-sm text-brand-blue hover:underline"
          >
            Descargar plantilla de {templates.find((t) => t.id === selectedTemplateId)?.name}
          </a>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="text-sm font-medium">
          Archivo (.xlsx o .csv)
        </label>
        <input id="file" name="file" type="file" accept=".xlsx,.csv" required className={inputClass} />
      </div>

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Procesando…" : "Subir y revisar"}
      </button>
    </form>
  );
}
