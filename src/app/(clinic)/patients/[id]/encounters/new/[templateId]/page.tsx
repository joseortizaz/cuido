import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { parseTemplateSchema } from "@/lib/domain/specialty-template";
import { EncounterForm } from "./encounter-form";

export default async function NewEncounterFormPage({
  params,
}: {
  params: Promise<{ id: string; templateId: string }>;
}) {
  const { id, templateId } = await params;
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

  const { data: template } = await supabase
    .from("specialty_templates")
    .select("id, name, schema, is_active")
    .eq("id", templateId)
    .maybeSingle();
  if (!template || !template.is_active) notFound();

  const { fields } = parseTemplateSchema(template.schema);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href={`/patients/${id}/encounters/new`} className="text-sm text-zinc-500 hover:underline">
          ← Elegir especialidad
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Nueva consulta — {template.name}</h1>
        <p className="text-sm text-zinc-500">
          {patient.first_name} {patient.last_name}
        </p>
      </div>
      <EncounterForm patientId={id} templateId={template.id} fields={fields} />
    </div>
  );
}
