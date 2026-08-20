import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("clinic_members")
    .select("clinic_id, role")
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/onboarding");

  const { data: clinic } = await supabase
    .from("clinics")
    .select("name, province")
    .eq("id", membership.clinic_id)
    .single();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">Bienvenido a {clinic?.name ?? "tu clínica"}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {clinic?.province} · Rol: {membership.role}
      </p>
      <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-500">
        Este es un placeholder — el núcleo clínico (pacientes, agenda,
        expedientes) llega en el siguiente incremento de Fase 1.
      </p>
      <SignOutButton />
    </div>
  );
}
