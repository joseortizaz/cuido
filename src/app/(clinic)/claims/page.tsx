import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { ClaimHistory } from "./claim-history";
import { PackageCard } from "./package-card";
import { listPackageInsurers } from "@/lib/bulk-import/claims-package";
import { ClaimStatusForm } from "./claim-status-form";
import { ClaimPaymentForm } from "./claim-payment-form";
import { CLAIM_STATUS_LABELS, CLAIM_STATUSES, formatMoney, pendingToCollect } from "@/lib/domain/claims";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";

const STATUS_LABELS: Record<string, string> = CLAIM_STATUS_LABELS;
const STATUSES: string[] = [...CLAIM_STATUSES];

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
  const readOnly = await isClinicReadOnly();
  const isBillingRole = membership.role === "admin" || membership.role === "recepcion";
  const canManageBilling = isBillingRole && !readOnly;

  const activeStatus = status && STATUSES.includes(status) ? status : undefined;

  let query = supabase
    .from("insurance_claims")
    .select(
      "id, status, claimed_amount, rejection_reason, encounter_id, patient_insurer_id, created_at, fiscal_document_id, authorization_number, approved_amount, paid_amount, paid_on, insurance_claim_status_history(from_status, to_status, changed_at, changed_by, rejection_reason, approved_amount)"
    )
    .order("created_at", { ascending: false });
  if (activeStatus) query = query.eq("status", activeStatus);
  const { data: claims } = await query;

  const encounterIds = Array.from(new Set((claims ?? []).map((c) => c.encounter_id)));
  const insurerIds = Array.from(new Set((claims ?? []).map((c) => c.patient_insurer_id)));
  const documentIds = Array.from(
    new Set((claims ?? []).map((c) => c.fiscal_document_id).filter((v): v is string => !!v))
  );
  const claimIds = (claims ?? []).map((c) => c.id);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

  const [{ data: encounters }, { data: insurers }, { data: documents }, { data: diagnoses }] = await Promise.all([
    encounterIds.length > 0
      ? supabase.from("encounters").select("id, patient_id, encounter_date").in("id", encounterIds)
      : Promise.resolve({ data: [] as { id: string; patient_id: string; encounter_date: string }[] }),
    insurerIds.length > 0
      ? supabase.from("patient_insurers").select("id, insurer_name, affiliate_number").in("id", insurerIds)
      : Promise.resolve({ data: [] as { id: string; insurer_name: string; affiliate_number: string }[] }),
    documentIds.length > 0
      ? supabase.from("fiscal_documents").select("id, e_ncf").in("id", documentIds)
      : Promise.resolve({ data: [] as { id: string; e_ncf: string | null }[] }),
    claimIds.length > 0
      ? supabase
          .from("insurance_claim_diagnoses")
          .select("claim_id, code, code_system, description, is_primary")
          .in("claim_id", claimIds)
          .order("position", { ascending: true })
      : Promise.resolve({
          data: [] as { claim_id: string; code: string; code_system: string; description: string; is_primary: boolean }[],
        }),
  ]);

  const patientIds = Array.from(new Set((encounters ?? []).map((e) => e.patient_id)));
  const { data: patients } =
    patientIds.length > 0
      ? await supabase.from("patients").select("id, first_name, last_name").in("id", patientIds)
      : { data: [] as { id: string; first_name: string; last_name: string }[] };

  const encounterById = new Map((encounters ?? []).map((e) => [e.id, e]));
  const patientById = new Map((patients ?? []).map((p) => [p.id, p]));
  const insurerById = new Map((insurers ?? []).map((i) => [i.id, i]));

  // Paquete para presentar a la ARS (personal de facturación) y correos del historial.
  const packageInsurers = isBillingRole ? await listPackageInsurers(supabase) : [];
  const historyUserIds = new Set<string>();
  for (const c of claims ?? []) for (const h of c.insurance_claim_status_history ?? []) if (h.changed_by) historyUserIds.add(h.changed_by);
  const emailByUserId = new Map<string, string>();
  if (historyUserIds.size > 0) {
    const admin = createAdminClient();
    await Promise.all(
      Array.from(historyUserIds).map(async (userId) => {
        const { data } = await admin.auth.admin.getUserById(userId);
        if (data.user?.email) emailByUserId.set(userId, data.user.email);
      })
    );
  }
  const documentById = new Map((documents ?? []).map((d) => [d.id, d]));
  const diagnosesByClaim = new Map<string, NonNullable<typeof diagnoses>>();
  for (const d of diagnoses ?? []) {
    const list = diagnosesByClaim.get(d.claim_id) ?? [];
    list.push(d);
    diagnosesByClaim.set(d.claim_id, list);
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Reclamaciones</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Seguimiento de reclamaciones ante aseguradoras — envío manual, sin integración en vivo. El comprobante, la
          autorización y los diagnósticos codificados se editan desde la consulta.
        </p>
      </div>
      {isBillingRole && (
        <>
          <PackageCard insurers={packageInsurers} />
          <p className="text-sm">
            <Link href="/claims/reports" className="text-brand-blue hover:underline">
              Ver reportes de reclamaciones →
            </Link>
          </p>
        </>
      )}
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
                    {claim.claimed_amount != null ? ` · ${formatMoney(claim.claimed_amount)}` : ""}
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
                <p className="text-xs text-zinc-500">
                  {claim.fiscal_document_id
                    ? `e-CF ${documentById.get(claim.fiscal_document_id)?.e_ncf ?? "sin e-NCF"}`
                    : "Sin comprobante vinculado"}
                  {claim.authorization_number ? ` · autorización ${claim.authorization_number}` : ""}
                  {claim.approved_amount != null ? ` · aprobado ${formatMoney(claim.approved_amount)}` : ""}
                  {claim.paid_amount != null
                    ? ` · cobrado ${formatMoney(claim.paid_amount)}${claim.paid_on ? ` (${claim.paid_on})` : ""}`
                    : ""}
                  {pendingToCollect(claim) ? ` · por cobrar ${formatMoney(pendingToCollect(claim) ?? 0)}` : ""}
                </p>
                <p className="text-xs text-zinc-500">
                  {(diagnosesByClaim.get(claim.id) ?? []).length > 0
                    ? `Diagnósticos: ${(diagnosesByClaim.get(claim.id) ?? [])
                        .map((d) => `${d.code}${d.is_primary ? " (principal)" : ""}`)
                        .join(", ")}`
                    : "Sin diagnóstico codificado"}
                </p>
                <ClaimHistory rows={claim.insurance_claim_status_history ?? []} emailByUserId={emailByUserId} />
                {canManageBilling && (
                  <>
                    <ClaimStatusForm
                      key={`${claim.id}-${claim.status}-${claim.approved_amount ?? ""}`}
                      claimId={claim.id}
                      currentStatus={claim.status}
                      currentApproved={claim.approved_amount}
                    />
                    {claim.status === "aprobada" && (
                      <ClaimPaymentForm
                        claimId={claim.id}
                        currentPaid={claim.paid_amount}
                        currentPaidOn={claim.paid_on}
                        today={today}
                      />
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
