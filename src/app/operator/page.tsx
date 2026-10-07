import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { requireOperatorPage } from "@/lib/supabase/operator-context";
import { ACCESS_STATE_LABELS, type ClinicAccessState } from "@/lib/domain/clinic-access";
import {
  ACCESS_STATE_BADGE,
  ACCESS_STATE_PRIORITY,
  BUSINESS_MODEL_LABELS,
  formatDate,
  formatTimestampDate,
  formatPrice,
} from "./labels";

/** "en 5 días" / "hoy" / "hace 3 días" -- días hasta el vencimiento (negativo = ya venció). */
function relativeDays(n: number | null): string {
  if (n === null) return "";
  if (n === 0) return "hoy";
  const abs = Math.abs(n);
  const label = `${abs} ${abs === 1 ? "día" : "días"}`;
  return n > 0 ? `en ${label}` : `hace ${label}`;
}

export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; orphans_failed?: string }>;
}) {
  const { deleted, orphans_failed } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await requireOperatorPage(supabase);

  const [
    { data: clinics },
    { data: subscriptions },
    { data: members },
    { data: overview },
    { data: openDeletions },
    { data: executedDeletions },
  ] = await Promise.all([
    supabase
      .from("clinics")
      .select("id, name, province, business_model, is_active, created_at")
      .order("name"),
    supabase.from("clinic_subscriptions").select("*"),
    supabase.from("clinic_members").select("clinic_id"),
    // El estado de acceso lo calcula UNA sola función en la base de datos
    // (la misma que usa el trigger de solo lectura): aquí nunca se recalcula.
    supabase.rpc("operator_clinic_access_overview"),
    supabase
      .from("clinic_deletion_requests")
      .select("id, clinic_id, clinic_name, channel, scheduled_for, export_confirmed_at")
      .eq("status", "solicitada"),
    supabase
      .from("clinic_deletion_requests")
      .select("id, clinic_name, channel, requested_by_email, executed_at, executed_by_email, deletion_summary")
      .eq("status", "ejecutada")
      .order("executed_at", { ascending: false })
      .limit(20),
  ]);

  const subByClinic = new Map((subscriptions ?? []).map((s) => [s.clinic_id, s]));
  const accessByClinic = new Map((overview ?? []).map((a) => [a.clinic_id, a]));
  const memberCountByClinic = new Map<string, number>();
  for (const m of members ?? []) {
    memberCountByClinic.set(m.clinic_id, (memberCountByClinic.get(m.clinic_id) ?? 0) + 1);
  }

  const stateOf = (clinicId: string) => (accessByClinic.get(clinicId)?.state ?? "sin_plan") as ClinicAccessState;

  // Primero lo que requiere acción: solo lectura, en gracia, por renovar, prueba
  // (la más próxima a vencer arriba); dentro de cada estado, por nombre.
  const sortedClinics = [...(clinics ?? [])].sort((a, b) => {
    const byState = ACCESS_STATE_PRIORITY[stateOf(a.id)] - ACCESS_STATE_PRIORITY[stateOf(b.id)];
    if (byState !== 0) return byState;
    const da = accessByClinic.get(a.id)?.days_to_expiry ?? Number.MAX_SAFE_INTEGER;
    const db = accessByClinic.get(b.id)?.days_to_expiry ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });

  const countByState = new Map<ClinicAccessState, number>();
  for (const c of clinics ?? []) countByState.set(stateOf(c.id), (countByState.get(stateOf(c.id)) ?? 0) + 1);
  const summary = (Object.keys(ACCESS_STATE_PRIORITY) as ClinicAccessState[])
    .filter((s) => countByState.has(s))
    .sort((a, b) => ACCESS_STATE_PRIORITY[a] - ACCESS_STATE_PRIORITY[b]);

  // Caso operador + admin de su propia clínica -- ver nota en src/app/page.tsx.
  const ownMembership = await getCurrentClinicMembership(supabase);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clínicas</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {clinics?.length ?? 0} clínica{clinics?.length === 1 ? "" : "s"} en la plataforma.
          </p>
        </div>
        {ownMembership && (
          <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
            Ir a tu clínica →
          </Link>
        )}
      </div>

      {deleted && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
          Eliminación ejecutada. La constancia queda al final de esta página.
          {orphans_failed ? ` No se pudieron eliminar ${orphans_failed} cuenta(s) de usuario: revísalas a mano.` : ""}
        </p>
      )}

      {(openDeletions ?? []).length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">Solicitudes de eliminación abiertas</p>
          <ul className="mt-1 list-disc pl-5">
            {(openDeletions ?? []).map((d) => (
              <li key={d.id}>
                <Link href={`/operator/${d.clinic_id}`} className="underline">
                  {d.clinic_name}
                </Link>{" "}
                —{" "}
                {d.scheduled_for
                  ? `se puede ejecutar desde el ${formatDate(d.scheduled_for)}`
                  : d.channel === "conservacion_vencida"
                    ? "lista para ejecutar"
                    : "falta que la clínica descargue y confirme"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {summary.map((s) => (
            <span key={s} className={`rounded-full px-2.5 py-1 font-medium ${ACCESS_STATE_BADGE[s]}`}>
              {countByState.get(s)} · {ACCESS_STATE_LABELS[s]}
            </span>
          ))}
        </div>
      )}

      {!clinics || clinics.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no hay clínicas registradas.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-4">Clínica</th>
                <th className="py-2 pr-4">Registro</th>
                <th className="py-2 pr-4">Acceso</th>
                <th className="py-2 pr-4">Vence / fin de prueba</th>
                <th className="py-2 pr-4">Modelo</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Precio</th>
                <th className="py-2 pr-4">Médicos</th>
                <th className="py-2 pr-4">Miembros</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {sortedClinics.map((clinic) => {
                const sub = subByClinic.get(clinic.id);
                const access = accessByClinic.get(clinic.id);
                const state = stateOf(clinic.id);
                return (
                  <tr key={clinic.id}>
                    <td className="py-3 pr-4">
                      <Link href={`/operator/${clinic.id}`} className="font-medium hover:underline">
                        {clinic.name}
                      </Link>
                      <div className="text-xs text-zinc-500">
                        {clinic.province}
                        {!clinic.is_active && <span className="ml-2 text-red-700 dark:text-red-400">Desactivada</span>}
                      </div>
                    </td>
                    <td className="py-3 pr-4">{formatTimestampDate(clinic.created_at)}</td>
                    <td className="py-3 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACCESS_STATE_BADGE[state]}`}>
                        {ACCESS_STATE_LABELS[state]}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {formatDate(access?.due_on ?? null)}
                      {state !== "exenta" && access?.days_to_expiry !== null && access?.days_to_expiry !== undefined && (
                        <div className="text-xs text-zinc-500">{relativeDays(access.days_to_expiry)}</div>
                      )}
                      {(state === "vencida_en_gracia" || state === "solo_lectura") && access?.blocked_on && (
                        <div className="text-xs text-red-700 dark:text-red-400">
                          Bloqueo {relativeDays(access.days_to_block)} ({formatDate(access.blocked_on)})
                          {access.block_deferred_until && " · acuerdo"}
                        </div>
                      )}
                      {state === "bloqueada" && access?.blocked_on && (
                        <div className="text-xs text-red-700 dark:text-red-400">
                          Cancelada el {formatDate(access.blocked_on)} · conservar hasta {formatDate(access.retention_until)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {BUSINESS_MODEL_LABELS[clinic.business_model]?.split(" — ")[0] ?? clinic.business_model}
                    </td>
                    <td className="py-3 pr-4">
                      {sub?.billing_period_days ? `${sub.billing_period_days} días` : "—"}
                    </td>
                    <td className="py-3 pr-4">{formatPrice(sub?.price ?? null)}</td>
                    <td className="py-3 pr-4">
                      {access?.seats_used ?? 0} / {sub?.included_clinician_seats ?? "∞"}
                    </td>
                    <td className="py-3 pr-4">{memberCountByClinic.get(clinic.id) ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(executedDeletions ?? []).length > 0 && (
        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium">Eliminaciones ejecutadas (constancias)</h2>
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
            {(executedDeletions ?? []).map((d) => (
              <li key={d.id} className="py-2 text-sm">
                <p>
                  <strong>{d.clinic_name}</strong> · pidió {d.requested_by_email} · ejecutó {d.executed_by_email}
                </p>
                <p className="text-xs text-zinc-500">
                  {d.executed_at ? new Date(d.executed_at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }) : ""}{" "}
                  · {JSON.stringify((d.deletion_summary as { deleted_rows?: unknown } | null)?.deleted_rows ?? {})}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
