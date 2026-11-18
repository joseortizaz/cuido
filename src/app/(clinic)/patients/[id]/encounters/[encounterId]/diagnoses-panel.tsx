"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cie11Picker } from "@/app/(clinic)/_components/cie11-picker";
import {
  CIE11_ATTRIBUTION,
  DIAGNOSIS_KIND_LABELS,
  toPayload,
  type DiagnosisDraft,
  type DiagnosisKind,
} from "@/lib/domain/encounter-diagnoses";
import { addEncounterDiagnoses, correctEncounterDiagnosis } from "./diagnoses-actions";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";
const buttonClass =
  "rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]";
const primaryClass =
  "rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";

export type DiagnosisRowView = {
  id: string;
  kind: string;
  is_primary: boolean;
  code: string;
  title: string;
  icd_release: string;
  verified: boolean;
  doctor_note: string | null;
  created_at: string;
  created_by_label: string;
  superseded_at: string | null;
  superseded_reason: string | null;
  superseded_by_label: string | null;
  replaced_by_code: string | null;
};

function Badge({ children, tone }: { children: React.ReactNode; tone: "zinc" | "amber" | "green" }) {
  const cls =
    tone === "amber"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
      : tone === "green"
        ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** Corregir (reemplazar) o retirar un diagnóstico vigente, siempre con motivo. El anterior se conserva marcado. */
function CorrectForm({ patientId, encounterId, row }: { patientId: string; encounterId: string; row: DiagnosisRowView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [replacement, setReplacement] = useState<DiagnosisDraft[]>([]);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  function submit() {
    startTransition(async () => {
      const res = await correctEncounterDiagnosis(patientId, encounterId, row.id, reason, JSON.stringify(replacement.map(toPayload)));
      setMessage(res);
      if (res.success) {
        setReplacement([]);
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-zinc-500">Corregir codificación</summary>
      <div className="mt-2 flex flex-col gap-3 rounded-lg border border-panel-border p-3">
        <p className="text-zinc-600 dark:text-zinc-400">
          Elige el código correcto para <strong>reemplazar</strong> este, o déjalo vacío para <strong>retirarlo</strong>. El anterior se conserva en el
          historial con tu motivo.
        </p>
        <Cie11Picker value={replacement} onChange={setReplacement} max={1} defaultKind={row.kind as DiagnosisKind} />
        <label className="flex flex-col gap-1">
          <span className="font-medium">Motivo de la corrección (obligatorio)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={`${inputClass} max-w-md`} />
        </label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={submit} disabled={pending} className={buttonClass}>
            {pending ? "Guardando…" : replacement.length === 1 ? "Reemplazar" : "Retirar diagnóstico"}
          </button>
          {message.error && <span className="text-red-600 dark:text-red-400">{message.error}</span>}
          {message.success && <span className="text-green-700 dark:text-green-400">{message.success}</span>}
        </div>
      </div>
    </details>
  );
}

/**
 * Diagnósticos codificados (CIE-11) de la consulta: los vigentes junto al texto del médico, el formulario para
 * agregar más (administradores y médicos con acceso) y el historial de lo reemplazado o retirado.
 */
export function DiagnosesPanel({
  patientId,
  encounterId,
  rows,
  canEdit,
}: {
  patientId: string;
  encounterId: string;
  rows: DiagnosisRowView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<DiagnosisDraft[]>([]);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  const active = rows.filter((r) => !r.superseded_at);
  const history = rows.filter((r) => r.superseded_at);

  function save() {
    startTransition(async () => {
      const res = await addEncounterDiagnoses(patientId, encounterId, JSON.stringify(draft.map(toPayload)));
      setMessage(res);
      if (res.success) {
        setDraft([]);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-lg font-medium">Diagnósticos codificados (CIE-11)</h2>

      {active.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Esta consulta no tiene diagnósticos codificados.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-panel-border">
          {active.map((r) => (
            <li key={r.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-bold">{r.code}</span>
                <span>{r.title}</span>
                <Badge tone="zinc">{DIAGNOSIS_KIND_LABELS[r.kind as DiagnosisKind] ?? r.kind}</Badge>
                {r.is_primary && <Badge tone="green">Principal</Badge>}
                {!r.verified && <Badge tone="amber">No verificado</Badge>}
              </div>
              {r.doctor_note && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Nota del médico: {r.doctor_note}</p>}
              <p className="mt-0.5 text-xs text-zinc-500">
                {r.created_by_label} · CIE-11 versión {r.icd_release}
              </p>
              {canEdit && <CorrectForm patientId={patientId} encounterId={encounterId} row={r} />}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-col gap-3 rounded-lg border border-panel-border p-3">
          <h3 className="text-sm font-semibold">Agregar diagnósticos</h3>
          <Cie11Picker value={draft} onChange={setDraft} />
          <div className="flex items-center gap-3">
            <button type="button" onClick={save} disabled={pending || draft.length === 0} className={primaryClass}>
              {pending ? "Guardando…" : "Guardar diagnósticos"}
            </button>
            {message.error && <span className="text-sm text-red-600 dark:text-red-400">{message.error}</span>}
            {message.success && <span className="text-sm text-green-700 dark:text-green-400">{message.success}</span>}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">Historial de correcciones ({history.length})</summary>
          <ul className="mt-2 flex flex-col divide-y divide-panel-border text-xs">
            {history.map((r) => (
              <li key={r.id} className="py-2">
                <span className="font-bold">{r.code}</span> · {r.title} ({DIAGNOSIS_KIND_LABELS[r.kind as DiagnosisKind] ?? r.kind})
                <br />
                <span className="text-zinc-500">
                  {r.replaced_by_code ? `Reemplazado por ${r.replaced_by_code}` : "Retirado"} · {r.superseded_by_label ?? "—"} · motivo: {r.superseded_reason}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-zinc-500">{CIE11_ATTRIBUTION}</p>
    </div>
  );
}
