"use client";

import { useActionState } from "react";
import { addClaimDiagnosis, removeClaimDiagnosis, type ClaimActionState } from "./actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";

export type DiagnosisRow = {
  id: string;
  code_system: string;
  code: string;
  description: string;
  is_primary: boolean;
};

function RemoveButton({ claimId, diagnosisId }: { claimId: string; diagnosisId: string }) {
  const bound = removeClaimDiagnosis.bind(null, claimId, diagnosisId);
  const [state, formAction, pending] = useActionState<ClaimActionState>(bound, undefined);
  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-zinc-500 underline disabled:opacity-50"
        aria-label="Quitar diagnóstico"
      >
        quitar
      </button>
      {state?.error && <span className="ml-1 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/**
 * Diagnósticos codificados de la reclamación (CIE-10 por defecto, CIE-11
 * permitido). El diagnóstico escrito por el médico se muestra de referencia.
 */
export function ClaimDiagnoses({
  claimId,
  diagnoses,
  reference,
  editable,
}: {
  claimId: string;
  diagnoses: DiagnosisRow[];
  reference: string[];
  editable: boolean;
}) {
  const boundAdd = addClaimDiagnosis.bind(null, claimId);
  const [state, formAction, pending] = useActionState<ClaimActionState, FormData>(boundAdd, undefined);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Diagnósticos codificados</p>
      {reference.length > 0 && (
        <p className="text-xs text-zinc-500">Diagnóstico del médico: {reference.join(" · ")}</p>
      )}
      {diagnoses.length === 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Sin diagnóstico codificado: hace falta al menos uno para marcar la reclamación como enviada.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-xs">
          {diagnoses.map((d) => (
            <li key={d.id}>
              <strong>{d.code}</strong> <span className="text-zinc-500">({d.code_system})</span> — {d.description}
              {d.is_primary && <span className="ml-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">principal</span>}
              {editable && (
                <>
                  {" "}
                  <RemoveButton claimId={claimId} diagnosisId={d.id} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <select name="code_system" defaultValue="CIE-10" aria-label="Sistema de codificación" className={inputClass}>
            <option value="CIE-10">CIE-10</option>
            <option value="CIE-11">CIE-11</option>
          </select>
          <input name="code" type="text" required placeholder="Código (J00, E11.9)" aria-label="Código del diagnóstico" className={`${inputClass} w-36`} />
          <input name="description" type="text" required placeholder="Descripción" aria-label="Descripción del diagnóstico" className={`${inputClass} w-56`} />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="is_primary" /> principal
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]"
          >
            {pending ? "…" : "Agregar diagnóstico"}
          </button>
          {state?.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
        </form>
      )}
    </div>
  );
}
