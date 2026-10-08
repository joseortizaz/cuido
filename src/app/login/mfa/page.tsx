import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { needsMfaChallenge, safeNextPath } from "@/lib/domain/mfa";
import { AuthShell } from "../../_auth/auth-shell";
import { SignOutButton } from "../../_nav/sign-out-button";
import { MfaChallengeForm } from "./mfa-form";

export const metadata = { title: "Verificación en dos pasos" };

export default async function MfaChallengePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = safeNextPath(next);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Si no hace falta el segundo paso (no lo activó, o ya lo pasó), no hay nada que hacer aquí.
  const hasVerifiedFactor = (user.factors ?? []).some((f) => f.status === "verified");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!needsMfaChallenge(aal?.currentLevel, hasVerifiedFactor)) redirect(destination);

  return (
    <AuthShell title="Verificación en dos pasos">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-zinc-600">
          Abre tu app de autenticación y escribe el código de 6 dígitos de Cuido.
        </p>
        <MfaChallengeForm next={destination} />
        <div className="flex justify-center border-t border-zinc-100 pt-4">
          <SignOutButton className="text-sm font-medium text-zinc-500 hover:underline" />
        </div>
      </div>
    </AuthShell>
  );
}
