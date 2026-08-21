import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { groupFieldsBySection, parseTemplateSchema } from "@/lib/domain/specialty-template";
import { ClaimForm } from "./claims/claim-form";
import { ClaimStatusForm } from "@/app/(clinic)/claims/claim-status-form";

const CLAIM_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
};

const VITAL_LABELS: Record<string, string> = {
  systolic_bp: "PA sistólica",
  diastolic_bp: "PA diastólica",
  heart_rate: "FC (lpm)",
  respiratory_rate: "FR (rpm)",
  temperature_celsius: "Temp (°C)",
  oxygen_saturation: "SatO₂ (%)",
  weight_kg: "Peso (kg)",
  height_cm: "Talla (cm)",
};

export default async function EncounterDetailPage({
  params,
}: {
  params: Promise<{ id: string; encounterId: string }>;
}) {
  const { id, encounterId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  const canManageBilling = membership?.role === "admin" || membership?.role === "recepcion";

  const { data: patient } = await supabase
    .from("patients")
    .select("id, first_name, last_name")
    .eq("id", id)
    .maybeSingle();
  if (!patient) notFound();

  const { data: encounter } = await supabase
    .from("encounters")
    .select("id, encounter_date, chief_complaint, specialty_data, specialty_template_id")
    .eq("id", encounterId)
    .eq("patient_id", id)
    .maybeSingle();
  if (!encounter) notFound();

  const [{ data: template }, { data: vitals }, { data: insurers }, { data: claims }] = await Promise.all([
    supabase
      .from("specialty_templates")
      .select("name, schema")
      .eq("id", encounter.specialty_template_id)
      .single(),
    supabase.from("vital_signs").select("*").eq("encounter_id", encounterId).maybeSingle(),
    supabase
      .from("patient_insurers")
      .select("id, insurer_name, affiliate_number")
      .eq("patient_id", id)
      .order("recorded_at", { ascending: false }),
    supabase
      .from("insurance_claims")
      .select("id, status, claimed_amount, rejection_reason, notes, created_by, created_at, patient_insurer_id")
      .eq("encounter_id", encounterId)
      .order("created_at", { ascending: false }),
  ]);

  const insurerNameById = new Map((insurers ?? []).map((i) => [i.id, i.insurer_name]));

  // El email no vive en `insurance_claims` -- se resuelve server-side,
  // mismo patrón que src/app/team/page.tsx.
  const admin = createAdminClient();
  const claimCreatorEmailByUserId = new Map<string, string>();
  await Promise.all(
    Array.from(new Set((claims ?? []).map((c) => c.created_by))).map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      if (data.user?.email) claimCreatorEmailByUserId.set(userId, data.user.email);
    })
  );

  const fields = template ? parseTemplateSchema(template.schema).fields : [];
  const specialtyData = (encounter.specialty_data ?? {}) as Record<string, unknown>;

  const vitalEntries = vitals
    ? Object.entries(VITAL_LABELS)
        .map(([key, label]) => [label, (vitals as Record<string, unknown>)[key]] as const)
        .filter(([, value]) => value !== null && value !== undefined)
    : [];

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href={`/patients/${id}`} className="text-sm text-zinc-500 hover:underline">
          ← {patient.first_name} {patient.last_name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{template?.name ?? "Consulta"}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {new Date(encounter.encounter_date).toLocaleString("es-DO")}
        </p>
        <div className="mt-2 flex flex-col gap-1">
          <Link
            href={`/patients/${id}/consents/new?encounterId=${encounterId}`}
            className="text-sm text-zinc-500 hover:underline"
          >
            Firmar consentimiento para esta consulta →
          </Link>
          <Link
            href={`/billing/new?patientId=${id}&encounterId=${encounterId}`}
            className="text-sm text-zinc-500 hover:underline"
          >
            Generar e-CF para esta consulta →
          </Link>
        </div>
      </div>

      {encounter.chief_complaint && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Motivo de consulta</h2>
          <p className="text-sm">{encounter.chief_complaint}</p>
        </div>
      )}

      {vitalEntries.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Signos vitales</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            {vitalEntries.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-zinc-500">{label}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {groupFieldsBySection(fields).map(([sectionTitle, sectionFields]) => {
        const filled = sectionFields.filter((field) => {
          const value = specialtyData[field.key];
          return value !== undefined && value !== "" && value !== null;
        });
        if (filled.length === 0) return null;
        return (
          <div key={sectionTitle ?? "__default"} className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              {sectionTitle ?? "Nota de la especialidad"}
            </h2>
            {filled.map((field) => (
              <div key={field.key}>
                <dt className="text-xs text-zinc-500">{field.label}</dt>
                <dd className="whitespace-pre-wrap text-sm">{String(specialtyData[field.key])}</dd>
              </div>
            ))}
          </div>
        );
      })}

      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Reclamaciones</h2>
        {!claims || claims.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin reclamaciones registradas.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {claims.map((claim) => (
              <li key={claim.id} className="flex flex-col gap-1 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {insurerNameById.get(claim.patient_insurer_id) ?? "Aseguradora"}
                    {claim.claimed_amount != null
                      ? ` — RD$ ${claim.claimed_amount.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`
                      : ""}
                  </span>
                  <span className="text-xs font-medium">{CLAIM_STATUS_LABELS[claim.status] ?? claim.status}</span>
                </div>
                <p className="text-xs text-zinc-500">
                  {new Date(claim.created_at).toLocaleString("es-DO")} · registrado por{" "}
                  {claimCreatorEmailByUserId.get(claim.created_by) ?? claim.created_by}
                  {claim.notes ? ` — ${claim.notes}` : ""}
                  {claim.status === "rechazada" && claim.rejection_reason
                    ? ` · motivo: ${claim.rejection_reason}`
                    : ""}
                </p>
                {canManageBilling && <ClaimStatusForm claimId={claim.id} currentStatus={claim.status} />}
              </li>
            ))}
          </ul>
        )}
        {canManageBilling && <ClaimForm patientId={id} encounterId={encounterId} insurers={insurers ?? []} />}
      </div>
    </div>
  );
}
