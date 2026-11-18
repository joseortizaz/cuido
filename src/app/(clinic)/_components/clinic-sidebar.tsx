"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CUIDO_LOGO_SRC } from "../../_landing/constants";
import { SignOutButton } from "../../_nav/sign-out-button";
import {
  AgendaIcon,
  BillingIcon,
  ClaimsIcon,
  CloseIcon,
  DashboardIcon,
  MenuIcon,
  PatientsIcon,
  SecurityIcon,
  TeamIcon,
} from "./panel-icons";

type NavItem = {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** Otras rutas que pertenecen a esta sección (se marcan como activas aquí). */
  alsoActiveOn?: string[];
};

const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", Icon: DashboardIcon },
  { href: "/patients", label: "Pacientes", Icon: PatientsIcon, alsoActiveOn: ["/settings/codigos-paciente"] },
  { href: "/appointments", label: "Agenda", Icon: AgendaIcon, alsoActiveOn: ["/settings/whatsapp"] },
  { href: "/billing", label: "Facturación", Icon: BillingIcon, alsoActiveOn: ["/settings/fiscal"] },
  { href: "/claims", label: "Reclamaciones", Icon: ClaimsIcon },
  { href: "/team", label: "Equipo", Icon: TeamIcon },
  { href: "/security", label: "Seguridad", Icon: SecurityIcon },
];

function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.alsoActiveOn ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Anillo de foco por teclado: azul del panel (claro: #93c5fd) con separación de 2 px, visible también sobre la pastilla activa.
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-style:solid] focus-visible:[outline-color:var(--panel-blue)] dark:focus-visible:[outline-color:#93c5fd]";

function SidebarContent({
  clinicName,
  pathname,
  onNavigate,
}: {
  clinicName: string | null;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    // En el cajón (onNavigate presente) hay un botón de cerrar arriba a la derecha: se deja espacio.
    <div className={`flex h-full flex-col gap-6 overflow-y-auto px-4 pb-5 ${onNavigate ? "pt-14" : "pt-5"}`}>
      <div>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          aria-label="Cuido — ir al Dashboard"
          className={`flex justify-center rounded-2xl bg-white px-4 py-3 shadow-sm ${FOCUS}`}
        >
          <Image src={CUIDO_LOGO_SRC} alt="Cuido" width={1254} height={1254} className="h-11 w-auto" priority />
        </Link>
        {clinicName && (
          <p className="mt-2 truncate px-1 text-center text-xs font-medium text-panel-row/80" title={clinicName}>
            {clinicName}
          </p>
        )}
      </div>

      <nav aria-label="Menú principal" className="flex-1">
        <ul className="flex flex-col gap-1">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${FOCUS} ${
                    active ? "bg-panel-blue text-white" : "text-panel-row hover:bg-white/60 dark:hover:bg-white/10"
                  }`}
                >
                  <item.Icon className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-panel-border pt-4">
        <SignOutButton className={`w-full rounded-full border border-panel-blue/40 px-4 py-2 text-sm font-medium text-panel-row transition-colors hover:bg-white/60 dark:hover:bg-white/10 ${FOCUS}`} />
      </div>
    </div>
  );
}

/**
 * Menú lateral del panel de clínica. ≥ 1024 px: columna fija de 260 px. Menos: barra superior con un botón
 * que abre el mismo menú en un cajón (Escape o clic fuera lo cierran). `aria-current="page"` marca la
 * sección activa. No se imprime.
 */
export function ClinicSidebar({ clinicName }: { clinicName: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Escritorio */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[260px] bg-panel-menu lg:block print:hidden">
        <SidebarContent clinicName={clinicName} pathname={pathname} />
      </aside>

      {/* Móvil / tableta: barra superior + cajón */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-panel-menu px-4 lg:hidden print:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir el menú"
          aria-expanded={open}
          aria-controls="panel-drawer"
          className={`-ml-2 rounded-full p-2 text-panel-row hover:bg-white/60 dark:hover:bg-white/10 ${FOCUS}`}
        >
          <MenuIcon className="h-6 w-6" />
        </button>
        <Link href="/dashboard" aria-label="Cuido — ir al Dashboard" className={`rounded-lg bg-white px-2.5 py-1 ${FOCUS}`}>
          <Image src={CUIDO_LOGO_SRC} alt="Cuido" width={1254} height={1254} className="h-7 w-auto" />
        </Link>
        {clinicName && <span className="min-w-0 flex-1 truncate text-right text-xs font-medium text-panel-row/80">{clinicName}</span>}
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            id="panel-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menú principal"
            className="absolute inset-y-0 left-0 w-[260px] max-w-[85vw] bg-panel-menu shadow-xl"
          >
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar el menú"
              className={`absolute right-2 top-2 z-10 rounded-full p-2 text-panel-row hover:bg-white/60 dark:hover:bg-white/10 ${FOCUS}`}
            >
              <CloseIcon className="h-5 w-5" />
            </button>
            <SidebarContent clinicName={clinicName} pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
