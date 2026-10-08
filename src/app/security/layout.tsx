import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isPlatformOperator } from "@/lib/supabase/operator-context";
import { ClinicNav } from "../(clinic)/_components/clinic-nav";
import { OperatorNav } from "../operator/_components/operator-nav";
import { SignOutButton } from "../_nav/sign-out-button";

/**
 * Layout de /security (seguridad de la cuenta: 2FA). Es de la PERSONA, no de la clínica, así
 * que vive fuera del grupo (clinic): también la usan los operadores y quien aún no tiene
 * clínica, y una clínica bloqueada no debe impedir gestionar la seguridad de la propia
 * cuenta. La barra depende de quién es: miembro de clínica → barra de clínica; solo
 * operador → barra de operador; si no, una cabecera mínima.
 */
export default async function SecurityLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  const operator = await isPlatformOperator(supabase);

  let nav: ReactNode;
  if (membership) {
    const { data: clinic } = await supabase
      .from("clinics")
      .select("name")
      .eq("id", membership.clinicId)
      .maybeSingle();
    nav = <ClinicNav clinicName={clinic?.name ?? null} />;
  } else if (operator) {
    nav = <OperatorNav />;
  } else {
    nav = (
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-end px-4 sm:px-6">
          <SignOutButton />
        </div>
      </header>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {nav}
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
