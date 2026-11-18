import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isPlatformOperator } from "@/lib/supabase/operator-context";
import { PanelShell } from "../(clinic)/_components/panel-shell";
import { OperatorNav } from "../operator/_components/operator-nav";
import { SignOutButton } from "../_nav/sign-out-button";

/**
 * Layout de /security (seguridad de la cuenta: 2FA). Es de la PERSONA, no de la clínica, así
 * que vive fuera del grupo (clinic): también la usan los operadores y quien aún no tiene
 * clínica, y una clínica bloqueada no debe impedir gestionar la seguridad de la propia
 * cuenta. Depende de quién es: miembro de clínica → menú lateral del panel; solo
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
    // Miembro de una clínica: el mismo cascarón con menú lateral que el resto del panel (sin aviso de suscripción).
    const { data: clinic } = await supabase
      .from("clinics")
      .select("name")
      .eq("id", membership.clinicId)
      .maybeSingle();
    return (
      <PanelShell clinicName={clinic?.name ?? null}>
        <div className="flex flex-1 flex-col">{children}</div>
      </PanelShell>
    );
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
