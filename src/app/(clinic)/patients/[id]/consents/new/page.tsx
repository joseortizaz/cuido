import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { ConsentForm } from "./consent-form";

export default async function NewConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ encounterId?: string }>;
}) {
  const { id } = await params;
  const { encounterId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const [{ data: patient }, { data: templates }, { data: encounters }] = await Promise.all([
    supabase.from("patients").select("id, first_name, last_name").eq("id", id).maybeSingle(),
    supabase
      .from("consent_templates")
      .select("id, title, body")
      .eq("is_active", true)
      .order("title"),
    supabase
      .from("encounters")
      .select("id, encounter_date, chief_complaint")
      .eq("patient_id", id)
      .order("encounter_date", { ascending: false }),
  ]);
  if (!patient) notFound();

  const encounterOptions = (encounters ?? []).map((e) => ({
    id: e.id,
    label: `${new Date(e.encounter_date).toLocaleDateString("es-DO")}${e.chief_complaint ? ` — ${e.chief_complaint}` : ""}`,
  }));

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href={`/patients/${id}`} className="text-sm text-zinc-500 hover:underline">
          ← {patient.first_name} {patient.last_name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Firmar consentimiento</h1>
      </div>
      <ConsentForm
        patientId={id}
        templates={templates ?? []}
        encounters={encounterOptions}
        defaultEncounterId={encounterId}
      />
    </div>
  );
}
