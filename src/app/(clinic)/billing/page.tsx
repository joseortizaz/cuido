import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  generado: "Generado (sin firmar)",
  firmado: "Firmado",
  enviado: "Enviado",
  aceptado: "Aceptado",
  rechazado: "Rechazado",
  anulado: "Anulado",
};

function formatAmount(value: number): string {
  return `RD$ ${value.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`;
}

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const [{ data: documents }, { data: patients }] = await Promise.all([
    supabase
      .from("fiscal_documents")
      .select("id, e_ncf, comprador_nombre, monto_total, status, created_at, patient_id")
      .order("created_at", { ascending: false }),
    supabase.from("patients").select("id, first_name, last_name"),
  ]);

  const patientNameById = new Map((patients ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Facturación (e-CF)</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Para generar un e-CF, ve a la ficha del paciente correspondiente.
          </p>
        </div>
        <Link href="/settings/fiscal" className="text-sm text-zinc-500 hover:underline">
          Datos fiscales →
        </Link>
      </div>

      {!documents || documents.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no se ha generado ningún e-CF.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-4">e-NCF</th>
                <th className="py-2 pr-4">Paciente</th>
                <th className="py-2 pr-4">Comprador</th>
                <th className="py-2 pr-4">Monto</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2 pr-4">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="py-3 pr-4">
                    <Link href={`/billing/${doc.id}`} className="font-medium hover:underline">
                      {doc.e_ncf ?? "—"}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">{patientNameById.get(doc.patient_id) ?? "—"}</td>
                  <td className="py-3 pr-4">{doc.comprador_nombre}</td>
                  <td className="py-3 pr-4">{formatAmount(doc.monto_total)}</td>
                  <td className="py-3 pr-4">{STATUS_LABELS[doc.status] ?? doc.status}</td>
                  <td className="py-3 pr-4">{new Date(doc.created_at).toLocaleDateString("es-DO")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
