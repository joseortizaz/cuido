import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { SpecialtyToggle } from "./specialty-toggle";

/**
 * Autoservicio del mecanismo 1 (preferencia de UI, ver
 * supabase/migrations/20260917090000_clinician_specialty_filtering.sql):
 * cualquier admin/médico que pueda crear encounters marca aquí sus
 * especialidades habituales. Solo se listan las especialidades YA
 * habilitadas para él (mecanismo 2, admin) -- no tiene sentido marcar
 * como habitual algo que no puede usar.
 */
export default async function ProfileSpecialtiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    redirect("/dashboard");
  }

  const { data: clinicMember } = await supabase
    .from("clinic_members")
    .select("id")
    .eq("clinic_id", membership.clinicId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!clinicMember) redirect("/onboarding");

  const [{ data: allTemplates }, { data: disabledRows }, { data: preferredRows }] = await Promise.all([
    supabase.from("specialty_templates").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("clinic_member_disabled_specialties")
      .select("specialty_template_id")
      .eq("clinic_member_id", clinicMember.id),
    supabase
      .from("clinic_member_preferred_specialties")
      .select("specialty_template_id")
      .eq("clinic_member_id", clinicMember.id),
  ]);

  const disabledIds = new Set((disabledRows ?? []).map((r) => r.specialty_template_id));
  const preferredIds = new Set((preferredRows ?? []).map((r) => r.specialty_template_id));
  const availableTemplates = (allTemplates ?? []).filter((t) => !disabledIds.has(t.id));

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Mis especialidades habituales</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Las que marques aparecen primero al crear una nueva consulta. Esto es solo una
          preferencia tuya — nunca te impide usar otra especialidad no marcada.
        </p>
      </div>
      {availableTemplates.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No tienes ninguna especialidad habilitada todavía.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {availableTemplates.map((template) => (
            <SpecialtyToggle
              key={template.id}
              specialtyTemplateId={template.id}
              name={template.name}
              initiallyPreferred={preferredIds.has(template.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
