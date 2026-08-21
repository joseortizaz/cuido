"use client";

import { useActionState } from "react";
import { upsertFiscalProfile, type FiscalActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

type Profile = {
  rnc: string;
  business_name: string;
  commercial_name: string | null;
  fiscal_address: string;
  economic_activity: string;
  phone: string | null;
  email: string | null;
};

export function FiscalProfileForm({ profile }: { profile: Profile | null }) {
  const [state, formAction, pending] = useActionState<FiscalActionState, FormData>(
    upsertFiscalProfile,
    undefined
  );

  return (
    <form action={formAction} className="flex w-full max-w-lg flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="rnc" className="text-sm font-medium">
            RNC (o cédula)
          </label>
          <input id="rnc" name="rnc" type="text" required defaultValue={profile?.rnc ?? ""} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="business_name" className="text-sm font-medium">
            Razón social
          </label>
          <input
            id="business_name"
            name="business_name"
            type="text"
            required
            defaultValue={profile?.business_name ?? ""}
            className={inputClass}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="commercial_name" className="text-sm font-medium">
          Nombre comercial (opcional)
        </label>
        <input
          id="commercial_name"
          name="commercial_name"
          type="text"
          defaultValue={profile?.commercial_name ?? ""}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="fiscal_address" className="text-sm font-medium">
          Dirección fiscal
        </label>
        <input
          id="fiscal_address"
          name="fiscal_address"
          type="text"
          required
          defaultValue={profile?.fiscal_address ?? ""}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="economic_activity" className="text-sm font-medium">
          Actividad económica
        </label>
        <input
          id="economic_activity"
          name="economic_activity"
          type="text"
          required
          defaultValue={profile?.economic_activity ?? ""}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="phone" className="text-sm font-medium">
            Teléfono (opcional)
          </label>
          <input id="phone" name="phone" type="tel" defaultValue={profile?.phone ?? ""} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Correo (opcional)
          </label>
          <input id="email" name="email" type="email" defaultValue={profile?.email ?? ""} className={inputClass} />
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Guardando…" : "Guardar datos fiscales"}
      </button>
    </form>
  );
}
