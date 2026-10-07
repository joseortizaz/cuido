import { getCurrentClinicAccess } from "@/lib/supabase/clinic-access";
import {
  CONTACT_EMAIL,
  CONTACT_WHATSAPP_URL,
  describeAccessBanner,
  type BannerTone,
} from "@/lib/domain/clinic-access";

const TONE_CLASSES: Record<BannerTone, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  danger: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
};

/**
 * Barra de estado de la suscripción, visible para TODOS los miembros de la
 * clínica en todas las pantallas (el layout de (clinic) la renderiza bajo la
 * navegación). Solo muestra estado y días -- nunca montos: eso es de la
 * tarjeta de plan del admin. El recordatorio de renovación (por_renovar) llega
 * únicamente al admin (la base de datos se lo devuelve como `activa` al resto).
 *
 * Qué mostrar según el estado vive en describeAccessBanner() (módulo puro,
 * probado con fechas límite en scripts/test-access-banner.ts).
 */
export async function AccessBanner({ isAdmin }: { isAdmin: boolean }) {
  const access = await getCurrentClinicAccess();
  if (!access) return null;
  const banner = describeAccessBanner(access, isAdmin);
  if (!banner) return null;

  return (
    <div role="status" className={`border-b px-4 py-3 text-sm sm:px-6 ${TONE_CLASSES[banner.tone]}`}>
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div>
          <p className="font-semibold">{banner.title}</p>
          <p className="mt-0.5">{banner.detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs font-medium">
          <a href={CONTACT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="underline">
            WhatsApp
          </a>
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            Correo
          </a>
        </div>
      </div>
    </div>
  );
}
