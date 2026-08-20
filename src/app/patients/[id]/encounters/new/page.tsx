import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export default async function ChooseSpecialtyPage({
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

  const { data: templates } = await supabase
    .from("specialty_templates")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href={`/patients/${id}`} className="text-sm text-zinc-500 hover:underline">
          ← {patient.first_name} {patient.last_name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Nueva consulta</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Elige la especialidad de la consulta.
        </p>
      </div>
      {!templates || templates.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay plantillas de especialidad configuradas todavía.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {templates.map((template) => (
            <li key={template.id}>
              <Link
                href={`/patients/${id}/encounters/new/${template.id}`}
                className="flex items-center justify-between py-3 text-sm hover:underline"
              >
                {template.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
