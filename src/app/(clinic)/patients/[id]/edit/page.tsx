import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { EditPatientForm } from "./edit-patient-form";

/** Editar los datos del paciente: solo admin y médicos (recepción edita únicamente el contacto, desde la ficha). */
export default async function EditPatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string }>;
}) {
  const { id } = await params;
  const { aviso } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect(`/patients/${id}`);
  if (await isClinicReadOnly()) return <ReadOnlyPage backHref={`/patients/${id}`} backLabel="Paciente" />;

  const [{ data: patient }, { data: consent }, { data: religion }] = await Promise.all([
    supabase.from("patients").select("*").eq("id", id).maybeSingle(),
    supabase.from("patient_messaging_consents").select("id").eq("patient_id", id).is("revoked_at", null).maybeSingle(),
    supabase.from("patient_religion").select("religion, religion_other").eq("patient_id", id).maybeSingle(),
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
      <PageBody>
        {aviso === "religion" && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            El paciente se creó, pero no se pudo guardar la religión. Vuelve a indicarla aquí y guarda.
          </p>
        )}
        <EditPatientForm
          patientId={id}
          hasActiveConsent={!!consent}
          hasReligionOnFile={!!religion}
          initial={{
            first_name: patient.first_name,
            last_name: patient.last_name,
            date_of_birth: patient.date_of_birth,
            sex: patient.sex,
            national_id: patient.national_id ?? "",
            education_level: patient.education_level ?? "",
            marital_status: patient.marital_status ?? "",
            residence: patient.residence ?? "",
            place_of_origin: patient.place_of_origin ?? "",
            occupation: patient.occupation ?? "",
            informant_type: patient.informant_type ?? "paciente",
            informant_name: patient.informant_name ?? "",
            religion: religion?.religion ?? "",
            religion_other: religion?.religion_other ?? "",
            phone: patient.phone ?? "",
            email: patient.email ?? "",
          }}
        />
      </PageBody>
    </>
  );
}
