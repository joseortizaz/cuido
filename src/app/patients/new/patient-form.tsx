"use client";

import { useActionState } from "react";
import { createPatient, type PatientFormState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export function PatientForm() {
  const [state, formAction, pending] = useActionState<PatientFormState, FormData>(
    createPatient,
    undefined
  );

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="first_name" className="text-sm font-medium">
            Nombre
          </label>
          <input id="first_name" name="first_name" type="text" required className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="last_name" className="text-sm font-medium">
            Apellido
          </label>
          <input id="last_name" name="last_name" type="text" required className={inputClass} />
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
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sex" className="text-sm font-medium">
            Sexo
          </label>
          <select id="sex" name="sex" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Selecciona
            </option>
            <option value="femenino">Femenino</option>
            <option value="masculino">Masculino</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="national_id" className="text-sm font-medium">
          Cédula / pasaporte (opcional)
        </label>
        <input id="national_id" name="national_id" type="text" className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="phone" className="text-sm font-medium">
            Teléfono (opcional)
          </label>
          <input id="phone" name="phone" type="tel" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Correo (opcional)
          </label>
          <input id="email" name="email" type="email" className={inputClass} />
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Guardando…" : "Crear paciente"}
      </button>
    </form>
  );
}
