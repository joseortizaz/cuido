import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { RetrySignForm, VoidForm } from "./void-form";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  generado: "Generado (sin firmar)",
  firmado: "Firmado",
  enviado: "Enviado",
  aceptado: "Aceptado",
  rechazado: "Rechazado",
  anulado: "Anulado",
};

const ITBIS_LABELS: Record<string, string> = {
  "0": "No facturable",
  "1": "ITBIS 18%",
  "2": "ITBIS 16%",
  "3": "ITBIS 0%",
  E: "Exento",
};

function formatAmount(value: number): string {
  return `RD$ ${value.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`;
}

export default async function FiscalDocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signPending?: string }>;
}) {
  const { id } = await params;
  const { signPending } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const { data: document } = await supabase.from("fiscal_documents").select("*").eq("id", id).maybeSingle();
  if (!document) notFound();

  const [{ data: items }, { data: patient }] = await Promise.all([
    supabase.from("fiscal_document_items").select("*").eq("fiscal_document_id", id).order("line_number"),
    supabase.from("patients").select("first_name, last_name").eq("id", document.patient_id).maybeSingle(),
  ]);

  const canManage = membership.role === "admin" || membership.role === "recepcion";
  const canVoid = canManage && (document.status === "borrador" || document.status === "generado");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/billing" className="text-sm text-zinc-500 hover:underline">
          ← Facturación
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{document.e_ncf ?? "e-CF sin número"}</h1>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800">
            {STATUS_LABELS[document.status] ?? document.status}
          </span>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Paciente: {patient ? `${patient.first_name} ${patient.last_name}` : "—"} · Comprador:{" "}
          {document.comprador_nombre}
        </p>
      </div>

      {signPending && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          El e-CF quedó generado, pero sin firmar ni enviar a la DGII: certificado digital tributario
          (PSC/INDOTEL) pendiente de configurar.
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Líneas</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-4">Descripción</th>
              <th className="py-2 pr-4">Cant.</th>
              <th className="py-2 pr-4">Precio</th>
              <th className="py-2 pr-4">ITBIS</th>
              <th className="py-2 pr-4">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {(items ?? []).map((item) => (
              <tr key={item.id}>
                <td className="py-2 pr-4">{item.description}</td>
                <td className="py-2 pr-4">{item.quantity}</td>
                <td className="py-2 pr-4">{formatAmount(item.unit_price)}</td>
                <td className="py-2 pr-4">{ITBIS_LABELS[item.itbis_indicator] ?? item.itbis_indicator}</td>
                <td className="py-2 pr-4">{formatAmount(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col items-end gap-0.5 text-sm">
          <p>Gravado: {formatAmount(document.monto_gravado_total)}</p>
          <p>Exento: {formatAmount(document.monto_exento)}</p>
          <p>ITBIS: {formatAmount(document.total_itbis)}</p>
          <p className="font-medium">Total: {formatAmount(document.monto_total)}</p>
        </div>
      </section>

      {document.xml_sin_firmar && (
        <details className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">XML sin firmar</summary>
          <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap">{document.xml_sin_firmar}</pre>
        </details>
      )}

      {document.voided_reason && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Anulado el {new Date(document.voided_at!).toLocaleString("es-DO")} — {document.voided_reason}
        </p>
      )}

      {canManage && (document.status === "generado" || document.status === "borrador") && (
        <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium">Firma y envío</h2>
          <RetrySignForm fiscalDocumentId={document.id} />
        </section>
      )}

      {canVoid && (
        <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium">Anular</h2>
          <VoidForm fiscalDocumentId={document.id} />
        </section>
      )}
    </div>
  );
}
