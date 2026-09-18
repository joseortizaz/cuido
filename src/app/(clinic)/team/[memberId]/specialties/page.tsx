import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { MemberSpecialtiesForm } from "./member-specialties-form";

/**
 * Mecanismo 2 (restricción real, admin-only, ver
 * supabase/migrations/20260917090000_clinician_specialty_filtering.sql).
 * Accesible para cualquier miembro (no solo "medico" en la fila) porque
 * un admin que también atiende pacientes puede querer restringirse a sí
 * mismo -- pero /team solo enlaza aquí para filas con rol médico, que es
 * el caso pedido.
 */
export default async function MemberSpecialtiesPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/team");

  const { data: member } = await supabase
    .from("clinic_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("clinic_id", membership.clinicId)
    .maybeSingle();
  if (!member) notFound();

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(member.user_id);

  const [{ data: templates }, { data: disabledRows }] = await Promise.all([
    supabase.from("specialty_templates").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("clinic_member_disabled_specialties")
      .select("specialty_template_id")
      .eq("clinic_member_id", memberId),
  ]);

  const disabledIds = new Set((disabledRows ?? []).map((r) => r.specialty_template_id));
  const enabledIds = new Set((templates ?? []).map((t) => t.id).filter((id) => !disabledIds.has(id)));

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/team" className="text-sm text-zinc-500 hover:underline">
          ← Equipo
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Especialidades habilitadas</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {authUser.user?.email ?? member.user_id} — desmarca una especialidad para impedirle crear
          consultas nuevas de ella. No afecta las consultas que ya existen.
        </p>
      </div>
      {!templates || templates.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay plantillas de especialidad configuradas todavía.
        </p>
      ) : (
        <MemberSpecialtiesForm memberId={memberId} templates={templates} enabledIds={enabledIds} />
      )}
    </div>
  );
}
