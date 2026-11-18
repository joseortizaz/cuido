import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArrowLeftIcon } from "./panel-icons";

/**
 * Encabezado de página del panel: banda azul con el título en blanco y, a la derecha, las acciones.
 * Acción principal = botón blanco en pastilla (HeaderPrimaryAction); secundarias = enlaces blancos
 * (HeaderLink). Al imprimir no hay banda: queda solo el título (sin enlace «volver» ni acciones).
 */

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Enlace «volver» sobre el título. */
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="bg-panel-blue px-4 py-5 text-white lg:px-8 print:bg-transparent print:px-0 print:py-2 print:text-black">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {back && (
            <Link
              href={back.href}
              className="mb-1 inline-flex items-center gap-1 text-sm text-white/85 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white print:hidden"
            >
              <ArrowLeftIcon />
              {back.label}
            </Link>
          )}
          <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-white/85 print:text-zinc-600">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">{actions}</div>}
      </div>
    </header>
  );
}

/** Acción principal del encabezado: botón blanco en pastilla. */
export function HeaderPrimaryAction({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={`inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-panel-blue shadow-sm transition-colors hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${className ?? ""}`}
    />
  );
}

/** Acción secundaria del encabezado: enlace blanco. */
export function HeaderLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={`inline-flex items-center gap-1 text-sm font-medium text-white/90 underline-offset-4 hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${className ?? ""}`}
    />
  );
}

/**
 * Cuerpo de la página: una tarjeta blanca con borde azul claro que ocupa todo el ancho de la columna.
 * Listas y tablas van a todo el ancho; los formularios usan `narrow` para conservar un ancho de lectura
 * cómodo dentro de la tarjeta. Al imprimir, sin borde ni relleno.
 */
export function PageBody({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className="flex-1 px-4 py-6 lg:px-8 print:p-0">
      <div className="rounded-xl border border-panel-border bg-panel-surface p-5 text-panel-row lg:p-6 print:rounded-none print:border-0 print:p-0">
        <div className={`flex flex-col gap-6 ${narrow ? "max-w-2xl" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
