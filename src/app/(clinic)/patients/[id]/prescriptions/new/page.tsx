import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { RecordRequired } from "@/app/(clinic)/_components/record-required";
import { PrescriptionForm } from "../prescription-form";
import { issuePrescription } from "../actions";

/** Nueva receta (desde una consulta o desde el expediente). Solo admin y médicos con sus datos profesionales completos. */
export default async function NewPrescriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ encounterId?: string }>;
}) {
  const { id } = await params;
  const { encounterId: encounterParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect(`/patients/${id}`);
  if (await isClinicReadOnly()) return <ReadOnlyPage backHref={`/patients/${id}?tab=expediente`} backLabel="Expediente" />;

  const { data: patient } = await supabase
    .from("patients")
    .select("id, first_name, last_name, record_number, voided_at")
    .eq("id", id)
    .maybeSingle();
  if (!patient) notFound();
  if (patient.voided_at !== null) redirect(`/patients/${id}`);
  const { data: record } = await supabase.from("patient_records").select("id").eq("patient_id", id).maybeSingle();
  if (!record) return <RecordRequired patientId={id} patientName={`${patient.first_name} ${patient.last_name}`} />;

  const [{ data: member }, { data: meds }, { data: encounter }] = await Promise.all([
    supabase
      .from("clinic_members")
      .select("professional_name, exequatur")
      .eq("clinic_id", membership.clinicId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("medications").select("name, dose, frequency").eq("patient_id", id).eq("status", "activo").order("created_at", { ascending: false }),
    encounterParam
      ? supabase.from("encounters").select("id").eq("id", encounterParam).eq("patient_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const profileComplete = !!member?.professional_name?.trim() && !!member?.exequatur?.trim();
  const back = encounter ? `/patients/${id}/encounters/${encounter.id}` : `/patients/${id}?tab=expediente`;

  return (
    <>
      <PageHeader
        title="Nueva receta"
        subtitle={
          <>
            {patient.first_name} {patient.last_name} · Código {patient.record_number}
          </>
        }
        back={{ href: back, label: encounter ? "Consulta" : "Expediente" }}
      />
      <PageBody narrow>
        {!profileComplete ? (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <p>
              <strong>Antes de emitir recetas</strong> completa tu nombre, tu especialidad y tu exequátur: salen impresos al pie de cada receta y no se emite
              ninguna sin ellos.
            </p>
            <div>
              <Link href="/profile/professional" className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
                Completar mis datos profesionales
              </Link>
            </div>
          </div>
        ) : (
          <PrescriptionForm
            action={issuePrescription.bind(null, id)}
            activeMedications={meds ?? []}
            encounterId={encounter?.id}
            cancelHref={back}
          />
        )}
      </PageBody>
    </>
  );
}
