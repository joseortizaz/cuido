"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CUIDO_LOGO_SRC } from "../../_landing/constants";
import { SignOutButton } from "../../_nav/sign-out-button";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/patients", label: "Pacientes" },
  { href: "/team", label: "Equipo" },
] as const;

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={
        active
          ? "text-sm font-medium text-brand-blue"
          : "text-sm font-medium text-zinc-600 transition-colors hover:text-brand-blue dark:text-zinc-400 dark:hover:text-brand-teal-light"
      }
    >
      {children}
    </Link>
  );
}

/**
 * Barra de navegación de las pantallas de clínica (dashboard/pacientes/
 * equipo, ver src/app/(clinic)/layout.tsx). Reusa el logo y la paleta
 * azul→teal de la landing (src/app/_landing/) para sentirse parte de la
 * misma marca, pero sin la fuente Poppins ni el resto de la landing —
 * es navegación funcional, el resto de la app sigue con Geist Sans.
 */
export function ClinicNav({ clinicName }: { clinicName: string | null }) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center" aria-label="Cuido">
            <Image src={CUIDO_LOGO_SRC} alt="Cuido" width={1254} height={1254} className="h-7 w-auto" />
          </Link>
          <nav className="flex items-center gap-4">
            {LINKS.map((link) => (
              <NavLink key={link.href} href={link.href}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {clinicName && (
            <span className="hidden text-sm text-zinc-500 sm:inline dark:text-zinc-400">
              {clinicName}
            </span>
          )}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
