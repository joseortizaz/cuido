"use client";

import { useActionState, useState } from "react";
import { samePhone } from "@/lib/domain/phone";
import { IdentityFields, inputClass, type IdentityForm } from "../../_components/identity-fields";
import { updatePatient, type EditPatientState } from "./actions";

type Initial = IdentityForm & {
  phone: string;
  email: string;
};

export function EditPatientForm({
  patientId,
  initial,
  hasActiveConsent,
  hasReligionOnFile,
}: {
  patientId: string;
  initial: Initial;
  /** El paciente tiene un consentimiento de WhatsApp vigente (de su teléfono actual). */
  hasActiveConsent: boolean;
  /** Ya hay una religión guardada (no se puede volver a «sin indicar»; se cambia por otra opción). */
  hasReligionOnFile: boolean;
}) {
  const [state, formAction, pending] = useActionState<EditPatientState, FormData>(
    updatePatient.bind(null, patientId),
    undefined
  );
  // Campos controlados: si el servidor rechaza el envío, React 19 vacía los no controlados.
  const [identity, setIdentity] = useState<IdentityForm>({
    first_name: initial.first_name,
    last_name: initial.last_name,
    national_id: initial.national_id,
    date_of_birth: initial.date_of_birth,
    sex: initial.sex,
    education_level: initial.education_level,
    marital_status: initial.marital_status,
    residence: initial.residence,
    place_of_origin: initial.place_of_origin,
    occupation: initial.occupation,
    informant_type: initial.informant_type,
    informant_name: initial.informant_name,
    religion: initial.religion,
    religion_other: initial.religion_other,
  });
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const phoneChanged = phone.trim() !== initial.phone.trim() && !samePhone(phone, initial.phone);

  return (
    <form action={formAction} className="flex w-full max-w-3xl flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-base font-semibold">Identificación</legend>
        <IdentityFields
          value={identity}
          onChange={(patch) => setIdentity((p) => ({ ...p, ...patch }))}
          canEditReligion
          hasReligionOnFile={hasReligionOnFile}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-base font-semibold">Contacto</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="phone" className="text-sm font-medium">
              Teléfono (opcional)
            </label>
            <input id="phone" name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium">
              Correo (opcional)
            </label>
            <input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </div>
        </div>
        {hasActiveConsent && phoneChanged && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Este paciente aceptó recordatorios por WhatsApp al número anterior. Al guardar, ese consentimiento se revoca y
            habrá que registrar uno nuevo para el número actual.
          </p>
        )}
      </fieldset>

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
