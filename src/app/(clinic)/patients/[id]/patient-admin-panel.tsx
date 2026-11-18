"use client";

import { useActionState, useState, useTransition } from "react";
import {
  deleteEmptyPatient,
  deleteTestPatient,
  setPatientTestFlag,
  unvoidPatient,
  voidPatient,
  type PatientAdminState,
} from "./admin-actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const buttonClass =
  "rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]";
const dangerClass =
  "rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950";

function Message({ state }: { state: PatientAdminState }) {
  if (state?.error) return <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>;
  if (state?.success) return <p className="text-sm text-green-700 dark:text-green-400">{state.success}</p>;
  return null;
}

/** Botón que ejecuta una acción de un solo paso (con confirmación opcional). */
function ActionButton({
  label,
  confirmText,
  danger,
  disabled,
  action,
}: {
  label: string;
  confirmText?: string;
  danger?: boolean;
  disabled: boolean;
  action: () => Promise<PatientAdminState>;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PatientAdminState>();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          disabled={pending || disabled}
          className={danger ? dangerClass : buttonClass}
          onClick={() => {
            if (confirmText && !window.confirm(confirmText)) return;
            startTransition(async () => setState(await action()));
          }}
        >
          {pending ? "Procesando…" : label}
        </button>
      </div>
      <Message state={state} />
    </div>
  );
}

export function PatientAdminPanel({
  patientId,
  patientName,
  isTest,
  isVoided,
  testBlockers,
  emptyBlockers,
  disabled,
}: {
  patientId: string;
  patientName: string;
  isTest: boolean;
  isVoided: boolean;
  testBlockers: string[];
  emptyBlockers: string[];
  /** Clínica en solo lectura. */
  disabled: boolean;
}) {
  const [voidState, voidAction, voidPending] = useActionState<PatientAdminState, FormData>(
    voidPatient.bind(null, patientId),
    undefined
  );
  const [delState, delAction, delPending] = useActionState<PatientAdminState, FormData>(
    deleteEmptyPatient.bind(null, patientId),
    undefined
  );

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-red-200 p-4 dark:border-red-900">
      {isTest ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Paciente de prueba</h3>
          {testBlockers.length > 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No se puede eliminar porque {testBlockers.join(" y ")}. Esos registros tienen valor fiscal y no se borran.
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Se elimina definitivamente con todas sus consultas, alergias, medicamentos, consentimientos y citas. Queda
                constancia de quién lo eliminó y cuándo.
              </p>
              <ActionButton
                danger
                label="Eliminar paciente de prueba"
                confirmText={`¿Eliminar definitivamente a ${patientName} y todo su expediente? Esta acción no se puede deshacer.`}
                disabled={disabled}
                action={() => deleteTestPatient(patientId)}
              />
            </>
          )}
          <ActionButton
            label="Quitar la marca de prueba"
            disabled={disabled}
            action={() => setPatientTestFlag(patientId, false)}
          />
        </div>
      ) : (
        <>
          {isVoided ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Paciente anulado</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Está oculto de listas, búsquedas y agenda. Al reactivarlo vuelve a aparecer; sus citas canceladas no se
                restauran.
              </p>
              <ActionButton label="Reactivar paciente" disabled={disabled} action={() => unvoidPatient(patientId)} />
            </div>
          ) : (
            <form action={voidAction} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Anular paciente</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Para pacientes reales con registros: deja de aparecer en listas, búsquedas y agenda, y se cancelan sus
                citas futuras. Sus datos se conservan y se puede reactivar.
              </p>
              <label htmlFor="void_reason" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Motivo (obligatorio)
              </label>
              <input id="void_reason" name="reason" required minLength={3} className={`${inputClass} max-w-md`} />
              <div>
                <button type="submit" disabled={voidPending || disabled} className={dangerClass}>
                  {voidPending ? "Anulando…" : "Anular paciente"}
                </button>
              </div>
              <Message state={voidState} />
            </form>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Eliminar (registrado por error)</h3>
            {emptyBlockers.length > 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No se puede eliminar porque {emptyBlockers.join(", ")}.{" "}
                {isVoided ? "" : "Anúlalo en su lugar."}
              </p>
            ) : (
              <form action={delAction} className="flex flex-col gap-2">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Este paciente no tiene actividad, así que puede eliminarse definitivamente. Para confirmar, escribe su
                  nombre completo: <strong>{patientName}</strong>. Queda constancia de quién lo eliminó y por qué.
                </p>
                <label htmlFor="confirm_name" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Nombre completo
                </label>
                <input id="confirm_name" name="confirm_name" required autoComplete="off" className={`${inputClass} max-w-md`} />
                <label htmlFor="delete_reason" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Motivo (obligatorio)
                </label>
                <input id="delete_reason" name="reason" required minLength={3} className={`${inputClass} max-w-md`} />
                <div>
                  <button type="submit" disabled={delPending || disabled} className={dangerClass}>
                    {delPending ? "Eliminando…" : "Eliminar paciente"}
                  </button>
                </div>
                <Message state={delState} />
              </form>
            )}
          </div>

          {!isVoided && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Paciente de prueba</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Si este paciente es ficticio, márcalo: se excluirá de exportaciones y reportes y podrás eliminarlo por
                completo. Su código actual no cambia.
              </p>
              <ActionButton
                label="Marcar como paciente de prueba"
                disabled={disabled}
                action={() => setPatientTestFlag(patientId, true)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
