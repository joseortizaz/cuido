"use client";

import { useActionState } from "react";
import { CLINIC_BUSINESS_MODELS, DOMINICAN_PROVINCES } from "@/lib/domain/clinic";
import { createClinic, type OnboardingState } from "./actions";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    createClinic,
    undefined
  );

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium">
          Nombre de la clínica
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="province" className="text-sm font-medium">
          Provincia
        </label>
        <select
          id="province"
          name="province"
          required
          defaultValue=""
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400"
        >
          <option value="" disabled>
            Selecciona una provincia
          </option>
          {DOMINICAN_PROVINCES.map((province) => (
            <option key={province} value={province}>
              {province}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="business_model" className="text-sm font-medium">
          Modelo de negocio
        </label>
        <select
          id="business_model"
          name="business_model"
          required
          defaultValue=""
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400"
        >
          <option value="" disabled>
            Selecciona un modelo
          </option>
          {CLINIC_BUSINESS_MODELS.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>
      </div>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Creando…" : "Crear clínica"}
      </button>
    </form>
  );
}
