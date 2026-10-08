import { CLAIM_STATUS_LABELS, formatMoney, type ClaimStatus } from "@/lib/domain/claims";

export type HistoryRow = {
  from_status: string | null;
  to_status: string;
  changed_at: string;
  changed_by: string | null;
  rejection_reason: string | null;
  approved_amount: number | null;
};

const label = (s: string) => CLAIM_STATUS_LABELS[s as ClaimStatus] ?? s;

/**
 * Línea de tiempo de una reclamación (historial de estados), plegable. Lo escribe solo un trigger
 * de la base de datos; aquí solo se muestra.
 */
export function ClaimHistory({
  rows,
  emailByUserId,
}: {
  rows: HistoryRow[];
  emailByUserId: Map<string, string>;
}) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  return (
    <details className="text-xs text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer">Historial ({sorted.length})</summary>
      <ul className="mt-1 flex flex-col gap-0.5 pl-3">
        {sorted.map((r, i) => (
          <li key={`${r.changed_at}-${i}`}>
            {new Date(r.changed_at).toLocaleString("es-DO")} ·{" "}
            {r.from_status ? `${label(r.from_status)} → ${label(r.to_status)}` : `Registrada (${label(r.to_status)})`}
            {r.to_status === "aprobada" && r.approved_amount != null ? ` · ${formatMoney(r.approved_amount)}` : ""}
            {r.to_status === "rechazada" && r.rejection_reason ? ` · motivo: ${r.rejection_reason}` : ""}
            {r.changed_by ? ` · ${emailByUserId.get(r.changed_by) ?? r.changed_by}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
