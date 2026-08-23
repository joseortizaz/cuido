import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOperatorPage } from "@/lib/supabase/operator-context";
import { getWhatsAppEnvironment } from "@/lib/whatsapp/env";
import { WhatsAppTestForm } from "./whatsapp-test-form";

/**
 * Validación inicial de Fase 4 -- envío MANUAL de mensajes de plantilla
 * de WhatsApp contra la cuenta y App DE PRUEBA de Meta ("Cuido - Test1",
 * App ID 1346275041895125, "Test WhatsApp Business Account",
 * +1 555-669-0076). NO dispara desde citas (esa tabla no existe todavía)
 * ni procesa respuestas del paciente -- ambos quedan para otra
 * conversación de diseño.
 */
export default async function WhatsAppTestPage() {
  const supabase = await createClient();
  await requireOperatorPage(supabase);

  const { data: messages } = await supabase
    .from("whatsapp_messages")
    .select("id, to_phone_number, template_name, status, meta_message_id, error_message, environment, sent_by, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const admin = createAdminClient();
  const emailByUserId = new Map<string, string>();
  await Promise.all(
    Array.from(new Set((messages ?? []).map((m) => m.sent_by))).map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      if (data.user?.email) emailByUserId.set(userId, data.user.email);
    })
  );

  const formatDateTime = (value: string) =>
    new Date(value).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" });

  const environment = getWhatsAppEnvironment();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/operator" className="text-sm text-zinc-500 hover:underline">
          ← Clínicas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">WhatsApp — validación de prueba</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Envío manual contra la cuenta{" "}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
              environment === "test"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
            }`}
          >
            {environment === "test" ? "de prueba" : "de producción"}
          </span>{" "}
          de Meta (WHATSAPP_MODE). Usa una plantilla ya aprobada en esa cuenta (p. ej. &quot;hello_world&quot;).
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <WhatsAppTestForm />
      </section>

      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Últimos envíos</h2>
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
          {(messages ?? []).map((m) => (
            <li key={m.id} className="py-2 text-sm">
              <p>
                <span
                  className={
                    m.status === "sent"
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }
                >
                  {m.status === "sent" ? "Enviado" : "Falló"}
                </span>{" "}
                — {m.to_phone_number} · {m.template_name} ·{" "}
                <span className="uppercase">{m.environment}</span>
              </p>
              {m.meta_message_id && (
                <p className="text-xs text-zinc-500">ID de Meta: {m.meta_message_id}</p>
              )}
              {m.error_message && (
                <p className="text-xs text-red-600 dark:text-red-400">{m.error_message}</p>
              )}
              <p className="text-xs text-zinc-500">
                {emailByUserId.get(m.sent_by) ?? m.sent_by} · {formatDateTime(m.created_at)}
              </p>
            </li>
          ))}
          {(messages ?? []).length === 0 && (
            <li className="py-2 text-sm text-zinc-500">Sin envíos todavía.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
