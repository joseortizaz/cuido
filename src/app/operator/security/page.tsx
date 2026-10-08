import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOperatorPage } from "@/lib/supabase/operator-context";
import { ResetMfaForm } from "./reset-form";

/**
 * Restablecer el 2FA de un usuario que perdió su teléfono (recuperación asistida por el
 * operador) + el registro de auditoría de los restablecimientos.
 */
export default async function OperatorSecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireOperatorPage(supabase);

  const { data: log } = await supabase
    .from("mfa_reset_log")
    .select("id, user_email, reason, factors_removed, created_at, reset_by")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/operator" className="text-sm text-zinc-500 hover:underline">
          ← Clínicas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Restablecer 2FA</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Para quien perdió el teléfono con su app de autenticación. Antes de quitar la protección, verifica su identidad
          por un medio distinto al correo de la cuenta (llamada, mensaje a un número ya registrado, etc.). Queda
          registrado quién lo hizo y por qué.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <ResetMfaForm />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Registro de restablecimientos</h2>
        {(log ?? []).length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no se ha restablecido ningún 2FA.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
            {(log ?? []).map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 py-2">
                <span className="font-medium">
                  {r.user_email ?? "(sin correo)"}{" "}
                  <span className="font-normal text-zinc-500">
                    · {new Date(r.created_at).toLocaleString("es-DO")} · {r.factors_removed} factor
                    {r.factors_removed === 1 ? "" : "es"}
                  </span>
                </span>
                <span className="text-zinc-600 dark:text-zinc-400">{r.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
