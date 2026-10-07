/**
 * Prueba de las funciones de estado de acceso y los RPC del operador
 * (período de prueba y suscripciones, Fase 1 --
 * supabase/migrations/20261006100000_subscription_access_state.sql y
 * 20261007100000_subscription_plan_periods_and_payments.sql).
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
 *   4. Ventanas de recordatorio por_renovar para planes de 30/90/180/365
 *      días, y que el recordatorio es solo del admin.
 *   5. Estados seguros (sin_plan), suspendida y exenta.
 *   6. Visibilidad: get_my_clinic_access() no devuelve montos y los cupos
 *      solo al admin; clinic_subscriptions y clinic_payments solo los lee
 *      el admin; las funciones internas no son ejecutables por un usuario
 *      autenticado.
 *   7. Los RPC del operador (set_clinic_plan_period, register_clinic_payment,
 *      extend_clinic_trial, set_clinic_access_exempt) calculan bien los
 *      vencimientos, dejan rastro, y un admin de clínica NO puede usarlos.
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

type SubscriptionPatch = {
  trial_ends_at?: string | null;
  next_payment_due_on?: string | null;
  billing_period_days?: number | null;
};

async function setSub(clinicId: string, patch: SubscriptionPatch) {
  const { error } = await admin.from("clinic_subscriptions").update(patch).eq("clinic_id", clinicId);
  if (error) throw new Error(`No se pudo fijar la suscripción: ${error.message}`);
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
  const op = operatorUser.client;

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
  const { data: events } = await admin.from("clinic_subscription_events").select("kind").eq("clinic_id", cid);
  check(
    "queda un evento trial_started en el historial",
    (events ?? []).some((e) => e.kind === "trial_started"),
    JSON.stringify(events)
  );
  check("estado inicial = prueba", (await state(cid, today)) === "prueba", `estado = ${await state(cid, today)}`);

  console.log("\nBordes de la prueba (vence 2026-10-20; la prueba vencida TAMBIÉN tiene 30 días de gracia):");
  await setSub(cid, { trial_ends_at: "2026-10-20", next_payment_due_on: null });
  const trialCases: [string, string][] = [
    ["2026-10-19", "prueba"],
    ["2026-10-20", "prueba"], // día de vencimiento = todavía válido
    ["2026-10-21", "vencida_en_gracia"], // día 1 de gracia
    ["2026-11-19", "vencida_en_gracia"], // día 30 de gracia
    ["2026-11-20", "solo_lectura"], // día 31
  ];
  for (const [date, expected] of trialCases) {
    const got = await state(cid, date);
    check(`${date} => ${expected}`, got === expected, `se obtuvo ${got}`);
  }

  console.log("\nUn vencimiento anterior al fin de la prueba no le quita días:");
  await setSub(cid, { trial_ends_at: "2026-10-20", next_payment_due_on: "2026-10-10", billing_period_days: null });
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

  console.log("\nVentanas de recordatorio por_renovar (desde vencimiento − ventana hasta el día de vencimiento):");
  const windows: [number, number, string][] = [
    [30, 5, "2026-10-31"],
    [90, 15, "2027-01-31"],
    [180, 30, "2027-04-04"],
    [365, 30, "2027-10-06"],
  ];
  for (const [period, window, due] of windows) {
    await setSub(cid, { trial_ends_at: null, next_payment_due_on: due, billing_period_days: period });
    const firstDay = addDays(due, -window);
    const cases: [string, string][] = [
      [addDays(firstDay, -1), "activa"],
      [firstDay, "por_renovar"],
      [due, "por_renovar"],
      [addDays(due, 1), "vencida_en_gracia"],
      [addDays(due, 30), "vencida_en_gracia"],
      [addDays(due, 31), "solo_lectura"],
    ];
    for (const [date, expected] of cases) {
      const got = await state(cid, date);
      check(`plan de ${period} días (vence ${due}): ${date} => ${expected}`, got === expected, `se obtuvo ${got}`);
    }
  }
  await setSub(cid, { trial_ends_at: null, next_payment_due_on: "2026-10-31", billing_period_days: 30 });
  check(
    "ejemplo del plan: vence 31-oct => recordatorio desde el 26-oct, solo lectura desde el 1-dic",
    (await state(cid, "2026-10-25")) === "activa" &&
      (await state(cid, "2026-10-26")) === "por_renovar" &&
      (await state(cid, "2026-11-30")) === "vencida_en_gracia" &&
      (await state(cid, "2026-12-01")) === "solo_lectura",
    "el ejemplo del plan no se cumple"
  );

  console.log("\nEstados seguros, suspendida y exenta:");
  await setSub(cid, { trial_ends_at: null, next_payment_due_on: null, billing_period_days: null });
  check("fila sin ninguna fecha => sin_plan", (await state(cid, today)) === "sin_plan", `estado = ${await state(cid, today)}`);
  check(
    "clínica sin fila => sin_plan",
    (await state(randomUUID(), today)) === "sin_plan",
    "una clínica inexistente debe dar sin_plan"
  );
  await setSub(cid, { trial_ends_at: addDays(today, -31) });
  const { data: w31 } = await admin.rpc("is_clinic_writable", { p_clinic_id: cid });
  await setSub(cid, { trial_ends_at: addDays(today, -30) });
  const { data: w30 } = await admin.rpc("is_clinic_writable", { p_clinic_id: cid });
  check("día 30 de gracia con la fecha real de hoy => escribible", w30 === true, `is_clinic_writable = ${w30}`);
  check("día 31 => solo lectura (no escribible)", w31 === false, `is_clinic_writable = ${w31}`);
  await admin.from("clinics").update({ is_active: false }).eq("id", cid);
  const { data: wSusp } = await admin.rpc("is_clinic_writable", { p_clinic_id: cid });
  check(
    "clínica suspendida => estado suspendida y no escribible",
    (await state(cid, today)) === "suspendida" && wSusp === false,
    `estado = ${await state(cid, today)}, writable = ${wSusp}`
  );
  await admin.from("clinics").update({ is_active: true }).eq("id", cid);

  console.log("\nVisibilidad:");
  await setSub(cid, { trial_ends_at: addDays(today, 14), next_payment_due_on: null });
  const { data: adminAccess } = await adminUser.client.rpc("get_my_clinic_access");
  const a = Array.isArray(adminAccess) ? adminAccess[0] : adminAccess;
  check("el admin ve estado prueba y 14 días", a?.state === "prueba" && a?.days_to_expiry === 14, JSON.stringify(a));
  check("el admin ve los cupos usados (admin + médico = 2)", a?.seats_used === 2, JSON.stringify(a));
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

  console.log("\nEl recordatorio de renovación es solo del admin:");
  await setSub(cid, { trial_ends_at: null, next_payment_due_on: addDays(today, 2), billing_period_days: 30 });
  const { data: aRenew } = await adminUser.client.rpc("get_my_clinic_access");
  const { data: mRenew } = await medicoUser.client.rpc("get_my_clinic_access");
  const ar = Array.isArray(aRenew) ? aRenew[0] : aRenew;
  const mr = Array.isArray(mRenew) ? mRenew[0] : mRenew;
  check("el admin ve por_renovar", ar?.state === "por_renovar", JSON.stringify(ar));
  check("el médico ve activa (sin el recordatorio)", mr?.state === "activa", JSON.stringify(mr));

  console.log("\nRPC del operador -- un admin de clínica NO puede usarlos:");
  const planArgs = { target_clinic_id: cid, p_period_days: 180, p_amount: null, p_start_on: "2026-10-06" };
  const callsByAdmin: [string, Record<string, unknown>][] = [
    ["set_clinic_plan_period", planArgs],
    ["register_clinic_payment", { target_clinic_id: cid, p_paid_on: "2026-10-20", p_amount: 100, p_note: "x" }],
    ["extend_clinic_trial", { target_clinic_id: cid, p_days: 5, p_reason: "x" }],
    ["set_clinic_access_exempt", { target_clinic_id: cid, p_exempt: true, p_reason: "x" }],
  ];
  for (const [fn, args] of callsByAdmin) {
    const { error } = await adminUser.client.rpc(fn, args);
    check(`un admin de clínica NO puede usar ${fn}`, error !== null, "el admin pudo llamar la RPC del operador");
  }

  console.log("\nset_clinic_plan_period (caso ICE Brens):");
  const { error: planErr } = await op.rpc("set_clinic_plan_period", planArgs);
  check("180 días, monto null, inicio 2026-10-06 funciona", planErr === null, planErr?.message ?? "");
  const { data: planned } = await admin.from("clinic_subscriptions").select("*").eq("clinic_id", cid).single();
  check("vencimiento = inicio + 180 = 2027-04-04", planned?.next_payment_due_on === "2027-04-04", JSON.stringify(planned));
  check(
    "el plan de ICE entra en solo lectura exactamente el 2027-05-05",
    (await state(cid, "2027-05-04")) === "vencida_en_gracia" && (await state(cid, "2027-05-05")) === "solo_lectura",
    `${await state(cid, "2027-05-04")} / ${await state(cid, "2027-05-05")}`
  );
  const { error: badPeriod } = await op.rpc("set_clinic_plan_period", { ...planArgs, p_period_days: 45 });
  check("un periodo fuera de 30/90/180/365 se rechaza", badPeriod !== null, "aceptó 45 días");

  console.log("\nregister_clinic_payment (plan de 30 días, vence 2026-10-31):");
  await op.rpc("set_clinic_plan_period", {
    target_clinic_id: cid,
    p_period_days: 30,
    p_amount: 100,
    p_start_on: "2026-10-01",
  });
  const pay = async (paidOn: string): Promise<string> => {
    const { error } = await op.rpc("register_clinic_payment", {
      target_clinic_id: cid,
      p_paid_on: paidOn,
      p_amount: 100,
      p_note: "prueba",
    });
    if (error) throw new Error(`register_clinic_payment(${paidOn}): ${error.message}`);
    const { data } = await admin.from("clinic_subscriptions").select("next_payment_due_on").eq("clinic_id", cid).single();
    return data?.next_payment_due_on as string;
  };
  check("a tiempo (paga 10-20, vence 10-31) => 11-30: vencimiento anterior + periodo", (await pay("2026-10-20")) === "2026-11-30", "no suma al vencimiento anterior");
  check("tarde pero en gracia (paga 12-10, vence 11-30) => 12-30: no regala días", (await pay("2026-12-10")) === "2026-12-30", "pagar tarde no debe regalar días");
  check("ya en solo lectura (vence 12-30, paga 2027-02-15) => 2027-03-17: fecha de pago + periodo", (await pay("2027-02-15")) === "2027-03-17", "debe contar desde la fecha de pago");
  check("tras pagar, la clínica vuelve a poder escribir", (await state(cid, "2027-02-15")) !== "solo_lectura", `estado = ${await state(cid, "2027-02-15")}`);
  const { data: payments } = await adminUser.client.from("clinic_payments").select("amount, resulting_due_on");
  const { data: medicoPayments } = await medicoUser.client.from("clinic_payments").select("id");
  check("el admin lee los pagos de su clínica (3)", (payments ?? []).length === 3, JSON.stringify(payments));
  check("el médico NO lee los pagos", (medicoPayments ?? []).length === 0, JSON.stringify(medicoPayments));
  const { error: directPay } = await adminUser.client.from("clinic_payments").insert({
    clinic_id: cid,
    amount: 1,
    paid_on: "2026-10-01",
    period_days: 30,
    resulting_due_on: "2026-10-31",
    registered_by: adminUser.userId,
  });
  check("un INSERT directo en clinic_payments se rechaza", directPay !== null, "el admin pudo insertar un pago");

  console.log("\nextend_clinic_trial:");
  await setSub(cid, { trial_ends_at: addDays(today, 5), next_payment_due_on: null });
  await op.rpc("extend_clinic_trial", { target_clinic_id: cid, p_days: 10, p_reason: "demo" });
  const { data: t1 } = await admin.from("clinic_subscriptions").select("trial_ends_at").eq("clinic_id", cid).single();
  check("una prueba vigente se extiende desde su fin (hoy+5, +10)", t1?.trial_ends_at === addDays(today, 15), JSON.stringify(t1));
  await setSub(cid, { trial_ends_at: addDays(today, -40), next_payment_due_on: null });
  await op.rpc("extend_clinic_trial", { target_clinic_id: cid, p_days: 7, p_reason: "demo" });
  const { data: t2 } = await admin.from("clinic_subscriptions").select("trial_ends_at").eq("clinic_id", cid).single();
  check("una prueba vencida se extiende desde hoy (hoy +7)", t2?.trial_ends_at === addDays(today, 7), JSON.stringify(t2));
  const { error: noReason } = await op.rpc("extend_clinic_trial", { target_clinic_id: cid, p_days: 3, p_reason: "  " });
  check("extender sin motivo se rechaza", noReason !== null, "aceptó un motivo vacío");

  console.log("\nset_clinic_access_exempt:");
  await setSub(cid, { trial_ends_at: addDays(today, -100), next_payment_due_on: null });
  await op.rpc("set_clinic_access_exempt", { target_clinic_id: cid, p_exempt: true, p_reason: "clínica piloto" });
  const { data: wEx } = await admin.rpc("is_clinic_writable", { p_clinic_id: cid });
  check(
    "exenta: estado exenta y escribible aunque venciera hace 100 días",
    (await state(cid, today)) === "exenta" && wEx === true,
    `estado = ${await state(cid, today)}`
  );
  await op.rpc("set_clinic_access_exempt", { target_clinic_id: cid, p_exempt: false, p_reason: "fin del piloto" });
  check("quitar la exención => vuelve a solo_lectura", (await state(cid, today)) === "solo_lectura", `estado = ${await state(cid, today)}`);

  console.log("\nHistorial:");
  const { data: evs } = await admin.from("clinic_subscription_events").select("kind").eq("clinic_id", cid);
  const kinds = (evs ?? []).map((e) => e.kind as string);
  check(
    "registra el plan, las 2 extensiones y los 2 cambios de exención",
    kinds.includes("plan_set") &&
      kinds.filter((k) => k === "trial_extended").length === 2 &&
      kinds.filter((k) => k === "exempt_changed").length === 2,
    JSON.stringify(kinds)
  );
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
    console.log("\nOK: estados de acceso y RPC del operador verificados.");
  });
