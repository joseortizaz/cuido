import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { DEFAULT_PATIENT_CODE_FORMAT } from "@/lib/domain/patient-code";
import { PatientCodeSettingsForm } from "./settings-form";

/**
 * Formato del código de paciente de la clínica (solo admin). El código lo asigna la base de datos al
 * crear cada paciente; aquí solo se configura cómo se arma y se ve cuál sería el siguiente.
 */
export default async function PatientCodeSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/dashboard");
  const readOnly = await isClinicReadOnly();

  const [{ data: settings }, { data: nextCode }] = await Promise.all([
    supabase
      .from("clinic_patient_code_settings")
      .select("format, start_number, reset_yearly")
      .eq("clinic_id", membership.clinicId)
      .maybeSingle(),
    supabase.rpc("preview_next_patient_code", { p_clinic_id: membership.clinicId }),
  ]);

  const year = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }).slice(0, 4);

  return (
    <>
      <PageHeader
        title="Código de paciente"
        subtitle="Cada paciente nuevo recibe un código único y consecutivo que Cuido asigna solo."
        back={{ href: "/patients", label: "Pacientes" }}
      />
      <PageBody narrow>
        <PatientCodeSettingsForm
          initialFormat={settings?.format ?? DEFAULT_PATIENT_CODE_FORMAT}
          initialStart={settings?.start_number ?? 1}
          initialResetYearly={settings?.reset_yearly ?? true}
          nextCode={nextCode ?? "—"}
          year={year}
          disabled={readOnly}
        />
      </PageBody>
    </>
  );
}
