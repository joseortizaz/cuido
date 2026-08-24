import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { ReviewActions } from "./review-actions";

type BatchRow = { row_number: number; raw: Record<string, string>; errors: string[] };

export default async function ImportReviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/patients");

  const { data: batch } = await supabase.from("bulk_import_batches").select("*").eq("id", batchId).maybeSingle();
  if (!batch) notFound();

  const rows = batch.rows as BatchRow[];
  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/patients/import" className="text-sm text-zinc-500 hover:underline">
          ← Importar
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Revisión de importación</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {batch.file_name} · {rows.length} fila{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {batch.status === "validado" && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p>
            <strong className="text-green-700 dark:text-green-400">{validRows.length}</strong> fila
            {validRows.length === 1 ? "" : "s"} lista{validRows.length === 1 ? "" : "s"} para importar.{" "}
            {invalidRows.length > 0 && (
              <>
                <strong className="text-red-600 dark:text-red-400">{invalidRows.length}</strong> con error
                {invalidRows.length === 1 ? "" : "es"}, se omitirán.
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Nada se ha guardado todavía. Al confirmar, solo se crean las filas sin error.
          </p>
        </div>
      )}

      {batch.status === "confirmado" && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
          Importación confirmada: {batch.valid_row_count} paciente{batch.valid_row_count === 1 ? "" : "s"} creado
          {batch.valid_row_count === 1 ? "" : "s"}
          {batch.error_row_count > 0 && `, ${batch.error_row_count} omitido${batch.error_row_count === 1 ? "" : "s"} por error`}.
        </div>
      )}

      {batch.status === "cancelado" && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Esta importación fue cancelada. No se creó ningún dato.
        </div>
      )}

      {invalidRows.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
            Filas con error{batch.status !== "validado" ? " (omitidas)" : ""}
          </h2>
          <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {invalidRows.map((r) => (
              <li key={r.row_number} className="py-2">
                <p className="font-medium">
                  Fila {r.row_number} — {r.raw.first_name} {r.raw.last_name}
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-red-600 dark:text-red-400">
                  {r.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {validRows.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-green-700 dark:text-green-400">
            Filas sin error{batch.status === "confirmado" ? " (creadas)" : ""}
          </h2>
          <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {validRows.map((r) => (
              <li key={r.row_number} className="py-2">
                Fila {r.row_number} — {r.raw.first_name} {r.raw.last_name}
                {r.raw.national_id ? ` · ${r.raw.national_id}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {batch.status === "validado" && <ReviewActions batchId={batch.id} hasValidRows={validRows.length > 0} />}
    </div>
  );
}
