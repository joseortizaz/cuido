import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicAccess } from "@/lib/supabase/clinic-access";
import { ACCESS_STATE_LABELS, CONTACT_NARNIA } from "@/lib/domain/clinic-access";
import { BUSINESS_MODEL_LABELS, formatPrice } from "@/app/operator/labels";

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("es-DO", { dateStyle: "medium" });
}

function days(n: number): string {
  return `${n} ${n === 1 ? "día" : "días"}`;
}

/**
 * Tarjeta de plan -- SOLO para el admin de la clínica. Monto, periodo, fecha
 * de renovación e historial de pagos viven en clinic_subscriptions /
 * clinic_payments, cuyas políticas de lectura son admin + operador, así que
 * recepción y médicos ni siquiera pueden consultarlas (el resto del equipo ve
 * únicamente estado y días, en la barra de aviso).
 *
 * El estado de acceso sale de la base de datos (get_my_clinic_access), NO de
 * la etiqueta manual payment_status, que ya no interviene en el acceso.
 */
export async function PlanCard({ clinicId, businessModel }: { clinicId: string; businessModel: string }) {
  const supabase = await createClient();
  const [access, { data: sub }, { data: payments }] = await Promise.all([
    getCurrentClinicAccess(),
    supabase.from("clinic_subscriptions").select("*").eq("clinic_id", clinicId).maybeSingle(),
    supabase
      .from("clinic_payments")
      .select("id, amount, paid_on, period_days, resulting_due_on")
      .eq("clinic_id", clinicId)
      .order("paid_on", { ascending: false })
      .limit(10),
  ]);

  // Último día válido efectivo: el más tardío entre fin de prueba y
  // vencimiento del plan pagado (mismo criterio que clinic_access_due_on).
  const due =
    sub && (sub.trial_ends_at || sub.next_payment_due_on)
      ? [sub.trial_ends_at, sub.next_payment_due_on].filter((d): d is string => !!d).sort().at(-1) ?? null
      : null;
  const dueIsTrial = !!sub && !!due && (!sub.next_payment_due_on || due !== sub.next_payment_due_on);

  return (
    <div className="rounded-xl border border-zinc-200 p-4 sm:col-span-2 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">Plan y facturación</p>
      {!sub ? (
        <p className="mt-1 text-sm text-zinc-500">Sin información de plan todavía.</p>
      ) : (
        <div className="mt-1 flex flex-col gap-0.5 text-sm">
          <span>{BUSINESS_MODEL_LABELS[businessModel] ?? businessModel}</span>
          <span>
            Estado: <strong>{access ? ACCESS_STATE_LABELS[access.state] : "—"}</strong>
          </span>
          {access?.state === "exenta" ? (
            <span>Tu clínica está exenta: no tiene fecha de vencimiento.</span>
          ) : (
            due && (
              <span>
                {dueIsTrial ? "Fin de la prueba" : "Vencimiento del plan"}: {formatDate(due)}
                {access?.daysToExpiry !== null && access?.daysToExpiry !== undefined && (
                  <span className="text-zinc-500">
                    {access.daysToExpiry >= 0
                      ? access.daysToExpiry === 0
                        ? " (hoy es el último día)"
                        : ` (en ${days(access.daysToExpiry)})`
                      : ` (venció hace ${days(-access.daysToExpiry)})`}
                  </span>
                )}
              </span>
            )
          )}
          <span>
            Periodo del plan: {sub.billing_period_days ? `${sub.billing_period_days} días` : "—"} · Monto:{" "}
            {formatPrice(sub.price)}
          </span>
          {sub.included_clinician_seats !== null && (
            <span>
              Médicos incluidos (médicos y administradores que atienden pacientes): {access?.seatsUsed ?? "—"} de {sub.included_clinician_seats}
            </span>
          )}
          {access?.state === "por_renovar" && (
            <span className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Tu plan está por vencer. Para renovarlo, contacta a Narnia Tech Solution: {CONTACT_NARNIA}.
            </span>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <p className="text-xs text-zinc-500">Historial de pagos</p>
        {!payments || payments.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">Sin pagos registrados.</p>
        ) : (
          <ul className="mt-1 flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 py-1.5">
                <span>
                  {formatDate(p.paid_on)} · {formatPrice(p.amount)}
                </span>
                <span className="text-xs text-zinc-500">
                  {p.period_days} días · cubre hasta {formatDate(p.resulting_due_on)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
