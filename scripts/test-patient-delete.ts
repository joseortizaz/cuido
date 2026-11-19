/**
 * Prueba de pacientes de prueba, eliminación y anulación
 * (supabase/migrations/20261121100000_patient_delete_and_void.sql).
 *
 * Qué verifica:
 *   1. PRUEBA: código PRUEBA-NNN con contador aparte (no gasta el consecutivo
 *      real); un paciente nuevo nunca nace anulado; is_test y los campos de
 *      anulación no se cambian por UPDATE directo (ni siquiera service_role);
 *      solo el admin marca/desmarca.
 *   2. ELIMINAR PRUEBA: borra todo lo suyo (consultas, alergias, medicamentos,
 *      citas, consentimientos y mensajes de WhatsApp) y deja constancia; se
 *      rechaza con e-CF o reclamaciones; solo el admin de la clínica.
 *   3. ELIMINAR SIN ACTIVIDAD: exige nombre y motivo; rechaza con cualquier
 *      actividad (consultas, citas completadas, alergias, mensajes…); sí borra
 *      un paciente con solo una cita pendiente.
 *   4. ANULAR / REACTIVAR: motivo obligatorio, cancela citas futuras, bloquea
 *      movimientos nuevos y ediciones, queda en el historial de cambios.
 *   5. PERMISOS: médico, recepción y el admin de otra clínica no pueden nada
 *      de esto; el registro de eliminaciones es solo del admin e inmutable.
 *   6. EXPORTACIONES Y REPORTES excluyen a los pacientes de prueba.
 *   7. MODO SOLO LECTURA bloquea eliminar, anular y marcar.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { fetchPatientsExportData } from "../src/lib/bulk-import/export";
import { fetchEncounterExportData } from "../src/lib/bulk-import/export-encounters";
import { fetchRecordsData, RECORD_DATASETS } from "../src/lib/bulk-import/export-records";
import { loadClaimsReport } from "../src/lib/bulk-import/claims-report-data";

loadDotenv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

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

type TestUser = { userId: string; client: SupabaseClient };

async function createUser(label: string): Promise<TestUser> {
  const email = `patient-delete-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, client };
}

async function createClinic(owner: TestUser, label: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] Eliminar ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

const drYear = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }).slice(0, 4);

async function cleanup() {
  for (const id of createdClinicIds) {
    try {
      await admin.from("clinics").delete().eq("id", id);
    } catch {
      // best-effort
    }
  }
  for (const id of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      // best-effort
    }
  }
}

async function main() {
  console.log("Aprovisionando clínicas y usuarios sintéticos...");
  const owner = await createUser("owner");
  const medico = await createUser("medico");
  const recepcion = await createUser("recepcion");
  const ownerB = await createUser("ownerB");
  const cid = await createClinic(owner, "A");
  await createClinic(ownerB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: recepcion.userId, role: "recepcion" });
  const year = drYear();

  const { data: templates } = await admin.from("specialty_templates").select("id, code");
  const interna = templates?.find((t) => t.code === "medicina_interna");
  if (!interna) throw new Error("Falta la plantilla medicina_interna.");
  const { data: consentTemplate } = await admin.from("consent_templates").select("id").limit(1).single();
  if (!consentTemplate) throw new Error("Falta una plantilla de consentimiento.");

  const mkPatient = async (client: SupabaseClient, extra: Record<string, unknown> = {}) => {
    const { data, error } = await client
      .from("patients")
      .insert({
        clinic_id: cid,
        first_name: "Prueba",
        last_name: `Borrado-${randomUUID().slice(0, 6)}`,
        date_of_birth: "1990-01-01",
        sex: "femenino",
        ...extra,
      })
      .select("id, record_number, first_name, last_name, is_test, voided_at, void_reason")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el paciente: ${error?.message}`);
    return data as { id: string; record_number: string; first_name: string; last_name: string; is_test: boolean; voided_at: string | null; void_reason: string | null };
  };
  const seedEncounter = async (patientId: string) => {
    const { data, error } = await admin
      .from("encounters")
      .insert({ clinic_id: cid, patient_id: patientId, provider_id: owner.userId, specialty_template_id: interna.id, chief_complaint: "Control", specialty_data: {} })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert consulta: ${error?.message}`);
    return data.id as string;
  };
  const seedAppointment = async (patientId: string, whenMs: number, status = "pendiente") => {
    const { data, error } = await admin
      .from("appointments")
      .insert({ clinic_id: cid, patient_id: patientId, provider_id: owner.userId, specialty_template_id: interna.id, scheduled_at: new Date(whenMs).toISOString(), status, created_by: owner.userId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert cita: ${error?.message}`);
    return data.id as string;
  };
  const count = async (table: string, patientId: string) =>
    (await admin.from(table).select("id", { count: "exact", head: true }).eq("patient_id", patientId)).count ?? -1;
  const deletionLog = async () => (await admin.from("patient_deletion_log").select("*").eq("clinic_id", cid).order("deleted_at")).data ?? [];

  // ------------------------------------------------------------ 1. prueba
  console.log("\nPacientes de prueba:");
  const t1 = await mkPatient(recepcion.client, { is_test: true });
  const t2 = await mkPatient(owner.client, { is_test: true });
  check("el primero de prueba recibe PRUEBA-001", t1.record_number === "PRUEBA-001" && t1.is_test, t1.record_number);
  check("el segundo, PRUEBA-002", t2.record_number === "PRUEBA-002", t2.record_number);
  const r1 = await mkPatient(owner.client);
  check(`un paciente real sigue en ${year}-0001: la prueba no gastó el consecutivo`, r1.record_number === `${year}-0001`, r1.record_number);
  const t3 = await mkPatient(owner.client, { is_test: true });
  const r2 = await mkPatient(owner.client);
  check("la prueba sigue su propia cuenta (003) y la real la suya (0002)", t3.record_number === "PRUEBA-003" && r2.record_number === `${year}-0002`, `${t3.record_number} ${r2.record_number}`);
  const forged = await mkPatient(owner.client, { voided_at: new Date().toISOString(), void_reason: "falso" });
  check("un paciente nuevo nunca nace anulado (se ignora lo que mande el cliente)", forged.voided_at === null && forged.void_reason === null, JSON.stringify(forged));

  console.log("\nEl estado no se cambia por UPDATE directo:");
  const stateMsg = "solo lo cambia el administrador";
  const eMed = await medico.client.from("patients").update({ is_test: true }).eq("id", r1.id);
  check("un médico no marca pacientes de prueba", eMed.error !== null && eMed.error.message.includes(stateMsg), eMed.error?.message ?? "no falló");
  const eOwner = await owner.client.from("patients").update({ voided_at: new Date().toISOString(), void_reason: "x" }).eq("id", r1.id);
  check("el admin tampoco anula por UPDATE directo", eOwner.error !== null && eOwner.error.message.includes(stateMsg), eOwner.error?.message ?? "no falló");
  const eSvc = await admin.from("patients").update({ is_test: true }).eq("id", r1.id);
  check("ni service_role", eSvc.error !== null && eSvc.error.message.includes(stateMsg), eSvc.error?.message ?? "no falló");

  console.log("\nMarcar como de prueba:");
  for (const [label, who] of [["médico", medico], ["recepción", recepcion], ["admin de otra clínica", ownerB]] as const) {
    const { error } = await who.client.rpc("set_patient_test_flag", { p_patient_id: r1.id, p_is_test: true });
    check(`${label} NO puede marcar`, error !== null, "no falló");
  }
  const mark = await owner.client.rpc("set_patient_test_flag", { p_patient_id: r1.id, p_is_test: true });
  const { data: marked } = await admin.from("patients").select("is_test, record_number").eq("id", r1.id).single();
  check("el admin marca a un paciente real como de prueba (su código no cambia)", mark.error === null && marked?.is_test === true && marked.record_number === `${year}-0001`, `${mark.error?.message ?? ""} ${JSON.stringify(marked)}`);
  await owner.client.rpc("set_patient_test_flag", { p_patient_id: r1.id, p_is_test: false });
  const { data: unmarked } = await admin.from("patients").select("is_test").eq("id", r1.id).single();
  check("y lo desmarca", unmarked?.is_test === false, JSON.stringify(unmarked));

  console.log("\nQué se puede hacer con el paciente (estado):");
  const st = await owner.client.rpc("patient_deletion_status", { p_patient_id: r1.id });
  check("el admin ve el estado", st.error === null && (st.data as { is_test: boolean }).is_test === false, st.error?.message ?? JSON.stringify(st.data));
  const stMed = await medico.client.rpc("patient_deletion_status", { p_patient_id: r1.id });
  check("un médico no", stMed.error !== null, "no falló");

  // ------------------------------------------------- 2. eliminar prueba
  console.log("\nEliminar paciente de prueba:");
  const realDel = await owner.client.rpc("delete_test_patient", { p_patient_id: r1.id });
  check("un paciente real no se elimina como de prueba", realDel.error !== null && realDel.error.message.includes("de prueba"), realDel.error?.message ?? "no falló");
  for (const [label, who] of [["médico", medico], ["recepción", recepcion], ["admin de otra clínica", ownerB]] as const) {
    const { error } = await who.client.rpc("delete_test_patient", { p_patient_id: t1.id });
    check(`${label} NO puede eliminar`, error !== null, "no falló");
  }
  const { data: stillThere } = await admin.from("patients").select("id").eq("id", t1.id);
  check("sigue existiendo", (stillThere ?? []).length === 1, "se borró");

  // t1 con todo tipo de datos (sin e-CF ni reclamaciones)
  const enc1 = await seedEncounter(t1.id);
  await admin.from("vital_signs").insert({ clinic_id: cid, encounter_id: enc1, heart_rate: 70 });
  await admin.from("allergies").insert({ clinic_id: cid, patient_id: t1.id, substance: "Penicilina" });
  await admin.from("medications").insert({ clinic_id: cid, patient_id: t1.id, name: "Metformina" });
  await seedAppointment(t1.id, Date.now() + 86_400_000);
  await owner.client.from("patient_messaging_consents").insert({ clinic_id: cid, patient_id: t1.id, phone_e164: "+18095550123", source: "verbal" });
  const { data: wm } = await admin
    .from("whatsapp_messages")
    .insert({ clinic_id: cid, patient_id: t1.id, to_phone_number: "+18095550123", template_name: "x", template_language: "es", environment: "test", meta_app_id: "1", status: "sent", meta_message_id: `wamid.${randomUUID()}`, sent_by: owner.userId })
    .select("id")
    .single();
  await admin.from("consents").insert({
    clinic_id: cid, patient_id: t1.id, encounter_id: enc1, consent_template_id: consentTemplate.id, document_title: "C", document_content: "T",
    document_hash: "h", signer_name: "X", signer_relationship: "paciente", status: "firmado", recorded_by: owner.userId,
  });
  const stT1 = (await owner.client.rpc("patient_deletion_status", { p_patient_id: t1.id })).data as { test_blockers: string[] };
  check("sin e-CF ni reclamaciones no hay impedimentos", stT1.test_blockers.length === 0, JSON.stringify(stT1));

  const del1 = await owner.client.rpc("delete_test_patient", { p_patient_id: t1.id });
  check("el admin elimina el paciente de prueba", del1.error === null, del1.error?.message ?? "");
  check("el paciente ya no existe", (await admin.from("patients").select("id").eq("id", t1.id)).data?.length === 0, "sigue");
  const leftovers = [
    await count("encounters", t1.id), await count("allergies", t1.id), await count("medications", t1.id),
    await count("appointments", t1.id), await count("consents", t1.id), await count("patient_messaging_consents", t1.id),
  ];
  check("se borró todo lo suyo (consultas, alergias, medicamentos, citas, consentimientos)", leftovers.every((n) => n === 0), JSON.stringify(leftovers));
  check("también sus signos vitales (cascada de la consulta)", ((await admin.from("vital_signs").select("id").eq("encounter_id", enc1)).data ?? []).length === 0, "quedaron");
  check("y sus mensajes de WhatsApp", ((await admin.from("whatsapp_messages").select("id").eq("id", wm!.id)).data ?? []).length === 0, "quedó el mensaje");
  const log1 = await deletionLog();
  check(
    "quedó constancia: código, nombre, quién, caso «prueba»",
    log1.length === 1 && log1[0].record_number === "PRUEBA-001" && log1[0].deletion_case === "prueba" && log1[0].deleted_by === owner.userId && log1[0].patient_name === `${t1.first_name} ${t1.last_name}`,
    JSON.stringify(log1)
  );
  check("el código PRUEBA-001 no se reutiliza", (await mkPatient(owner.client, { is_test: true })).record_number === "PRUEBA-004", "reutilizado");

  // t2 con e-CF
  await admin.from("fiscal_documents").insert({
    clinic_id: cid, patient_id: t2.id, e_ncf: `E32${Date.now()}`.slice(0, 13), comprador_nombre: "T", monto_gravado_total: 0, monto_exento: 10,
    total_itbis: 0, monto_total: 10, status: "anulado", voided_at: new Date().toISOString(), voided_by: owner.userId, voided_reason: "x", created_by: owner.userId,
  });
  const delFiscal = await owner.client.rpc("delete_test_patient", { p_patient_id: t2.id });
  check("con un e-CF (aunque esté anulado) NO se elimina", delFiscal.error !== null && delFiscal.error.message.includes("e-CF"), delFiscal.error?.message ?? "no falló");
  check("el paciente con e-CF sigue", ((await admin.from("patients").select("id").eq("id", t2.id)).data ?? []).length === 1, "se borró");

  // t3 con reclamación
  const enc3 = await seedEncounter(t3.id);
  const { data: ins3 } = await admin.from("patient_insurers").insert({ clinic_id: cid, patient_id: t3.id, insurer_name: "SENASA", affiliate_number: "AF-1", recorded_by: owner.userId }).select("id").single();
  const { data: claim3, error: claimErr } = await admin
    .from("insurance_claims")
    .insert({ clinic_id: cid, encounter_id: enc3, patient_insurer_id: ins3!.id, claimed_amount: 100, status: "pendiente", created_by: owner.userId })
    .select("id")
    .single();
  if (claimErr || !claim3) throw new Error(`insert reclamación: ${claimErr?.message}`);
  const delClaim = await owner.client.rpc("delete_test_patient", { p_patient_id: t3.id });
  check("con una reclamación NO se elimina", delClaim.error !== null && delClaim.error.message.includes("reclamaciones"), delClaim.error?.message ?? "no falló");
  check("ninguna de las dos negativas dejó constancia", (await deletionLog()).length === 1, JSON.stringify(await deletionLog()));

  // ---------------------------------------------- 3. eliminar sin actividad
  console.log("\nEliminar paciente sin actividad:");
  const e1 = await mkPatient(owner.client, { first_name: "Ana  María", last_name: "Pérez" });
  const delTestPath = await owner.client.rpc("delete_empty_patient", { p_patient_id: t2.id, p_confirm_name: "x", p_reason: "error" });
  check("un paciente de prueba no se elimina por esta vía", delTestPath.error !== null && delTestPath.error.message.includes("de prueba"), delTestPath.error?.message ?? "no falló");
  const wrongName = await owner.client.rpc("delete_empty_patient", { p_patient_id: e1.id, p_confirm_name: "Otra Persona", p_reason: "Se creó por error" });
  check("con el nombre equivocado se rechaza", wrongName.error !== null && wrongName.error.message.includes("no coincide"), wrongName.error?.message ?? "no falló");
  const noReason = await owner.client.rpc("delete_empty_patient", { p_patient_id: e1.id, p_confirm_name: "Ana  María Pérez", p_reason: " " });
  check("sin motivo se rechaza", noReason.error !== null && noReason.error.message.includes("motivo"), noReason.error?.message ?? "no falló");
  for (const [label, who] of [["médico", medico], ["recepción", recepcion], ["admin de otra clínica", ownerB]] as const) {
    const { error } = await who.client.rpc("delete_empty_patient", { p_patient_id: e1.id, p_confirm_name: "Ana María Pérez", p_reason: "Se creó por error" });
    check(`${label} NO puede eliminar`, error !== null, "no falló");
  }
  check("hasta aquí nada se borró", ((await admin.from("patients").select("id").eq("id", e1.id)).data ?? []).length === 1, "se borró");
  const okEmpty = await owner.client.rpc("delete_empty_patient", { p_patient_id: e1.id, p_confirm_name: "  ana maría   pérez ", p_reason: "Se creó por error" });
  check("con nombre (sin importar mayúsculas ni espacios) y motivo, se elimina", okEmpty.error === null, okEmpty.error?.message ?? "");
  const log2 = (await deletionLog()).filter((l) => l.deletion_case === "error");
  check("constancia con caso «error», motivo y quién", log2.length === 1 && log2[0].reason === "Se creó por error" && log2[0].deleted_by === owner.userId && log2[0].record_number === e1.record_number, JSON.stringify(log2));

  const blockedCases: [string, (id: string) => Promise<void>, string][] = [
    ["una consulta", async (id) => void (await seedEncounter(id)), "consultas"],
    ["una cita completada", async (id) => void (await seedAppointment(id, Date.now() - 86_400_000, "completada")), "citas completadas"],
    ["una alergia", async (id) => void (await admin.from("allergies").insert({ clinic_id: cid, patient_id: id, substance: "Látex" })), "alergias"],
    ["un medicamento", async (id) => void (await admin.from("medications").insert({ clinic_id: cid, patient_id: id, name: "Aspirina" })), "medicamentos"],
    ["un consentimiento de WhatsApp", async (id) => void (await owner.client.from("patient_messaging_consents").insert({ clinic_id: cid, patient_id: id, phone_e164: "+18295550199", source: "verbal" })), "WhatsApp"],
    ["un consentimiento informado", async (id) => void (await admin.from("consents").insert({ clinic_id: cid, patient_id: id, consent_template_id: consentTemplate.id, document_title: "C", document_content: "T", document_hash: "h", signer_name: "X", signer_relationship: "paciente", status: "firmado", recorded_by: owner.userId })), "consentimientos"],
  ];
  for (const [label, seed, word] of blockedCases) {
    const p = await mkPatient(owner.client);
    await seed(p.id);
    const { error } = await owner.client.rpc("delete_empty_patient", { p_patient_id: p.id, p_confirm_name: `${p.first_name} ${p.last_name}`, p_reason: "Prueba de bloqueo" });
    check(`con ${label} NO se elimina`, error !== null && error.message.includes(word) && error.message.includes("Anúlalo"), error?.message ?? "no falló");
    check(`(${label}) el paciente sigue`, ((await admin.from("patients").select("id").eq("id", p.id)).data ?? []).length === 1, "se borró");
  }
  const e3 = await mkPatient(owner.client);
  await seedAppointment(e3.id, Date.now() + 2 * 86_400_000);
  await admin.from("patient_insurers").insert({ clinic_id: cid, patient_id: e3.id, insurer_name: "SENASA", affiliate_number: "AF-9", recorded_by: owner.userId });
  const okE3 = await owner.client.rpc("delete_empty_patient", { p_patient_id: e3.id, p_confirm_name: `${e3.first_name} ${e3.last_name}`, p_reason: "Duplicado" });
  check("con solo una cita pendiente y un seguro SÍ se elimina (se van con él)", okE3.error === null && (await count("appointments", e3.id)) === 0 && (await count("patient_insurers", e3.id)) === 0, okE3.error?.message ?? "quedaron filas");

  console.log("\nRegistro de eliminaciones:");
  const asOwner = await owner.client.from("patient_deletion_log").select("id").eq("clinic_id", cid);
  check("el admin lo lee", (asOwner.data ?? []).length === (await deletionLog()).length && (asOwner.data ?? []).length >= 3, `${asOwner.data?.length}`);
  const asMedico = await medico.client.from("patient_deletion_log").select("id");
  check("el médico NO", (asMedico.data ?? []).length === 0, `${asMedico.data?.length}`);
  const asRecep = await recepcion.client.from("patient_deletion_log").select("id");
  check("recepción NO", (asRecep.data ?? []).length === 0, `${asRecep.data?.length}`);
  const asOther = await ownerB.client.from("patient_deletion_log").select("id");
  check("otra clínica NO", (asOther.data ?? []).length === 0, `${asOther.data?.length}`);
  const uLog = await admin.from("patient_deletion_log").update({ reason: "x" }).eq("clinic_id", cid);
  const dLog = await admin.from("patient_deletion_log").delete().eq("clinic_id", cid);
  const iLog = await owner.client.from("patient_deletion_log").insert({ clinic_id: cid, record_number: "x", patient_name: "x", reason: "x", deletion_case: "error" });
  check("es inmutable (ni editar, ni borrar, ni escribir a mano)", uLog.error !== null && dLog.error !== null && iLog.error !== null, `${uLog.error?.message} | ${dLog.error?.message} | ${iLog.error?.message}`);

  // ------------------------------------------------------- 4. anular
  console.log("\nAnular y reactivar:");
  const v = await mkPatient(owner.client);
  await seedEncounter(v.id);
  const futureAppt = await seedAppointment(v.id, Date.now() + 3 * 86_400_000);
  const pastAppt = await seedAppointment(v.id, Date.now() - 3 * 86_400_000, "completada");
  for (const [label, who] of [["médico", medico], ["recepción", recepcion], ["admin de otra clínica", ownerB]] as const) {
    const { error } = await who.client.rpc("void_patient", { p_patient_id: v.id, p_reason: "Motivo válido" });
    check(`${label} NO puede anular`, error !== null, "no falló");
  }
  const shortReason = await owner.client.rpc("void_patient", { p_patient_id: v.id, p_reason: "x" });
  check("el motivo es obligatorio", shortReason.error !== null && shortReason.error.message.includes("motivo"), shortReason.error?.message ?? "no falló");
  const voided = await owner.client.rpc("void_patient", { p_patient_id: v.id, p_reason: "Paciente duplicado" });
  check("el admin anula", voided.error === null, voided.error?.message ?? "");
  const { data: vRow } = await admin.from("patients").select("voided_at, voided_by, void_reason").eq("id", v.id).single();
  check("quedan fecha, quién y motivo", !!vRow?.voided_at && vRow.voided_by === owner.userId && vRow.void_reason === "Paciente duplicado", JSON.stringify(vRow));
  const twice = await owner.client.rpc("void_patient", { p_patient_id: v.id, p_reason: "Otra vez" });
  check("no se anula dos veces", twice.error !== null && twice.error.message.includes("ya está anulado"), twice.error?.message ?? "no falló");
  const { data: appts } = await admin.from("appointments").select("id, status").eq("patient_id", v.id);
  const byId = new Map((appts ?? []).map((a) => [a.id, a.status]));
  check("su cita futura se canceló y la pasada completada no se tocó", byId.get(futureAppt) === "cancelada" && byId.get(pastAppt) === "completada", JSON.stringify(appts));
  const vLog = (await admin.from("patient_change_log").select("field").eq("patient_id", v.id)).data ?? [];
  const fields = vLog.map((r) => r.field).sort();
  check("el historial de cambios registra la anulación (sin repetir quién)", fields.includes("voided_at") && fields.includes("void_reason") && !fields.includes("voided_by"), fields.join(","));

  const medEdit = await medico.client.from("patients").update({ phone: "8095550000" }).eq("id", v.id).select("id");
  check("un paciente anulado no se edita (ni el médico ni el admin)", (medEdit.data ?? []).length === 0, JSON.stringify(medEdit));
  const ownEdit = await owner.client.from("patients").update({ phone: "8095550000" }).eq("id", v.id).select("id");
  check("(admin)", (ownEdit.data ?? []).length === 0, JSON.stringify(ownEdit));
  const movMsg = "está anulado";
  const mEnc = await medico.client.from("encounters").insert({ clinic_id: cid, patient_id: v.id, provider_id: medico.userId, specialty_template_id: interna.id, specialty_data: {} });
  check("no admite consultas nuevas", mEnc.error !== null && mEnc.error.message.includes(movMsg), mEnc.error?.message ?? "no falló");
  const mApp = await admin.from("appointments").insert({ clinic_id: cid, patient_id: v.id, provider_id: owner.userId, specialty_template_id: interna.id, scheduled_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), created_by: owner.userId });
  check("ni citas nuevas (tampoco service_role)", mApp.error !== null && mApp.error.message.includes(movMsg), mApp.error?.message ?? "no falló");
  const mAll = await medico.client.from("allergies").insert({ clinic_id: cid, patient_id: v.id, substance: "X" });
  const mMed = await medico.client.from("medications").insert({ clinic_id: cid, patient_id: v.id, name: "X" });
  check("ni alergias ni medicamentos", mAll.error !== null && mMed.error !== null, `${mAll.error?.message} | ${mMed.error?.message}`);
  const mFis = await admin.from("fiscal_documents").insert({ clinic_id: cid, patient_id: v.id, e_ncf: `E39${Date.now()}`.slice(0, 13), comprador_nombre: "X", monto_gravado_total: 0, monto_exento: 1, total_itbis: 0, monto_total: 1, status: "anulado", voided_at: new Date().toISOString(), voided_by: owner.userId, voided_reason: "x", created_by: owner.userId });
  check("ni comprobantes", mFis.error !== null && mFis.error.message.includes(movMsg), mFis.error?.message ?? "no falló");
  const mCon = await admin.from("consents").insert({ clinic_id: cid, patient_id: v.id, consent_template_id: consentTemplate.id, document_title: "C", document_content: "T", document_hash: "h", signer_name: "X", signer_relationship: "paciente", status: "firmado", recorded_by: owner.userId });
  check("ni consentimientos", mCon.error !== null && mCon.error.message.includes(movMsg), mCon.error?.message ?? "no falló");

  const unvoidMed = await medico.client.rpc("unvoid_patient", { p_patient_id: v.id });
  check("un médico NO reactiva", unvoidMed.error !== null, "no falló");
  const unvoidB = await ownerB.client.rpc("unvoid_patient", { p_patient_id: v.id });
  check("otra clínica NO reactiva", unvoidB.error !== null, "no falló");
  const unvoid = await owner.client.rpc("unvoid_patient", { p_patient_id: v.id });
  check("el admin reactiva", unvoid.error === null, unvoid.error?.message ?? "");
  const { data: uRow } = await admin.from("patients").select("voided_at, voided_by, void_reason").eq("id", v.id).single();
  check("queda limpio", uRow?.voided_at === null && uRow.voided_by === null && uRow.void_reason === null, JSON.stringify(uRow));
  const afterEdit = await medico.client.from("patients").update({ phone: "8095550000" }).eq("id", v.id).select("id");
  // Con el expediente abierto (requisito para registrar consultas) el paciente reactivado vuelve a recibirlas.
  await admin.from("patient_records").insert({ clinic_id: cid, patient_id: v.id });
  const afterEnc = await medico.client.from("encounters").insert({ clinic_id: cid, patient_id: v.id, provider_id: medico.userId, specialty_template_id: interna.id, specialty_data: {} });
  check("reactivado vuelve a poder editarse y recibir consultas", (afterEdit.data ?? []).length === 1 && afterEnc.error === null, `${afterEnc.error?.message ?? ""}`);
  const { data: stillCancelled } = await admin.from("appointments").select("status").eq("id", futureAppt).single();
  check("la cita cancelada NO se restaura sola", stillCancelled?.status === "cancelada", JSON.stringify(stillCancelled));

  // ------------------------------------------------ 5. exportaciones y reportes
  console.log("\nExportaciones y reportes excluyen a los pacientes de prueba:");
  const real = await mkPatient(owner.client, { first_name: "Real", last_name: "Visible" });
  const test = await mkPatient(owner.client, { first_name: "Ficticio", last_name: "Invisible", is_test: true });
  const voidedReal = await mkPatient(owner.client, { first_name: "Anulado", last_name: "Exportado" });
  await owner.client.rpc("void_patient", { p_patient_id: voidedReal.id, p_reason: "Se anula para probar" });
  for (const p of [real, test]) {
    await seedEncounter(p.id);
    await admin.from("allergies").insert({ clinic_id: cid, patient_id: p.id, substance: `Alergia-${p.last_name}` });
    await seedAppointment(p.id, Date.now() + 9 * 86_400_000);
    await admin.from("consents").insert({ clinic_id: cid, patient_id: p.id, consent_template_id: consentTemplate.id, document_title: "C", document_content: "T", document_hash: "h", signer_name: p.last_name, signer_relationship: "paciente", status: "firmado", recorded_by: owner.userId });
    const { data: ins } = await admin.from("patient_insurers").insert({ clinic_id: cid, patient_id: p.id, insurer_name: "SENASA", affiliate_number: `AF-${p.last_name}`, recorded_by: owner.userId }).select("id").single();
    await admin.from("fiscal_documents").insert({ clinic_id: cid, patient_id: p.id, e_ncf: `E3${String(Math.floor(Math.random() * 1e11)).padStart(11, "0")}`, comprador_nombre: p.last_name, monto_gravado_total: 0, monto_exento: 5, total_itbis: 0, monto_total: 5, status: "anulado", voided_at: new Date().toISOString(), voided_by: owner.userId, voided_reason: "x", created_by: owner.userId });
    const encId = (await admin.from("encounters").select("id").eq("patient_id", p.id).limit(1).single()).data!.id;
    await admin.from("insurance_claims").insert({ clinic_id: cid, encounter_id: encId, patient_insurer_id: ins!.id, claimed_amount: 50, status: "pendiente", created_by: owner.userId });
  }
  const pe = await fetchPatientsExportData(owner.client, { withDetail: true });
  const peNames = pe.patients.map((p) => p.last_name);
  check("pacientes: sale el real y el anulado, no el de prueba", peNames.includes("Visible") && peNames.includes("Exportado") && !peNames.includes("Invisible"), peNames.join(","));
  check("pacientes: el anulado sale con su estado", pe.patients.find((p) => p.last_name === "Exportado")?.voided_at != null, "sin marca");
  check("pacientes: tampoco las alergias del de prueba", pe.allergies.some((a) => a.substance === "Alergia-Visible") && !pe.allergies.some((a) => a.substance === "Alergia-Invisible"), JSON.stringify(pe.allergies.map((a) => a.substance)));
  const ee = await fetchEncounterExportData(owner.client);
  check("consultas: solo las del paciente real", ee.some((e) => e.patient?.last_name === "Visible") && !ee.some((e) => e.patient?.last_name === "Invisible"), JSON.stringify(ee.map((e) => e.patient?.last_name)));
  const rd = await fetchRecordsData(owner.client, [...RECORD_DATASETS]);
  const testId = test.id;
  check("registros: nada del paciente de prueba (consentimientos, comprobantes, citas, seguros)",
    !rd.consents.some((c) => c.patient_id === testId) && !rd.fiscalDocs.some((d) => d.patient_id === testId) &&
      !rd.appointments.some((a) => a.patient_id === testId) && !rd.insurers.some((i) => i.patient_id === testId),
    "salió algo del paciente de prueba");
  check("registros: sí lo del paciente real", rd.consents.some((c) => c.patient_id === real.id) && rd.fiscalDocs.some((d) => d.patient_id === real.id) && rd.insurers.some((i) => i.patient_id === real.id), "faltó lo del real");
  const testInsurerIds = new Set(rd.insurers.map((i) => i.id));
  check("registros: reclamaciones solo del real (1)", rd.claims.length === 1 && rd.claims.every((c) => testInsurerIds.has(c.patient_insurer_id)), `${rd.claims.length}`);
  const { report } = await loadClaimsReport(owner.client, "todo");
  check("reporte de reclamaciones: cuenta 1 (la del real; la de prueba no entra)", report.totals.count === 1, `${report.totals.count}`);

  // ------------------------------------------------------ 6. solo lectura
  console.log("\nModo solo lectura:");
  const roEmpty = await mkPatient(owner.client);
  const roTest = await mkPatient(owner.client, { is_test: true });
  const old = new Date();
  old.setUTCDate(old.getUTCDate() - 40);
  const { error: subErr } = await admin.from("clinic_subscriptions").update({ trial_ends_at: old.toISOString().slice(0, 10), next_payment_due_on: null }).eq("clinic_id", cid);
  if (subErr) throw new Error(`No se pudo vencer la suscripción: ${subErr.message}`);
  const ro = "modo solo lectura";
  const roVoid = await owner.client.rpc("void_patient", { p_patient_id: real.id, p_reason: "Solo lectura" });
  check("no se puede anular", roVoid.error !== null && roVoid.error.message.includes(ro), roVoid.error?.message ?? "no falló");
  const roFlag = await owner.client.rpc("set_patient_test_flag", { p_patient_id: real.id, p_is_test: true });
  check("ni marcar como de prueba", roFlag.error !== null && roFlag.error.message.includes(ro), roFlag.error?.message ?? "no falló");
  const roDel = await owner.client.rpc("delete_test_patient", { p_patient_id: roTest.id });
  check("ni eliminar un paciente de prueba", roDel.error !== null && roDel.error.message.includes(ro), roDel.error?.message ?? "no falló");
  const roDelEmpty = await owner.client.rpc("delete_empty_patient", { p_patient_id: roEmpty.id, p_confirm_name: `${roEmpty.first_name} ${roEmpty.last_name}`, p_reason: "Solo lectura" });
  check("ni eliminar uno sin actividad", roDelEmpty.error !== null && roDelEmpty.error.message.includes(ro), roDelEmpty.error?.message ?? "no falló");
  const { data: intact } = await admin.from("patients").select("id, voided_at, is_test").in("id", [real.id, test.id, roEmpty.id, roTest.id]);
  check("todo quedó intacto", (intact ?? []).length === 4 && intact!.every((p) => p.voided_at === null), JSON.stringify(intact));
  const logAfter = await deletionLog();
  check("y sin constancias nuevas por esos intentos", logAfter.length === 3, `${logAfter.length}`);
}

main()
  .catch((err) => {
    console.error("Error inesperado:", err);
    failures.push({ name: "error inesperado", detail: String(err?.message ?? err) });
  })
  .finally(async () => {
    console.log("\nLimpiando datos sintéticos...");
    await cleanup();
    console.log("");
    if (failures.length > 0) {
      console.error(`FALLÓ: ${failures.length} verificación(es) no pasaron.`);
      process.exit(1);
    }
    console.log("OK: pacientes de prueba, eliminación y anulación verificados.");
  });
