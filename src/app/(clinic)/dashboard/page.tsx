import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { AdminDashboard } from "./admin-dashboard";
import { DoctorDashboard } from "./doctor-dashboard";
import { PageHeader } from "@/app/(clinic)/_components/page-header";
import { BookIcon } from "@/app/(clinic)/_components/panel-icons";

/**
 * Panel de clínica -- contenido distinto por rol (no solo texto de
 * bienvenida). El branch de rol ocurre AQUÍ, en el servidor: un médico
 * nunca recibe el HTML de los bloques fiscal/ARS/plan, no depende
 * únicamente de que RLS los bloquee si intentara leerlos.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name, province, business_model")
    .eq("id", membership.clinicId)
    .single();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={clinic?.name ?? "Tu clínica"}
        subtitle={clinic?.province}
        actions={
          // Manual del usuario: lo ven los tres roles (este encabezado es común a ambos paneles). Se
          // mantiene el botón azul; el aro blanco lo separa de la banda azul del encabezado.
          <Link
            href="/manual"
            className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-3 py-1.5 text-sm font-medium text-white ring-1 ring-white/70 transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <BookIcon />
            Manual del usuario
          </Link>
        }
      />

      {membership.role === "medico" ? (
        <DoctorDashboard userId={user.id} />
      ) : (
        <AdminDashboard
          clinicId={membership.clinicId}
          businessModel={clinic?.business_model ?? ""}
          role={membership.role}
        />
      )}
    </div>
  );
}
