import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { ClaimStatusForm } from "./claim-status-form";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
};
const STATUSES = Object.keys(STATUS_LABELS);

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  const canManageBilling = membership.role === "admin" || membership.role === "recepcion";

  const activeStatus = status && STATUSES.includes(status) ? status : undefined;

  let query = supabase
    .from("insurance_claims")
    .select("id, status, claimed_amount, rejection_reason, encounter_id, patient_insurer_id, created_at")
    .order("created_at", { ascending: false });
  if (activeStatus) query = query.eq("status", activeStatus);
  const { data: claims } = await query;

  const encounterIds = Array.from(new Set((claims ?? []).map((c) => c.encounter_id)));
  const insurerIds = Array.from(new Set((claims ?? []).map((c) => c.patient_insurer_id)));

  const [{ data: encounters }, { data: insurers }] = await Promise.all([
    encounterIds.length > 0
      ? supabase.from("encounters").select("id, patient_id, encounter_date").in("id", encounterIds)
      : Promise.resolve({ data: [] as { id: string; patient_id: string; encounter_date: string }[] }),
    insurerIds.length > 0
      ? supabase.from("patient_insurers").select("id, insurer_name, affiliate_number").in("id", insurerIds)
      : Promise.resolve({ data: [] as { id: string; insurer_name: string; affiliate_number: string }[] }),
  ]);

  const patientIds = Array.from(new Set((encounters ?? []).map((e) => e.patient_id)));
  const { data: patients } =
    patientIds.length > 0
      ? await supabase.from("patients").select("id, first_name, last_name").in("id", patientIds)
      : { data: [] as { id: string; first_name: string; last_name: string }[] };

  const encounterById = new Map((encounters ?? []).map((e) => [e.id, e]));
  const patientById = new Map((patients ?? []).map((p) => [p.id, p]));
  const insurerById = new Map((insurers ?? []).map((i) => [i.id, i]));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Reclamaciones</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Seguimiento de reclamaciones ante aseguradoras — envío manual, sin integración en vivo.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/claims"
          className={
            !activeStatus
              ? "rounded-full bg-foreground px-3 py-1 text-background"
              : "rounded-full border border-zinc-300 px-3 py-1 hover:bg-black/[.04] dark:border-zinc-700 dark:hover:bg-white/[.08]"
          }
        >
          Todas
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/claims?status=${s}`}
            className={
              activeStatus === s
                ? "rounded-full bg-foreground px-3 py-1 text-background"
                : "rounded-full border border-zinc-300 px-3 py-1 hover:bg-black/[.04] dark:border-zinc-700 dark:hover:bg-white/[.08]"
            }
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>

      {!claims || claims.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin reclamaciones en este filtro.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {claims.map((claim) => {
            const encounter = encounterById.get(claim.encounter_id);
            const patient = encounter ? patientById.get(encounter.patient_id) : undefined;
            const insurer = insurerById.get(claim.patient_insurer_id);
            return (
              <li key={claim.id} className="flex flex-col gap-1 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {patient ? (
                      <Link href={`/patients/${patient.id}`} className="font-medium hover:underline">
                        {patient.first_name} {patient.last_name}
                      </Link>
                    ) : (
                      "Paciente"
                    )}
                    {" — "}
                    {insurer ? `${insurer.insurer_name} (${insurer.affiliate_number})` : "Aseguradora"}
                    {claim.claimed_amount != null
                      ? ` · RD$ ${claim.claimed_amount.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`
                      : ""}
                  </span>
                  <span className="text-xs font-medium">{STATUS_LABELS[claim.status] ?? claim.status}</span>
                </div>
                <p className="text-xs text-zinc-500">
                  {encounter && (
                    <Link
                      href={`/patients/${encounter.patient_id}/encounters/${encounter.id}`}
                      className="hover:underline"
                    >
                      Ver consulta ({new Date(encounter.encounter_date).toLocaleDateString("es-DO")}) →
                    </Link>
                  )}
                  {claim.status === "rechazada" && claim.rejection_reason
                    ? ` · motivo: ${claim.rejection_reason}`
                    : ""}
                </p>
                {canManageBilling && <ClaimStatusForm claimId={claim.id} currentStatus={claim.status} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
