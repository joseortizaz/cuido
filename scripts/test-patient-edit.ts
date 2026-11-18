/**
 * Prueba de la edición de pacientes y su historial de cambios
 * (supabase/migrations/20261120100000_patient_edit_and_change_log.sql).
 *
 * Qué verifica:
 *   1. QUIÉN edita: admin y médicos sí; recepción NO actualiza `patients`
 *      directo (la fila queda igual); el admin de otra clínica tampoco.
 *   2. HISTORIAL: una fila por campo que cambia, con valor anterior, valor
 *      nuevo y quién lo hizo; un UPDATE que no cambia nada no registra nada.
 *   3. QUIÉN lo lee: admin y médicos; recepción y otra clínica no.
 *   4. INMUTABLE: nadie edita ni borra el historial (ni service_role), pero sí
 *      desaparece junto con el paciente (cascada).
 *   5. CONTACTO desde recepción: update_patient_contact funciona para admin y
 *      recepción (con el cambio en el historial a nombre de quien lo hizo) y
 *      se rechaza al médico y a otra clínica.
 *   6. CONSENTIMIENTO DE WHATSAPP: si el teléfono cambia se revoca el
 *      consentimiento vigente; si es el mismo número, no. Solo personal
 *      autorizado puede pedir la revocación.
 *   7. MODO SOLO LECTURA: bloquea editar y el contacto; no deja filas en el
 *      historial.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

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
  const email = `patient-edit-${label}-${randomUUID()}@example.invalid`;
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
    clinic_name: `[TEST] Edición ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

const newPatient = (clinicId: string) => ({
  clinic_id: clinicId,
  first_name: "Prueba",
  last_name: `Edición-${randomUUID().slice(0, 6)}`,
  date_of_birth: "1990-01-01",
  sex: "femenino",
});

type LogRow = { field: string; old_value: string | null; new_value: string | null; changed_by: string | null };
async function logOf(patientId: string): Promise<LogRow[]> {
  const { data } = await admin
    .from("patient_change_log")
    .select("field, old_value, new_value, changed_by, changed_at")
    .eq("patient_id", patientId)
    .order("changed_at", { ascending: true })
    .order("field", { ascending: true });
  return (data ?? []) as LogRow[];
}

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
  const cidA = await createClinic(owner, "A");
  const cidB = await createClinic(ownerB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cidA, user_id: medico.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cidA, user_id: recepcion.userId, role: "recepcion" });

  const { data: p, error: pErr } = await recepcion.client.from("patients").insert(newPatient(cidA)).select("id, first_name").single();
  if (pErr || !p) throw new Error(`recepción no pudo crear el paciente: ${pErr?.message}`);
  const pid = p.id as string;
  const original = p.first_name as string;
  check("recepción sigue pudiendo CREAR pacientes", true, "");
  check("el alta no genera historial de cambios", (await logOf(pid)).length === 0, JSON.stringify(await logOf(pid)));

  console.log("\nQuién puede editar:");
  const recepUpd = await recepcion.client.from("patients").update({ first_name: "Hackeado" }).eq("id", pid).select("id");
  const { data: afterRecep } = await admin.from("patients").select("first_name").eq("id", pid).single();
  check("recepción NO actualiza patients directo", afterRecep?.first_name === original && (recepUpd.data ?? []).length === 0, `${afterRecep?.first_name} ${recepUpd.error?.message ?? ""}`);
  const otherUpd = await ownerB.client.from("patients").update({ first_name: "Hackeado" }).eq("id", pid).select("id");
  const { data: afterOther } = await admin.from("patients").select("first_name").eq("id", pid).single();
  check("el admin de otra clínica tampoco", afterOther?.first_name === original && (otherUpd.data ?? []).length === 0, `${afterOther?.first_name}`);
  check("ninguno de esos intentos dejó historial", (await logOf(pid)).length === 0, JSON.stringify(await logOf(pid)));

  const medUpd = await medico.client.from("patients").update({ first_name: "Marta" }).eq("id", pid).select("id");
  check("un médico edita el paciente", medUpd.error === null && (medUpd.data ?? []).length === 1, medUpd.error?.message ?? "0 filas");
  let log = await logOf(pid);
  check(
    "queda 1 fila: first_name, antes → después, a nombre del médico",
    log.length === 1 && log[0].field === "first_name" && log[0].old_value === original && log[0].new_value === "Marta" && log[0].changed_by === medico.userId,
    JSON.stringify(log)
  );

  const adminUpd = await owner.client
    .from("patients")
    .update({ last_name: "Nuevo", phone: "8095550101", national_id: "001-9999999-9" })
    .eq("id", pid)
    .select("id");
  check("el admin edita varios campos a la vez", adminUpd.error === null && (adminUpd.data ?? []).length === 1, adminUpd.error?.message ?? "0 filas");
  log = (await logOf(pid)).slice(1);
  const byField = new Map(log.map((r) => [r.field, r]));
  check("una fila por campo (3)", log.length === 3, JSON.stringify(log));
  check("phone: de vacío a 8095550101", byField.get("phone")?.old_value === null && byField.get("phone")?.new_value === "8095550101", JSON.stringify(byField.get("phone")));
  check("national_id registrado", byField.get("national_id")?.new_value === "001-9999999-9", JSON.stringify(byField.get("national_id")));
  check("todas a nombre del admin", log.every((r) => r.changed_by === owner.userId), JSON.stringify(log));

  const before = (await logOf(pid)).length;
  await owner.client.from("patients").update({ first_name: "Marta", phone: "8095550101" }).eq("id", pid);
  check("un UPDATE sin cambios reales no registra nada", (await logOf(pid)).length === before, "se agregaron filas");
  const dateChange = await owner.client.from("patients").update({ date_of_birth: "1991-02-03", sex: "masculino" }).eq("id", pid);
  const last2 = (await logOf(pid)).slice(before);
  check("fecha de nacimiento y sexo también se registran", dateChange.error === null && last2.map((r) => r.field).join(",") === "date_of_birth,sex", JSON.stringify(last2));

  console.log("\nQuién lee el historial:");
  const asMedico = await medico.client.from("patient_change_log").select("id").eq("patient_id", pid);
  check("el médico lo lee", (asMedico.data ?? []).length > 0, asMedico.error?.message ?? "0 filas");
  const asOwner = await owner.client.from("patient_change_log").select("id").eq("patient_id", pid);
  check("el admin lo lee", (asOwner.data ?? []).length > 0, asOwner.error?.message ?? "0 filas");
  const asRecep = await recepcion.client.from("patient_change_log").select("id").eq("patient_id", pid);
  check("recepción NO lo lee", (asRecep.data ?? []).length === 0, `${asRecep.data?.length} filas`);
  const asOther = await ownerB.client.from("patient_change_log").select("id").eq("patient_id", pid);
  check("otra clínica NO lo lee", (asOther.data ?? []).length === 0, `${asOther.data?.length} filas`);

  console.log("\nHistorial inmutable:");
  const logIds = (await admin.from("patient_change_log").select("id").eq("patient_id", pid)).data ?? [];
  const uOwner = await owner.client.from("patient_change_log").update({ new_value: "x" }).eq("patient_id", pid);
  check("el admin no lo edita", uOwner.error !== null, "no falló");
  const dOwner = await owner.client.from("patient_change_log").delete().eq("patient_id", pid);
  check("ni lo borra", dOwner.error !== null, "no falló");
  const iOwner = await owner.client.from("patient_change_log").insert({ clinic_id: cidA, patient_id: pid, field: "x" });
  check("ni escribe filas a mano", iOwner.error !== null, "no falló");
  const uSvc = await admin.from("patient_change_log").update({ new_value: "x" }).eq("patient_id", pid);
  check("service_role no lo edita", uSvc.error !== null && uSvc.error.message.includes("no se puede modificar"), uSvc.error?.message ?? "no falló");
  const dSvc = await admin.from("patient_change_log").delete().eq("patient_id", pid);
  check("service_role no lo borra directo", dSvc.error !== null && dSvc.error.message.includes("no se puede modificar"), dSvc.error?.message ?? "no falló");
  check("las filas siguen ahí", ((await admin.from("patient_change_log").select("id").eq("patient_id", pid)).data ?? []).length === logIds.length, "cambió el conteo");

  console.log("\nContacto desde recepción:");
  const { data: c1, error: c1Err } = await recepcion.client.rpc("update_patient_contact", {
    p_patient_id: pid,
    p_phone: "8295550202",
    p_email: "recepcion@example.invalid",
    p_phone_e164: "+18295550202",
  });
  check("recepción cambia teléfono y correo por la función", c1Err === null && c1 === false, `${c1Err?.message ?? ""} ${c1}`);
  const { data: afterContact } = await admin.from("patients").select("phone, email, first_name").eq("id", pid).single();
  check("se guardaron (y nada más cambió)", afterContact?.phone === "8295550202" && afterContact?.email === "recepcion@example.invalid" && afterContact?.first_name === "Marta", JSON.stringify(afterContact));
  const contactLog = (await logOf(pid)).filter((r) => r.changed_by === recepcion.userId);
  check("el historial dice que lo hizo recepción", contactLog.map((r) => r.field).sort().join(",") === "email,phone", JSON.stringify(contactLog));
  const contactMed = await medico.client.rpc("update_patient_contact", { p_patient_id: pid, p_phone: "1", p_email: "", p_phone_e164: "" });
  check("un médico NO usa la función de contacto (edita por su pantalla)", contactMed.error !== null, "no falló");
  const contactOther = await ownerB.client.rpc("update_patient_contact", { p_patient_id: pid, p_phone: "1", p_email: "", p_phone_e164: "" });
  check("otra clínica tampoco", contactOther.error !== null, "no falló");
  const clearContact = await owner.client.rpc("update_patient_contact", { p_patient_id: pid, p_phone: "8295550202", p_email: "", p_phone_e164: "+18295550202" });
  const { data: cleared } = await admin.from("patients").select("email").eq("id", pid).single();
  check("el admin también; un correo vacío queda como vacío", clearContact.error === null && cleared?.email === null, `${clearContact.error?.message ?? ""} ${cleared?.email}`);

  console.log("\nConsentimiento de WhatsApp al cambiar el teléfono:");
  const consent = await owner.client
    .from("patient_messaging_consents")
    .insert({ clinic_id: cidA, patient_id: pid, phone_e164: "+18295550202", source: "verbal" })
    .select("id")
    .single();
  check("consentimiento vigente creado", consent.error === null, consent.error?.message ?? "");
  const same = await recepcion.client.rpc("update_patient_contact", { p_patient_id: pid, p_phone: "8295550202", p_email: "", p_phone_e164: "+18295550202" });
  check("mismo número: el consentimiento NO se revoca", same.error === null && same.data === false, `${same.error?.message ?? ""} ${same.data}`);
  const { data: stillActive } = await admin.from("patient_messaging_consents").select("revoked_at").eq("id", consent.data!.id).single();
  check("sigue vigente", stillActive?.revoked_at === null, JSON.stringify(stillActive));
  const changed = await recepcion.client.rpc("update_patient_contact", { p_patient_id: pid, p_phone: "8495550303", p_email: "", p_phone_e164: "+18495550303" });
  check("número distinto: se revoca (devuelve true)", changed.error === null && changed.data === true, `${changed.error?.message ?? ""} ${changed.data}`);
  const { data: revokedRow } = await admin.from("patient_messaging_consents").select("revoked_at, revoke_source, revoked_by").eq("id", consent.data!.id).single();
  check("queda revocado, motivo «personal» y a nombre de quien cambió el número", !!revokedRow?.revoked_at && revokedRow.revoke_source === "personal" && revokedRow.revoked_by === recepcion.userId, JSON.stringify(revokedRow));
  const again = await recepcion.client.rpc("update_patient_contact", { p_patient_id: pid, p_phone: "8495550303", p_email: "", p_phone_e164: "+18495550303" });
  check("sin consentimiento vigente no hay nada que revocar", again.error === null && again.data === false, `${again.data}`);

  // Camino del médico: edita por su pantalla y luego pide revocar el consentimiento viejo.
  const consent2 = await owner.client
    .from("patient_messaging_consents")
    .insert({ clinic_id: cidA, patient_id: pid, phone_e164: "+18495550303", source: "escrito" })
    .select("id")
    .single();
  await medico.client.from("patients").update({ phone: "8095550404" }).eq("id", pid);
  const recepRevoke = await recepcion.client.rpc("revoke_stale_patient_consent", { p_patient_id: pid, p_phone_e164: "+18095550404" });
  check("recepción NO puede usar la revocación del médico", recepRevoke.error !== null, "no falló");
  const otherRevoke = await ownerB.client.rpc("revoke_stale_patient_consent", { p_patient_id: pid, p_phone_e164: "+18095550404" });
  check("otra clínica tampoco", otherRevoke.error !== null, "no falló");
  const medRevoke = await medico.client.rpc("revoke_stale_patient_consent", { p_patient_id: pid, p_phone_e164: "+18095550404" });
  check("el médico revoca el consentimiento del número anterior", medRevoke.error === null && medRevoke.data === true, `${medRevoke.error?.message ?? ""} ${medRevoke.data}`);
  const { data: rev2 } = await admin.from("patient_messaging_consents").select("revoked_at").eq("id", consent2.data!.id).single();
  check("queda revocado", !!rev2?.revoked_at, JSON.stringify(rev2));

  console.log("\nModo solo lectura:");
  const logBefore = (await logOf(pid)).length;
  const old = new Date();
  old.setUTCDate(old.getUTCDate() - 31);
  const { error: subErr } = await admin
    .from("clinic_subscriptions")
    .update({ trial_ends_at: old.toISOString().slice(0, 10), next_payment_due_on: null })
    .eq("clinic_id", cidA);
  if (subErr) throw new Error(`No se pudo vencer la suscripción: ${subErr.message}`);
  const roEdit = await owner.client.from("patients").update({ first_name: "SoloLectura" }).eq("id", pid);
  check("el admin no puede editar", roEdit.error !== null && roEdit.error.message.includes("modo solo lectura"), roEdit.error?.message ?? "no falló");
  const roMed = await medico.client.from("patients").update({ first_name: "SoloLectura" }).eq("id", pid);
  check("el médico tampoco", roMed.error !== null && roMed.error.message.includes("modo solo lectura"), roMed.error?.message ?? "no falló");
  const roContact = await recepcion.client.rpc("update_patient_contact", { p_patient_id: pid, p_phone: "8095550505", p_email: "", p_phone_e164: "+18095550505" });
  check("ni recepción por la función de contacto", roContact.error !== null && roContact.error.message.includes("modo solo lectura"), roContact.error?.message ?? "no falló");
  const { data: roRow } = await admin.from("patients").select("first_name, phone").eq("id", pid).single();
  check("los datos quedaron intactos", roRow?.first_name === "Marta" && roRow?.phone === "8095550404", JSON.stringify(roRow));
  check("sin filas nuevas en el historial", (await logOf(pid)).length === logBefore, "se agregaron filas");

  console.log("\nSe borra junto con el paciente:");
  const delPatient = await admin.from("patients").delete().eq("id", pid);
  // La clínica está en solo lectura (fila protegida por el guard): se vuelve a habilitar para poder borrar.
  if (delPatient.error) {
    await admin.from("clinic_subscriptions").update({ trial_ends_at: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10) }).eq("clinic_id", cidA);
    const retry = await admin.from("patients").delete().eq("id", pid);
    check("borrar el paciente (clínica activa) funciona", retry.error === null, retry.error?.message ?? "");
  } else {
    check("borrar el paciente funciona", true, "");
  }
  check("su historial desaparece en cascada", (await logOf(pid)).length === 0, "quedaron filas");
  void cidB;
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
    console.log("OK: edición de pacientes e historial de cambios verificados.");
  });
