import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { BillingForm } from "./billing-form";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

export default async function NewFiscalDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; encounterId?: string }>;
}) {
  const { patientId, encounterId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "recepcion") redirect("/dashboard");
  if (await isClinicReadOnly()) {
    return <ReadOnlyPage backHref="/billing" backLabel="Facturación" />;
  }

  if (!patientId) redirect("/patients");

  const { data: patient } = await supabase
    .from("patients")
    .select("id, first_name, last_name")
    .eq("id", patientId)
    .maybeSingle();
  if (!patient) notFound();

  return (
    <>
      <PageHeader
        title="Generar e-CF"
        back={{ href: `/patients/${patientId}`, label: <>{patient.first_name} {patient.last_name}</> }}
      />
      <PageBody narrow>
      <BillingForm
        patientId={patient.id}
        patientName={`${patient.first_name} ${patient.last_name}`}
        encounterId={encounterId}
      />
      </PageBody>
    </>
  );
}
