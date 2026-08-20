import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (membership) redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <h1 className="mb-2 text-2xl font-semibold">Crea tu clínica</h1>
      <p className="mb-8 max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
        Serás el administrador de esta clínica. Podrás invitar al resto del
        equipo más adelante.
      </p>
      <OnboardingForm />
    </div>
  );
}
