import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { AllergyForm } from "./allergy-form";
import { MedicationForm } from "./medication-form";
import { RevokeConsentForm } from "./consents/revoke-consent-form";

const CONSENT_RELATIONSHIP_LABELS: Record<string, string> = {
  paciente: "el propio paciente",
  tutor: "tutor",
  representante: "representante",
};

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const { data: patient } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
  if (!patient) notFound();

  const [{ data: allergies }, { data: medications }, { data: encounters }, { data: templates }, { data: consents }] =
    await Promise.all([
      supabase
        .from("allergies")
        .select("id, substance, reaction, severity, status")
        .eq("patient_id", id)
        .order("recorded_at", { ascending: false }),
      supabase
        .from("medications")
        .select("id, name, dose, frequency, status")
        .eq("patient_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("encounters")
        .select("id, encounter_date, chief_complaint, specialty_template_id")
        .eq("patient_id", id)
        .order("encounter_date", { ascending: false }),
      supabase.from("specialty_templates").select("id, name"),
      supabase
        .from("consents")
        .select("id, document_title, signer_name, signer_relationship, signed_at, status, recorded_by")
        .eq("patient_id", id)
        .order("signed_at", { ascending: false }),
    ]);

  const templateNameById = new Map((templates ?? []).map((t) => [t.id, t.name]));
  const canWriteClinical = membership.role === "admin" || membership.role === "medico";

  // El email no vive en `consents` (auth.users no está expuesto vía la Data
  // API) -- se resuelve server-side, mismo patrón que src/app/team/page.tsx.
  const admin = createAdminClient();
  const recorderEmailByUserId = new Map<string, string>();
  await Promise.all(
    Array.from(new Set((consents ?? []).map((c) => c.recorded_by))).map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      if (data.user?.email) recorderEmailByUserId.set(userId, data.user.email);
    })
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <div>
        <Link href="/patients" className="text-sm text-zinc-500 hover:underline">
          ← Pacientes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {patient.first_name} {patient.last_name}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {patient.date_of_birth} · {patient.sex}
          {patient.national_id ? ` · ${patient.national_id}` : ""}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Consultas</h2>
          {canWriteClinical && (
            <Link
              href={`/patients/${id}/encounters/new`}
              className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              Nueva consulta
            </Link>
          )}
        </div>
        {!encounters || encounters.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin consultas registradas.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {encounters.map((encounter) => (
              <li key={encounter.id}>
                <Link
                  href={`/patients/${id}/encounters/${encounter.id}`}
                  className="flex items-center justify-between py-3 text-sm hover:underline"
                >
                  <span>
                    {templateNameById.get(encounter.specialty_template_id) ?? "Consulta"}
                    {encounter.chief_complaint ? ` — ${encounter.chief_complaint}` : ""}
                  </span>
                  <span className="text-zinc-500">
                    {new Date(encounter.encounter_date).toLocaleDateString("es-DO")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Alergias</h2>
        {!allergies || allergies.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin alergias registradas.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {allergies.map((allergy) => (
              <li key={allergy.id}>
                <span className="font-medium">{allergy.substance}</span>
                {allergy.reaction ? ` — ${allergy.reaction}` : ""}
                {allergy.severity ? ` (${allergy.severity})` : ""}
                {allergy.status === "resuelta" ? " · resuelta" : ""}
              </li>
            ))}
          </ul>
        )}
        {canWriteClinical && <AllergyForm patientId={id} />}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Medicamentos activos</h2>
        {!medications || medications.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin medicamentos registrados.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {medications.map((medication) => (
              <li key={medication.id}>
                <span className="font-medium">{medication.name}</span>
                {medication.dose ? ` — ${medication.dose}` : ""}
                {medication.frequency ? ` — ${medication.frequency}` : ""}
                {medication.status === "descontinuado" ? " · descontinuado" : ""}
              </li>
            ))}
          </ul>
        )}
        {canWriteClinical && <MedicationForm patientId={id} />}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Consentimientos</h2>
          <Link
            href={`/patients/${id}/consents/new`}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Firmar consentimiento
          </Link>
        </div>
        {!consents || consents.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin consentimientos firmados.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {consents.map((consent) => (
              <li key={consent.id} className="flex flex-col gap-1 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{consent.document_title}</span> — firmado por{" "}
                    {consent.signer_name} (
                    {CONSENT_RELATIONSHIP_LABELS[consent.signer_relationship] ?? consent.signer_relationship}
                    )
                  </span>
                  <span
                    className={
                      consent.status === "revocado"
                        ? "text-xs font-medium text-red-700 dark:text-red-400"
                        : "text-xs font-medium text-green-700 dark:text-green-400"
                    }
                  >
                    {consent.status === "revocado" ? "Revocado" : "Firmado"}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  {new Date(consent.signed_at).toLocaleString("es-DO")} · registrado por{" "}
                  {recorderEmailByUserId.get(consent.recorded_by) ?? consent.recorded_by}
                </p>
                {canWriteClinical && consent.status === "firmado" && (
                  <RevokeConsentForm patientId={id} consentId={consent.id} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
