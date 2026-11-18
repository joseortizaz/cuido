import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { UploadPatientImportForm } from "./upload-form";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

export default async function UploadPatientImportPage() {
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

  return (
    <>
      <PageHeader
        back={{ href: "/patients/import", label: "Importar" }}
        title="Importar pacientes"
        subtitle={
          <>
            Usa la{" "}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- descarga un archivo, no navega */}
            <a href="/patients/import/template/patients" className="font-medium text-white underline underline-offset-2">
              plantilla descargable
            </a>{" "}
            para asegurarte de que las columnas coincidan. Máximo 500 filas por archivo.
          </>
        }
      />
      <PageBody narrow>
        <UploadPatientImportForm />
      </PageBody>
    </>
  );
}
