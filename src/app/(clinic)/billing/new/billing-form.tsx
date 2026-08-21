"use client";

import { useActionState, useState } from "react";
import { generateFiscalDocument, type BillingActionState } from "../actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

const ITBIS_OPTIONS = [
  { value: "1", label: "ITBIS 18%" },
  { value: "2", label: "ITBIS 16%" },
  { value: "3", label: "ITBIS 0%" },
  { value: "E", label: "Exento" },
  { value: "0", label: "No facturable" },
] as const;

let nextRowId = 0;
function newRow() {
  nextRowId += 1;
  return { id: nextRowId };
}

export function BillingForm({
  patientId,
  patientName,
  encounterId,
}: {
  patientId: string;
  patientName: string;
  encounterId?: string;
}) {
  const generateForPatientEncounter = generateFiscalDocument.bind(null, patientId, encounterId ?? null);
  const [state, formAction, pending] = useActionState<BillingActionState, FormData>(
    generateForPatientEncounter,
    undefined
  );

  const [rows, setRows] = useState([newRow(), newRow()]);

  return (
    <form action={formAction} className="flex w-full max-w-2xl flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="comprador_nombre" className="text-sm font-medium">
            Nombre del comprador
          </label>
          <input
            id="comprador_nombre"
            name="comprador_nombre"
            type="text"
            required
            defaultValue={patientName}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="comprador_rnc_cedula" className="text-sm font-medium">
            RNC/Cédula (opcional bajo RD$250,000)
          </label>
          <input id="comprador_rnc_cedula" name="comprador_rnc_cedula" type="text" className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="comprador_email" className="text-sm font-medium">
            Correo (opcional)
          </label>
          <input id="comprador_email" name="comprador_email" type="email" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="comprador_direccion" className="text-sm font-medium">
            Dirección (opcional)
          </label>
          <input id="comprador_direccion" name="comprador_direccion" type="text" className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Líneas</h2>
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-end gap-2">
              <input
                name="item_description"
                type="text"
                placeholder="Descripción"
                className={`${inputClass} flex-1 basis-48`}
              />
              <input
                name="item_quantity"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={1}
                placeholder="Cant."
                className={`${inputClass} w-20`}
              />
              <input
                name="item_unit_price"
                type="number"
                min="0"
                step="0.01"
                placeholder="Precio"
                className={`${inputClass} w-28`}
              />
              <select name="item_itbis_indicator" defaultValue="1" className={inputClass}>
                {ITBIS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRows((r) => [...r, newRow()])}
          className="self-start rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] dark:border-zinc-700 dark:hover:bg-white/[.08]"
        >
          + Agregar línea
        </button>
      </div>

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Generando…" : "Generar e-CF"}
      </button>
    </form>
  );
}
