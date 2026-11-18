import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { EditPatientForm } from "./edit-patient-form";

/** Editar los datos del paciente: solo admin y médicos (recepción edita únicamente el contacto, desde la ficha). */
export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect(`/patients/${id}`);
  if (await isClinicReadOnly()) return <ReadOnlyPage backHref={`/patients/${id}`} backLabel="Paciente" />;

  const [{ data: patient }, { data: consent }] = await Promise.all([
    supabase.from("patients").select("*").eq("id", id).maybeSingle(),
    supabase.from("patient_messaging_consents").select("id").eq("patient_id", id).is("revoked_at", null).maybeSingle(),
  ]);
  if (!patient) notFound();
  if (patient.voided_at !== null) redirect(`/patients/${id}`);

  return (
    <>
      <PageHeader
        title="Editar paciente"
        subtitle={
          <>
            {patient.first_name} {patient.last_name} · Código {patient.record_number}
          </>
        }
        back={{ href: `/patients/${id}`, label: <>{patient.first_name} {patient.last_name}</> }}
      />
      <PageBody narrow>
        <EditPatientForm
          patientId={id}
          hasActiveConsent={!!consent}
          initial={{
            first_name: patient.first_name,
            last_name: patient.last_name,
            date_of_birth: patient.date_of_birth,
            sex: patient.sex,
            national_id: patient.national_id ?? "",
            phone: patient.phone ?? "",
            email: patient.email ?? "",
          }}
        />
      </PageBody>
    </>
  );
}
