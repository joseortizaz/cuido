import type { ReactNode } from "react";
import { ClinicSidebar } from "./clinic-sidebar";

/**
 * Cascarón del panel de clínica: menú lateral + columna principal. Reemplaza a la antigua barra
 * superior (ClinicNav). `.panel-shell` (globals.css) sube el texto +1 pt solo aquí dentro y lo restablece al
 * imprimir; el menú no se imprime y la columna principal pasa a ancho completo.
 *
 * `banner` es el aviso de estado de la suscripción (AccessBanner): va arriba de la columna principal.
 */
export function PanelShell({
  clinicName,
  banner,
  children,
}: {
  clinicName: string | null;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="panel-shell flex min-h-dvh flex-col bg-panel-page text-foreground lg:pl-[260px] print:bg-white print:pl-0">
      <ClinicSidebar clinicName={clinicName} />
      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        {children}
      </div>
    </div>
  );
}
