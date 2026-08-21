import Image from "next/image";
import Link from "next/link";
import { CUIDO_LOGO_SRC } from "../../_landing/constants";
import { SignOutButton } from "../../_nav/sign-out-button";

/**
 * Barra de navegación del panel de operador (src/app/operator/layout.tsx).
 *
 * Decisión: comparte el logo y el botón de cerrar sesión con ClinicNav
 * (src/app/(clinic)/_components/clinic-nav.tsx) pero NO reusa el mismo
 * componente ni su paleta clara -- fondo navy oscuro + insignia "MODO
 * OPERADOR" en ámbar, a propósito muy distinto de la barra blanca de
 * clínica. Un operador de Narnia que además administra su propia clínica
 * (caso documentado en src/app/page.tsx) nunca debe confundir en cuál de
 * los dos contextos está parado con solo un vistazo -- por eso la
 * variante visual, no un simple prop de color sobre el mismo componente.
 * No lleva enlace a "clínica activa" porque el operador no está dentro
 * de ninguna: /operator ya ofrece "Ir a tu clínica →" cuando aplica.
 */
export function OperatorNav() {
  return (
    <header className="sticky top-0 z-10 border-b border-brand-navy/60 bg-brand-navy">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/operator" className="flex items-center" aria-label="Cuido">
            <Image
              src={CUIDO_LOGO_SRC}
              alt="Cuido"
              width={1254}
              height={1254}
              className="h-7 w-auto rounded-sm bg-white/90 p-0.5"
            />
          </Link>
          <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-semibold tracking-wide text-amber-300 uppercase">
            Modo operador
          </span>
          <Link
            href="/operator"
            className="text-sm font-medium text-zinc-200 transition-colors hover:text-white"
          >
            Clínicas
          </Link>
        </div>
        <SignOutButton className="rounded-full border border-zinc-600 px-3 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10" />
      </div>
    </header>
  );
}
