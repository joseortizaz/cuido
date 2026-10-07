import { BLOCKED_MESSAGE, CONTACT_EMAIL, CONTACT_WHATSAPP_URL, SUSPENDED_MESSAGE } from "@/lib/domain/clinic-access";

/**
 * Pantalla única para una clínica bloqueada (bloqueo total = suscripción
 * cancelada) o suspendida. La base de datos ya no entrega ningún dato clínico
 * en esos estados (RLS), así que en vez de pantallas vacías o con errores se
 * explica qué pasó y a quién llamar. El layout de (clinic) la renderiza en
 * lugar de las páginas.
 */
export function BlockedPage({ suspended }: { suspended: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">
        {suspended ? "Tu clínica está suspendida" : "El acceso de tu clínica está bloqueado"}
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{suspended ? SUSPENDED_MESSAGE : BLOCKED_MESSAGE}</p>
      {!suspended && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tu información no se ha borrado: se conserva según los Términos de Servicio. Al regularizar el pago, tu clínica
          se reactiva de inmediato.
        </p>
      )}
      <div className="flex gap-4 text-sm">
        <a href={CONTACT_WHATSAPP_URL} className="text-brand-blue hover:underline">
          WhatsApp
        </a>
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand-blue hover:underline">
          Correo
        </a>
      </div>
    </div>
  );
}
