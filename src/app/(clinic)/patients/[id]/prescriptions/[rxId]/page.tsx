import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";
import { HeaderLink, PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { formatDrDateTime } from "@/lib/domain/dr-time";
import { formatRxNumber, rxItemDetail } from "@/lib/domain/prescriptions";
import { VoidPrescriptionForm } from "./rx-actions";

/** Una receta emitida: sus renglones, su estado, sus impresiones y la anulación (con motivo). */
export default async function PrescriptionDetailPage({ params }: { params: Promise<{ id: string; rxId: string }> }) {
  const { id, rxId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect(`/patients/${id}`);

  const { data: rx } = await supabase.from("prescriptions").select("*").eq("id", rxId).eq("patient_id", id).maybeSingle();
  if (!rx) notFound();
  const [{ data: items }, { data: prints }, { data: patient }] = await Promise.all([
    supabase.from("prescription_items").select("*").eq("prescription_id", rxId).order("position", { ascending: true }),
    supabase.from("prescription_prints").select("id, printed_by, printed_at, is_copy, format").eq("prescription_id", rxId).order("printed_at", { ascending: false }),
    supabase.from("patients").select("first_name, last_name, voided_at").eq("id", id).maybeSingle(),
  ]);

  const readOnly = await isClinicReadOnly();
  const canAct = !readOnly && rx.status === "emitida" && patient?.voided_at === null;
  const canVoid = canAct && (rx.provider_id === user.id || membership.role === "admin");

  const admin = createAdminClient();
  const emailById = new Map<string, string>();
  const ids = new Set<string>([rx.provider_id, rx.voided_by, ...(prints ?? []).map((p) => p.printed_by)].filter((u): u is string => !!u));
  await Promise.all(
    Array.from(ids).map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid);
      if (data.user?.email) emailById.set(uid, data.user.email);
    })
  );
  const who = (uid: string | null) => (uid ? (emailById.get(uid) ?? "usuario") : "sistema");

  return (
    <>
      <PageHeader
        title={
          <>
            Receta N.º {formatRxNumber(rx.number)}{" "}
            <span
              className={`ml-2 rounded-full px-2 py-0.5 align-middle text-xs font-medium ${
                rx.status === "emitida" ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
              }`}
            >
              {rx.status === "emitida" ? "Emitida" : "Anulada"}
            </span>
          </>
        }
        subtitle={
          <>
            {patient?.first_name} {patient?.last_name} · {formatDrDateTime(rx.issued_at)}
          </>
        }
        back={{ href: `/patients/${id}?tab=expediente`, label: "Expediente" }}
        actions={
          rx.status === "emitida" ? (
            <>
              <HeaderLink href={`/patients/${id}/prescriptions/${rxId}/print`}>Imprimir (A6)</HeaderLink>
              <HeaderLink href={`/patients/${id}/prescriptions/${rxId}/print?formato=a4`}>Imprimir en A4 centrada</HeaderLink>
            </>
          ) : undefined
        }
      />
      <PageBody narrow>
        {rx.status === "anulada" && (
          <p role="status" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            <strong>Receta anulada</strong> el {formatDrDateTime(rx.voided_at!)} por {who(rx.voided_by)} — motivo: {rx.void_reason}. Ya no se puede imprimir.
          </p>
        )}

        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-zinc-500">Emitida por</dt>
          <dd>
            {rx.provider_name}
            {rx.provider_title ? ` · ${rx.provider_title}` : ""} · Exequátur {rx.provider_exequatur}
          </dd>
          <dt className="text-zinc-500">Timbrado</dt>
          <dd>{(rx.letterhead as { name?: string }).name}</dd>
          {rx.encounter_id && (
            <>
              <dt className="text-zinc-500">Consulta</dt>
              <dd>
                <a href={`/patients/${id}/encounters/${rx.encounter_id}`} className="underline">
                  Ver la consulta
                </a>
              </dd>
            </>
          )}
        </dl>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Medicamentos</h2>
          <ol className="flex flex-col divide-y divide-panel-border text-sm">
            {(items ?? []).map((it) => (
              <li key={it.id} className="flex flex-col gap-0.5 py-2">
                <span className="font-medium">
                  {it.position}. {it.medication}
                </span>
                {rxItemDetail(it) && <span className="text-zinc-600 dark:text-zinc-400">{rxItemDetail(it)}</span>}
                {it.instructions && <span className="text-xs italic text-zinc-500">{it.instructions}</span>}
              </li>
            ))}
          </ol>
          {rx.notes && (
            <p className="text-sm">
              <strong>Indicaciones generales:</strong> {rx.notes}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Impresiones</h2>
          {!prints || prints.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no se ha impreso.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-panel-border text-sm">
              {prints.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    {p.is_copy ? "Copia" : "Original"} · {p.format === "a4" ? "A4 centrada" : "A6"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatDrDateTime(p.printed_at)} · {who(p.printed_by)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-zinc-500">
            La receta es un documento impreso que el médico firma y sella; Cuido no la firma digitalmente. Las reimpresiones salen marcadas «COPIA» y quedan registradas.
          </p>
        </section>

        {canVoid && (
          <details className="rounded-lg border border-red-200 p-3 dark:border-red-900">
            <summary className="cursor-pointer text-sm font-medium">Anular receta</summary>
            <div className="mt-3">
              <VoidPrescriptionForm patientId={id} prescriptionId={rxId} disabled={readOnly} />
            </div>
          </details>
        )}
      </PageBody>
    </>
  );
}
