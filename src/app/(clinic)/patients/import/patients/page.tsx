import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { UploadPatientImportForm } from "./upload-form";

export default async function UploadPatientImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/patients");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/patients/import" className="text-sm text-zinc-500 hover:underline">
          ← Importar
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Importar pacientes</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Usa la{" "}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- descarga un archivo, no navega */}
          <a href="/patients/import/template/patients" className="text-brand-blue hover:underline">
            plantilla descargable
          </a>{" "}
          para asegurarte de que las columnas coincidan. Máximo 500 filas por archivo.
        </p>
      </div>
      <UploadPatientImportForm />
    </div>
  );
}
