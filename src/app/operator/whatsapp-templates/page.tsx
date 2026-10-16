import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOperatorPage } from "@/lib/supabase/operator-context";
import { CreateTemplateForm, SyncForm } from "./template-forms";

const STATUS_STYLE: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  IN_APPEAL: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  PAUSED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  DISABLED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};
const STATUS_LABEL: Record<string, string> = {
  APPROVED: "Aprobada",
  PENDING: "En revisión",
  IN_APPEAL: "En apelación",
  REJECTED: "Rechazada",
  PAUSED: "Pausada",
  DISABLED: "Desactivada",
};
const QUALITY_LABEL: Record<string, string> = { GREEN: "Alta", YELLOW: "Media", RED: "Baja", UNKNOWN: "Sin clasificar" };

/**
 * Catálogo de plantillas de WhatsApp de la cuenta de Narnia (compartida por todas las clínicas).
 * El estado se actualiza solo por el webhook de Meta; «Sincronizar con Meta» lo refresca a mano.
 */
export default async function WhatsAppTemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireOperatorPage(supabase);

  // Solo las plantillas de la cuenta de WhatsApp activa (WHATSAPP_WABA_ID): las plantillas son por
  // cuenta, y el catálogo puede conservar filas de una cuenta anterior (p. ej. la de pruebas).
  const activeWabaId = process.env.WHATSAPP_WABA_ID?.trim();
  let query = supabase
    .from("whatsapp_templates")
    .select("id, name, language, category, status, quality_score, rejected_reason, synced_at")
    .order("name");
  if (activeWabaId) query = query.eq("waba_id", activeWabaId);
  const { data: templates } = await query;

  const formatDateTime = (value: string) =>
    new Date(value).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santo_Domingo" });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/operator" className="text-sm text-zinc-500 hover:underline">
          ← Clínicas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Plantillas de WhatsApp</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Plantillas de la cuenta de WhatsApp de Narnia Tech (compartida por todas las clínicas). Meta revisa cada
          plantilla nueva en hasta 24 horas; el estado se actualiza solo cuando Meta avisa por el webhook.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <SyncForm />
        {(templates ?? []).length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no hay plantillas en el catálogo. Pulsa «Sincronizar con Meta».</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="py-2 pr-4">Nombre</th>
                  <th className="py-2 pr-4">Idioma</th>
                  <th className="py-2 pr-4">Categoría</th>
                  <th className="py-2 pr-4">Estado</th>
                  <th className="py-2 pr-4">Calidad</th>
                  <th className="py-2 pr-4">Actualizada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {(templates ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-4 font-mono text-xs">{t.name}</td>
                    <td className="py-2 pr-4">{t.language}</td>
                    <td className="py-2 pr-4">{t.category}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          STATUS_STYLE[t.status] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                      {t.rejected_reason && <p className="mt-1 text-xs text-red-600">{t.rejected_reason}</p>}
                    </td>
                    <td className="py-2 pr-4">{t.quality_score ? (QUALITY_LABEL[t.quality_score] ?? t.quality_score) : "—"}</td>
                    <td className="py-2 pr-4 text-xs text-zinc-500">{formatDateTime(t.synced_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-medium">Crear plantilla de utilidad</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Solo categoría Utilidad (recordatorios y confirmaciones de citas), sin promociones. Mensajes mínimos: nunca
            diagnósticos, cédulas ni resultados. Se valida antes de enviarla a Meta; no se puede reutilizar el nombre de
            una plantilla borrada durante 30 días, así que usa versiones (<code>_v1</code>, <code>_v2</code>).
          </p>
        </div>
        <CreateTemplateForm />
      </section>
    </div>
  );
}
