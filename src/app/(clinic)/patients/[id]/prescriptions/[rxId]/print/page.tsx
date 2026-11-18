import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isPrintFormat, type Letterhead } from "@/lib/domain/prescriptions";
import { PrescriptionSheet, type SheetData } from "../../prescription-sheet";
import { PrintButton } from "../rx-actions";

/**
 * Hoja de impresión de una receta: SOLO la receta (sin menú, encabezados ni avisos), en A6 (105 × 148 mm) o centrada en
 * una A4, siempre en claro aunque el sistema esté en oscuro. «Imprimir» deja constancia (prescription_prints); desde la
 * segunda impresión la hoja sale marcada «COPIA». Solo admin y médicos; una receta anulada no se imprime.
 */
export default async function PrescriptionPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; rxId: string }>;
  searchParams: Promise<{ formato?: string }>;
}) {
  const { id, rxId } = await params;
  const { formato } = await searchParams;
  const format = isPrintFormat(formato) ? formato : "a6";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect(`/patients/${id}`);

  const { data: rx } = await supabase.from("prescriptions").select("*").eq("id", rxId).eq("patient_id", id).maybeSingle();
  if (!rx) notFound();
  if (rx.status === "anulada") redirect(`/patients/${id}/prescriptions/${rxId}`);

  const [{ data: items }, { count: prints }] = await Promise.all([
    supabase.from("prescription_items").select("*").eq("prescription_id", rxId).order("position", { ascending: true }),
    supabase.from("prescription_prints").select("id", { count: "exact", head: true }).eq("prescription_id", rxId),
  ]);

  const letterhead = rx.letterhead as unknown as Letterhead;
  const patient = rx.patient_snapshot as unknown as { name: string; date_of_birth: string; record_number: string };
  // El logo se muestra con una URL firmada de 1 hora (nunca una URL pública permanente).
  let logoUrl: string | null = null;
  if (letterhead.logo_path) {
    const { data } = await supabase.storage.from("clinic-letterhead").createSignedUrl(letterhead.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }

  const data: SheetData = {
    number: rx.number,
    issuedAt: rx.issued_at,
    providerName: rx.provider_name,
    providerTitle: rx.provider_title,
    providerExequatur: rx.provider_exequatur,
    letterhead,
    logoUrl,
    patient,
    items: (items ?? []).map((i) => ({
      medication: i.medication,
      dose: i.dose,
      route: i.route,
      frequency: i.frequency,
      duration: i.duration,
      quantity: i.quantity,
      instructions: i.instructions,
    })),
    notes: rx.notes,
    isCopy: (prints ?? 0) > 0,
  };

  const base = `/patients/${id}/prescriptions/${rxId}/print`;
  return (
    <div className="rx-root">
      <div className="rx-toolbar">
        <Link href={`/patients/${id}/prescriptions/${rxId}`}>← Volver a la receta</Link>
        <span>
          Formato:{" "}
          {format === "a6" ? <b>A6</b> : <Link href={`${base}?formato=a6`}>A6</Link>} ·{" "}
          {format === "a4" ? <b>A4 centrada</b> : <Link href={`${base}?formato=a4`}>A4 centrada</Link>}
        </span>
        <PrintButton patientId={id} prescriptionId={rxId} format={format} />
        <span style={{ flexBasis: "100%", fontSize: 12, color: "#444" }}>
          Imprime al 100 % (sin «ajustar a la página»). {data.isCopy ? "Ya se imprimió antes: esta salida lleva la marca COPIA." : "Esta es la primera impresión (original)."}
        </span>
      </div>
      <PrescriptionSheet data={data} format={format} />
    </div>
  );
}
