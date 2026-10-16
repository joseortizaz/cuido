"use client";

import { useActionState } from "react";
import {
  grantWhatsAppConsent,
  revokeWhatsAppConsent,
  updatePatientContact,
  type WhatsAppFormState,
} from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const buttonClass =
  "rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]";

function Message({ state }: { state: WhatsAppFormState }) {
  if (state?.error) return <p className="w-full text-sm text-red-600 dark:text-red-400">{state.error}</p>;
  if (state?.success) return <p className="w-full text-sm text-green-700 dark:text-green-400">{state.success}</p>;
  return null;
}

/** Teléfono y correo del paciente (el consentimiento de WhatsApp es de ESE número). */
export function ContactForm({
  patientId,
  phone,
  email,
}: {
  patientId: string;
  phone: string;
  email: string;
}) {
  const [state, formAction, pending] = useActionState<WhatsAppFormState, FormData>(
    updatePatientContact.bind(null, patientId),
    undefined
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="contact_phone" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Teléfono
        </label>
        <input id="contact_phone" name="phone" type="tel" defaultValue={phone} placeholder="809-555-1234" className={`${inputClass} w-44`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="contact_email" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Correo
        </label>
        <input id="contact_email" name="email" type="email" defaultValue={email} className={`${inputClass} w-56`} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Guardando…" : "Guardar contacto"}
      </button>
      <Message state={state} />
    </form>
  );
}

/** Registrar el consentimiento (el paciente aceptó, verbal o por escrito). */
export function GrantConsentForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState<WhatsAppFormState, FormData>(
    grantWhatsAppConsent.bind(null, patientId),
    undefined
  );
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="mt-1" />
        <span>
          El paciente aceptó recibir <strong>recordatorios de sus citas por WhatsApp</strong> al teléfono de su ficha, y
          sabe que puede dejar de recibirlos respondiendo BAJA.
        </span>
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="consent_source" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Cómo aceptó
          </label>
          <select id="consent_source" name="source" defaultValue="" required className={inputClass}>
            <option value="" disabled>
              Selecciona
            </option>
            <option value="verbal">Verbalmente (en recepción o por teléfono)</option>
            <option value="escrito">Por escrito (formulario o papel)</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Registrando…" : "Registrar consentimiento"}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function RevokeConsentButton({ patientId, consentId }: { patientId: string; consentId: string }) {
  const [state, formAction, pending] = useActionState<WhatsAppFormState, FormData>(
    revokeWhatsAppConsent.bind(null, patientId, consentId),
    undefined
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Revocando…" : "Revocar consentimiento"}
      </button>
      <Message state={state} />
    </form>
  );
}
