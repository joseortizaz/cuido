import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { ReviewActions } from "./review-actions";

type PatientBatchRow = { row_number: number; raw: Record<string, string>; errors: string[] };
type EncounterBatchGroup = {
  groupKey: string;
  rowNumbers: number[];
  nationalId: string;
  scheduledAt: string;
  providerEmail: string;
  fields: Record<string, string>;
  errors: string[];
};

function describePatientRow(r: PatientBatchRow) {
  return {
    key: String(r.row_number),
    title: `Fila ${r.row_number} — ${r.raw.first_name} ${r.raw.last_name}`,
    subtitle: r.raw.national_id ? `Cédula/pasaporte ${r.raw.national_id}` : undefined,
    errors: r.errors,
  };
}

function describeEncounterGroup(g: EncounterBatchGroup) {
  const fieldCount = Object.keys(g.fields).length;
  return {
    key: g.groupKey,
    title: `Cédula ${g.nationalId || "—"} · ${g.scheduledAt || "—"} (fila${g.rowNumbers.length === 1 ? "" : "s"} ${g.rowNumbers.join(", ")})`,
    subtitle: `${fieldCount} campo${fieldCount === 1 ? "" : "s"}${g.providerEmail ? ` · Médico: ${g.providerEmail}` : ""}`,
    errors: g.errors,
  };
}

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

  const isEncounters = batch.import_type === "encounters";
  const unit = isEncounters ? "consulta" : "paciente";
  const genderSuffix = isEncounters ? "a" : "o"; // "consulta creada" (f) vs. "paciente creado" (m)
  const rowLabel = isEncounters ? "Consultas" : "Filas";

  const items = isEncounters
    ? (batch.rows as EncounterBatchGroup[]).map(describeEncounterGroup)
    : (batch.rows as PatientBatchRow[]).map(describePatientRow);
  const validItems = items.filter((i) => i.errors.length === 0);
  const invalidItems = items.filter((i) => i.errors.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/patients/import" className="text-sm text-zinc-500 hover:underline">
          ← Importar
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Revisión de importación</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {batch.file_name} · {items.length} {rowLabel.toLowerCase()}
        </p>
      </div>

      {batch.status === "validado" && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p>
            <strong className="text-green-700 dark:text-green-400">{validItems.length}</strong> {unit}
            {validItems.length === 1 ? "" : "s"} list{genderSuffix}
            {validItems.length === 1 ? "" : "s"} para importar.{" "}
            {invalidItems.length > 0 && (
              <>
                <strong className="text-red-600 dark:text-red-400">{invalidItems.length}</strong> con error
                {invalidItems.length === 1 ? "" : "es"}, se omitirán.
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Nada se ha guardado todavía. Al confirmar, solo se crean {isEncounters ? "las consultas" : "las filas"} sin
            error.
          </p>
        </div>
      )}

      {batch.status === "confirmado" && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
          {/* "consulta" es femenino, "paciente" es masculino -- concordancia de género en "creado/a", "omitido/a". */}
          Importación confirmada: {batch.valid_row_count} {unit}
          {batch.valid_row_count === 1 ? "" : "s"} cread{genderSuffix}
          {batch.valid_row_count === 1 ? "" : "s"}
          {batch.error_row_count > 0 &&
            `, ${batch.error_row_count} omitid${genderSuffix}${batch.error_row_count === 1 ? "" : "s"} por error`}
          .
        </div>
      )}

      {batch.status === "cancelado" && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Esta importación fue cancelada. No se creó ningún dato.
        </div>
      )}

      {invalidItems.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
            {isEncounters ? "Consultas" : "Filas"} con error{batch.status !== "validado" ? " (omitidas)" : ""}
          </h2>
          <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {invalidItems.map((item) => (
              <li key={item.key} className="py-2">
                <p className="font-medium">{item.title}</p>
                {item.subtitle && <p className="text-xs text-zinc-500">{item.subtitle}</p>}
                <ul className="mt-1 list-disc pl-5 text-xs text-red-600 dark:text-red-400">
                  {item.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {validItems.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-green-700 dark:text-green-400">
            {isEncounters ? "Consultas" : "Filas"} sin error{batch.status === "confirmado" ? " (creadas)" : ""}
          </h2>
          <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {validItems.map((item) => (
              <li key={item.key} className="py-2">
                <p>{item.title}</p>
                {item.subtitle && <p className="text-xs text-zinc-500">{item.subtitle}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {batch.status === "validado" && <ReviewActions batchId={batch.id} hasValidRows={validItems.length > 0} />}
    </div>
  );
}
