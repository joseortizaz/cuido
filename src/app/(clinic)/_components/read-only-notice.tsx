import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentClinicAccess, READONLY_MESSAGE, SUSPENDED_MESSAGE } from "@/lib/supabase/clinic-access";

/**
 * ¿La clínica está en solo lectura (o suspendida)? Para decidir si una
 * página oculta sus controles de crear/editar. Capa de COMODIDAD: la
 * barrera real es el trigger readonly_guard de la base de datos y el
 * chequeo de cada Server Action (readOnlyBlock).
 */
export async function isClinicReadOnly(): Promise<boolean> {
  const access = await getCurrentClinicAccess();
  return access?.isReadOnly ?? false;
}

/** Caja de aviso en línea (listados y detalles que siguen siendo legibles). */
export async function ReadOnlyNotice() {
  const access = await getCurrentClinicAccess();
  if (!access?.isReadOnly) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {access.state === "suspendida" ? SUSPENDED_MESSAGE : READONLY_MESSAGE}
    </p>
  );
}

/**
 * Reemplaza a una página de "crear/editar" cuando la clínica está en solo
 * lectura: en vez del formulario, explica por qué no se puede y ofrece
 * volver. Las páginas hacen `if (await isClinicReadOnly()) return <ReadOnlyPage .../>`.
 */
export function ReadOnlyPage({
  backHref,
  backLabel,
  children,
}: {
  backHref: string;
  backLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-16">
      <Link href={backHref} className="text-sm text-zinc-500 hover:underline">
        ← {backLabel}
      </Link>
      <ReadOnlyNotice />
      {children}
    </div>
  );
}
