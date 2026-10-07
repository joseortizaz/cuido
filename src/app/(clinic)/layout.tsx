import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { getCurrentClinicAccess } from "@/lib/supabase/clinic-access";
import { ClinicNav } from "./_components/clinic-nav";
import { AccessBanner } from "./_components/access-banner";
import { BlockedPage } from "./_components/blocked-page";

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

  // Clínica bloqueada (bloqueo total) o suspendida: la base de datos ya no
  // entrega datos clínicos; se muestra una sola pantalla explicativa en vez de
  // páginas vacías. getCurrentClinicAccess falla "abierto" (null) a propósito.
  const access = await getCurrentClinicAccess();
  if (access?.state === "bloqueada" || access?.state === "suspendida") {
    return (
      <div className="flex min-h-full flex-col">
        <ClinicNav clinicName={clinic?.name ?? null} />
        <BlockedPage suspended={access.state === "suspendida"} />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ClinicNav clinicName={clinic?.name ?? null} />
      <AccessBanner isAdmin={membership.role === "admin"} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
