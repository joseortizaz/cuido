import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { formatDrDate } from "@/lib/domain/dr-time";
import { HeaderLink, PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

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
    <>
      <PageHeader
        title="Facturación (e-CF)"
        subtitle="Para generar un e-CF, ve a la ficha del paciente correspondiente."
        actions={<HeaderLink href="/settings/fiscal">Datos fiscales →</HeaderLink>}
      />
      <PageBody>
      {!documents || documents.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no se ha generado ningún e-CF.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr className="border-b border-panel-border text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-4">e-NCF</th>
                <th className="py-2 pr-4">Paciente</th>
                <th className="py-2 pr-4">Comprador</th>
                <th className="py-2 pr-4">Monto</th>
                <th className="py-2 pr-4">Estado</th>
                <th className="py-2 pr-4">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-panel-border">
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
                  <td className="py-3 pr-4">{formatDrDate(doc.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </PageBody>
    </>
  );
}
