import { CLAIM_STATUS_LABELS, CLAIM_STATUSES } from "@/lib/domain/claims";
import type { PackageInsurerOption } from "@/lib/bulk-import/claims-package";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

/**
 * Descarga del paquete en Excel para presentar reclamaciones a una ARS. Es un formulario GET
 * normal (no un <Link>): la respuesta es un archivo (Route Handler con Content-Disposition). Solo
 * se muestra al personal de facturación; funciona también en modo solo lectura.
 */
export function PackageCard({ insurers }: { insurers: PackageInsurerOption[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div>
        <h2 className="font-semibold">Paquete para presentar a la ARS</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Excel con las reclamaciones de una aseguradora (pacientes, afiliados, comprobantes, servicios, diagnósticos y
          montos) y una hoja «Por completar» con lo que falta antes de presentarlas. No cambia ningún estado.
        </p>
      </div>
      {insurers.length === 0 ? (
        <p className="text-sm text-zinc-500">Todavía no hay reclamaciones para armar un paquete.</p>
      ) : (
        <form method="get" action="/claims/package" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="pkg_insurer" className={labelClass}>
              Aseguradora
            </label>
            <select id="pkg_insurer" name="insurer" required className={inputClass}>
              {insurers.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label} ({i.pending} pendiente{i.pending === 1 ? "" : "s"} de {i.total})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pkg_status" className={labelClass}>
              Estado
            </label>
            <select id="pkg_status" name="status" defaultValue="pendiente" className={inputClass}>
              {CLAIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CLAIM_STATUS_LABELS[s]}
                </option>
              ))}
              <option value="todas">Todas</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pkg_from" className={labelClass}>
              Servicios desde
            </label>
            <input id="pkg_from" name="from" type="date" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pkg_to" className={labelClass}>
              Hasta
            </label>
            <input id="pkg_to" name="to" type="date" className={inputClass} />
          </div>
          <button
            type="submit"
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Descargar .xlsx
          </button>
        </form>
      )}
    </div>
  );
}
