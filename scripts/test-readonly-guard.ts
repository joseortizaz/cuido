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

  // ----------------------------------- cupo: el operador fija quién atiende
  console.log("\nCupo: solo cuentan los administradores que atienden (lo fija el operador):");
  const ownerQ = await createUser("admin-q");
  const medQ = await createUser("medico-q");
  const med2Q = await createUser("medico-q2");
  const recepQ = await createUser("recep-q");
  const cidQ = await createClinic(ownerQ, "Q");
  await op.rpc("set_clinic_clinician_seats", { target_clinic_id: cidQ, p_seats: 1, p_reason: "plan de 1 médico" });
  const seatsUsedQ = async () => {
    const { data } = await ownerQ.client.rpc("get_my_clinic_access");
    const row = Array.isArray(data) ? data[0] : data;
    return row?.seats_used as number | null | undefined;
  };
  check("por defecto el admin atiende y ocupa el cupo (1 de 1)", (await seatsUsedQ()) === 1, `seats_used = ${await seatsUsedQ()}`);
  const { data: adminRow } = await admin.from("clinic_members").select("attends_patients").eq("clinic_id", cidQ).eq("user_id", ownerQ.userId).single();
  check("la columna attends_patients es true por defecto", adminRow?.attends_patients === true, JSON.stringify(adminRow));

  // El admin NO puede evadir el cupo.
  const { error: selfFlip } = await ownerQ.client
    .from("clinic_members")
    .update({ attends_patients: false })
    .eq("clinic_id", cidQ)
    .eq("user_id", ownerQ.userId);
  check("el admin NO puede cambiar attends_patients (permiso por columna)", selfFlip !== null && /permission denied/i.test(selfFlip.message), selfFlip?.message ?? "lo permitió");
  const { error: insFlag } = await ownerQ.client
    .from("clinic_members")
    .insert({ clinic_id: cidQ, user_id: recepQ.userId, role: "recepcion", attends_patients: false } as never);
  check("ni al invitar a alguien con esa columna", insFlag !== null && /permission denied/i.test(insFlag.message), insFlag?.message ?? "lo permitió");
  const { error: normalInvite } = await ownerQ.client.from("clinic_members").insert({ clinic_id: cidQ, user_id: recepQ.userId, role: "recepcion" });
  check("invitar con las columnas de siempre (clinic_id, user_id, role) sigue funcionando", normalInvite === null, normalInvite?.message ?? "");
  const { error: roleSame } = await ownerQ.client.from("clinic_members").update({ role: "recepcion" }).eq("clinic_id", cidQ).eq("user_id", recepQ.userId);
  check("cambiar el rol (columna permitida) sigue funcionando", roleSame === null, roleSame?.message ?? "");
  const { data: stillTrue } = await admin.from("clinic_members").select("attends_patients").eq("clinic_id", cidQ).eq("user_id", ownerQ.userId).single();
  check("la columna del admin no cambió", stillTrue?.attends_patients === true, JSON.stringify(stillTrue));

  // RPC del operador.
  const { error: notOpAttends } = await ownerQ.client.rpc("set_member_attends_patients", {
    target_clinic_id: cidQ,
    target_user_id: ownerQ.userId,
    p_attends: false,
    p_reason: "yo mismo",
  });
  check("un admin de clínica NO puede usar la RPC del operador", notOpAttends !== null, "la RPC se lo permitió");
  const { error: noReasonAttends } = await op.rpc("set_member_attends_patients", {
    target_clinic_id: cidQ,
    target_user_id: ownerQ.userId,
    p_attends: false,
    p_reason: " ",
  });
  check("sin motivo se rechaza", noReasonAttends !== null, "aceptó un motivo vacío");
  const { error: notAdmin } = await op.rpc("set_member_attends_patients", {
    target_clinic_id: cidQ,
    target_user_id: recepQ.userId,
    p_attends: false,
    p_reason: "x",
  });
  check("solo aplica a administradores (recepción se rechaza)", notAdmin !== null && /administradores/.test(notAdmin.message), notAdmin?.message ?? "lo permitió");

  const { error: offErr } = await op.rpc("set_member_attends_patients", {
    target_clinic_id: cidQ,
    target_user_id: ownerQ.userId,
    p_attends: false,
    p_reason: "administra pero no atiende",
  });
  check("el operador marca que el admin NO atiende", offErr === null, offErr?.message ?? "");
  check("el cupo usado baja a 0", (await seatsUsedQ()) === 0, `seats_used = ${await seatsUsedQ()}`);
  const { error: medOk } = await admin.from("clinic_members").insert({ clinic_id: cidQ, user_id: medQ.userId, role: "medico" });
  check("ahora cabe un médico (ocupa el único cupo)", medOk === null, medOk?.message ?? "");
  const { error: med2Err } = await admin.from("clinic_members").insert({ clinic_id: cidQ, user_id: med2Q.userId, role: "medico" });
  check("un segundo médico se rechaza (cupo 1)", med2Err !== null && /Plan actual incluye 1 médico/.test(med2Err.message), med2Err?.message ?? "no falló");

  const { error: onFull } = await op.rpc("set_member_attends_patients", {
    target_clinic_id: cidQ,
    target_user_id: ownerQ.userId,
    p_attends: true,
    p_reason: "ahora sí atiende",
  });
  check("marcar 'atiende' sin cupo libre se rechaza con el mensaje del plan", onFull !== null && /Plan actual incluye 1 médico/.test(onFull.message), onFull?.message ?? "lo permitió");
  const { data: stillOff } = await admin.from("clinic_members").select("attends_patients").eq("clinic_id", cidQ).eq("user_id", ownerQ.userId).single();
  check("y el admin sigue como 'no atiende'", stillOff?.attends_patients === false, JSON.stringify(stillOff));
  const { error: roleSwap } = await admin.from("clinic_members").update({ role: "medico" }).eq("clinic_id", cidQ).eq("user_id", ownerQ.userId);
  check("un admin que no atiende no puede pasar a médico sin cupo libre", roleSwap !== null && /Plan actual incluye/.test(roleSwap.message), roleSwap?.message ?? "lo permitió");

  // Funciona aunque la clínica esté en solo lectura (decisión comercial del operador).
  await op.rpc("set_clinic_clinician_seats", { target_clinic_id: cidQ, p_seats: 2, p_reason: "ampliación" });
  await setSub(cidQ, { trial_ends_at: addDays(today, -31), next_payment_due_on: null });
  const { error: roOn } = await op.rpc("set_member_attends_patients", {
    target_clinic_id: cidQ,
    target_user_id: ownerQ.userId,
    p_attends: true,
    p_reason: "con la clínica en solo lectura",
  });
  check("el operador puede fijarlo con la clínica en solo lectura", roOn === null, roOn?.message ?? "");
  const { data: attendsEvs } = await admin.from("clinic_subscription_events").select("details").eq("clinic_id", cidQ).eq("kind", "seats_changed");
  const memberEvs = (attendsEvs ?? []).filter((e) => (e.details as { member_user_id?: string }).member_user_id === ownerQ.userId);
  check("cada cambio queda en el historial con el miembro y el motivo (2)", memberEvs.length === 2, JSON.stringify(memberEvs));

  // ------------------------------------------------ clínica bloqueada (total)
  console.log("\nCobertura del bloqueo total (políticas):");
  const { data: openPolicies, error: openPoliciesErr } = await admin.rpc("list_policies_open_when_blocked");
  check(
    "toda política pasa por una función de clínica activa (o está justificada en la lista explícita)",
    openPoliciesErr === null && (openPolicies ?? []).length === 0,
    openPoliciesErr?.message ?? `abiertas: ${JSON.stringify(openPolicies)}`
  );

  const ownerK = await createUser("admin-k");
  const medicoK = await createUser("medico-k");
  const recep = await createUser("recepcion");
  const cidK = await createClinic(ownerK, "K");
  await admin.from("clinic_members").insert([
    { clinic_id: cidK, user_id: medicoK.userId, role: "medico" },
    { clinic_id: cidK, user_id: recep.userId, role: "recepcion" },
  ]);
  const { data: tpls } = await admin.from("specialty_templates").select("id, code, requires_explicit_access");
  const tplInterna = tpls?.find((t) => t.code === "medicina_interna");
  const tplCirugia = tpls?.find((t) => t.code === "cirugia_general");
  const tplSensible = tpls?.find((t) => t.requires_explicit_access);
  const { data: consentTpl } = await admin.from("consent_templates").select("id").limit(1).single();
  if (!tplInterna || !tplCirugia || !tplSensible || !consentTpl) throw new Error("Faltan plantillas base.");

  const { data: pk, error: pkErr } = await admin.from("patients").insert(newPatient(cidK)).select("id").single();
  if (pkErr || !pk) throw new Error(`insert paciente: ${pkErr?.message}`);
  const { data: ek, error: ekErr } = await admin
    .from("encounters")
    .insert({ clinic_id: cidK, patient_id: pk.id, provider_id: ownerK.userId, specialty_template_id: tplInterna.id, specialty_data: {} })
    .select("id")
    .single();
  if (ekErr || !ek) throw new Error(`insert consulta: ${ekErr?.message}`);
  const { error: apErr } = await admin.from("appointments").insert({
    clinic_id: cidK,
    patient_id: pk.id,
    provider_id: ownerK.userId,
    specialty_template_id: tplCirugia.id,
    appointment_type: "procedimiento_quirurgico",
    scheduled_at: new Date(Date.now() + 86400_000).toISOString(),
    created_by: ownerK.userId,
  });
  if (apErr) throw new Error(`insert cita: ${apErr.message}`);
  const { error: csErr } = await admin.from("consents").insert({
    clinic_id: cidK,
    patient_id: pk.id,
    consent_template_id: consentTpl.id,
    document_title: "Consentimiento",
    document_content: "Texto",
    document_hash: "h",
    signer_name: "Paciente",
    signer_relationship: "paciente",
    status: "firmado",
    recorded_by: ownerK.userId,
  });
  if (csErr) throw new Error(`insert consentimiento: ${csErr.message}`);
  const { error: fdErr } = await admin.from("fiscal_documents").insert({
    clinic_id: cidK,
    patient_id: pk.id,
    comprador_nombre: "Paciente",
    monto_gravado_total: 0,
    monto_exento: 10,
    total_itbis: 0,
    monto_total: 10,
    status: "borrador",
    created_by: ownerK.userId,
  });
  if (fdErr) throw new Error(`insert comprobante: ${fdErr.message}`);
  const { data: insK, error: insKErr } = await admin
    .from("patient_insurers")
    .insert({ clinic_id: cidK, patient_id: pk.id, insurer_name: "SENASA", affiliate_number: "A-1", recorded_by: ownerK.userId })
    .select("id")
    .single();
  if (insKErr || !insK) throw new Error(`insert seguro: ${insKErr?.message}`);
  const { error: elErr } = await admin
    .from("eligibility_checks")
    .insert({ clinic_id: cidK, patient_id: pk.id, patient_insurer_id: insK.id, result: "elegible", checked_by: ownerK.userId });
  if (elErr) throw new Error(`insert elegibilidad: ${elErr.message}`);
  const { error: clmErr } = await admin
    .from("insurance_claims")
    .insert({ clinic_id: cidK, encounter_id: ek.id, patient_insurer_id: insK.id, status: "pendiente", created_by: ownerK.userId });
  if (clmErr) throw new Error(`insert reclamación: ${clmErr.message}`);
  const { error: fpErr } = await admin.from("clinic_fiscal_profiles").insert({
    clinic_id: cidK,
    rnc: "131000001",
    business_name: "Clínica de prueba",
    fiscal_address: "Calle 1",
    economic_activity: "Salud",
  });
  if (fpErr) throw new Error(`insert perfil fiscal: ${fpErr.message}`);
  const { error: seqErr } = await admin
    .from("clinic_ecf_sequences")
    .insert({ clinic_id: cidK, tipo_ecf: "32", range_start: 1, range_end: 100, next_number: 1, valid_until: addDays(today, 365) });
  if (seqErr) throw new Error(`insert secuencia: ${seqErr.message}`);
  const { error: bbErr } = await admin.from("bulk_import_batches").insert({
    clinic_id: cidK,
    import_type: "patients",
    file_name: "x.xlsx",
    row_count: 0,
    valid_row_count: 0,
    error_row_count: 0,
    rows: [],
    created_by: ownerK.userId,
  });
  if (bbErr) throw new Error(`insert lote: ${bbErr.message}`);
  const { data: memberRow } = await admin.from("clinic_members").select("id").eq("clinic_id", cidK).eq("user_id", medicoK.userId).single();
  const { error: prefErr } = await admin
    .from("clinic_member_preferred_specialties")
    .insert({ clinic_id: cidK, clinic_member_id: memberRow!.id, specialty_template_id: tplInterna.id });
  if (prefErr) throw new Error(`insert preferencia: ${prefErr.message}`);
  const { error: disErr } = await admin
    .from("clinic_member_disabled_specialties")
    .insert({ clinic_id: cidK, clinic_member_id: memberRow!.id, specialty_template_id: tplInterna.id, disabled_by_user_id: ownerK.userId });
  if (disErr) throw new Error(`insert restricción: ${disErr.message}`);
  const { error: grErr } = await admin.from("sensitive_specialty_access_grants").insert({
    clinic_id: cidK,
    patient_id: pk.id,
    specialty_template_id: tplSensible.id,
    granted_to_user_id: medicoK.userId,
    granted_by_user_id: ownerK.userId,
    reason: "prueba de bloqueo",
  });
  if (grErr) throw new Error(`insert concesión: ${grErr.message}`);

  // [tabla, quién la lee]: admin, médico o recepción -- según quién puede verla.
  const readers: [string, "owner" | "medico" | "recep"][] = [
    ["patients", "owner"],
    ["patients", "medico"],
    ["patients", "recep"],
    ["encounters", "owner"],
    ["appointments", "owner"],
    ["appointment_surgical_checklist", "medico"],
    ["consents", "owner"],
    ["fiscal_documents", "recep"],
    ["patient_insurers", "owner"],
    ["eligibility_checks", "owner"],
    ["insurance_claims", "owner"],
    ["clinic_fiscal_profiles", "owner"],
    ["clinic_ecf_sequences", "owner"],
    ["bulk_import_batches", "owner"],
    ["clinic_member_preferred_specialties", "medico"],
    ["clinic_member_disabled_specialties", "medico"],
    ["sensitive_specialty_access_grants", "owner"],
  ];
  const clients = { owner: ownerK.client, medico: medicoK.client, recep: recep.client };
  const countRows = async (table: string, who: "owner" | "medico" | "recep") => {
    const { data } = await clients[who]
      .from(table as never)
      .select("*")
      .eq("clinic_id" as never, cidK as never)
      .limit(5);
    return (data ?? []).length;
  };

  // Control: con la clínica en prueba cada tabla se lee (si no, la prueba de abajo pasaría en vacío).
  const seeded = readers;
  const emptyBefore: string[] = [];
  for (const [table, who] of seeded) {
    if ((await countRows(table, who)) < 1) emptyBefore.push(`${table}/${who}`);
  }
  check("control (clínica con acceso): cada tabla sembrada se puede leer", emptyBefore.length === 0, `sin filas: ${JSON.stringify(emptyBefore)}`);

  // Bloqueo total: vencida hace 121 días.
  await setSub(cidK, { trial_ends_at: addDays(today, -121), next_payment_due_on: null, block_deferred_until: null });
  const { data: stK } = await admin.rpc("clinic_access_state", { p_clinic_id: cidK });
  check("la clínica quedó bloqueada", stK === "bloqueada", `estado = ${stK}`);

  console.log("\nClínica bloqueada: nadie lee datos clínicos ni fiscales:");
  const stillReadable: string[] = [];
  for (const [table, who] of readers) {
    if ((await countRows(table, who)) > 0) stillReadable.push(`${table}/${who}`);
  }
  check("las 17 lecturas (admin, médico, recepción) devuelven 0 filas", stillReadable.length === 0, `todavía legibles: ${JSON.stringify(stillReadable)}`);

  const { error: blockedIns } = await ownerK.client.from("patients").insert(newPatient(cidK));
  check("tampoco puede escribir", blockedIns !== null, "el INSERT pasó");
  const { data: ownClinic } = await ownerK.client.from("clinics").select("id").eq("id", cidK);
  const { data: roster } = await ownerK.client.from("clinic_members").select("id").eq("clinic_id", cidK);
  const { data: subRow } = await ownerK.client.from("clinic_subscriptions").select("clinic_id").eq("clinic_id", cidK);
  check(
    "el admin SÍ sigue viendo su clínica, su equipo y su suscripción (para saber por qué y cómo regularizar)",
    (ownClinic ?? []).length === 1 && (roster ?? []).length === 3 && (subRow ?? []).length === 1,
    JSON.stringify({ clinica: ownClinic?.length, equipo: roster?.length, suscripcion: subRow?.length })
  );
  const { data: myAccess } = await ownerK.client.rpc("get_my_clinic_access");
  const ma = Array.isArray(myAccess) ? myAccess[0] : myAccess;
  check("get_my_clinic_access sigue respondiendo (bloqueada)", ma?.state === "bloqueada", JSON.stringify(ma));

  // Acuerdo: diferir el bloqueo devuelve la lectura (solo lectura), y el bloqueo vuelve al vencer.
  const { error: agrErr } = await op.rpc("set_clinic_block_agreement", {
    target_clinic_id: cidK,
    p_until: addDays(today, 3),
    p_reason: "descarga de la información",
  });
  const { data: readAgain } = await ownerK.client.from("patients").select("id").eq("clinic_id", cidK);
  check("con acuerdo vuelve la lectura (para exportar) pero no la escritura", agrErr === null && (readAgain ?? []).length === 1, agrErr?.message ?? JSON.stringify(readAgain));
  const { error: stillNoWrite } = await ownerK.client.from("patients").insert(newPatient(cidK));
  check("con acuerdo sigue sin poder escribir", isReadonlyError(stillNoWrite), stillNoWrite?.message ?? "el INSERT pasó");

  // Un pago la reactiva al instante.
  await setSub(cidK, { billing_period_days: 30 });
  await op.rpc("register_clinic_payment", { target_clinic_id: cidK, p_paid_on: today, p_amount: 100, p_note: "regulariza" });
  const { data: afterPayK } = await ownerK.client.from("patients").insert(newPatient(cidK)).select("id").single();
  check("tras el pago, la clínica vuelve a escribir", !!afterPayK, "no pudo crear un paciente");
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
    console.log("\nOK: bloqueo de solo lectura, bloqueo total y cupos verificados.");
  });
