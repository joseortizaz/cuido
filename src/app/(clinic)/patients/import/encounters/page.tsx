import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { EncounterImportForm } from "./encounter-import-form";

export default async function UploadEncounterImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/patients");

  const { data: templates } = await supabase
    .from("specialty_templates")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/patients/import" className="text-sm text-zinc-500 hover:underline">
          ← Importar
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Importar consultas por especialidad</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Elige la especialidad, descarga su plantilla (formato campo/valor) y súbela llena. Los
          pacientes deben existir ya en la clínica. Máximo 500 filas por archivo.
        </p>
      </div>
      {!templates || templates.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay plantillas de especialidad configuradas todavía.
        </p>
      ) : (
        <EncounterImportForm templates={templates} />
      )}
    </div>
  );
}
