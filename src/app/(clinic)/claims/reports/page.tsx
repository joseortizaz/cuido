import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { loadClaimsReport } from "@/lib/bulk-import/claims-report-data";
import { PERIOD_OPTIONS } from "@/lib/domain/claims-report";
import { CLAIM_STATUS_LABELS, formatMoney } from "@/lib/domain/claims";

const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)} %`);
const days = (n: number | null) => (n === null ? "—" : `${(Math.round(n * 10) / 10).toLocaleString("es-DO")} d`);

export default async function ClaimsReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: requested } = await searchParams;
  const period = PERIOD_OPTIONS.some((p) => p.value === requested) ? (requested as string) : "90";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  // Reportes de facturación: admin y recepción; el resto vuelve al listado.
  if (membership.role !== "admin" && membership.role !== "recepcion") redirect("/claims");

  const { report, since } = await loadClaimsReport(supabase, period);
  const t = report.totals;
  const card = "rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/claims" className="text-sm text-zinc-500 hover:underline">
          ← Reclamaciones
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Reportes de reclamaciones</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Solo de tu clínica. {since ? `Reclamaciones registradas desde el ${since}.` : "Todo el historial."}
        </p>
      </div>

      <nav className="flex flex-wrap items-center gap-2 text-sm">
        {PERIOD_OPTIONS.map((p) => (
          <Link
            key={p.value}
            href={`/claims/reports?period=${p.value}`}
            className={
              p.value === period
                ? "rounded-full bg-foreground px-3 py-1 text-background"
                : "rounded-full border border-zinc-300 px-3 py-1 hover:bg-black/[.04] dark:border-zinc-700 dark:hover:bg-white/[.08]"
            }
          >
            {p.label}
          </Link>
        ))}
        {/* <a> normal, no <Link>: descarga un archivo (Route Handler con Content-Disposition). */}
        <a href={`/claims/reports/export?period=${period}`} className="ml-auto text-brand-blue hover:underline">
          Descargar .xlsx
        </a>
      </nav>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className={card}>
          <p className="text-xs text-zinc-500">Reclamaciones</p>
          <p className="text-2xl font-semibold">{t.count}</p>
          <p className="text-xs text-zinc-500">
            {(["pendiente", "enviada", "aprobada", "rechazada"] as const)
              .map((s) => `${t.byStatus[s]} ${CLAIM_STATUS_LABELS[s].toLowerCase()}${t.byStatus[s] === 1 ? "" : "s"}`)
              .join(" · ")}
          </p>
        </div>
        <div className={card}>
          <p className="text-xs text-zinc-500">Reclamado / aprobado</p>
          <p className="text-lg font-semibold">{formatMoney(t.claimed)}</p>
          <p className="text-xs text-zinc-500">aprobado {formatMoney(t.approved)}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-zinc-500">Cobrado / por cobrar</p>
          <p className="text-lg font-semibold">{formatMoney(t.paid)}</p>
          <p className="text-xs text-zinc-500">por cobrar {formatMoney(t.pending)}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-zinc-500">Tasa de rechazo</p>
          <p className="text-2xl font-semibold">{pct(t.rejectionRate)}</p>
          <p className="text-xs text-zinc-500">rechazadas ÷ (aprobadas + rechazadas)</p>
        </div>
        <div className={card}>
          <p className="text-xs text-zinc-500">Respuesta de la ARS</p>
          <p className="text-2xl font-semibold">{days(t.avgResponseDays)}</p>
          <p className="text-xs text-zinc-500">promedio desde que se envía</p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Por aseguradora</h2>
        {report.byInsurer.length === 0 ? (
          <p className="text-sm text-zinc-500">Sin reclamaciones en este periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-4">ARS</th>
                  <th className="py-2 pr-4">Reclam.</th>
                  <th className="py-2 pr-4">Pend.</th>
                  <th className="py-2 pr-4">Env.</th>
                  <th className="py-2 pr-4">Aprob.</th>
                  <th className="py-2 pr-4">Rech.</th>
                  <th className="py-2 pr-4">Reclamado</th>
                  <th className="py-2 pr-4">Por cobrar</th>
                  <th className="py-2 pr-4">Rechazo</th>
                  <th className="py-2 pr-4">Respuesta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {report.byInsurer.map((r) => (
                  <tr key={r.key}>
                    <td className="py-2 pr-4 font-medium">{r.label}</td>
                    <td className="py-2 pr-4">{r.count}</td>
                    <td className="py-2 pr-4">{r.byStatus.pendiente}</td>
                    <td className="py-2 pr-4">{r.byStatus.enviada}</td>
                    <td className="py-2 pr-4">{r.byStatus.aprobada}</td>
                    <td className="py-2 pr-4">{r.byStatus.rechazada}</td>
                    <td className="py-2 pr-4">{formatMoney(r.claimed)}</td>
                    <td className="py-2 pr-4">{formatMoney(r.pending)}</td>
                    <td className="py-2 pr-4">{pct(r.rejectionRate)}</td>
                    <td className="py-2 pr-4">{days(r.avgResponseDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Motivos de rechazo</h2>
        {report.byReason.length === 0 ? (
          <p className="text-sm text-zinc-500">Sin rechazos en este periodo.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
            {report.byReason.map((r) => (
              <li key={r.reason} className="flex justify-between gap-4 py-2">
                <span>{r.reason}</span>
                <span className="font-medium">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Antigüedad</h2>
        <p className="text-xs text-zinc-500">
          Enviadas sin respuesta (desde que se enviaron) y aprobadas con saldo por cobrar (desde que se aprobaron).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-4">Tramo</th>
                <th className="py-2 pr-4">Enviadas sin respuesta</th>
                <th className="py-2 pr-4">Monto reclamado</th>
                <th className="py-2 pr-4">Aprobadas con saldo</th>
                <th className="py-2 pr-4">Saldo por cobrar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {report.sentWithoutResponse.buckets.map((b, i) => (
                <tr key={b.label}>
                  <td className="py-2 pr-4">{b.label}</td>
                  <td className="py-2 pr-4">{b.count}</td>
                  <td className="py-2 pr-4">{formatMoney(b.amount)}</td>
                  <td className="py-2 pr-4">{report.approvedWithBalance.buckets[i].count}</td>
                  <td className="py-2 pr-4">{formatMoney(report.approvedWithBalance.buckets[i].amount)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 pr-4">Total</td>
                <td className="py-2 pr-4">{report.sentWithoutResponse.count}</td>
                <td className="py-2 pr-4">{formatMoney(report.sentWithoutResponse.amount)}</td>
                <td className="py-2 pr-4">{report.approvedWithBalance.count}</td>
                <td className="py-2 pr-4">{formatMoney(report.approvedWithBalance.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
