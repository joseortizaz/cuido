import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentClinicAccess } from "@/lib/supabase/clinic-access";

/**
 * ¿La clínica está en solo lectura (o suspendida)? Para decidir si una
 * página oculta sus controles de crear/editar. Capa de COMODIDAD: la
 * barrera real es el trigger readonly_guard de la base de datos y el
 * chequeo de cada Server Action (readOnlyBlock).
 *
 * El aviso con el estado, los días y el contacto de Narnia NO se repite en
 * cada pantalla: lo muestra una sola vez la barra global (AccessBanner, en
 * el layout de (clinic)).
 */
export async function isClinicReadOnly(): Promise<boolean> {
  const access = await getCurrentClinicAccess();
  return access?.isReadOnly ?? false;
}

/**
 * Reemplaza a una página de "crear/editar" cuando la clínica está en solo
 * lectura: en vez del formulario, explica en una frase por qué no se puede y
 * ofrece volver. Las páginas hacen
 * `if (await isClinicReadOnly()) return <ReadOnlyPage .../>`.
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
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Esta acción no está disponible mientras tu clínica esté en modo solo lectura. Puedes seguir consultando tu
        información, y el administrador puede exportar el listado de pacientes.
      </p>
      {children}
    </div>
  );
}
