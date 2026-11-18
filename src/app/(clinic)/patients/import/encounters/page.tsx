import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { EncounterImportForm } from "./encounter-import-form";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

export default async function UploadEncounterImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/patients");
  if (await isClinicReadOnly()) {
    return <ReadOnlyPage backHref="/patients" backLabel="Pacientes" />;
  }

  const { data: templates } = await supabase
    .from("specialty_templates")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <>
      <PageHeader
        title="Importar consultas por especialidad"
        subtitle="Elige la especialidad, descarga su plantilla (formato campo/valor) y súbela llena. Los pacientes deben existir ya en la clínica. Máximo 500 filas por archivo."
        back={{ href: "/patients/import", label: "Importar" }}
      />
      <PageBody narrow>
      {!templates || templates.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay plantillas de especialidad configuradas todavía.
        </p>
      ) : (
        <EncounterImportForm templates={templates} />
      )}
      </PageBody>
    </>
  );
}
