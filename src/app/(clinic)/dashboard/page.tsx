import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

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
    .select("name, province")
    .eq("id", membership.clinicId)
    .single();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">Bienvenido a {clinic?.name ?? "tu clínica"}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {clinic?.province} · Rol: {membership.role}
      </p>
      <div className="flex gap-3">
        <Link
          href="/patients"
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Ver pacientes
        </Link>
        <Link
          href="/team"
          className="rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-zinc-700 dark:hover:bg-white/[.08]"
        >
          Ver equipo
        </Link>
      </div>
    </div>
  );
}
