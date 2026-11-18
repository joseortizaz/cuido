import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type PatientSummary = {
  allergies: { substance: string; reaction: string | null; severity: string | null }[];
  medications: { name: string; dose: string | null; frequency: string | null }[];
  pathological: string | null;
};

/**
 * Lo que el médico necesita tener a la vista al registrar una consulta, sin volver a pedirlo: alergias
 * activas, medicamentos activos y antecedentes patológicos. Vive en el expediente (solo admin y médicos lo
 * leen: RLS); aquí solo se muestra.
 */
export async function loadPatientSummary(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<PatientSummary> {
  const [{ data: allergies }, { data: medications }, { data: history }] = await Promise.all([
    supabase
      .from("allergies")
      .select("substance, reaction, severity")
      .eq("patient_id", patientId)
      .eq("status", "activa")
      .order("recorded_at", { ascending: false }),
    supabase
      .from("medications")
      .select("name, dose, frequency")
      .eq("patient_id", patientId)
      .eq("status", "activo")
      .order("created_at", { ascending: false }),
    supabase.from("patient_medical_history").select("pathological_history").eq("patient_id", patientId).maybeSingle(),
  ]);
  return {
    allergies: allergies ?? [],
    medications: medications ?? [],
    pathological: history?.pathological_history ?? null,
  };
}

export function PatientSummaryCard({ summary, patientId }: { summary: PatientSummary; patientId: string }) {
  return (
    <aside
      aria-label="Resumen del expediente"
      className="flex w-full max-w-lg flex-col gap-2 rounded-lg border border-panel-border bg-panel-surface p-4 text-sm"
    >
      <h2 className="text-sm font-semibold">Resumen del expediente</h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-zinc-500">Alergias</dt>
        <dd>
          {summary.allergies.length === 0
            ? "Ninguna registrada"
            : summary.allergies
                .map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ""}${a.severity ? ` · ${a.severity}` : ""}`)
                .join("; ")}
        </dd>
        <dt className="text-zinc-500">Medicamentos activos</dt>
        <dd>
          {summary.medications.length === 0
            ? "Ninguno registrado"
            : summary.medications.map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(" ")).join("; ")}
        </dd>
        <dt className="text-zinc-500">Antecedentes patológicos</dt>
        <dd className="whitespace-pre-wrap">{summary.pathological?.trim() ? summary.pathological : "Sin datos registrados"}</dd>
      </dl>
      <p className="text-xs text-zinc-500">
        Se completan en el{" "}
        <a href={`/patients/${patientId}?tab=expediente`} className="underline">
          expediente
        </a>
        ; esta consulta no los vuelve a pedir.
      </p>
    </aside>
  );
}
