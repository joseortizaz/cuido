import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { ClinicNav } from "./_components/clinic-nav";

/**
 * Layout compartido de las pantallas de clínica (dashboard, pacientes,
 * equipo). Grupo de rutas "(clinic)" -- no agrega segmento a la URL, solo
 * agrupa estas carpetas bajo un layout común sin tocar
 * src/app/layout.tsx, que sigue sirviendo también /login, /signup,
 * /onboarding y la landing SIN esta barra.
 *
 * Repite el chequeo de sesión/membresía que cada página ya hace por su
 * cuenta (defensa en profundidad, mismo criterio que requireOperatorPage
 * en src/app/operator/) -- así la barra nunca se renderiza sin una
 * clínica activa real detrás.
 */
export default async function ClinicLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", membership.clinicId)
    .maybeSingle();

  return (
    <div className="flex min-h-full flex-col">
      <ClinicNav clinicName={clinic?.name ?? null} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
