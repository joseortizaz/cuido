import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { ConsentForm } from "./consent-form";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { formatDrDate } from "@/lib/domain/dr-time";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

export default async function NewConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ encounterId?: string }>;
}) {
  const { id } = await params;
  const { encounterId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (await isClinicReadOnly()) {
    return <ReadOnlyPage backHref={`/patients/${id}`} backLabel="Paciente" />;
  }

  const [{ data: patient }, { data: templates }, { data: encounters }] = await Promise.all([
    supabase.from("patients").select("id, first_name, last_name").eq("id", id).maybeSingle(),
    supabase
      .from("consent_templates")
      .select("id, title, body")
      .eq("is_active", true)
      .order("title"),
    supabase
      .from("encounters")
      .select("id, encounter_date, chief_complaint")
      .eq("patient_id", id)
      .order("encounter_date", { ascending: false }),
  ]);
  if (!patient) notFound();

  const encounterOptions = (encounters ?? []).map((e) => ({
    id: e.id,
    label: `${formatDrDate(e.encounter_date)}${e.chief_complaint ? ` — ${e.chief_complaint}` : ""}`,
  }));

  return (
    <>
      <PageHeader
        title="Firmar consentimiento"
        back={{ href: `/patients/${id}`, label: <>{patient.first_name} {patient.last_name}</> }}
      />
      <PageBody narrow>
      <ConsentForm
        patientId={id}
        templates={templates ?? []}
        encounters={encounterOptions}
        defaultEncounterId={encounterId}
      />
      </PageBody>
    </>
  );
}
