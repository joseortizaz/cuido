import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { FiscalProfileForm } from "./fiscal-profile-form";
import { SequenceForm } from "./sequence-form";

export default async function FiscalSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/dashboard");

  const [{ data: profile }, { data: sequence }] = await Promise.all([
    supabase
      .from("clinic_fiscal_profiles")
      .select("rnc, business_name, commercial_name, fiscal_address, economic_activity, phone, email")
      .eq("clinic_id", membership.clinicId)
      .maybeSingle(),
    supabase
      .from("clinic_ecf_sequences")
      .select("range_start, range_end, next_number, valid_until")
      .eq("clinic_id", membership.clinicId)
      .eq("tipo_ecf", "32")
      .maybeSingle(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-10 px-6 py-16">
      <div>
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Datos fiscales</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Necesarios para generar comprobantes fiscales electrónicos (e-CF).
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Emisor</h2>
        <FiscalProfileForm profile={profile ?? null} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Secuencia de e-NCF (Factura de Consumo — tipo 32)</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Rango autorizado por la DGII. Se captura a mano por ahora — la autorización automática de
          secuencias queda para cuando el certificado digital esté configurado.
        </p>
        {sequence && (
          <p className="text-sm">
            Rango {sequence.range_start}–{sequence.range_end} · próximo número {sequence.next_number} · vence{" "}
            {sequence.valid_until}
          </p>
        )}
        <SequenceForm currentRangeStart={sequence?.range_start} />
      </section>
    </div>
  );
}
