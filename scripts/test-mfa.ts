/**
 * Prueba de la autenticación de dos pasos (app de autenticación / TOTP) --
 * supabase/migrations/20261015100000_mfa_enforcement.sql y src/lib/domain/mfa.ts.
 *
 * Qué verifica:
 *   1. DOMINIO (puro): normalización y validación del código, decisión de pedir el segundo
 *      paso, destino seguro tras verificar, motivo del restablecimiento.
 *   2. BASE DE DATOS, con usuarios y clínicas sintéticos y códigos TOTP calculados aquí
 *      (RFC 6238, scripts/lib/totp.ts):
 *        - sin factor: todo igual que antes;
 *        - factor SIN verificar: no bloquea;
 *        - factor verificado + sesión aal1 (solo contraseña): lectura y escritura de datos
 *          clínicos, exportación y panel de operador DENEGADOS por la API; con aal2 vuelven;
 *        - código incorrecto rechazado; un aal1 no puede quitar un factor verificado;
 *        - al desactivar el 2FA se recupera el acceso con contraseña sola;
 *        - aislamiento entre clínicas intacto; service_role no cambia;
 *        - restablecimiento por operador: quitar el factor restaura el acceso; mfa_reset_log
 *          solo la leen operadores y solo la escribe service_role;
 *        - cobertura de readonly_guard / políticas abiertas siguen vacías;
 *        - costo: leer >1,000 filas con RLS sigue siendo rápido.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  MFA_CHALLENGE_PATH,
  RESET_REASON_MIN_LENGTH,
  isValidTotpCode,
  needsMfaChallenge,
  normalizeTotpCode,
  resetReasonError,
  safeNextPath,
} from "../src/lib/domain/mfa";
import { base32Decode, totpCode } from "./lib/totp";

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

type TestUser = { userId: string; email: string; password: string };

function newClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function createUser(label: string): Promise<TestUser> {
  const email = `mfa-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { userId: data.user.id, email, password };
}

/** Sesión NUEVA solo con contraseña (aal1). */
async function signIn(u: TestUser): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(`No se pudo iniciar sesión (${u.email}): ${error.message}`);
  return client;
}

async function createClinic(owner: SupabaseClient, label: string): Promise<string> {
  const { data, error } = await owner.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] MFA ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

function newPatient(clinicId: string) {
  return {
    clinic_id: clinicId,
    first_name: "Paciente",
    last_name: `MFA ${randomUUID().slice(0, 6)}`,
    date_of_birth: "1990-01-01",
    sex: "masculino",
  };
}

/** Activa un factor TOTP verificado para el usuario; devuelve el secreto. */
async function enrollVerified(client: SupabaseClient): Promise<{ factorId: string; secret: string }> {
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `t-${randomUUID().slice(0, 6)}` });
  if (error || !data) throw new Error(`enroll falló: ${error?.message}`);
  const { error: vError } = await client.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code: totpCode(data.totp.secret),
  });
  if (vError) throw new Error(`verify falló: ${vError.message}`);
  return { factorId: data.id, secret: data.totp.secret };
}

/** Sube una sesión aal1 a aal2 con el código vigente. */
async function stepUp(client: SupabaseClient, factorId: string, secret: string) {
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: totpCode(secret) });
  return error;
}

async function aalOf(client: SupabaseClient): Promise<string | undefined> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return undefined;
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal;
}

async function main() {
  // ------------------------------------------------------------------ dominio
  console.log("\nDominio (puro):");
  check("normaliza espacios y guiones del código", normalizeTotpCode(" 123 456 ") === "123456" && normalizeTotpCode("123-456") === "123456", "no normalizó");
  check("código vacío o nulo => cadena vacía", normalizeTotpCode(null) === "" && normalizeTotpCode(undefined) === "", "no vacío");
  check("6 dígitos es válido", isValidTotpCode("123456") && isValidTotpCode("000000"), "rechazó uno válido");
  check(
    "5 o 7 dígitos, letras o vacío no son válidos",
    !isValidTotpCode("12345") && !isValidTotpCode("1234567") && !isValidTotpCode("12345a") && !isValidTotpCode(""),
    "aceptó uno inválido"
  );
  check("pide segundo paso: factor verificado + aal1", needsMfaChallenge("aal1", true) === true, "no lo pidió");
  check("no lo pide si ya es aal2", needsMfaChallenge("aal2", true) === false, "lo pidió");
  check("no lo pide sin factor verificado (aun siendo aal1)", needsMfaChallenge("aal1", false) === false, "lo pidió");
  check("sin nivel conocido con factor => lo pide", needsMfaChallenge(undefined, true) === true && needsMfaChallenge(null, true) === true, "no lo pidió");
  check("destino interno se respeta", safeNextPath("/claims?x=1") === "/claims?x=1", "lo cambió");
  check(
    "destinos externos o raros caen al valor por defecto",
    safeNextPath("//evil.com") === "/" &&
      safeNextPath("https://evil.com") === "/" &&
      safeNextPath("/\\evil.com") === "/" &&
      safeNextPath(undefined) === "/" &&
      safeNextPath("") === "/" &&
      safeNextPath("/\t/evil.com") === "/" &&
      safeNextPath("/\n/evil.com") === "/",
    "aceptó un destino externo"
  );
  check("no vuelve a la pantalla del código", safeNextPath(MFA_CHALLENGE_PATH) === "/" && safeNextPath(`${MFA_CHALLENGE_PATH}?next=/x`) === "/", "volvió");
  check("el motivo corto se rechaza", resetReasonError("corto") !== null && resetReasonError("   ") !== null && resetReasonError(undefined) !== null, "aceptó motivo corto");
  check(
    `el motivo de ${RESET_REASON_MIN_LENGTH}+ caracteres se acepta`,
    resetReasonError("Llamada al número registrado de la clínica") === null,
    "rechazó un motivo válido"
  );
  check("generador TOTP: vector de RFC 6238 (SHA-1, T=59 s => 94287082 → 287082)", totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000) === "287082", "el generador no coincide con el estándar");
  check("base32 decodifica la semilla del RFC", base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").toString() === "12345678901234567890", "decodificó mal");

  // ----------------------------------------------------------- base de datos
  const owner = await createUser("admin");
  const other = await createUser("otra-clinica");
  const operator = await createUser("operator");
  const plain = await createUser("sin-clinica");

  const ownerA = await signIn(owner);
  const otherC = await signIn(other);
  const clinicA = await createClinic(ownerA, "A");
  const clinicB = await createClinic(otherC, "B");
  await admin.from("platform_operators").insert({ user_id: operator.userId });

  const { data: seedPatient, error: seedError } = await ownerA
    .from("patients")
    .insert(newPatient(clinicA))
    .select("id")
    .single();
  if (seedError || !seedPatient) throw new Error(`No se pudo crear paciente de prueba: ${seedError?.message}`);
  const { error: seedBError } = await otherC.from("patients").insert(newPatient(clinicB));
  if (seedBError) throw new Error(`No se pudo crear paciente de la clínica B: ${seedBError.message}`);

  // ------------------------------------------------------------ sin factor
  console.log("\nSin factor (nada cambia):");
  const { data: p0 } = await ownerA.from("patients").select("id").eq("clinic_id", clinicA);
  check("el admin lee los pacientes de su clínica", (p0 ?? []).length === 1, `filas: ${(p0 ?? []).length}`);
  check("la sesión es aal1 y no importa", (await aalOf(ownerA)) === "aal1", String(await aalOf(ownerA)));

  // ------------------------------------------------------ factor sin verificar
  console.log("\nFactor SIN verificar (enrolamiento a medias):");
  const enr = await ownerA.auth.mfa.enroll({ factorType: "totp", friendlyName: `half-${randomUUID().slice(0, 6)}` });
  check("se puede iniciar el enrolamiento", enr.error === null && !!enr.data?.totp.secret, enr.error?.message ?? "sin secreto");
  const fresh0 = await signIn(owner);
  const { data: p1 } = await fresh0.from("patients").select("id").eq("clinic_id", clinicA);
  check("con el factor sin verificar, una sesión nueva sigue leyendo", (p1 ?? []).length === 1, `filas: ${(p1 ?? []).length}`);
  const { error: w1 } = await fresh0.from("patients").insert(newPatient(clinicA));
  check("y sigue escribiendo", w1 === null, w1?.message ?? "");

  // --------------------------------------------------------- código incorrecto
  console.log("\nVerificación del factor:");
  const wrong = await ownerA.auth.mfa.challengeAndVerify({
    factorId: enr.data!.id,
    code: totpCode("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"), // código de OTRO secreto
  });
  check("un código incorrecto se rechaza", wrong.error !== null, "lo aceptó");
  const okVerify = await stepUp(ownerA, enr.data!.id, enr.data!.totp.secret);
  check("el código correcto verifica el factor", okVerify === null, okVerify?.message ?? "");
  check("la sesión que verificó pasa a aal2", (await aalOf(ownerA)) === "aal2", String(await aalOf(ownerA)));
  const factorId = enr.data!.id;
  const secret = enr.data!.totp.secret;

  // ------------------------------------------------ factor verificado + aal1
  console.log("\nFactor verificado + sesión aal1 (solo contraseña) => denegado:");
  const aal1 = await signIn(owner);
  check("la sesión nueva es aal1", (await aalOf(aal1)) === "aal1", String(await aalOf(aal1)));
  const { data: p2 } = await aal1.from("patients").select("id").eq("clinic_id", clinicA);
  check("no lee pacientes", (p2 ?? []).length === 0, `filas: ${(p2 ?? []).length}`);
  const { data: c2 } = await aal1.from("clinics").select("id").eq("id", clinicA);
  check("no lee su clínica", (c2 ?? []).length === 0, `filas: ${(c2 ?? []).length}`);
  const { error: w2 } = await aal1.from("patients").insert(newPatient(clinicA));
  check("no crea pacientes", w2 !== null, "insertó");
  await aal1.from("patients").update({ first_name: "Cambiado" }).eq("id", seedPatient.id);
  const { data: afterUpdate } = await admin.from("patients").select("first_name").eq("id", seedPatient.id).single();
  check("no modifica pacientes", afterUpdate?.first_name === "Paciente", String(afterUpdate?.first_name));
  const { error: exp2 } = await aal1.rpc("log_clinic_export", { p_kind: "all" });
  check("no puede registrar/ejecutar la exportación completa", exp2 !== null, "lo permitió");
  const { error: unenroll1 } = await aal1.auth.mfa.unenroll({ factorId });
  check("una sesión aal1 NO puede quitar un factor verificado", unenroll1 !== null, "lo quitó");

  // ----------------------------------------------------------------- aal2
  console.log("\nFactor verificado + sesión aal2 (con el código) => permitido:");
  const stepErr = await stepUp(aal1, factorId, secret);
  check("el código vigente sube la sesión a aal2", stepErr === null && (await aalOf(aal1)) === "aal2", stepErr?.message ?? String(await aalOf(aal1)));
  const { data: p3 } = await aal1.from("patients").select("id").eq("clinic_id", clinicA);
  check("vuelve a leer pacientes", (p3 ?? []).length === 2, `filas: ${(p3 ?? []).length}`);
  const { error: w3 } = await aal1.from("patients").insert(newPatient(clinicA));
  check("vuelve a escribir", w3 === null, w3?.message ?? "");
  const { data: bOfA } = await aal1.from("patients").select("id").eq("clinic_id", clinicB);
  check("aislamiento entre clínicas intacto (no ve la clínica B)", (bOfA ?? []).length === 0, `filas: ${(bOfA ?? []).length}`);
  const { data: aOfB } = await otherC.from("patients").select("id").eq("clinic_id", clinicA);
  check("la otra clínica (sin 2FA) tampoco ve la A", (aOfB ?? []).length === 0, `filas: ${(aOfB ?? []).length}`);
  const { data: svc } = await admin.from("patients").select("id").eq("clinic_id", clinicA);
  check("service_role no cambia", (svc ?? []).length === 3, `filas: ${(svc ?? []).length}`);

  // ------------------------------------------------------------ operador
  console.log("\nOperador de plataforma con 2FA:");
  const opSession = await signIn(operator);
  const { data: isOp0 } = await opSession.rpc("is_platform_operator");
  check("sin factor, es operador", isOp0 === true, String(isOp0));
  const opEnroll = await enrollVerified(opSession);
  const opAal1 = await signIn(operator);
  const { data: isOp1 } = await opAal1.rpc("is_platform_operator");
  check("con factor verificado y aal1, NO es operador", isOp1 === false, String(isOp1));
  const { data: clinicsAal1 } = await opAal1.from("clinics").select("id").eq("id", clinicA);
  check("con aal1 no ve clínicas", (clinicsAal1 ?? []).length === 0, `filas: ${(clinicsAal1 ?? []).length}`);
  const { error: opWriteAal1 } = await opAal1.rpc("upsert_insurer", { p_name: `MFA ${randomUUID()}`, p_aliases: [], p_is_active: false });
  check("con aal1 no puede usar RPC de operador", opWriteAal1 !== null, "las permitió");
  await stepUp(opAal1, opEnroll.factorId, opEnroll.secret);
  const { data: isOp2 } = await opAal1.rpc("is_platform_operator");
  check("con aal2 vuelve a ser operador", isOp2 === true, String(isOp2));
  const { data: clinicsAal2 } = await opAal1.from("clinics").select("id").eq("id", clinicA);
  check("con aal2 ve la clínica (panel de operador)", (clinicsAal2 ?? []).length === 1, `filas: ${(clinicsAal2 ?? []).length}`);

  // ----------------------------------------------- restablecimiento y registro
  console.log("\nRestablecimiento por un operador (mfa_reset_log):");
  const { data: listed } = await admin.auth.admin.mfa.listFactors({ userId: owner.userId });
  check("la API de administración lista los factores del usuario", (listed?.factors ?? []).some((f) => f.id === factorId), JSON.stringify(listed));
  const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({ id: factorId, userId: owner.userId });
  check("la API de administración puede quitar el factor", delErr === null, delErr?.message ?? "");
  const afterReset = await signIn(owner);
  const { data: p4 } = await afterReset.from("patients").select("id").eq("clinic_id", clinicA);
  check("tras el restablecimiento, entra con la contraseña sola", (p4 ?? []).length === 3, `filas: ${(p4 ?? []).length}`);

  const { error: logErr } = await admin.from("mfa_reset_log").insert({
    user_id: owner.userId,
    user_email: owner.email,
    reset_by: operator.userId,
    reason: "Prueba automática de restablecimiento de 2FA",
    factors_removed: 1,
  });
  check("service_role escribe en mfa_reset_log", logErr === null, logErr?.message ?? "");
  const { error: shortReason } = await admin.from("mfa_reset_log").insert({
    user_id: owner.userId,
    reset_by: operator.userId,
    reason: "corto",
    factors_removed: 0,
  });
  check("la tabla rechaza un motivo corto", shortReason !== null, "lo aceptó");
  const { data: logOp } = await opAal1.from("mfa_reset_log").select("id").eq("user_id", owner.userId);
  check("un operador (aal2) lee el registro", (logOp ?? []).length === 1, `filas: ${(logOp ?? []).length}`);
  const { data: logOwner } = await afterReset.from("mfa_reset_log").select("id");
  check("un usuario normal no lo lee", (logOwner ?? []).length === 0, `filas: ${(logOwner ?? []).length}`);
  const { error: logWrite } = await afterReset.from("mfa_reset_log").insert({
    user_id: owner.userId,
    reset_by: owner.userId,
    reason: "Intento de escribir sin ser servidor",
    factors_removed: 0,
  });
  check("un usuario normal no puede escribirlo", logWrite !== null, "escribió");
  const { error: logWriteOp } = await opAal1.from("mfa_reset_log").insert({
    user_id: owner.userId,
    reset_by: operator.userId,
    reason: "Un operador tampoco escribe directo",
    factors_removed: 0,
  });
  check("ni siquiera un operador escribe directo (solo el servidor)", logWriteOp !== null, "escribió");
  await opAal1.from("mfa_reset_log").update({ reason: "Cambiado a posteriori" }).eq("user_id", owner.userId);
  const { data: logAfter } = await admin.from("mfa_reset_log").select("reason").eq("user_id", owner.userId);
  check("el registro no se puede alterar", (logAfter ?? []).every((r) => r.reason !== "Cambiado a posteriori"), JSON.stringify(logAfter));

  // ----------------------------------------------------- desactivar uno mismo
  console.log("\nDesactivar el propio 2FA (con aal2):");
  const second = await enrollVerified(afterReset);
  const aal1Again = await signIn(owner);
  const { data: p5 } = await aal1Again.from("patients").select("id").eq("clinic_id", clinicA);
  check("al activarlo de nuevo, una sesión aal1 vuelve a quedar fuera", (p5 ?? []).length === 0, `filas: ${(p5 ?? []).length}`);
  check("la sesión que lo activó (aal2) sigue entrando", (await afterReset.from("patients").select("id").eq("clinic_id", clinicA)).data?.length === 3, "no entró");
  const { error: selfUnenroll } = await afterReset.auth.mfa.unenroll({ factorId: second.factorId });
  check("con aal2 puede desactivarlo", selfUnenroll === null, selfUnenroll?.message ?? "");
  const aal1Free = await signIn(owner);
  const { data: p6 } = await aal1Free.from("patients").select("id").eq("clinic_id", clinicA);
  check("tras desactivarlo, la contraseña sola vuelve a bastar", (p6 ?? []).length === 3, `filas: ${(p6 ?? []).length}`);

  // --------------------------------------------------------- usuario sin clínica
  console.log("\nUsuario sin clínica con 2FA:");
  const plainSession = await signIn(plain);
  await enrollVerified(plainSession);
  const plainAal1 = await signIn(plain);
  const { data: mine } = await plainAal1.from("clinics").select("id");
  check("no rompe: simplemente no ve nada", (mine ?? []).length === 0, `filas: ${(mine ?? []).length}`);

  // ---------------------------------------------------------------- cobertura
  console.log("\nCobertura:");
  const { data: unguarded, error: ugErr } = await admin.rpc("list_unguarded_tables");
  check("ninguna tabla queda sin readonly_guard", ugErr === null && (unguarded ?? []).length === 0, ugErr?.message ?? JSON.stringify(unguarded));
  const { data: open, error: openErr } = await admin.rpc("list_policies_open_when_blocked");
  check(
    "ninguna política queda abierta con la clínica bloqueada",
    openErr === null && (open ?? []).length === 0,
    openErr?.message ?? JSON.stringify(open)
  );

  // ------------------------------------------------------------------- costo
  console.log("\nCosto de la regla (leer >1,000 filas con RLS):");
  const rows = Array.from({ length: 1050 }, () => newPatient(clinicA));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("patients").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`No se pudieron sembrar pacientes: ${error.message}`);
  }
  async function timeRead(client: SupabaseClient): Promise<{ ms: number; n: number }> {
    const started = Date.now();
    let n = 0;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .from("patients")
        .select("id, first_name, last_name")
        .eq("clinic_id", clinicA)
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      n += (data ?? []).length;
      if ((data ?? []).length < 1000) break;
    }
    return { ms: Date.now() - started, n };
  }
  const noFactor = await timeRead(aal1Free);
  const sess = await signIn(owner);
  const enrolledCost = await enrollVerified(sess);
  const withFactor = await timeRead(sess);
  await sess.auth.mfa.unenroll({ factorId: enrolledCost.factorId });
  console.log(`    sin factor: ${noFactor.ms} ms (${noFactor.n} filas) · con factor aal2: ${withFactor.ms} ms (${withFactor.n} filas)`);
  check("lee todas las filas sin factor y con factor", noFactor.n === 1053 && withFactor.n === 1053, `${noFactor.n} / ${withFactor.n}`);
  check("la regla no vuelve lenta la lectura (< 8 s para ~1,050 filas)", noFactor.ms < 8000 && withFactor.ms < 8000, `${noFactor.ms} / ${withFactor.ms} ms`);
}

async function cleanup() {
  // Filas de auditoría de la prueba, clínicas (cascada) y usuarios.
  if (createdUserIds.length > 0) await admin.from("mfa_reset_log").delete().in("user_id", createdUserIds);
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
    console.log("\nOK: autenticación de dos pasos verificada.");
  });
