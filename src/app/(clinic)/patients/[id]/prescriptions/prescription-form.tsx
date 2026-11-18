"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { MAX_RX_ITEMS, type RxItem } from "@/lib/domain/prescriptions";
import type { RxFormState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

/**
 * Formulario de una receta: lista de medicamentos (con autocompletado desde los medicamentos activos del
 * paciente) e indicaciones generales. Una receta emitida no se edita: se anula y se emite otra. Los campos son
 * controlados: React 19 vacía los no controlados tras cada envío, también cuando hay un error.
 */
export function PrescriptionForm({
  action,
  activeMedications,
  encounterId,
  cancelHref,
}: {
  action: (prev: RxFormState, formData: FormData) => Promise<RxFormState>;
  activeMedications: { name: string; dose: string | null; frequency: string | null }[];
  encounterId?: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<RxFormState, FormData>(action, undefined);
  const [rows, setRows] = useState<RxItem[]>([{ medication: "" }, { medication: "" }]);
  const [notes, setNotes] = useState("");
  const [addToActive, setAddToActive] = useState(false);

  const setRow = (i: number, k: keyof RxItem, v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));

  // Al elegir un medicamento activo se completan su dosis y frecuencia (editables).
  function onMedicationChange(i: number, value: string) {
    const match = activeMedications.find((m) => m.name.toLowerCase() === value.trim().toLowerCase());
    setRows((r) =>
      r.map((row, idx) =>
        idx === i
          ? { ...row, medication: value, ...(match && !row.dose && !row.frequency ? { dose: match.dose ?? "", frequency: match.frequency ?? "" } : {}) }
          : row
      )
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-2xl flex-col gap-5">
      {encounterId && <input type="hidden" name="encounter_id" value={encounterId} />}
      <datalist id="active-medications">
        {activeMedications.map((m) => (
          <option key={m.name} value={m.name} />
        ))}
      </datalist>

      <div className="flex flex-col gap-4">
        {rows.map((row, i) => (
          <fieldset key={i} className="flex flex-col gap-2 rounded-lg border border-panel-border p-3">
            <legend className="px-1 text-sm font-medium">Medicamento {i + 1}</legend>
            <input
              aria-label={`Medicamento ${i + 1}`}
              name={`rx_medication_${i}`}
              list="active-medications"
              maxLength={200}
              value={row.medication}
              onChange={(e) => onMedicationChange(i, e.target.value)}
              placeholder="Nombre y concentración (p. ej. Losartán 50 mg tabletas)"
              className={inputClass}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <input aria-label={`Dosis del medicamento ${i + 1}`} name={`rx_dose_${i}`} value={row.dose ?? ""} onChange={(e) => setRow(i, "dose", e.target.value)} maxLength={200} placeholder="Dosis (1 tableta)" className={inputClass} />
              <input aria-label={`Vía del medicamento ${i + 1}`} name={`rx_route_${i}`} value={row.route ?? ""} onChange={(e) => setRow(i, "route", e.target.value)} maxLength={200} placeholder="Vía (oral)" className={inputClass} />
              <input aria-label={`Frecuencia del medicamento ${i + 1}`} name={`rx_frequency_${i}`} value={row.frequency ?? ""} onChange={(e) => setRow(i, "frequency", e.target.value)} maxLength={200} placeholder="Frecuencia (cada 12 h)" className={inputClass} />
              <input aria-label={`Duración del medicamento ${i + 1}`} name={`rx_duration_${i}`} value={row.duration ?? ""} onChange={(e) => setRow(i, "duration", e.target.value)} maxLength={200} placeholder="Duración (30 días)" className={inputClass} />
              <input aria-label={`Cantidad del medicamento ${i + 1}`} name={`rx_quantity_${i}`} value={row.quantity ?? ""} onChange={(e) => setRow(i, "quantity", e.target.value)} maxLength={200} placeholder="Cantidad (60 tabletas)" className={inputClass} />
            </div>
            <input aria-label={`Indicaciones del medicamento ${i + 1}`} name={`rx_instructions_${i}`} value={row.instructions ?? ""} onChange={(e) => setRow(i, "instructions", e.target.value)} maxLength={500} placeholder="Indicaciones (con las comidas, etc.)" className={inputClass} />
          </fieldset>
        ))}
        {rows.length < MAX_RX_ITEMS && (
          <div>
            <button type="button" onClick={() => setRows((r) => [...r, { medication: "" }])} className="text-sm text-zinc-600 underline dark:text-zinc-400">
              Agregar otro medicamento
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-sm font-medium">
          Indicaciones generales (opcional)
        </label>
        <textarea id="notes" name="notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="add_to_active" checked={addToActive} onChange={(e) => setAddToActive(e.target.checked)} className="mt-1" />
        <span>Agregar estos medicamentos a los <strong>medicamentos activos</strong> del paciente (sin repetir los que ya están).</span>
      </label>

      <p className="text-xs text-zinc-500">
        Al emitirla, la receta recibe su número y <strong>ya no se edita</strong>: si hay un error se anula con un motivo y se emite otra. Se imprime en A6; la
        firmas y la sellas a mano.
      </p>

      {state?.error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {state.error}{" "}
          {state.profileIncomplete && (
            <Link href="/profile/professional" className="underline">
              Completar mis datos profesionales
            </Link>
          )}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {pending ? "Emitiendo…" : "Emitir receta"}
        </button>
        <Link href={cancelHref} className="text-sm text-zinc-500 hover:underline">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
