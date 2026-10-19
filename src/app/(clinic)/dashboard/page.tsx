import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { AdminDashboard } from "./admin-dashboard";
import { DoctorDashboard } from "./doctor-dashboard";

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
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-start justify-between gap-3 px-6 pt-12">
        <div>
          <h1 className="text-2xl font-semibold">{clinic?.name ?? "Tu clínica"}</h1>
          <p className="text-sm text-zinc-500">{clinic?.province}</p>
        </div>
        {/* Manual del usuario: lo ven los tres roles (este encabezado es común a ambos paneles). */}
        <Link
          href="/manual"
          className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          Manual del usuario
        </Link>
      </div>

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
