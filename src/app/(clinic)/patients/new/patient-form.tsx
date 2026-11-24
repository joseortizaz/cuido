"use client";

import { useActionState, useState, useTransition } from "react";
import { EMPTY_IDENTITY, IdentityFields, inputClass, type IdentityForm } from "../_components/identity-fields";
import { createPatient, type PatientFormState } from "./actions";

export function PatientForm({
  canRecordConsent = false,
  canEditReligion = false,
}: {
  canRecordConsent?: boolean;
  /** Administradores y médicos: la religión es un dato sensible y recepción no la ve. */
  canEditReligion?: boolean;
}) {
  const [state, formAction, pending] = useActionState<PatientFormState, FormData>(createPatient, undefined);

  // Todo en estado: si el servidor rechaza el envío (p. ej. cédula repetida), React 19 vacía los campos no
  // controlados y con tantos campos sería perder todo lo escrito.
  // El envío se hace a mano (no con <form action={…}>): React 19 vacía el formulario al terminar la acción y, en un
  // <select>, lo vuelve a la primera opción aunque el estado diga otra; con tantos campos sería perder lo escrito.
  const [, startTransition] = useTransition();
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  const [identity, setIdentity] = useState<IdentityForm>(EMPTY_IDENTITY);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [consent, setConsent] = useState(false);
  const [source, setSource] = useState("verbal");

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-3xl flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-base font-semibold">Identificación</legend>
        <IdentityFields value={identity} onChange={(patch) => setIdentity((p) => ({ ...p, ...patch }))} canEditReligion={canEditReligion} />
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
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="is_test" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} className="mt-1" />
          <span>
            <strong>Paciente de prueba (datos ficticios).</strong> Recibe un código PRUEBA-NNN, no gasta el consecutivo real
            y se excluye de exportaciones y reportes. El administrador puede eliminarlo después.
          </span>
        </label>
        {canRecordConsent && (
          <fieldset className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <legend className="px-1 text-sm font-medium">Recordatorios por WhatsApp (opcional)</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="whatsapp_consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
              <span>
                El paciente aceptó recibir recordatorios de sus citas por WhatsApp al teléfono indicado arriba, y sabe que
                puede dejar de recibirlos respondiendo BAJA.
              </span>
            </label>
            <select name="whatsapp_source" value={source} onChange={(e) => setSource(e.target.value)} className={inputClass} aria-label="Cómo aceptó">
              <option value="verbal">Aceptó verbalmente</option>
              <option value="escrito">Aceptó por escrito</option>
              <option value="otro">Otro</option>
            </select>
          </fieldset>
        )}
      </fieldset>

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Guardando…" : "Crear paciente"}
      </button>
    </form>
  );
}
