import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { CUIDO_LOGO_SRC } from "../_landing/constants";
import { poppins } from "../_landing/fonts";

type AuthShellProps = {
  title: string;
  children: ReactNode;
};

/**
 * Envoltorio compartido por login/signup/forgot-password/reset-password —
 * mismo criterio de diseño de la landing (fondo brand-bg, tipografía Poppins,
 * logo Cuido) para que el flujo de autenticación no se sienta como una
 * pantalla aparte del resto del sitio.
 *
 * El logo enlaza a "/" (landing) tal como se pidió: patrón estándar, NO
 * navega a /dashboard ni requiere sesión -- es un <Link> normal, el
 * middleware ya trata "/" como ruta pública.
 */
export function AuthShell({ title, children }: AuthShellProps) {
  return (
    <div
      className={`${poppins.variable} flex flex-1 flex-col items-center justify-center bg-brand-bg px-6 py-16 font-[family-name:var(--font-poppins)]`}
    >
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <Image src={CUIDO_LOGO_SRC} alt="Cuido" width={1254} height={1254} className="h-9 w-9 rounded-md" />
        <span className="text-lg font-semibold text-brand-navy">Cuido</span>
      </Link>
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5">
        <h1 className="mb-6 text-center text-xl font-semibold text-brand-navy">{title}</h1>
        {children}
      </div>
    </div>
  );
}
