"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { buildUnsignedECFXml } from "@/lib/domain/ecf";
import { signAndSubmitECF, ECFSigningNotConfiguredError } from "@/lib/domain/ecf-signing";
import type { Database, Json } from "@/lib/supabase/database.types";

export type BillingActionState = { error?: string; success?: string } | undefined;

type LineItemInput = {
  description: string;
  quantity: number;
  unit_price: number;
  itbis_indicator: Database["public"]["Tables"]["fiscal_document_items"]["Row"]["itbis_indicator"];
};

function parseLineItems(formData: FormData): LineItemInput[] | { error: string } {
  const descriptions = formData.getAll("item_description").map(String);
  const quantities = formData.getAll("item_quantity").map(String);
  const unitPrices = formData.getAll("item_unit_price").map(String);
  const itbisIndicators = formData.getAll("item_itbis_indicator").map(String);

  const items: LineItemInput[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = descriptions[i].trim();
    if (!description) continue; // fila vacía del formulario dinámico, se ignora

    const quantity = Number(quantities[i]);
    const unitPrice = Number(unitPrices[i]);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: `Cantidad inválida en la línea "${description}".` };
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return { error: `Precio unitario inválido en la línea "${description}".` };
    }
    const indicator = itbisIndicators[i] ?? "1";
    if (!["0", "1", "2", "3", "E"].includes(indicator)) {
      return { error: `Indicador de ITBIS inválido en la línea "${description}".` };
    }

    items.push({
      description,
      quantity,
      unit_price: unitPrice,
      itbis_indicator: indicator as LineItemInput["itbis_indicator"],
    });
  }

  if (items.length === 0) return { error: "Agrega al menos una línea con descripción." };
  return items;
}

/**
 * Genera el e-CF (reserva el e-NCF vía el RPC, que es el único camino
 * seguro), arma el XML en TypeScript y lo guarda, e intenta
 * signAndSubmitECF -- que hoy SIEMPRE falla con un mensaje claro. El
 * documento queda generado igual; la firma/envío es lo único pendiente.
 */
export async function generateFiscalDocument(
  patientId: string,
  encounterId: string | null,
  _prevState: BillingActionState,
  formData: FormData
): Promise<BillingActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const compradorNombre = String(formData.get("comprador_nombre") ?? "").trim();
  const compradorRnc = String(formData.get("comprador_rnc_cedula") ?? "").trim();
  const compradorEmail = String(formData.get("comprador_email") ?? "").trim();
  const compradorDireccion = String(formData.get("comprador_direccion") ?? "").trim();

  if (!compradorNombre) return { error: "El nombre del comprador es requerido." };

  const items = parseLineItems(formData);
  if ("error" in items) return items;

  const { data: newDocumentId, error: generateError } = await supabase.rpc("generate_fiscal_document", {
    target_patient_id: patientId,
    // El generador de tipos marca estos como no-nulables porque los
    // parámetros SQL no tienen DEFAULT -- pero sí aceptan NULL en runtime.
    // Cast justificado, mismo patrón usado en el resto del proyecto.
    target_encounter_id: (encounterId || null) as unknown as string,
    comprador_rnc_cedula: (compradorRnc || null) as unknown as string,
    comprador_nombre: compradorNombre,
    comprador_email: (compradorEmail || null) as unknown as string,
    comprador_direccion: (compradorDireccion || null) as unknown as string,
    // items es jsonb en la RPC -- LineItemInput[] es JSON-serializable,
    // el cast solo salva la brecha de tipos entre nuestro tipo específico
    // y el Json genérico que generó el tipador.
    items: items as unknown as Json,
  });
  if (generateError || !newDocumentId) {
    return { error: generateError?.message ?? "No se pudo generar el e-CF." };
  }

  // Volver a leer el documento recién creado + el perfil fiscal para armar
  // el XML -- generate_fiscal_document no lo hace (no se construye XML en
  // plpgsql, ver la migración).
  const [{ data: document }, { data: fiscalItems }, { data: fiscalProfile }] = await Promise.all([
    supabase.from("fiscal_documents").select("*").eq("id", newDocumentId).single(),
    supabase
      .from("fiscal_document_items")
      .select("*")
      .eq("fiscal_document_id", newDocumentId)
      .order("line_number"),
    supabase
      .from("clinic_fiscal_profiles")
      .select("rnc, business_name, commercial_name, fiscal_address")
      .eq("clinic_id", membership.clinicId)
      .single(),
  ]);

  // e_ncf y fecha_vencimiento_secuencia son nullable en el tipo de la fila
  // (borrador nunca los tiene), pero generate_fiscal_document los asigna
  // siempre al crear -- este chequeo es tanto una guarda real como lo que
  // estrecha el tipo para buildUnsignedECFXml.
  if (!document || !fiscalProfile || !document.e_ncf || !document.fecha_vencimiento_secuencia) {
    return { error: "El e-CF se generó, pero no se pudo armar el XML. Contacta soporte." };
  }

  const xmlSinFirmar = buildUnsignedECFXml(
    { ...document, e_ncf: document.e_ncf, fecha_vencimiento_secuencia: document.fecha_vencimiento_secuencia },
    fiscalItems ?? [],
    fiscalProfile
  );

  await supabase.from("fiscal_documents").update({ xml_sin_firmar: xmlSinFirmar }).eq("id", newDocumentId);

  let signError: string | null = null;
  try {
    await signAndSubmitECF(xmlSinFirmar);
  } catch (e) {
    signError = e instanceof ECFSigningNotConfiguredError ? e.message : "No se pudo firmar/enviar el e-CF.";
  }

  revalidatePath("/billing");
  redirect(`/billing/${newDocumentId}${signError ? "?signPending=1" : ""}`);
}

/** Reintenta signAndSubmitECF sobre un documento ya generado -- pensado
 * para cuando el certificado esté configurado, sin tener que regenerar
 * todo el documento. Hoy siempre falla, igual que en la generación. */
export async function retrySignFiscalDocument(
  fiscalDocumentId: string,
  _prevState: BillingActionState,
  _formData: FormData
): Promise<BillingActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: document } = await supabase
    .from("fiscal_documents")
    .select("xml_sin_firmar")
    .eq("id", fiscalDocumentId)
    .maybeSingle();
  if (!document?.xml_sin_firmar) return { error: "Este documento todavía no tiene un XML generado." };

  try {
    await signAndSubmitECF(document.xml_sin_firmar);
  } catch (e) {
    return { error: e instanceof ECFSigningNotConfiguredError ? e.message : "No se pudo firmar/enviar el e-CF." };
  }

  return undefined;
}

export async function voidFiscalDocument(
  fiscalDocumentId: string,
  _prevState: BillingActionState,
  formData: FormData
): Promise<BillingActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "El motivo de anulación es requerido." };

  const { error } = await supabase.rpc("void_fiscal_document", {
    target_fiscal_document_id: fiscalDocumentId,
    reason,
  });
  if (error) return { error: error.message };

  revalidatePath("/billing");
  revalidatePath(`/billing/${fiscalDocumentId}`);
  return { success: "e-CF anulado." };
}
