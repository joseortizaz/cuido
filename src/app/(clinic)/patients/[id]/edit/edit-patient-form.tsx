"use client";

import { useActionState, useState } from "react";
import { samePhone } from "@/lib/domain/phone";
import { updatePatient, type EditPatientState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

type Initial = {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  sex: string;
  national_id: string;
  phone: string;
  email: string;
};

export function EditPatientForm({
  patientId,
  initial,
  hasActiveConsent,
}: {
  patientId: string;
  initial: Initial;
  /** El paciente tiene un consentimiento de WhatsApp vigente (de su teléfono actual). */
  hasActiveConsent: boolean;
}) {
  const [state, formAction, pending] = useActionState<EditPatientState, FormData>(
    updatePatient.bind(null, patientId),
    undefined
  );
  const [phone, setPhone] = useState(initial.phone);
  const phoneChanged = phone.trim() !== initial.phone.trim() && !samePhone(phone, initial.phone);

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="first_name" className="text-sm font-medium">
            Nombre
          </label>
          <input id="first_name" name="first_name" type="text" required defaultValue={initial.first_name} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="last_name" className="text-sm font-medium">
            Apellido
          </label>
          <input id="last_name" name="last_name" type="text" required defaultValue={initial.last_name} className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="date_of_birth" className="text-sm font-medium">
            Fecha de nacimiento
          </label>
          <input
            id="date_of_birth"
            name="date_of_birth"
            type="date"
            required
            defaultValue={initial.date_of_birth}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sex" className="text-sm font-medium">
            Sexo
          </label>
          <select id="sex" name="sex" required defaultValue={initial.sex} className={inputClass}>
            <option value="femenino">Femenino</option>
            <option value="masculino">Masculino</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="national_id" className="text-sm font-medium">
          Cédula / pasaporte (opcional)
        </label>
        <input id="national_id" name="national_id" type="text" defaultValue={initial.national_id} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="phone" className="text-sm font-medium">
            Teléfono (opcional)
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Correo (opcional)
          </label>
          <input id="email" name="email" type="email" defaultValue={initial.email} className={inputClass} />
        </div>
      </div>
      {hasActiveConsent && phoneChanged && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Este paciente aceptó recordatorios por WhatsApp al número anterior. Al guardar, ese consentimiento se revoca y
          habrá que registrar uno nuevo para el número actual.
        </p>
      )}
      <p className="text-xs text-zinc-500">
        Cada cambio queda registrado en el historial del paciente (quién, cuándo, valor anterior y nuevo). El código del
        paciente no se modifica.
      </p>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Guardando…" : "Guardar cambios"}
      </button>
    </form>
  );
}
