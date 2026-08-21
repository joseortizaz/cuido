import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOperatorPage } from "@/lib/supabase/operator-context";
import { BUSINESS_MODEL_LABELS, PAYMENT_STATUS_LABELS, formatPrice } from "../labels";
import { ActiveStatusForm, NoteForm, PaymentStatusForm, PlanForm } from "./operator-forms";

export default async function OperatorClinicDetailPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;
  const supabase = await createClient();

  await requireOperatorPage(supabase);

  const [{ data: clinic }, { data: subscription }, { data: members }, { data: statusChanges }, { data: planChanges }, { data: notes }] =
    await Promise.all([
      supabase.from("clinics").select("id, name, province, business_model, is_active").eq("id", clinicId).maybeSingle(),
      supabase.from("clinic_subscriptions").select("*").eq("clinic_id", clinicId).maybeSingle(),
      supabase.from("clinic_members").select("id", { count: "exact" }).eq("clinic_id", clinicId),
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
    ]);

  if (!clinic) notFound();

  // El email no vive en estas tablas (auth.users no está expuesto vía la
  // Data API) -- se resuelve server-side con el cliente admin, mismo patrón
  // que src/app/team/page.tsx.
  const userIds = new Set<string>();
  for (const s of statusChanges ?? []) userIds.add(s.changed_by);
  for (const p of planChanges ?? []) userIds.add(p.changed_by);
  for (const n of notes ?? []) userIds.add(n.created_by);

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/operator" className="text-sm text-zinc-500 hover:underline">
          ← Clínicas
        </Link>
        <div className="mt-1 flex items-center gap-3">
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
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {clinic.province} · {members?.length ?? 0} miembro{members?.length === 1 ? "" : "s"}
        </p>
      </div>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Estado de la clínica</h2>
        <ActiveStatusForm clinicId={clinic.id} isActive={clinic.is_active} />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Plan</h2>
        <PlanForm
          clinicId={clinic.id}
          currentBusinessModel={clinic.business_model}
          currentPrice={subscription?.price ?? null}
          currentConditions={subscription?.plan_conditions ?? null}
        />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Pago</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Estado actual:{" "}
          {subscription
            ? PAYMENT_STATUS_LABELS[subscription.payment_status] ?? subscription.payment_status
            : "—"}{" "}
          · Precio: {formatPrice(subscription?.price ?? null)} · Próximo pago:{" "}
          {subscription?.next_payment_due_on ?? "—"}
        </p>
        <PaymentStatusForm
          clinicId={clinic.id}
          currentPaymentStatus={subscription?.payment_status ?? "al_dia"}
          currentDueDate={subscription?.next_payment_due_on ?? null}
        />
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
        <h2 className="text-lg font-medium">Historial de plan</h2>
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
            <li className="py-2 text-sm text-zinc-500">Sin cambios de plan todavía.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
