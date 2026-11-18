import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { NewAppointmentForm } from "./new-appointment-form";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

export default async function NewAppointmentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "recepcion") {
    redirect("/appointments");
  }
  if (await isClinicReadOnly()) {
    return <ReadOnlyPage backHref="/appointments" backLabel="Agenda" />;
  }

  const [{ data: patients }, { data: providerMembers }, { data: templates }] = await Promise.all([
    supabase.from("patients").select("id, first_name, last_name").order("last_name"),
    supabase
      .from("clinic_members")
      .select("user_id, role")
      .in("role", ["admin", "medico"]),
    supabase.from("specialty_templates").select("id, name").eq("is_active", true).order("name"),
  ]);

  // El médico asignado se elige entre admin/médico -- mismos roles que
  // pueden crear el encounter resultante (createEncounter en
  // patients/[id]/encounters/new/[templateId]/actions.ts). El email no
  // vive en clinic_members (auth.users no está expuesto vía la Data
  // API) -- se resuelve server-side con el cliente admin, mismo patrón
  // que src/app/team/page.tsx.
  const admin = createAdminClient();
  const providers = await Promise.all(
    (providerMembers ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      return { id: m.user_id, label: data.user?.email ?? m.user_id };
    })
  );

  return (
    <>
      <PageHeader
        title="Nueva cita"
        back={{ href: "/appointments", label: "Agenda" }}
      />
      <PageBody narrow>

      {!templates || templates.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay plantillas de especialidad configuradas todavía.
        </p>
      ) : !patients || patients.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay pacientes registrados todavía —{" "}
          <Link href="/patients/new" className="underline">
            registra uno primero
          </Link>
          .
        </p>
      ) : (
        <NewAppointmentForm
          patients={patients.map((p) => ({ id: p.id, label: `${p.first_name} ${p.last_name}` }))}
          providers={providers}
          templates={templates}
        />
      )}
      </PageBody>
    </>
  );
}
