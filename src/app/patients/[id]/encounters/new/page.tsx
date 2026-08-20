import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { parseTemplateSchema } from "@/lib/domain/specialty-template";
import { EncounterForm } from "./encounter-form";

export default async function NewEncounterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    redirect(`/patients/${id}`);
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("id, first_name, last_name")
    .eq("id", id)
    .maybeSingle();
  if (!patient) notFound();

  // Fase 1: una sola especialidad activa (Medicina Interna). Cuando haya
  // más de una, esto se convierte en un selector — el resto del flujo ya
  // está diseñado para eso (el motor de plantillas no conoce especialidades
  // específicas).
  const { data: templates } = await supabase
    .from("specialty_templates")
    .select("id, name, schema")
    .eq("is_active", true)
    .order("name");

  const template = templates?.[0];
  if (!template) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-6 py-16">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay plantillas de especialidad configuradas todavía.
        </p>
      </div>
    );
  }

  const { fields } = parseTemplateSchema(template.schema);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href={`/patients/${id}`} className="text-sm text-zinc-500 hover:underline">
          ← {patient.first_name} {patient.last_name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Nueva consulta — {template.name}</h1>
      </div>
      <EncounterForm patientId={id} templateId={template.id} fields={fields} />
    </div>
  );
}
