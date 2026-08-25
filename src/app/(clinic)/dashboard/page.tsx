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
      <div className="mx-auto w-full max-w-3xl px-6 pt-12">
        <h1 className="text-2xl font-semibold">{clinic?.name ?? "Tu clínica"}</h1>
        <p className="text-sm text-zinc-500">{clinic?.province}</p>
      </div>

      {membership.role === "medico" ? (
        <DoctorDashboard userId={user.id} />
      ) : (
        <AdminDashboard clinicId={membership.clinicId} businessModel={clinic?.business_model ?? ""} />
      )}
    </div>
  );
}
