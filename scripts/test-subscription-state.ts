/**
 * Prueba de las funciones de estado de acceso (período de prueba y
 * suscripciones, Fase 1 -- supabase/migrations/20261006100000_subscription_access_state.sql).
 *
 * Qué verifica:
 *   1. Una clínica nueva nace con prueba de 14 días y como modelo_c, aunque
 *      el cliente pida otro modelo (create_clinic_with_admin ignora el valor).
 *   2. Los BORDES del estado con fechas explícitas (p_today): el día de
 *      vencimiento todavía es válido, el día 30 de gracia sigue escribiendo,
 *      el día 31 es solo lectura -- para la prueba y para el plan pagado
 *      (caso ICE Brens: vence 2027-04-04, solo lectura desde 2027-05-05).
 *   3. El cambio de día en America/Santo_Domingo vs UTC (11:30 pm del
 *      último día válido sigue siendo válido aunque en UTC ya sea mañana).
 *   4. Estados seguros: sin fila / sin fechas => sin_plan, nunca bloquea.
 *   5. Visibilidad: get_my_clinic_access() no devuelve montos y los cupos
 *      solo al admin; clinic_subscriptions solo la lee el admin; las
 *      funciones internas no son ejecutables por un usuario autenticado.
 *   6. La RPC del operador renew_clinic_subscription renueva y deja rastro;
 *      un admin de clínica NO puede usarla.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
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

async function createUser(label: string) {
  const email = `subscription-state-${label}-${randomUUID()}@example.invalid`;
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

async function state(clinicId: string, today: string): Promise<string | null> {
  const { data, error } = await admin.rpc("clinic_access_state", { p_clinic_id: clinicId, p_today: today });
  if (error) throw new Error(`clinic_access_state(${today}): ${error.message}`);
  return data as string | null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function setDates(
  clinicId: string,
  dates: { trial_ends_at?: string | null; next_payment_due_on?: string | null }
) {
  const { error } = await admin.from("clinic_subscriptions").update(dates).eq("clinic_id", clinicId);
  if (error) throw new Error(`No se pudieron fijar fechas: ${error.message}`);
}

async function main() {
  const adminUser = await createUser("admin");
  const medicoUser = await createUser("medico");
  const operatorUser = await createUser("operator");

  // Camino real de onboarding. Se pide modelo_e a propósito: debe ignorarse.
  const { data: clinicId, error: rpcError } = await adminUser.client.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] Clínica suscripción ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_e",
  });
  if (rpcError || !clinicId) throw new Error(`create_clinic_with_admin falló: ${rpcError?.message}`);
  createdClinicIds.push(clinicId as string);
  const cid = clinicId as string;

  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medicoUser.userId, role: "medico" });
  await admin.from("platform_operators").insert({ user_id: operatorUser.userId });

  const { data: todayData } = await admin.rpc("dr_today");
  const today = todayData as string;

  console.log("\nAlta de clínica nueva:");
  const { data: clinicRow } = await admin.from("clinics").select("business_model").eq("id", cid).single();
  check(
    "create_clinic_with_admin ignora el modelo pedido y crea modelo_c",
    clinicRow?.business_model === "modelo_c",
    `business_model = ${clinicRow?.business_model}`
  );
  const { data: sub } = await admin.from("clinic_subscriptions").select("*").eq("clinic_id", cid).single();
  check(
    "la clínica nace con prueba de 14 días (hoy en Santo Domingo + 14)",
    sub?.trial_ends_at === addDays(today, 14),
    `trial_ends_at = ${sub?.trial_ends_at}, esperado ${addDays(today, 14)}`
  );
  const { data: events } = await admin
    .from("clinic_subscription_events")
    .select("kind")
    .eq("clinic_id", cid);
  check(
    "queda un evento trial_started en el historial",
    (events ?? []).some((e) => e.kind === "trial_started"),
    JSON.stringify(events)
  );
  check("estado inicial = prueba", (await state(cid, today)) === "prueba", `estado = ${await state(cid, today)}`);

  console.log("\nBordes de la prueba (vence 2026-10-20):");
  await setDates(cid, { trial_ends_at: "2026-10-20", next_payment_due_on: null });
  const trialCases: [string, string][] = [
    ["2026-10-19", "prueba"],
    ["2026-10-20", "prueba"], // día de vencimiento = todavía válido
    ["2026-10-21", "gracia"], // día 1 de gracia
    ["2026-11-19", "gracia"], // día 30 de gracia
    ["2026-11-20", "solo_lectura"], // día 31
  ];
  for (const [date, expected] of trialCases) {
    const got = await state(cid, date);
    check(`${date} => ${expected}`, got === expected, `se obtuvo ${got}`);
  }

  console.log("\nBordes del plan pagado (caso ICE Brens, vence 2027-04-04):");
  await setDates(cid, { trial_ends_at: "2026-10-06", next_payment_due_on: "2027-04-04" });
  const paidCases: [string, string][] = [
    ["2027-04-04", "activa"],
    ["2027-04-05", "gracia"],
    ["2027-05-04", "gracia"], // día 30 de gracia
    ["2027-05-05", "solo_lectura"], // exactamente la fecha del backfill de ICE
  ];
  for (const [date, expected] of paidCases) {
    const got = await state(cid, date);
    check(`${date} => ${expected}`, got === expected, `se obtuvo ${got}`);
  }

  console.log("\nUn vencimiento anterior al fin de la prueba no le quita días:");
  await setDates(cid, { trial_ends_at: "2026-10-20", next_payment_due_on: "2026-10-10" });
  check(
    "2026-10-20 sigue válido y se etiqueta prueba",
    (await state(cid, "2026-10-20")) === "prueba",
    `estado = ${await state(cid, "2026-10-20")}`
  );

  console.log("\nCambio de día Santo Domingo vs UTC (UTC-4, sin horario de verano):");
  const { data: lateNight } = await admin.rpc("dr_today", { p_ts: "2026-10-21T03:30:00Z" });
  const { data: nextMorning } = await admin.rpc("dr_today", { p_ts: "2026-10-21T04:00:00Z" });
  check(
    "2026-10-20 11:30 pm en Santo Domingo (03:30 UTC del 21) sigue siendo el día 20",
    lateNight === "2026-10-20",
    `dr_today = ${lateNight}`
  );
  check("a las 12:00 am en Santo Domingo ya es el día 21", nextMorning === "2026-10-21", `dr_today = ${nextMorning}`);

  console.log("\nEstados seguros (nunca bloquean por un error de datos):");
  await setDates(cid, { trial_ends_at: null, next_payment_due_on: null });
  check("fila sin ninguna fecha => sin_plan", (await state(cid, today)) === "sin_plan", `estado = ${await state(cid, today)}`);
  check(
    "clínica sin fila => sin_plan",
    (await state(randomUUID(), today)) === "sin_plan",
    "una clínica inexistente debe dar sin_plan"
  );

  console.log("\nis_clinic_writable con la fecha real de hoy:");
  await setDates(cid, { trial_ends_at: addDays(today, -30), next_payment_due_on: null });
  const { data: w30 } = await admin.rpc("is_clinic_writable", { p_clinic_id: cid });
  await setDates(cid, { trial_ends_at: addDays(today, -31), next_payment_due_on: null });
  const { data: w31 } = await admin.rpc("is_clinic_writable", { p_clinic_id: cid });
  check("día 30 de gracia => escribible", w30 === true, `is_clinic_writable = ${w30}`);
  check("día 31 => solo lectura (no escribible)", w31 === false, `is_clinic_writable = ${w31}`);
  await setDates(cid, { trial_ends_at: addDays(today, 14), next_payment_due_on: null });

  console.log("\nVisibilidad:");
  const { data: adminAccess } = await adminUser.client.rpc("get_my_clinic_access");
  const a = Array.isArray(adminAccess) ? adminAccess[0] : adminAccess;
  check("el admin ve estado prueba y 14 días", a?.state === "prueba" && a?.days_to_expiry === 14, JSON.stringify(a));
  check("el admin ve los cupos usados (1 médico en el equipo)", a?.seats_used === 1, JSON.stringify(a));
  check(
    "get_my_clinic_access no devuelve ningún monto",
    a !== undefined && !("price" in a) && !("next_payment_due_on" in a),
    JSON.stringify(a)
  );
  const { data: medicoAccess } = await medicoUser.client.rpc("get_my_clinic_access");
  const m = Array.isArray(medicoAccess) ? medicoAccess[0] : medicoAccess;
  check(
    "el médico ve estado y días pero NO los cupos",
    m?.state === "prueba" && m?.seats_used === null && m?.seats_included === null,
    JSON.stringify(m)
  );
  const { data: adminSubs } = await adminUser.client.from("clinic_subscriptions").select("clinic_id");
  const { data: medicoSubs } = await medicoUser.client.from("clinic_subscriptions").select("clinic_id");
  check("el admin SÍ lee clinic_subscriptions", (adminSubs ?? []).length === 1, JSON.stringify(adminSubs));
  check("el médico NO lee clinic_subscriptions", (medicoSubs ?? []).length === 0, JSON.stringify(medicoSubs));
  const { error: internalError } = await adminUser.client.rpc("clinic_access_state", { p_clinic_id: cid });
  check(
    "un usuario autenticado no puede ejecutar clinic_access_state (interna)",
    internalError !== null,
    "la función interna es ejecutable por authenticated"
  );

  console.log("\nRenovación por el operador:");
  const { error: adminRenewError } = await adminUser.client.rpc("renew_clinic_subscription", {
    target_clinic_id: cid,
    new_due_on: "2027-04-04",
    new_price: 100,
    p_reason: "intento de un admin de clínica",
  });
  check("un admin de clínica NO puede renovar", adminRenewError !== null, "el admin pudo llamar la RPC del operador");
  const { error: renewError } = await operatorUser.client.rpc("renew_clinic_subscription", {
    target_clinic_id: cid,
    new_due_on: "2027-04-04",
    new_price: 100,
    p_reason: "pago confirmado (prueba automatizada)",
  });
  check("el operador SÍ renueva", renewError === null, renewError?.message ?? "");
  const { data: renewed } = await admin.from("clinic_subscriptions").select("*").eq("clinic_id", cid).single();
  check(
    "la renovación fija vencimiento y deja la clínica activa",
    renewed?.next_payment_due_on === "2027-04-04" && renewed?.payment_status === "al_dia",
    JSON.stringify(renewed)
  );
  check("estado tras renovar = activa", (await state(cid, today)) === "activa", `estado = ${await state(cid, today)}`);
  const { data: renewalEvents } = await admin
    .from("clinic_subscription_events")
    .select("kind")
    .eq("clinic_id", cid)
    .eq("kind", "renewal");
  check("la renovación queda en el historial", (renewalEvents ?? []).length === 1, JSON.stringify(renewalEvents));
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
    console.log("\nOK: estados de acceso verificados.");
  });
