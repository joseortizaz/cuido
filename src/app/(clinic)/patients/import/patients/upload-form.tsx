"use client";

import { useActionState } from "react";
import { uploadPatientImport, type UploadPatientImportState } from "./actions";

export function UploadPatientImportForm() {
  const [state, formAction, pending] = useActionState<UploadPatientImportState, FormData>(
    uploadPatientImport,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="text-sm font-medium">
          Archivo (.xlsx o .csv)
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,.csv"
          required
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400"
        />
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
