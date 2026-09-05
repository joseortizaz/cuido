"use client";

import { useActionState } from "react";
import { createAppointment, type NewAppointmentActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const labelClass = "text-sm font-medium";

export function NewAppointmentForm({
  patients,
  providers,
  templates,
}: {
  patients: { id: string; label: string }[];
  providers: { id: string; label: string }[];
  templates: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<NewAppointmentActionState, FormData>(
    createAppointment,
    undefined
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="patient_id" className={labelClass}>
          Paciente
        </label>
        <select id="patient_id" name="patient_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecciona
          </option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="provider_id" className={labelClass}>
          Médico
        </label>
        <select id="provider_id" name="provider_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecciona
          </option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="specialty_template_id" className={labelClass}>
          Especialidad
        </label>
        <select id="specialty_template_id" name="specialty_template_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Selecciona
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="date" className={labelClass}>
            Fecha
          </label>
          <input id="date" name="date" type="date" required defaultValue={today} className={inputClass} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="time" className={labelClass}>
            Hora
          </label>
          <input id="time" name="time" type="time" required className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="reason" className={labelClass}>
          Motivo (opcional)
        </label>
        <input id="reason" name="reason" type="text" className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="appointment_type" className={labelClass}>
          Tipo de evento
        </label>
        <select
          id="appointment_type"
          name="appointment_type"
          required
          defaultValue="consulta"
          className={inputClass}
        >
          <option value="consulta">Consulta ambulatoria</option>
          <option value="procedimiento_quirurgico">Procedimiento quirúrgico</option>
        </select>
      </div>

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Agendando…" : "Agendar cita"}
      </button>
    </form>
  );
}
