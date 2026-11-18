import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";
import { HeaderLink, PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { formatDateString, formatDrDateTime } from "@/lib/domain/dr-time";
import {
  STUDY_CATEGORY_LABELS,
  STUDY_FIELD_LABELS,
  STUDY_STATUS_LABELS,
  formatFileSize,
  type StudyCategory,
  type StudyStatus,
  type StudyValue,
} from "@/lib/domain/study-results";
import { StudyUploader, VoidAttachmentForm, VoidStudyForm } from "./study-files";

const STATUS_CLASS: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  recibido: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  anulado: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

/** Un estudio: resultado, valores, interpretación, archivos adjuntos (descarga con URL firmada) y su historial. */
export default async function StudyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; studyId: string }>;
  searchParams: Promise<{ adjuntar?: string }>;
}) {
  const { id, studyId } = await params;
  const { adjuntar } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect(`/patients/${id}`);

  const [{ data: study }, { data: patient }] = await Promise.all([
    supabase.from("study_results").select("*").eq("id", studyId).eq("patient_id", id).maybeSingle(),
    supabase.from("patients").select("first_name, last_name, voided_at").eq("id", id).maybeSingle(),
  ]);
  if (!study || !patient) notFound();

  const [{ data: attachments }, { data: revisions }] = await Promise.all([
    supabase
      .from("study_attachments")
      .select("id, file_name, mime_type, size_bytes, uploaded_by, uploaded_at, removed_at, removed_reason")
      .eq("study_id", studyId)
      .order("uploaded_at", { ascending: true }),
    supabase
      .from("study_result_revisions")
      .select("id, field, old_value, new_value, changed_by, changed_at, reason")
      .eq("study_id", studyId)
      .order("changed_at", { ascending: false })
      .order("field", { ascending: true })
      .limit(200),
  ]);

  const readOnly = await isClinicReadOnly();
  const canWrite = !readOnly && patient.voided_at === null && study.status !== "anulado";
  const values = (Array.isArray(study.result_values) ? study.result_values : []) as unknown as StudyValue[];

  const admin = createAdminClient();
  const emailById = new Map<string, string>();
  const ids = new Set<string>(
    [
      study.created_by,
      study.updated_by,
      ...(attachments ?? []).map((a) => a.uploaded_by),
      ...(revisions ?? []).map((r) => r.changed_by),
    ].filter((u): u is string => !!u)
  );
  await Promise.all(
    Array.from(ids).map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid);
      if (data.user?.email) emailById.set(uid, data.user.email);
    })
  );
  const who = (uid: string | null) => (uid ? (emailById.get(uid) ?? "usuario") : "sistema");
  const activeAttachments = (attachments ?? []).filter((a) => !a.removed_at);
  const removedAttachments = (attachments ?? []).filter((a) => a.removed_at);

  return (
    <>
      <PageHeader
        title={
          <>
            {study.study_name}{" "}
            <span className={`ml-2 rounded-full px-2 py-0.5 align-middle text-xs font-medium ${STATUS_CLASS[study.status] ?? ""}`}>
              {STUDY_STATUS_LABELS[study.status as StudyStatus] ?? study.status}
            </span>
          </>
        }
        subtitle={
          <>
            {patient.first_name} {patient.last_name} · {STUDY_CATEGORY_LABELS[study.category as StudyCategory] ?? study.category}
          </>
        }
        back={{ href: `/patients/${id}?tab=expediente`, label: "Expediente" }}
        actions={canWrite ? <HeaderLink href={`/patients/${id}/studies/${studyId}/editar`}>Completar / corregir</HeaderLink> : undefined}
      />
      <PageBody narrow>
        {study.status === "pendiente" && (
          <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Estudio indicado, pendiente de resultado. Cuando llegue, usa «Completar / corregir» y súbelo.
          </p>
        )}

        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-zinc-500">Fecha de indicación</dt>
          <dd>{study.ordered_at ? formatDateString(study.ordered_at) : "—"}</dd>
          <dt className="text-zinc-500">Fecha de realización</dt>
          <dd>{study.performed_at ? formatDateString(study.performed_at) : "—"}</dd>
          <dt className="text-zinc-500">Registrado</dt>
          <dd>
            {formatDrDateTime(study.created_at)} · {who(study.created_by)}
          </dd>
          {study.encounter_id && (
            <>
              <dt className="text-zinc-500">Consulta</dt>
              <dd>
                <Link href={`/patients/${id}/encounters/${study.encounter_id}`} className="underline">
                  Ver la consulta
                </Link>
              </dd>
            </>
          )}
        </dl>

        {study.result_text && (
          <section className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Resultado</h2>
            <p className="whitespace-pre-wrap text-sm">{study.result_text}</p>
          </section>
        )}

        {values.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Valores</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Nombre</th>
                    <th className="py-1 pr-3 font-medium">Valor</th>
                    <th className="py-1 pr-3 font-medium">Unidad</th>
                    <th className="py-1 font-medium">Rango de referencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-panel-border">
                  {values.map((v, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-3">{v.name}</td>
                      <td className="py-1.5 pr-3 font-medium">{v.value}</td>
                      <td className="py-1.5 pr-3 text-zinc-500">{v.unit ?? ""}</td>
                      <td className="py-1.5 text-zinc-500">{v.reference_range ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {study.interpretation && (
          <section className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Interpretación del médico</h2>
            <p className="whitespace-pre-wrap text-sm">{study.interpretation}</p>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Archivos</h2>
          {activeAttachments.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin archivos adjuntos.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-panel-border text-sm">
              {activeAttachments.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <a href={`/patients/${id}/studies/${studyId}/files/${a.id}`} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                      {a.file_name}
                    </a>
                    <span className="text-xs text-zinc-500">
                      {a.mime_type === "application/pdf" ? "PDF" : a.mime_type === "image/png" ? "PNG" : "JPG"} · {formatFileSize(a.size_bytes)}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500">
                    Subido el {formatDrDateTime(a.uploaded_at)} · {who(a.uploaded_by)}
                  </span>
                  {canWrite && <VoidAttachmentForm patientId={id} studyId={studyId} attachmentId={a.id} disabled={readOnly} />}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <div id="adjuntar" className={adjuntar ? "rounded-lg border border-panel-border p-3" : ""}>
              <StudyUploader patientId={id} studyId={studyId} disabled={readOnly} />
            </div>
          )}
          {removedAttachments.length > 0 && (
            <details className="text-sm text-zinc-500">
              <summary className="cursor-pointer">Adjuntos retirados ({removedAttachments.length})</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {removedAttachments.map((a) => (
                  <li key={a.id}>
                    {a.file_name} — retirado el {formatDrDateTime(a.removed_at!)}: {a.removed_reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Historial de cambios</h2>
          {!revisions || revisions.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Este estudio no se ha modificado desde que se registró.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-panel-border text-sm">
              {revisions.map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5 py-2">
                  <span>
                    <span className="font-medium">{STUDY_FIELD_LABELS[r.field] ?? r.field}:</span>{" "}
                    <span className="whitespace-pre-wrap break-words text-zinc-500 line-through">{r.old_value || "(vacío)"}</span>
                    {" → "}
                    <span className="whitespace-pre-wrap break-words">{r.new_value || "(vacío)"}</span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatDrDateTime(r.changed_at)} · {who(r.changed_by)}
                    {r.reason ? ` · motivo: ${r.reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canWrite && (
          <details className="rounded-lg border border-red-200 p-3 dark:border-red-900">
            <summary className="cursor-pointer text-sm font-medium">Anular estudio</summary>
            <div className="mt-3">
              <VoidStudyForm patientId={id} studyId={studyId} disabled={readOnly} />
            </div>
          </details>
        )}
      </PageBody>
    </>
  );
}
