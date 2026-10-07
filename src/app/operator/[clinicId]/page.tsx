import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOperatorPage } from "@/lib/supabase/operator-context";
import { ACCESS_STATE_LABELS, type ClinicAccessState } from "@/lib/domain/clinic-access";
import {
  DELETION_CHANNEL_LABELS,
  DELETION_STATUS_LABELS,
  DELETION_WAIT_DAYS,
  DELETION_WARNING_TEXT,
  RETENTION_YEARS,
  deletionStep,
  type DeletionChannel,
  type DeletionStatus,
} from "@/lib/domain/data-deletion";
import {
  ACCESS_STATE_BADGE,
  addDaysIso,
  BUSINESS_MODEL_LABELS,
  EVENT_KIND_LABELS,
  describeSubscriptionEvent,
  formatDate,
  formatTimestampDate,
  formatPrice,
  todayInSantoDomingo,
} from "../labels";
import {
  ActiveStatusForm,
  BlockAgreementForm,
  ExecuteDeletionForm,
  ExpiredRetentionForm,
  ExemptForm,
  ExtendTrialForm,
  NoteForm,
  PaymentForm,
  PlanForm,
  PlanPeriodForm,
  RegisterDeletionForm,
  SeatsForm,
  WithdrawRequestForm,
} from "./operator-forms";

function days(n: number): string {
  return `${n} ${n === 1 ? "día" : "días"}`;
}

export default async function OperatorClinicDetailPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;
  const supabase = await createClient();

  await requireOperatorPage(supabase);

  const [
    { data: clinic },
    { data: subscription },
    { data: members },
    { data: overview },
    { data: payments },
    { data: accessEvents },
    { data: statusChanges },
    { data: planChanges },
    { data: notes },
    { data: deletionRequests },
  ] = await Promise.all([
    supabase
      .from("clinics")
      .select("id, name, province, business_model, is_active, created_at")
      .eq("id", clinicId)
      .maybeSingle(),
    supabase.from("clinic_subscriptions").select("*").eq("clinic_id", clinicId).maybeSingle(),
    supabase.from("clinic_members").select("id", { count: "exact" }).eq("clinic_id", clinicId),
    supabase.rpc("operator_clinic_access_overview"),
    supabase
      .from("clinic_payments")
      .select("id, amount, paid_on, period_days, resulting_due_on, note, registered_by, created_at")
      .eq("clinic_id", clinicId)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("clinic_subscription_events")
      .select("id, kind, details, changed_by, created_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false }),
    supabase
      .from("clinic_status_changes")
      .select("id, is_active, reason, changed_by, created_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false }),
    supabase
      .from("clinic_plan_changes")
      .select("id, business_model, price, plan_conditions, changed_by, created_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false }),
    supabase
      .from("clinic_internal_notes")
      .select("id, note, created_by, created_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false }),
    supabase
      .from("clinic_deletion_requests")
      .select("id, status, channel, requested_by_email, requested_at, export_confirmed_at, scheduled_for")
      .eq("clinic_id", clinicId)
      .order("requested_at", { ascending: false }),
  ]);

  if (!clinic) notFound();

  const access = (overview ?? []).find((r) => r.clinic_id === clinicId) ?? null;
  const state = (access?.state ?? "sin_plan") as ClinicAccessState;

  // El email no vive en estas tablas (auth.users no está expuesto vía la
  // Data API) -- se resuelve server-side con el cliente admin, mismo patrón
  // que src/app/team/page.tsx.
  const userIds = new Set<string>();
  for (const s of statusChanges ?? []) userIds.add(s.changed_by);
  for (const p of planChanges ?? []) userIds.add(p.changed_by);
  for (const n of notes ?? []) userIds.add(n.created_by);
  for (const p of payments ?? []) userIds.add(p.registered_by);
  for (const e of accessEvents ?? []) if (e.changed_by) userIds.add(e.changed_by);

  const admin = createAdminClient();
  const emailByUserId = new Map<string, string>();
  await Promise.all(
    Array.from(userIds).map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      if (data.user?.email) emailByUserId.set(userId, data.user.email);
    })
  );

  const formatDateTime = (value: string) =>
    new Date(value).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });

  const today = todayInSantoDomingo();
  const hasOpenDeletion = (deletionRequests ?? []).some((r) => r.status === "solicitada");
  const retentionExpired = state === "bloqueada" && !!access?.retention_until && access.retention_until <= today;
  const trialIsDue =
    !!subscription &&
    !!access?.due_on &&
    (!subscription.next_payment_due_on || access.due_on !== subscription.next_payment_due_on);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/operator" className="text-sm text-zinc-500 hover:underline">
          ← Clínicas
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{clinic.name}</h1>
          <span
            className={
              clinic.is_active
                ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-400"
                : "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400"
            }
          >
            {clinic.is_active ? "Activa" : "Desactivada"}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACCESS_STATE_BADGE[state]}`}>
            {ACCESS_STATE_LABELS[state]}
          </span>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {clinic.province} · {members?.length ?? 0} miembro{members?.length === 1 ? "" : "s"} · registrada el{" "}
          {formatTimestampDate(clinic.created_at)}
        </p>
      </div>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Acceso y plan</h2>
        <div className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <p>
            Estado de acceso: <strong>{ACCESS_STATE_LABELS[state]}</strong>
          </p>
          <p>
            {trialIsDue ? "Fin de la prueba" : "Vencimiento"}: <strong>{formatDate(access?.due_on ?? null)}</strong>
            {access?.days_to_expiry !== null && access?.days_to_expiry !== undefined && (
              <span className="text-zinc-500">
                {access.days_to_expiry >= 0
                  ? access.days_to_expiry === 0
                    ? " (hoy es el último día)"
                    : ` (en ${days(access.days_to_expiry)})`
                  : ` (venció hace ${days(-access.days_to_expiry)})`}
              </span>
            )}
          </p>
          <p>
            Solo lectura desde:{" "}
            {access?.due_on && state !== "exenta" ? (
              <strong>{formatDate(addDaysIso(access.due_on, 31))}</strong>
            ) : (
              "—"
            )}
          </p>
          <p>
            Bloqueo total y cancelación:{" "}
            {access?.blocked_on ? (
              <>
                <strong>{formatDate(access.blocked_on)}</strong>
                {access.days_to_block !== null && access.days_to_block > 0 && (
                  <span className="text-zinc-500"> (en {days(access.days_to_block)})</span>
                )}
                {access.block_deferred_until && (
                  <span className="text-zinc-500"> · acuerdo hasta {formatDate(access.block_deferred_until)}</span>
                )}
              </>
            ) : (
              "—"
            )}
          </p>
          <p>
            Conservación de datos hasta:{" "}
            {access?.retention_until ? (
              <>
                <strong>{formatDate(access.retention_until)}</strong>
                <span className="text-zinc-500"> (2 años desde la cancelación; no eliminar antes)</span>
              </>
            ) : (
              "—"
            )}
          </p>
          <p>
            Plan: {subscription?.billing_period_days ? `${subscription.billing_period_days} días` : "—"} · Monto:{" "}
            {formatPrice(subscription?.price ?? null)}
          </p>
          <p>
            Inicio del plan: {formatDate(subscription?.plan_started_on ?? null)} · Prueba hasta:{" "}
            {formatDate(subscription?.trial_ends_at ?? null)}
          </p>
          <p>
            Médicos (admin y médico): {access?.seats_used ?? 0} de{" "}
            {subscription?.included_clinician_seats ?? "ilimitado"}
          </p>
          <p>Modelo: {BUSINESS_MODEL_LABELS[clinic.business_model]?.split(" — ")[0] ?? clinic.business_model}</p>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Estado de la clínica</h2>
        <ActiveStatusForm clinicId={clinic.id} isActive={clinic.is_active} />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Fijar plan</h2>
        <PlanPeriodForm
          clinicId={clinic.id}
          currentPeriod={subscription?.billing_period_days ?? null}
          currentAmount={subscription?.price ?? null}
          today={today}
        />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Registrar pago</h2>
        <PaymentForm clinicId={clinic.id} hasPlan={!!subscription?.billing_period_days} today={today} />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Extender prueba</h2>
        <ExtendTrialForm clinicId={clinic.id} />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Exención</h2>
        <ExemptForm clinicId={clinic.id} isExempt={subscription?.access_exempt ?? false} />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Acuerdo de bloqueo</h2>
        <BlockAgreementForm clinicId={clinic.id} currentUntil={access?.block_deferred_until ?? null} today={today} />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Cupo de médicos</h2>
        <SeatsForm clinicId={clinic.id} currentSeats={subscription?.included_clinician_seats ?? null} />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Modelo de negocio y condiciones</h2>
        <PlanForm
          clinicId={clinic.id}
          currentBusinessModel={clinic.business_model}
          currentConditions={subscription?.plan_conditions ?? null}
        />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Historial de pagos</h2>
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {(payments ?? []).map((p) => (
            <li key={p.id} className="py-2 text-sm">
              <p>
                {formatDate(p.paid_on)} · {formatPrice(p.amount)} · {p.period_days} días · cubre hasta{" "}
                {formatDate(p.resulting_due_on)}
                {p.note ? ` · ${p.note}` : ""}
              </p>
              <p className="text-xs text-zinc-500">
                {emailByUserId.get(p.registered_by) ?? p.registered_by} · {formatDateTime(p.created_at)}
              </p>
            </li>
          ))}
          {(payments ?? []).length === 0 && <li className="py-2 text-sm text-zinc-500">Sin pagos registrados.</li>}
        </ul>
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Historial de acceso</h2>
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {(accessEvents ?? []).map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <p>
                <strong>{EVENT_KIND_LABELS[e.kind] ?? e.kind}</strong> — {describeSubscriptionEvent(e.kind, e.details)}
              </p>
              <p className="text-xs text-zinc-500">
                {e.changed_by ? (emailByUserId.get(e.changed_by) ?? e.changed_by) : "Sistema"} ·{" "}
                {formatDateTime(e.created_at)}
              </p>
            </li>
          ))}
          {(accessEvents ?? []).length === 0 && (
            <li className="py-2 text-sm text-zinc-500">Sin cambios de acceso todavía.</li>
          )}
        </ul>
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Eliminación de datos</h2>
        <p className="text-xs text-zinc-500">
          Nada se elimina automáticamente. La clínica puede solicitarla desde su panel (espera de {DELETION_WAIT_DAYS} días
          tras confirmar la descarga), o por correo si está bloqueada. También procede al vencer la conservación de{" "}
          {RETENTION_YEARS} años de una clínica cancelada.
        </p>
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {(deletionRequests ?? []).map((r) => {
            const step = deletionStep(
              {
                status: r.status as DeletionStatus,
                exportConfirmedAt: r.export_confirmed_at,
                scheduledFor: r.scheduled_for,
              },
              today
            );
            const executable = r.status === "solicitada" && (r.channel === "conservacion_vencida" ? true : step === "lista");
            return (
              <li key={r.id} className="flex flex-col gap-2 py-3 text-sm">
                <p>
                  <strong>{DELETION_STATUS_LABELS[r.status as DeletionStatus] ?? r.status}</strong> ·{" "}
                  {DELETION_CHANNEL_LABELS[r.channel as DeletionChannel] ?? r.channel} · pidió {r.requested_by_email}
                </p>
                <p className="text-xs text-zinc-500">
                  Solicitada {formatDateTime(r.requested_at)}
                  {r.export_confirmed_at ? ` · descarga confirmada ${formatDateTime(r.export_confirmed_at)}` : " · descarga sin confirmar"}
                  {r.scheduled_for ? ` · eliminación desde el ${formatDate(r.scheduled_for)}` : ""}
                </p>
                {r.status === "solicitada" && (
                  <>
                    {executable ? (
                      <ExecuteDeletionForm clinicId={clinic.id} requestId={r.id} clinicName={clinic.name} />
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Todavía no se puede ejecutar:{" "}
                        {step === "descargar" ? "falta que la clínica descargue y confirme." : "no ha pasado la espera."}
                      </p>
                    )}
                    <WithdrawRequestForm clinicId={clinic.id} requestId={r.id} />
                  </>
                )}
              </li>
            );
          })}
          {(deletionRequests ?? []).length === 0 && (
            <li className="py-2 text-sm text-zinc-500">Sin solicitudes de eliminación.</li>
          )}
        </ul>
        {!hasOpenDeletion && (
          <>
            {retentionExpired && <ExpiredRetentionForm clinicId={clinic.id} />}
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
                Registrar una solicitud recibida por correo
              </summary>
              <div className="mt-3">
                <RegisterDeletionForm clinicId={clinic.id} warningText={DELETION_WARNING_TEXT} />
              </div>
            </details>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Notas internas</h2>
        <p className="text-xs text-zinc-500">Nunca visibles para el admin de la clínica.</p>
        <NoteForm clinicId={clinic.id} />
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {(notes ?? []).map((n) => (
            <li key={n.id} className="py-2 text-sm">
              <p>{n.note}</p>
              <p className="text-xs text-zinc-500">
                {emailByUserId.get(n.created_by) ?? n.created_by} · {formatDateTime(n.created_at)}
              </p>
            </li>
          ))}
          {(notes ?? []).length === 0 && (
            <li className="py-2 text-sm text-zinc-500">Sin notas todavía.</li>
          )}
        </ul>
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Historial de estado</h2>
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {(statusChanges ?? []).map((s) => (
            <li key={s.id} className="py-2 text-sm">
              <p>
                {s.is_active ? "Activada" : "Desactivada"} — {s.reason}
              </p>
              <p className="text-xs text-zinc-500">
                {emailByUserId.get(s.changed_by) ?? s.changed_by} · {formatDateTime(s.created_at)}
              </p>
            </li>
          ))}
          {(statusChanges ?? []).length === 0 && (
            <li className="py-2 text-sm text-zinc-500">Sin cambios de estado todavía.</li>
          )}
        </ul>
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Historial de modelo y condiciones</h2>
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {(planChanges ?? []).map((p) => (
            <li key={p.id} className="py-2 text-sm">
              <p>
                {BUSINESS_MODEL_LABELS[p.business_model]?.split(" — ")[0] ?? p.business_model} ·{" "}
                {formatPrice(p.price)}
                {p.plan_conditions ? ` · ${p.plan_conditions}` : ""}
              </p>
              <p className="text-xs text-zinc-500">
                {emailByUserId.get(p.changed_by) ?? p.changed_by} · {formatDateTime(p.created_at)}
              </p>
            </li>
          ))}
          {(planChanges ?? []).length === 0 && (
            <li className="py-2 text-sm text-zinc-500">Sin cambios de modelo todavía.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
