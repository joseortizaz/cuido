import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";
import { HeaderLink, PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { ProfessionalForm } from "./professional-form";

/** Datos profesionales del médico (nombre, especialidad y exequátur): salen impresos en sus recetas. */
export default async function ProfessionalProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect("/dashboard");
  const readOnly = await isClinicReadOnly();

  const { data: member } = await supabase
    .from("clinic_members")
    .select("professional_name, professional_title, exequatur")
    .eq("clinic_id", membership.clinicId)
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <>
      <PageHeader
        title="Mis datos profesionales"
        subtitle="Nombre, especialidad y exequátur: salen impresos al pie de cada receta."
        back={{ href: "/dashboard", label: "Dashboard" }}
        actions={<HeaderLink href="/profile/specialties">Mis especialidades →</HeaderLink>}
      />
      <PageBody narrow>
        <ProfessionalForm
          disabled={readOnly}
          initial={{ name: member?.professional_name ?? "", title: member?.professional_title ?? "", exequatur: member?.exequatur ?? "" }}
        />
      </PageBody>
    </>
  );
}
