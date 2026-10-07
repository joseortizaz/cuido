/**
 * Prueba del bloqueo de solo lectura y de los cupos de médicos (período de
 * prueba y suscripciones, Fase 2 --
 * supabase/migrations/20261007130000_readonly_guard_and_seats.sql).
 *
 * Qué verifica:
 *   1. COBERTURA: ninguna tabla pública queda sin el trigger readonly_guard
 *      salvo las de la lista explícita (list_unguarded_tables() = vacío), y
 *      toda clínica tiene su fila de suscripción. Así una tabla futura no
 *      puede quedar sin bloqueo por olvido (mismo espíritu que "ninguna tabla
 *      sin RLS").
 *   2. COMPORTAMIENTO con una clínica en solo lectura: SELECT funciona;
 *      INSERT/UPDATE/DELETE fallan -- también para service_role y para las
 *      RPC SECURITY DEFINER --; no se puede esquivar mandando el clinic_id de
 *      otra clínica; el operador sigue pudiendo renovar; un pago o una
 *      extensión de prueba desbloquean al instante; borrar una clínica en
 *      solo lectura (cascada) funciona.
 *   3. Una clínica exenta nunca queda bloqueada.
 *   4. CUPOS: con cupo, rechaza invitar/cambiar a un médico de más (también
 *      por cambio de rol), no cuenta recepción, permite el intercambio
 *      admin/médico, y dos altas simultáneas no se cuelan las dos.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 *
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
  console.error(
    "Faltan variables de entorno. Se requieren NEXT_PUBLIC_SUPABASE_URL, " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
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

type TestUser = { userId: string; client: SupabaseClient };

async function createUser(label: string): Promise<TestUser> {
  const email = `readonly-guard-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, client };
}

async function createClinic(owner: TestUser, label: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] Guard ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function setSub(clinicId: string, patch: Record<string, unknown>) {
  const { error } = await admin.from("clinic_subscriptions").update(patch).eq("clinic_id", clinicId);
  if (error) throw new Error(`No se pudo fijar la suscripción: ${error.message}`);
}

const READONLY = "modo solo lectura";
const isReadonlyError = (e: { message?: string; hint?: string } | null) =>
  e !== null && (e.message ?? "").includes(READONLY);

function newPatient(clinicId: string) {
  return {
    clinic_id: clinicId,
    first_name: "Paciente",
    last_name: `Guard ${randomUUID().slice(0, 6)}`,
    date_of_birth: "1990-01-01",
    sex: "masculino",
  };
}

async function main() {
  const owner = await createUser("admin");
  const medico = await createUser("medico");
  const operator = await createUser("operator");
  await admin.from("platform_operators").insert({ user_id: operator.userId });
  const op = operator.client;

  const { data: todayData } = await admin.rpc("dr_today");
  const today = todayData as string;

  // ---------------------------------------------------------------- cobertura
  console.log("\nCobertura del guard:");
  const { data: unguarded, error: unguardedError } = await admin.rpc("list_unguarded_tables");
  check(
    "ninguna tabla pública queda sin guard fuera de la lista explícita",
    unguardedError === null && (unguarded ?? []).length === 0,
    unguardedError?.message ?? `sin guard: ${JSON.stringify(unguarded)}`
  );
  const { data: allClinics } = await admin.from("clinics").select("id");
  const { data: allSubs } = await admin.from("clinic_subscriptions").select("clinic_id");
  const withSub = new Set((allSubs ?? []).map((s) => s.clinic_id));
  const missing = (allClinics ?? []).filter((c) => !withSub.has(c.id));
  check("toda clínica tiene fila de suscripción", missing.length === 0, `sin fila: ${JSON.stringify(missing)}`);

  // ------------------------------------------------- clínica A: solo lectura
  const cidA = await createClinic(owner, "A");
  await admin.from("clinic_members").insert({ clinic_id: cidA, user_id: medico.userId, role: "medico" });

  console.log("\nClínica escribible (control):");
  const { data: p1, error: p1Err } = await owner.client.from("patients").insert(newPatient(cidA)).select("id").single();
  check("en prueba, el admin crea un paciente", p1Err === null && !!p1, p1Err?.message ?? "");
  const patientId = p1?.id as string;

  console.log("\nClínica en solo lectura (vencida hace 31 días):");
  await setSub(cidA, { trial_ends_at: addDays(today, -31), next_payment_due_on: null });

  const { data: readBack, error: readErr } = await owner.client.from("patients").select("id");
  check("SELECT sigue funcionando", readErr === null && (readBack ?? []).length === 1, readErr?.message ?? JSON.stringify(readBack));

  const { error: insErr } = await owner.client.from("patients").insert(newPatient(cidA));
  check("INSERT de un usuario falla con mensaje claro", isReadonlyError(insErr), insErr?.message ?? "no falló");
  check("el error trae el contacto de Narnia", (insErr?.message ?? "").includes("info@narniats.com"), insErr?.message ?? "");
  const { error: updErr } = await owner.client.from("patients").update({ phone: "8095550000" }).eq("id", patientId);
  check("UPDATE falla", isReadonlyError(updErr), updErr?.message ?? "no falló");
  // `patients` no tiene política de DELETE para usuarios (borrar 0 filas sin
  // error, el trigger ni se dispara), así que el DELETE se ejercita con
  // service_role, que sí lo alcanza.
  const { error: delErr } = await admin.from("patients").delete().eq("id", patientId);
  check("DELETE (service_role, que sí llega al trigger) falla", isReadonlyError(delErr), delErr?.message ?? "no falló");
  const { error: svcErr } = await admin.from("patients").insert(newPatient(cidA));
  check("también bloquea a service_role (p. ej. la Edge Function sign-consent)", isReadonlyError(svcErr), svcErr?.message ?? "no falló");

  const { data: smTemplate } = await admin
    .from("specialty_templates")
    .select("id")
    .eq("requires_explicit_access", true)
    .limit(1)
    .single();
  const { error: rpcErr } = await owner.client.rpc("grant_sensitive_specialty_access", {
    target_patient_id: patientId,
    target_specialty_template_id: smTemplate?.id,
    target_user_id: medico.userId,
    p_reason: "prueba del guard",
  });
  check("una RPC SECURITY DEFINER que escribe también queda bloqueada", isReadonlyError(rpcErr), rpcErr?.message ?? "no falló");

  // El guard AFTER mira la fila FINAL: mandar el clinic_id de otra clínica
  // escribible no sirve para esquivarlo, aunque appointments derive el
  // clinic_id real desde el paciente en un trigger BEFORE.
  const other = await createUser("otra-clinica");
  const cidB = await createClinic(other, "B");
  const { data: apptTemplate } = await admin.from("specialty_templates").select("id").limit(1).single();
  const { error: bypassErr } = await owner.client.from("appointments").insert({
    clinic_id: cidB, // clínica ajena y escribible: lo derivará el trigger a cidA
    patient_id: patientId,
    provider_id: owner.userId,
    specialty_template_id: apptTemplate?.id,
    scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    created_by: owner.userId,
  });
  check("no se esquiva mandando el clinic_id de otra clínica", bypassErr !== null, "el INSERT pasó");

  const { data: opPatients } = await op.from("patients").select("id");
  check("el operador sigue sin ver datos clínicos", (opPatients ?? []).length === 0, JSON.stringify(opPatients));

  console.log("\nEl operador puede renovar una clínica en solo lectura:");
  const { error: extendErr } = await op.rpc("extend_clinic_trial", {
    target_clinic_id: cidA,
    p_days: 5,
    p_reason: "prueba del guard",
  });
  check("extend_clinic_trial funciona estando en solo lectura", extendErr === null, extendErr?.message ?? "");
  const { error: afterExtend } = await owner.client.from("patients").insert(newPatient(cidA));
  check("tras extender la prueba, el INSERT funciona al instante", afterExtend === null, afterExtend?.message ?? "");

  await setSub(cidA, { trial_ends_at: addDays(today, -31), next_payment_due_on: null });
  const { error: blockedAgain } = await owner.client.from("patients").insert(newPatient(cidA));
  check("de nuevo en solo lectura, vuelve a bloquear", isReadonlyError(blockedAgain), blockedAgain?.message ?? "");
  await op.rpc("set_clinic_plan_period", {
    target_clinic_id: cidA,
    p_period_days: 30,
    p_amount: 100,
    p_start_on: addDays(today, -90),
  });
  const { error: stillBlocked } = await owner.client.from("patients").insert(newPatient(cidA));
  check("un plan ya vencido hace 60 días sigue en solo lectura", isReadonlyError(stillBlocked), stillBlocked?.message ?? "");
  const { error: payErr } = await op.rpc("register_clinic_payment", {
    target_clinic_id: cidA,
    p_paid_on: today,
    p_amount: 100,
    p_note: "prueba del guard",
  });
  check("el operador registra el pago", payErr === null, payErr?.message ?? "");
  const { error: afterPay } = await owner.client.from("patients").insert(newPatient(cidA));
  check("registrar un pago desbloquea al instante", afterPay === null, afterPay?.message ?? "");

  console.log("\nClínica exenta:");
  await setSub(cidA, { trial_ends_at: addDays(today, -100), next_payment_due_on: null, billing_period_days: null });
  const { error: beforeExempt } = await owner.client.from("patients").insert(newPatient(cidA));
  check("sin exención, vencida hace 100 días, bloquea", isReadonlyError(beforeExempt), beforeExempt?.message ?? "");
  await op.rpc("set_clinic_access_exempt", { target_clinic_id: cidA, p_exempt: true, p_reason: "prueba del guard" });
  const { error: whenExempt } = await owner.client.from("patients").insert(newPatient(cidA));
  check("con exención, escribe aunque esté vencida", whenExempt === null, whenExempt?.message ?? "");

  console.log("\nTabla con clinic_id nulo (whatsapp_messages de prueba del operador):");
  await op.rpc("set_clinic_access_exempt", { target_clinic_id: cidA, p_exempt: false, p_reason: "prueba del guard" });
  const { error: waErr } = await admin.from("whatsapp_messages").insert({
    clinic_id: null,
    to_phone_number: "+18095550000",
    template_name: "prueba",
    template_language: "es",
    environment: "test",
    meta_app_id: "prueba",
    status: "sent",
    sent_by: operator.userId,
  });
  check("el guard deja pasar clinic_id nulo", waErr === null, waErr?.message ?? "");
  await admin.from("whatsapp_messages").delete().eq("sent_by", operator.userId);

  console.log("\nBorrar una clínica en solo lectura (cascada):");
  const cleanOwner = await createUser("borrar");
  const cidC = await createClinic(cleanOwner, "C");
  await admin.from("patients").insert(newPatient(cidC));
  await admin.from("whatsapp_messages").insert({
    clinic_id: cidC,
    to_phone_number: "+18095550001",
    template_name: "prueba",
    template_language: "es",
    environment: "test",
    meta_app_id: "prueba",
    status: "sent",
    sent_by: operator.userId,
  });
  await setSub(cidC, { trial_ends_at: addDays(today, -31), next_payment_due_on: null });
  const { error: cascadeErr } = await admin.from("clinics").delete().eq("id", cidC);
  check("eliminar la clínica funciona aunque esté en solo lectura", cascadeErr === null, cascadeErr?.message ?? "");
  const { data: goneClinic } = await admin.from("clinics").select("id").eq("id", cidC);
  const { data: gonePatients } = await admin.from("patients").select("id").eq("clinic_id", cidC);
  check("la clínica y sus pacientes se eliminaron", (goneClinic ?? []).length === 0 && (gonePatients ?? []).length === 0, "quedaron filas");
  await admin.from("whatsapp_messages").delete().eq("sent_by", operator.userId);

  // ---------------------------------------------------------------- cupos
  console.log("\nCupos de médicos (clínica con 1 médico incluido):");
  const seatOwner = await createUser("cupo-admin");
  const cidS = await createClinic(seatOwner, "cupos");
  const sec = await createUser("secretaria");
  const doc2 = await createUser("medico-extra");
  const { error: noOp } = await seatOwner.client.rpc("set_clinic_clinician_seats", {
    target_clinic_id: cidS,
    p_seats: 5,
    p_reason: "x",
  });
  check("un admin de clínica NO puede cambiar su cupo", noOp !== null, "el admin pudo llamar la RPC del operador");
  const { error: seatsErr } = await op.rpc("set_clinic_clinician_seats", {
    target_clinic_id: cidS,
    p_seats: 1,
    p_reason: "plan ICE",
  });
  check("el operador fija el cupo en 1", seatsErr === null, seatsErr?.message ?? "");

  const { error: secErr } = await admin.from("clinic_members").insert({ clinic_id: cidS, user_id: sec.userId, role: "recepcion" });
  check("se puede agregar una secretaria (recepción no consume cupo)", secErr === null, secErr?.message ?? "");
  const { error: docErr } = await admin.from("clinic_members").insert({ clinic_id: cidS, user_id: doc2.userId, role: "medico" });
  check(
    "agregar otro médico se rechaza con mensaje claro",
    docErr !== null && (docErr.message ?? "").includes("Plan actual incluye 1 médico"),
    docErr?.message ?? "no falló"
  );
  const { error: roleErr } = await admin.from("clinic_members").update({ role: "medico" }).eq("clinic_id", cidS).eq("user_id", sec.userId);
  check("cambiar a la secretaria a médico también se rechaza", roleErr !== null && (roleErr.message ?? "").includes("Plan actual incluye"), roleErr?.message ?? "no falló");
  const { error: swapErr } = await admin.from("clinic_members").update({ role: "medico" }).eq("clinic_id", cidS).eq("user_id", seatOwner.userId);
  check("el intercambio admin -> médico no cambia el consumo y se permite", swapErr === null, swapErr?.message ?? "");
  await admin.from("clinic_members").update({ role: "admin" }).eq("clinic_id", cidS).eq("user_id", seatOwner.userId);

  await op.rpc("set_clinic_clinician_seats", { target_clinic_id: cidS, p_seats: 3, p_reason: "ampliación pagada" });
  const racerA = await createUser("carrera-a");
  const racerB = await createUser("carrera-b");
  // Cupo 3, ya hay 1 (admin): caben 2. Se agregan 3 a la vez: solo 2 deben pasar.
  const racerC = await createUser("carrera-c");
  const results = await Promise.all(
    [racerA, racerB, racerC].map((r) => admin.from("clinic_members").insert({ clinic_id: cidS, user_id: r.userId, role: "medico" }))
  );
  const accepted = results.filter((r) => r.error === null).length;
  check("tres altas simultáneas con 2 cupos libres: pasan exactamente 2", accepted === 2, `pasaron ${accepted}`);

  await op.rpc("set_clinic_clinician_seats", { target_clinic_id: cidS, p_seats: null, p_reason: "plan sin límite" });
  const { error: unlimited } = await admin.from("clinic_members").insert({ clinic_id: cidS, user_id: doc2.userId, role: "medico" });
  check("con cupo null (ilimitado) ya no rechaza", unlimited === null, unlimited?.message ?? "");

  const { data: evs } = await admin.from("clinic_subscription_events").select("kind").eq("clinic_id", cidS).eq("kind", "seats_changed");
  check("los cambios de cupo quedan en el historial (3)", (evs ?? []).length === 3, JSON.stringify(evs));
}

async function cleanup() {
  for (const id of createdClinicIds) {
    await admin.from("clinics").delete().eq("id", id);
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
    console.log("\nOK: bloqueo de solo lectura y cupos verificados.");
  });
