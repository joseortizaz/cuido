import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { SpecialtyPicker } from "./specialty-picker";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { RecordRequired } from "@/app/(clinic)/_components/record-required";

/**
 * El picker de especialidad combina dos mecanismos independientes
 * (propuesta confirmada con el usuario, ver
 * supabase/migrations/20260917090000_clinician_specialty_filtering.sql):
 *
 *   1. clinic_member_disabled_specialties (admin, restrictivo): se
 *      calcula PRIMERO y se resta de la lista base -- una especialidad
 *      deshabilitada nunca entra a `templates`, así que es imposible
 *      que aparezca ni siquiera en "ver todas".
 *   2. clinic_member_preferred_specialties (el propio médico, solo
 *      preferencia de UI): se aplica DESPUÉS, únicamente para resaltar/
 *      preseleccionar dentro de lo que ya quedó habilitado.
 *
 * Este orden -- filtrar antes de preferir -- es lo que garantiza que el
 * mecanismo 2 siempre gane, sin necesitar un caso especial que compare
 * ambos.
 */
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
  if (await isClinicReadOnly()) {
    return <ReadOnlyPage backHref={`/patients/${id}`} backLabel="Paciente" />;
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("id, first_name, last_name")
    .eq("id", id)
    .maybeSingle();
  if (!patient) notFound();

  // Sin expediente abierto no se registran consultas (también lo exige la base de datos).
  const { data: openRecord } = await supabase.from("patient_records").select("id").eq("patient_id", id).maybeSingle();
  if (!openRecord) return <RecordRequired patientId={id} patientName={`${patient.first_name} ${patient.last_name}`} />;

  const { data: clinicMember } = await supabase
    .from("clinic_members")
    .select("id")
    .eq("clinic_id", membership.clinicId)
    .eq("user_id", user.id)
    .maybeSingle();

  const [{ data: allTemplates }, { data: disabledRows }, { data: preferredRows }] = await Promise.all([
    supabase.from("specialty_templates").select("id, name").eq("is_active", true).order("name"),
    clinicMember
      ? supabase
          .from("clinic_member_disabled_specialties")
          .select("specialty_template_id")
          .eq("clinic_member_id", clinicMember.id)
      : Promise.resolve({ data: [] as { specialty_template_id: string }[] }),
    clinicMember
      ? supabase
          .from("clinic_member_preferred_specialties")
          .select("specialty_template_id")
          .eq("clinic_member_id", clinicMember.id)
      : Promise.resolve({ data: [] as { specialty_template_id: string }[] }),
  ]);

  const disabledIds = new Set((disabledRows ?? []).map((r) => r.specialty_template_id));
  const preferredIds = new Set((preferredRows ?? []).map((r) => r.specialty_template_id));

  // Mecanismo 2 aplicado aquí -- lo deshabilitado por el admin queda
  // fuera de `templates` de una vez por todas, antes de que el
  // mecanismo 1 (preferencia) entre en juego.
  const templates = (allTemplates ?? []).filter((t) => !disabledIds.has(t.id));
  const preferredTemplates = templates.filter((t) => preferredIds.has(t.id));
  const hasPreferred = preferredTemplates.length > 0;

  return (
    <>
      <PageHeader
        title="Nueva consulta"
        subtitle="Elige la especialidad de la consulta."
        back={{ href: `/patients/${id}`, label: <>{patient.first_name} {patient.last_name}</> }}
      />
      <PageBody narrow>
      {templates.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay plantillas de especialidad disponibles para ti todavía.
        </p>
      ) : (
        <SpecialtyPicker
          patientId={id}
          templates={templates}
          preferredTemplates={preferredTemplates}
          hasPreferred={hasPreferred}
        />
      )}
      <Link href="/profile/specialties" className="text-sm text-zinc-500 hover:underline">
        Personalizar mis especialidades habituales
      </Link>
      </PageBody>
    </>
  );
}
