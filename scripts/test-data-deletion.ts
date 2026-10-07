/**
 * Prueba de la eliminación de datos de una clínica a solicitud
 * (supabase/migrations/20261010100000_clinic_data_deletion.sql) y del módulo puro
 * src/lib/domain/data-deletion.ts.
 *
 * Verifica, con clínicas sintéticas:
 *   1. SOLICITUD: sin aceptar la advertencia no se solicita; solo el admin puede
 *      (médico y recepción no); una sola solicitud abierta; el texto aceptado y
 *      su huella quedan guardados.
 *   2. DESCARGA + ESPERA: no se puede confirmar sin una descarga completa
 *      REGISTRADA después de la solicitud; al confirmar, la eliminación queda a
 *      30 días (hora de Santo Domingo).
 *   3. EJECUCIÓN (solo operador, irreversible): no antes de la fecha, no con un
 *      nombre equivocado, no sin ser operador; al ejecutarse la clínica y todos
 *      sus datos desaparecen (incluidos los mensajes de WhatsApp), los e-CF
 *      quedan ARCHIVADOS 5 años sin paciente ni consulta ni correo/dirección del
 *      comprador, la constancia permanece (con los pagos), y solo se reportan
 *      para borrar los usuarios que no pertenecen a otra clínica.
 *   4. CONSERVACIÓN VENCIDA: una clínica bloqueada solo puede eliminarse por esta
 *      vía cuando pasó retention_until.
 *   5. AISLAMIENTO Y COBERTURA: otra clínica no ve solicitudes ni registros
 *      ajenos; el archivo lo lee el operador y nadie más; ninguna tabla nueva
 *      queda sin guard ni sin política "de clínica activa" justificada.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";
import {
  DELETION_WAIT_DAYS,
  DELETION_WARNING_TEXT,
  FISCAL_ARCHIVE_YEARS,
  deletionStep,
} from "../src/lib/domain/data-deletion";

loadDotenv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltan variables de entorno. Se requieren NEXT_PUBLIC_SUPABASE_URL, " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const failures: { name: string; detail: string }[] = [];
function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push({ name, detail });
  }
}

const createdUserIds: string[] = [];
const createdClinicIds: string[] = [];

async function createUser(label: string) {
  const email = `data-deletion-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, email, client: client as unknown as SupabaseClient<Database> };
}
type TestUser = Awaited<ReturnType<typeof createUser>>;

async function createClinic(owner: TestUser, label: string): Promise<{ id: string; name: string }> {
  const name = `[TEST] Eliminación ${label} ${randomUUID().slice(0, 8)}`;
  const { data, error } = await owner.client.rpc("create_clinic_with_admin", {
    clinic_name: name,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return { id: data as string, name };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function countRows(table: string, clinicId: string): Promise<number> {
  const { count, error } = await admin
    .from(table as never)
    .select("*", { count: "exact", head: true })
    .eq("clinic_id" as never, clinicId as never);
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const adminA = await createUser("admin-a");
  const medicoA = await createUser("medico-a");
  const recepA = await createUser("recep-a");
  const sharedUser = await createUser("compartido"); // recepción en A y en B
  const adminB = await createUser("admin-b");
  const operator = await createUser("operador");
  await admin.from("platform_operators").insert({ user_id: operator.userId });
  const op = operator.client;

  const clinicA = await createClinic(adminA, "A");
  const clinicB = await createClinic(adminB, "B");
  await admin.from("clinic_members").insert([
    { clinic_id: clinicA.id, user_id: medicoA.userId, role: "medico" },
    { clinic_id: clinicA.id, user_id: recepA.userId, role: "recepcion" },
    { clinic_id: clinicA.id, user_id: sharedUser.userId, role: "recepcion" },
    { clinic_id: clinicB.id, user_id: sharedUser.userId, role: "recepcion" },
  ]);
  const { data: todayData } = await admin.rpc("dr_today");
  const today = todayData as string;

  // --- datos de la clínica A ---------------------------------------------------
  const { data: tpl } = await admin.from("specialty_templates").select("id").eq("code", "medicina_interna").single();
  const { data: consentTpl } = await admin.from("consent_templates").select("id").limit(1).single();
  const { data: patient } = await admin
    .from("patients")
    .insert({
      clinic_id: clinicA.id,
      first_name: "Ana",
      last_name: "Peña",
      national_id: "DEL-1",
      date_of_birth: "1990-01-01",
      sex: "femenino",
    })
    .select("id")
    .single();
  const { data: enc } = await admin
    .from("encounters")
    .insert({
      clinic_id: clinicA.id,
      patient_id: patient!.id,
      provider_id: adminA.userId,
      specialty_template_id: tpl!.id,
      specialty_data: {},
    })
    .select("id")
    .single();
  await admin.from("appointments").insert({
    clinic_id: clinicA.id,
    patient_id: patient!.id,
    provider_id: adminA.userId,
    specialty_template_id: tpl!.id,
    scheduled_at: new Date(Date.now() + 86400_000).toISOString(),
    created_by: adminA.userId,
  });
  await admin.from("consents").insert({
    clinic_id: clinicA.id,
    patient_id: patient!.id,
    consent_template_id: consentTpl!.id,
    document_title: "Consentimiento",
    document_content: "Texto",
    document_hash: "h",
    signer_name: "Ana",
    signer_relationship: "paciente",
    status: "firmado",
    recorded_by: adminA.userId,
  });
  const { data: insurer } = await admin
    .from("patient_insurers")
    .insert({ clinic_id: clinicA.id, patient_id: patient!.id, insurer_name: "SENASA", affiliate_number: "A-1", recorded_by: adminA.userId })
    .select("id")
    .single();
  await admin
    .from("insurance_claims")
    .insert({ clinic_id: clinicA.id, encounter_id: enc!.id, patient_insurer_id: insurer!.id, status: "pendiente", created_by: adminA.userId });
  await admin.from("clinic_fiscal_profiles").insert({
    clinic_id: clinicA.id,
    rnc: "131000002",
    business_name: "Clínica A",
    fiscal_address: "Calle 1",
    economic_activity: "Salud",
  });
  const { data: docs, error: docErr } = await admin
    .from("fiscal_documents")
    .insert([
      {
        clinic_id: clinicA.id,
        patient_id: patient!.id,
        encounter_id: enc!.id,
        e_ncf: "E320000000101",
        comprador_nombre: "Ana Peña",
        comprador_rnc_cedula: "00100000001",
        comprador_email: "ana@example.invalid",
        comprador_direccion: "Calle Secreta 123",
        monto_gravado_total: 100,
        monto_exento: 0,
        total_itbis: 18,
        monto_total: 118,
        status: "aceptado",
        xml_sin_firmar: "<sin-firmar/>",
        xml_firmado: "<firmado/>",
        created_by: adminA.userId,
      },
      {
        clinic_id: clinicA.id,
        patient_id: patient!.id,
        e_ncf: "E320000000102",
        comprador_nombre: "Ana Peña",
        monto_gravado_total: 0,
        monto_exento: 10,
        total_itbis: 0,
        monto_total: 10,
        status: "anulado",
        voided_at: new Date().toISOString(),
        voided_by: adminA.userId,
        voided_reason: "Error",
        xml_sin_firmar: "<solo-sin-firmar/>",
        created_by: adminA.userId,
      },
    ])
    .select("id, e_ncf");
  if (docErr || !docs) throw new Error(`insert comprobantes: ${docErr?.message}`);
  const doc1 = docs.find((d) => d.e_ncf === "E320000000101")!.id;
  await admin.from("fiscal_document_items").insert([
    { fiscal_document_id: doc1, line_number: 1, description: "Consulta", quantity: 1, unit_price: 100, itbis_indicator: "1", line_total: 100 },
    { fiscal_document_id: doc1, line_number: 2, description: "Extra", quantity: 1, unit_price: 0, itbis_indicator: "E", line_total: 0 },
  ]);
  await admin.from("whatsapp_messages").insert({
    clinic_id: clinicA.id,
    patient_id: patient!.id,
    to_phone_number: "+18095550101",
    template_name: "recordatorio",
    template_language: "es",
    environment: "test",
    meta_app_id: "test",
    status: "sent",
    sent_by: adminA.userId,
  });
  await op.rpc("set_clinic_plan_period", { target_clinic_id: clinicA.id, p_period_days: 30, p_amount: 100, p_start_on: today });
  await op.rpc("register_clinic_payment", { target_clinic_id: clinicA.id, p_paid_on: today, p_amount: 100, p_note: "pago de prueba" });
  // Un dato de la clínica B que NO debe tocarse.
  await admin.from("patients").insert({
    clinic_id: clinicB.id,
    first_name: "Bruno",
    last_name: "Otra",
    national_id: "DEL-B",
    date_of_birth: "1980-01-01",
    sex: "masculino",
  });

  // --------------------------------------------------------------------- 0. módulo puro
  console.log("\nMódulo de dominio:");
  check("la advertencia menciona irrecuperable, liberación y los años de archivo de e-CF",
    /IRRECUPERABLES/.test(DELETION_WARNING_TEXT) &&
      /libero a Narnia Tech Solution, SRL y a Cuido/.test(DELETION_WARNING_TEXT) &&
      DELETION_WARNING_TEXT.includes(`${FISCAL_ARCHIVE_YEARS} años`),
    DELETION_WARNING_TEXT
  );
  check(
    "deletionStep: sin solicitud / descargar / en espera / lista / cerrada",
    deletionStep(null, "2026-10-07") === "solicitar" &&
      deletionStep({ status: "solicitada", exportConfirmedAt: null, scheduledFor: null }, "2026-10-07") === "descargar" &&
      deletionStep({ status: "solicitada", exportConfirmedAt: "x", scheduledFor: "2026-10-08" }, "2026-10-07") === "en_espera" &&
      deletionStep({ status: "solicitada", exportConfirmedAt: "x", scheduledFor: "2026-10-07" }, "2026-10-07") === "lista" &&
      deletionStep({ status: "ejecutada", exportConfirmedAt: "x", scheduledFor: "2026-10-07" }, "2026-10-07") === "cerrada",
    "estados incorrectos"
  );

  // --------------------------------------------------------------------- 1. solicitud
  console.log("\nSolicitud:");
  const { error: notAccepted } = await adminA.client.rpc("request_clinic_data_deletion", { p_warning_text: DELETION_WARNING_TEXT, p_accepted: false });
  check("sin aceptar la advertencia no se solicita", notAccepted !== null, "se aceptó sin aceptación");
  const { error: noText } = await adminA.client.rpc("request_clinic_data_deletion", { p_warning_text: " ", p_accepted: true });
  check("sin el texto de la advertencia no se solicita", noText !== null, "se aceptó un texto vacío");
  for (const [who, u] of [["médico", medicoA], ["recepción", recepA]] as const) {
    const { error } = await u.client.rpc("request_clinic_data_deletion", { p_warning_text: DELETION_WARNING_TEXT, p_accepted: true });
    check(`${who} NO puede solicitar la eliminación`, error !== null, "lo permitió");
  }
  const { data: reqId, error: reqErr } = await adminA.client.rpc("request_clinic_data_deletion", { p_warning_text: DELETION_WARNING_TEXT, p_accepted: true });
  check("el admin solicita la eliminación", reqErr === null && !!reqId, reqErr?.message ?? "");
  const requestId = reqId as string;
  const { error: dup } = await adminA.client.rpc("request_clinic_data_deletion", { p_warning_text: DELETION_WARNING_TEXT, p_accepted: true });
  check("una sola solicitud abierta por clínica", dup !== null, "permitió una segunda");
  const { data: stored } = await adminA.client.from("clinic_deletion_requests").select("*").eq("id", requestId).single();
  check(
    "guarda el texto exacto aceptado, su huella, el solicitante y el canal",
    stored?.warning_text === DELETION_WARNING_TEXT &&
      stored?.warning_hash === createHash("sha256").update(DELETION_WARNING_TEXT, "utf8").digest("hex") &&
      stored?.requested_by_email === adminA.email &&
      stored?.channel === "app" &&
      stored?.clinic_name === clinicA.name &&
      stored?.status === "solicitada",
    JSON.stringify(stored)
  );
  const { error: directIns } = await adminA.client.from("clinic_deletion_requests").insert({
    clinic_id: clinicA.id,
    clinic_name: "x",
    requested_by_email: "x@x",
    channel: "app",
    warning_text: "x",
    warning_hash: "x",
  });
  check("un INSERT directo en clinic_deletion_requests se rechaza", directIns !== null, "el admin pudo insertar");
  const { data: seenByMedico } = await medicoA.client.from("clinic_deletion_requests").select("id");
  const { data: seenByB } = await adminB.client.from("clinic_deletion_requests").select("id");
  check("el médico y el admin de otra clínica NO ven la solicitud", (seenByMedico ?? []).length === 0 && (seenByB ?? []).length === 0, JSON.stringify([seenByMedico, seenByB]));

  // --------------------------------------------------------------------- 2. descarga + espera
  console.log("\nDescarga y espera:");
  const { error: early } = await adminA.client.rpc("confirm_deletion_export", { p_request_id: requestId });
  check("no se confirma sin una descarga registrada", early !== null, "confirmó sin descarga");
  const { error: wrongKind } = await adminA.client.rpc("log_clinic_export", { p_kind: "patients" });
  check("solo se registra la descarga del libro completo", wrongKind !== null, "aceptó otro tipo");
  const { error: logOther } = await medicoA.client.rpc("log_clinic_export", { p_kind: "all" });
  check("el médico no puede registrar una descarga", logOther !== null, "lo permitió");
  const { error: exOtherAdmin } = await adminB.client.rpc("confirm_deletion_export", { p_request_id: requestId });
  check("el admin de otra clínica no puede confirmar la solicitud ajena", exOtherAdmin !== null, "lo permitió");
  const { error: logOk } = await adminA.client.rpc("log_clinic_export", { p_kind: "all" });
  check("el admin registra la descarga completa", logOk === null, logOk?.message ?? "");
  const { data: confirmedFor, error: confirmErr } = await adminA.client.rpc("confirm_deletion_export", { p_request_id: requestId });
  check(
    `confirmar fija la eliminación a ${DELETION_WAIT_DAYS} días (hora de Santo Domingo)`,
    confirmErr === null && confirmedFor === addDays(today, DELETION_WAIT_DAYS),
    confirmErr?.message ?? `fecha = ${confirmedFor}`
  );
  const { error: again } = await adminA.client.rpc("confirm_deletion_export", { p_request_id: requestId });
  check("no se confirma dos veces", again !== null, "confirmó otra vez");

  // --------------------------------------------------------------------- 3. ejecución
  console.log("\nEjecución:");
  const { error: notOp } = await adminA.client.rpc("execute_clinic_data_deletion", { p_request_id: requestId, p_confirm_name: clinicA.name });
  check("un admin de clínica NO puede ejecutar la eliminación", notOp !== null, "la ejecutó");
  const { error: tooSoon } = await op.rpc("execute_clinic_data_deletion", { p_request_id: requestId, p_confirm_name: clinicA.name });
  check("el operador no puede ejecutar antes de la fecha", tooSoon !== null && /Todavía no se cumple la espera/.test(tooSoon.message), tooSoon?.message ?? "la ejecutó");
  check("nada se eliminó todavía", (await countRows("patients", clinicA.id)) === 1, "faltan pacientes");

  // Se adelanta la fecha (service_role) para poder probar la ejecución.
  await admin.from("clinic_deletion_requests").update({ scheduled_for: today }).eq("id", requestId);
  const { error: wrongName } = await op.rpc("execute_clinic_data_deletion", { p_request_id: requestId, p_confirm_name: "otro nombre" });
  check("con el nombre equivocado no se ejecuta", wrongName !== null && /no coincide/.test(wrongName.message), wrongName?.message ?? "la ejecutó");
  check("sigue sin eliminarse nada", (await countRows("patients", clinicA.id)) === 1, "se eliminó con nombre equivocado");

  const { data: orphans, error: execErr } = await op.rpc("execute_clinic_data_deletion", { p_request_id: requestId, p_confirm_name: clinicA.name });
  check("el operador ejecuta la eliminación", execErr === null, execErr?.message ?? "");
  const orphanIds = ((orphans ?? []) as string[]).sort();
  const expectedOrphans = [adminA.userId, medicoA.userId, recepA.userId].sort();
  check(
    "devuelve para borrar solo los usuarios sin otra clínica (no el compartido ni el operador)",
    JSON.stringify(orphanIds) === JSON.stringify(expectedOrphans),
    JSON.stringify(orphanIds)
  );

  const { data: gone } = await admin.from("clinics").select("id").eq("id", clinicA.id);
  check("la clínica ya no existe", (gone ?? []).length === 0, "sigue existiendo");
  const leftovers: string[] = [];
  for (const t of ["patients", "encounters", "appointments", "consents", "insurance_claims", "patient_insurers", "fiscal_documents", "clinic_members", "clinic_payments", "clinic_fiscal_profiles", "whatsapp_messages"]) {
    if ((await countRows(t, clinicA.id)) > 0) leftovers.push(t);
  }
  check("todas sus tablas quedan en 0 (incluidos los mensajes de WhatsApp)", leftovers.length === 0, `quedan: ${JSON.stringify(leftovers)}`);
  const { data: waOrphans } = await admin.from("whatsapp_messages").select("id").eq("to_phone_number", "+18095550101");
  check("no quedan mensajes de WhatsApp huérfanos (clinic_id nulo)", (waOrphans ?? []).length === 0, `quedan ${waOrphans?.length}`);
  check("la clínica B y su paciente no se tocaron", (await countRows("patients", clinicB.id)) === 1, "se afectó otra clínica");
  const { data: sharedStill } = await admin.from("clinic_members").select("clinic_id").eq("user_id", sharedUser.userId);
  check("el usuario compartido sigue siendo miembro de la clínica B", (sharedStill ?? []).length === 1 && sharedStill![0].clinic_id === clinicB.id, JSON.stringify(sharedStill));

  console.log("\nArchivo fiscal (e-CF):");
  const { data: archived } = await op.from("archived_fiscal_documents").select("*").eq("source_clinic_id", clinicA.id).order("e_ncf");
  check("los 2 e-CF quedan archivados", (archived ?? []).length === 2, `archivados ${archived?.length}`);
  const a1 = (archived ?? []).find((d) => d.e_ncf === "E320000000101");
  const a2 = (archived ?? []).find((d) => d.e_ncf === "E320000000102");
  check(
    "conservan lo fiscal: montos, ITBIS, RNC del emisor, comprador y XML firmado",
    a1?.monto_total === 118 &&
      a1?.total_itbis === 18 &&
      a1?.emisor_rnc === "131000002" &&
      a1?.comprador_nombre === "Ana Peña" &&
      a1?.comprador_rnc_cedula === "00100000001" &&
      a1?.xml === "<firmado/>" &&
      a1?.xml_is_signed === true &&
      a1?.clinic_name === clinicA.name,
    JSON.stringify(a1)
  );
  check(
    "el anulado conserva su anulación y su XML sin firmar",
    a2?.status === "anulado" && a2?.voided_reason === "Error" && a2?.xml === "<solo-sin-firmar/>" && a2?.xml_is_signed === false,
    JSON.stringify(a2)
  );
  const keys = Object.keys(a1 ?? {});
  check(
    "SIN vínculo con el expediente: no hay patient_id, encounter_id, correo ni dirección del comprador",
    !keys.includes("patient_id") && !keys.includes("encounter_id") && !keys.includes("comprador_email") && !keys.includes("comprador_direccion"),
    JSON.stringify(keys)
  );
  check("retain_until = hoy + 5 años", a1?.retain_until === `${Number(today.slice(0, 4)) + FISCAL_ARCHIVE_YEARS}${today.slice(4)}`, String(a1?.retain_until));
  const { data: archivedItems } = await op.from("archived_fiscal_document_items").select("line_number").eq("fiscal_document_id", doc1);
  check("conserva las 2 líneas del e-CF", (archivedItems ?? []).length === 2, `líneas ${archivedItems?.length}`);
  const { data: adminReadsArchive } = await adminB.client.from("archived_fiscal_documents").select("id");
  check("un admin de clínica NO lee el archivo fiscal", (adminReadsArchive ?? []).length === 0, `leyó ${adminReadsArchive?.length}`);

  console.log("\nConstancia:");
  const { data: receipt } = await op.from("clinic_deletion_requests").select("*").eq("id", requestId).single();
  const summary = receipt?.deletion_summary as { deleted_rows?: Record<string, number>; payments?: unknown[] } | null;
  check(
    "la solicitud permanece como constancia: ejecutada, sin clínica, con quién y cuándo",
    receipt?.status === "ejecutada" &&
      receipt?.clinic_id === null &&
      receipt?.clinic_name === clinicA.name &&
      receipt?.executed_by_email === operator.email &&
      !!receipt?.executed_at,
    JSON.stringify(receipt)
  );
  check(
    "resume cuántas filas se eliminaron (sin contenido) y conserva los pagos",
    summary?.deleted_rows?.patients === 1 &&
      summary?.deleted_rows?.fiscal_documents_archived === 2 &&
      summary?.deleted_rows?.whatsapp_messages === 1 &&
      (summary?.payments ?? []).length === 1,
    JSON.stringify(summary)
  );
  const { error: reexec } = await op.rpc("execute_clinic_data_deletion", { p_request_id: requestId, p_confirm_name: clinicA.name });
  check("no se puede ejecutar dos veces", reexec !== null, "la ejecutó otra vez");

  // Los usuarios huérfanos se eliminan como lo hace la acción del operador.
  for (const id of orphanIds) await admin.auth.admin.deleteUser(id);
  const { data: stillThere } = await admin.auth.admin.getUserById(sharedUser.userId);
  check("el usuario compartido NO se elimina", !!stillThere.user, "se eliminó");

  // --------------------------------------------------------------------- desistir
  console.log("\nDesistir:");
  const { data: reqB } = await adminB.client.rpc("request_clinic_data_deletion", { p_warning_text: DELETION_WARNING_TEXT, p_accepted: true });
  const { error: wdOther } = await adminA.client.rpc("withdraw_clinic_data_deletion", { p_request_id: reqB as string });
  check("un usuario ajeno no puede desistir de la solicitud de otra clínica", wdOther !== null, "pudo desistir");
  const { error: wd } = await adminB.client.rpc("withdraw_clinic_data_deletion", { p_request_id: reqB as string });
  check("el admin desiste de su solicitud", wd === null, wd?.message ?? "");
  const { error: execWithdrawn } = await op.rpc("execute_clinic_data_deletion", { p_request_id: reqB as string, p_confirm_name: clinicB.name });
  check("una solicitud desistida no se puede ejecutar", execWithdrawn !== null, "la ejecutó");
  const { error: again2 } = await adminB.client.rpc("request_clinic_data_deletion", { p_warning_text: DELETION_WARNING_TEXT, p_accepted: true });
  check("tras desistir se puede volver a solicitar", again2 === null, again2?.message ?? "");
  await adminB.client.rpc("withdraw_clinic_data_deletion", { p_request_id: (await adminB.client.from("clinic_deletion_requests").select("id").eq("status", "solicitada").single()).data!.id });

  // --------------------------------------------------------------------- 4. conservación vencida
  console.log("\nConservación vencida (clínica bloqueada):");
  const owner3 = await createUser("admin-c");
  const clinicC = await createClinic(owner3, "C");
  const { error: notBlocked } = await op.rpc("operator_start_expired_retention_deletion", { target_clinic_id: clinicC.id });
  check("una clínica que no está bloqueada no entra por esta vía", notBlocked !== null, "lo permitió");
  // Bloqueada hace poco: vencimiento = hoy - 121 -> retention_until = hoy + 2 años.
  await admin.from("clinic_subscriptions").update({ trial_ends_at: addDays(today, -121), next_payment_due_on: null }).eq("clinic_id", clinicC.id);
  const { error: tooEarly } = await op.rpc("operator_start_expired_retention_deletion", { target_clinic_id: clinicC.id });
  check("bloqueada pero dentro de los 2 años: se rechaza", tooEarly !== null && /no ha vencido/.test(tooEarly.message), tooEarly?.message ?? "lo permitió");
  const { error: adminStart } = await owner3.client.rpc("operator_start_expired_retention_deletion", { target_clinic_id: clinicC.id });
  check("un admin de clínica no puede usar esta vía", adminStart !== null, "lo permitió");
  // Vencida hace más de 2 años + 121 días.
  await admin.from("clinic_subscriptions").update({ trial_ends_at: addDays(today, -(121 + 366 * 2)) }).eq("clinic_id", clinicC.id);
  const { data: reqC, error: startErr } = await op.rpc("operator_start_expired_retention_deletion", { target_clinic_id: clinicC.id });
  check("vencidos los 2 años: el operador inicia la eliminación", startErr === null && !!reqC, startErr?.message ?? "");
  const { data: ovC } = await op.rpc("operator_clinic_access_overview");
  const rowC = (ovC ?? []).find((r: { clinic_id: string }) => r.clinic_id === clinicC.id);
  check("la clínica está bloqueada y su conservación venció", rowC?.state === "bloqueada" && !!rowC?.retention_until && rowC.retention_until <= today, JSON.stringify(rowC));
  const { error: execC } = await op.rpc("execute_clinic_data_deletion", { p_request_id: reqC as string, p_confirm_name: clinicC.name });
  check("se ejecuta sobre una clínica bloqueada (sin pedir la descarga)", execC === null, execC?.message ?? "");
  const { data: goneC } = await admin.from("clinics").select("id").eq("id", clinicC.id);
  check("la clínica bloqueada fue eliminada", (goneC ?? []).length === 0, "sigue existiendo");

  // --------------------------------------------------------------------- por correo
  console.log("\nSolicitud recibida por correo (el operador la registra):");
  const { error: regNotOp } = await adminB.client.rpc("operator_register_deletion_request", {
    target_clinic_id: clinicB.id,
    p_requester_email: "x@example.invalid",
    p_warning_text: DELETION_WARNING_TEXT,
    p_note: "",
  });
  check("un admin de clínica no puede usar el registro del operador", regNotOp !== null, "lo permitió");
  const { data: reqMail, error: regErr } = await op.rpc("operator_register_deletion_request", {
    target_clinic_id: clinicB.id,
    p_requester_email: adminB.email,
    p_warning_text: DELETION_WARNING_TEXT,
    p_note: "Recibida por correo",
  });
  check("el operador registra una solicitud por correo", regErr === null && !!reqMail, regErr?.message ?? "");
  const { data: mail } = await adminB.client.from("clinic_deletion_requests").select("channel, status").eq("id", reqMail as string).single();
  check("el admin la ve en su panel (canal correo)", mail?.channel === "correo" && mail?.status === "solicitada", JSON.stringify(mail));
  const { error: execNoDownload } = await op.rpc("execute_clinic_data_deletion", { p_request_id: reqMail as string, p_confirm_name: clinicB.name });
  check("sin descarga confirmada no se ejecuta, aunque la haya registrado el operador", execNoDownload !== null && /no confirmó la descarga/.test(execNoDownload.message), execNoDownload?.message ?? "la ejecutó");
  await op.rpc("withdraw_clinic_data_deletion", { p_request_id: reqMail as string });

  // --------------------------------------------------------------------- 5. cobertura
  console.log("\nCobertura:");
  const { data: unguarded } = await admin.rpc("list_unguarded_tables");
  check("ninguna tabla pública queda sin guard fuera de la lista explícita", (unguarded ?? []).length === 0, JSON.stringify(unguarded));
  const { data: openPolicies } = await admin.rpc("list_policies_open_when_blocked");
  check("ninguna política queda abierta al bloqueo sin justificar", (openPolicies ?? []).length === 0, JSON.stringify(openPolicies));
}

async function cleanup() {
  for (const id of createdClinicIds) {
    await admin.from("clinics").delete().eq("id", id);
  }
  // La constancia y el archivo fiscal de las pruebas también se limpian.
  const { data: reqs } = await admin.from("clinic_deletion_requests").select("id").like("clinic_name", "[TEST] Eliminación %");
  const ids = (reqs ?? []).map((r) => r.id);
  if (ids.length > 0) {
    await admin.from("archived_fiscal_documents").delete().in("deletion_request_id", ids);
    await admin.from("clinic_deletion_requests").delete().in("id", ids);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

main()
  .catch((e) => {
    failures.push({ name: "excepción no controlada", detail: e instanceof Error ? e.message : String(e) });
    console.error(e);
  })
  .finally(async () => {
    console.log("\nLimpiando datos sintéticos...");
    await cleanup();
    if (failures.length > 0) {
      console.error(`\nFALLÓ: ${failures.length} verificación(es) no pasaron.`);
      process.exit(1);
    }
    console.log("\nOK: eliminación de datos a solicitud verificada.");
  });
