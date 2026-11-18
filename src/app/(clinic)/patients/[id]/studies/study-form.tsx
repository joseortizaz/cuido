"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { STUDY_CATEGORIES, STUDY_CATEGORY_LABELS, type StudyValue } from "@/lib/domain/study-results";
import type { StudyFormState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const smallInput = `${inputClass} w-full`;

export type StudyFormInitial = {
  category: string;
  study_name: string;
  ordered_at: string;
  performed_at: string;
  status: "pendiente" | "recibido";
  result_text: string;
  interpretation: string;
  values: StudyValue[];
};

/**
 * Formulario de un estudio: sirve para registrar un resultado (o solo indicar el estudio) y para completar o
 * corregir uno existente (con motivo, obligatorio si el resultado ya estaba recibido). Los campos son
 * controlados: React 19 vacía los no controlados tras cada envío, también cuando hay un error.
 */
export function StudyForm({
  action,
  initial,
  mode,
  cancelHref,
  encounterId,
}: {
  action: (prev: StudyFormState, formData: FormData) => Promise<StudyFormState>;
  initial: StudyFormInitial;
  mode: "new" | "edit";
  cancelHref: string;
  encounterId?: string;
}) {
  const [state, formAction, pending] = useActionState<StudyFormState, FormData>(action, undefined);
  const [f, setF] = useState(initial);
  const [rows, setRows] = useState<StudyValue[]>(
    initial.values.length > 0 ? initial.values : [{ name: "", value: "" }, { name: "", value: "" }, { name: "", value: "" }]
  );
  const [reason, setReason] = useState("");
  const wasReceived = mode === "edit" && initial.status === "recibido";
  const set = (k: keyof StudyFormInitial) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setRow = (i: number, k: keyof StudyValue, v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));

  return (
    <form action={formAction} className="flex w-full max-w-2xl flex-col gap-5">
      {encounterId && <input type="hidden" name="encounter_id" value={encounterId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="category" className="text-sm font-medium">
            Categoría
          </label>
          <select id="category" name="category" required value={f.category} onChange={set("category")} className={inputClass}>
            <option value="" disabled>
              Selecciona
            </option>
            {STUDY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {STUDY_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="study_name" className="text-sm font-medium">
            Estudio
          </label>
          <input
            id="study_name"
            name="study_name"
            required
            maxLength={200}
            value={f.study_name}
            onChange={set("study_name")}
            placeholder="Hemograma, radiografía de tórax…"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ordered_at" className="text-sm font-medium">
            Fecha de indicación
          </label>
          <input id="ordered_at" name="ordered_at" type="date" value={f.ordered_at} onChange={set("ordered_at")} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="performed_at" className="text-sm font-medium">
            Fecha de realización
          </label>
          <input id="performed_at" name="performed_at" type="date" value={f.performed_at} onChange={set("performed_at")} className={inputClass} />
        </div>
      </div>

      {mode === "new" ? (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium">¿Qué registras?</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              value="recibido"
              checked={f.status === "recibido"}
              onChange={() => setF((p) => ({ ...p, status: "recibido" }))}
            />
            El resultado (ya lo tengo)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              value="pendiente"
              checked={f.status === "pendiente"}
              onChange={() => setF((p) => ({ ...p, status: "pendiente" }))}
            />
            Solo indicar el estudio (queda pendiente hasta que llegue el resultado)
          </label>
        </fieldset>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-sm font-medium">
            Estado
          </label>
          <select
            id="status"
            name="status"
            value={f.status}
            onChange={(e) => setF((p) => ({ ...p, status: e.target.value as "pendiente" | "recibido" }))}
            className={`${inputClass} max-w-xs`}
          >
            <option value="pendiente">Pendiente</option>
            <option value="recibido">Recibido</option>
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="result_text" className="text-sm font-medium">
          Resultado
        </label>
        <textarea id="result_text" name="result_text" rows={4} maxLength={10000} value={f.result_text} onChange={set("result_text")} className={inputClass} />
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-panel-border p-3">
        <legend className="px-1 text-sm font-medium">Valores (opcional)</legend>
        <p className="text-xs text-zinc-500">Cada valor con su unidad y su rango de referencia, si aplica.</p>
        <div className="hidden grid-cols-[2fr_1fr_1fr_1.4fr] gap-2 text-xs text-zinc-500 sm:grid">
          <span>Nombre</span>
          <span>Valor</span>
          <span>Unidad</span>
          <span>Rango de referencia</span>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1.4fr]">
            <input aria-label={`Nombre del valor ${i + 1}`} name={`value_name_${i}`} value={row.name} onChange={(e) => setRow(i, "name", e.target.value)} maxLength={100} placeholder="Glucosa" className={smallInput} />
            <input aria-label={`Valor ${i + 1}`} name={`value_value_${i}`} value={row.value} onChange={(e) => setRow(i, "value", e.target.value)} maxLength={200} placeholder="98" className={smallInput} />
            <input aria-label={`Unidad del valor ${i + 1}`} name={`value_unit_${i}`} value={row.unit ?? ""} onChange={(e) => setRow(i, "unit", e.target.value)} maxLength={30} placeholder="mg/dL" className={smallInput} />
            <input aria-label={`Rango de referencia del valor ${i + 1}`} name={`value_range_${i}`} value={row.reference_range ?? ""} onChange={(e) => setRow(i, "reference_range", e.target.value)} maxLength={100} placeholder="70-100" className={smallInput} />
          </div>
        ))}
        {rows.length < 100 && (
          <div>
            <button type="button" onClick={() => setRows((r) => [...r, { name: "", value: "" }])} className="text-sm text-zinc-600 underline dark:text-zinc-400">
              Agregar otro valor
            </button>
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="interpretation" className="text-sm font-medium">
          Interpretación del médico
        </label>
        <textarea id="interpretation" name="interpretation" rows={3} maxLength={5000} value={f.interpretation} onChange={set("interpretation")} className={inputClass} />
      </div>

      {mode === "edit" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="reason" className="text-sm font-medium">
            Motivo del ajuste{wasReceived ? " (obligatorio: el resultado ya estaba recibido)" : " (opcional)"}
          </label>
          <input id="reason" name="reason" required={wasReceived} minLength={wasReceived ? 3 : undefined} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          <p className="text-xs text-zinc-500">Cada ajuste queda registrado (quién, cuándo, antes y después) y nunca se borra.</p>
        </div>
      )}

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {pending ? "Guardando…" : mode === "new" ? "Guardar estudio" : "Guardar ajuste"}
        </button>
        <Link href={cancelHref} className="text-sm text-zinc-500 hover:underline">
          Cancelar
        </Link>
      </div>
      {mode === "new" && <p className="text-xs text-zinc-500">Después de guardar podrás adjuntar los archivos del resultado (PDF, JPG o PNG, hasta 10 MB cada uno).</p>}
    </form>
  );
}
