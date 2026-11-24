import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { PatientForm } from "./patient-form";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

export default async function NewPatientPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (await isClinicReadOnly()) {
    return <ReadOnlyPage backHref="/patients" backLabel="Pacientes" />;
  }

  return (
    <>
      <PageHeader
        title="Nuevo paciente"
        back={{ href: "/patients", label: "Pacientes" }}
      />
      <PageBody>
        <PatientForm
          canRecordConsent={membership.role === "admin" || membership.role === "recepcion"}
          canEditReligion={membership.role === "admin" || membership.role === "medico"}
        />
      </PageBody>
    </>
  );
}
