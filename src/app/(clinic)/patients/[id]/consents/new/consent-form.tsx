"use client";

import { useActionState, useState } from "react";
import { signConsent, type ConsentActionState } from "../actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

type Template = { id: string; title: string; body: string };
type EncounterOption = { id: string; label: string };

export function ConsentForm({
  patientId,
  templates,
  encounters,
  defaultEncounterId,
}: {
  patientId: string;
  templates: Template[];
  encounters: EncounterOption[];
  defaultEncounterId?: string;
}) {
  const signConsentForPatient = signConsent.bind(null, patientId);
  const [state, formAction, pending] = useActionState<ConsentActionState, FormData>(
    signConsentForPatient,
    undefined
  );

  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "");
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  if (templates.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No hay plantillas de consentimiento activas configuradas todavía.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="consent_template_id" className="text-sm font-medium">
          Tipo de consentimiento
        </label>
        <select
          id="consent_template_id"
          name="consent_template_id"
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          className={inputClass}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>

      {selectedTemplate && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Texto que verá y firmará el paciente
          </span>
          <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-900">
            {selectedTemplate.body}
          </div>
        </div>
      )}

      {encounters.length > 0 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="encounter_id" className="text-sm font-medium">
            Asociar a una consulta (opcional)
          </label>
          <select
            id="encounter_id"
            name="encounter_id"
            defaultValue={defaultEncounterId ?? ""}
            className={inputClass}
          >
            <option value="">— Sin asociar a una consulta —</option>
            {encounters.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="signer_name" className="text-sm font-medium">
            Nombre de quien firma
          </label>
          <input id="signer_name" name="signer_name" type="text" required className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="signer_national_id" className="text-sm font-medium">
            Cédula (opcional)
          </label>
          <input id="signer_national_id" name="signer_national_id" type="text" className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="signer_relationship" className="text-sm font-medium">
          Quien firma es...
        </label>
        <select
          id="signer_relationship"
          name="signer_relationship"
          defaultValue="paciente"
          className={inputClass}
        >
          <option value="paciente">El propio paciente</option>
          <option value="tutor">Tutor</option>
          <option value="representante">Representante</option>
        </select>
      </div>

      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        {pending ? "Firmando…" : "Firmar consentimiento"}
      </button>
    </form>
  );
}
