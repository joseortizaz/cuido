import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DisableForm, EnrollPanel } from "./two-factor-forms";

export const metadata = { title: "Seguridad de la cuenta" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ activated?: string; disabled?: string }>;
}) {
  const { activated, disabled } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const active = factors?.totp?.[0] ?? null;
  const card = "flex flex-col gap-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Seguridad de la cuenta</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
      </div>

      {activated && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          Listo: la verificación en dos pasos quedó activada. Desde ahora, al iniciar sesión te pediremos el código de tu app.
        </p>
      )}
      {disabled && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          La verificación en dos pasos fue desactivada.
        </p>
      )}

      <section className={card}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Verificación en dos pasos</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Además de tu contraseña, te pedimos un código de 6 dígitos que genera una app de autenticación en tu
              teléfono. Aunque alguien conozca tu contraseña, no podrá entrar sin tu teléfono.
            </p>
          </div>
          <span
            className={
              active
                ? "shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200"
                : "shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
            }
          >
            {active ? "Activada" : "Desactivada"}
          </span>
        </div>

        {active ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              App de autenticación registrada el {new Date(active.created_at).toLocaleDateString("es-DO")}.
            </p>
            <DisableForm />
          </div>
        ) : (
          <EnrollPanel />
        )}
      </section>

      <section className="flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <h2 className="font-semibold text-foreground">Qué app usar</h2>
        <p>
          Cualquiera que genere códigos TOTP, todas gratuitas: Google Authenticator, Microsoft Authenticator, Authy,
          1Password o Bitwarden. No hay costo ni suscripción.
        </p>
        <h2 className="mt-2 font-semibold text-foreground">Si pierdes tu teléfono</h2>
        <p>
          Escríbenos desde el correo de tu cuenta: verificaremos tu identidad por otro medio y desactivaremos la
          verificación para que puedas volver a entrar y activarla en tu nuevo teléfono.
        </p>
      </section>

      <p className="text-sm">
        <Link href="/" className="text-brand-blue hover:underline">
          ← Volver
        </Link>
      </p>
    </div>
  );
}
