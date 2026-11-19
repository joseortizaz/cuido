/**
 * Prueba del código automático de paciente
 * (supabase/migrations/20261119100000_patient_record_number.sql).
 *
 * Qué verifica:
 *   1. El formato: lógica pura (src/lib/domain/patient-code.ts) y que coincida
 *      EXACTO con las funciones de la base de datos (validación y render).
 *   2. Asignación: consecutivo por clínica, independiente entre clínicas,
 *      que el cliente NO puede falsificar el código, que no se puede editar,
 *      que un número borrado no se reutiliza, y que 15 altas simultáneas
 *      reciben 15 códigos distintos y seguidos.
 *   3. Reinicio anual con el año en hora de República Dominicana (frontera
 *      31-dic/1-ene) y contador sin reinicio.
 *   4. Cambio de formato: solo afecta a los pacientes nuevos; la red de
 *      seguridad salta un código que ya existe.
 *   5. Permisos por rol: solo el admin de la clínica guarda el formato y ve la
 *      configuración y la vista previa; médico, recepción y el admin de OTRA
 *      clínica no; los contadores no se leen ni se escriben directo.
 *   6. Reglas del número inicial y validación del formato en la base.
 *   7. Modo solo lectura: bloquea guardar el formato y crear pacientes.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { patientCodeFormatError, renderPatientCode } from "../src/lib/domain/patient-code";

loadDotenv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.");
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
  const email = `patient-code-${label}-${randomUUID()}@example.invalid`;
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
    clinic_name: `[TEST] Código ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

const newPatient = (clinicId: string, extra: Record<string, unknown> = {}) => ({
  clinic_id: clinicId,
  first_name: "Prueba",
  last_name: `Código-${randomUUID().slice(0, 6)}`,
  date_of_birth: "1990-01-01",
  sex: "femenino",
  ...extra,
});

const drYear = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }).slice(0, 4);

async function insertAndGetCode(client: SupabaseClient, clinicId: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await client.from("patients").insert(newPatient(clinicId, extra)).select("id, record_number").single();
  if (error || !data) throw new Error(`No se pudo crear el paciente: ${error?.message}`);
  return data as { id: string; record_number: string };
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
  console.log("Formato (lógica pura y paridad con la base de datos):");
  const formatCases: [string, boolean][] = [
    ["{AAAA}-{NNNN}", true],
    ["{NNNN}", false],
    ["CL-{AAAA}-{NNN}", true],
    ["{NNNN}/{AAAA}", true],
    ["H.{NN}", false],
    ["", false],
    ["{AAAA}", false],
    ["{NNNN}{NN}", false],
    ["{AAAA}-{AAAA}-{NNNN}", true],
    ["{NNNNNNNNNN}", false],
    ["{NNNN} ", false],
    ["Ñ-{NNNN}", false],
    ["{nnnn}", false],
    ["{AAAA}-{NNNN}-{XX}", true],
    ["{NNNN}", true], // reinicio anual sin {AAAA}
    ["x".repeat(31) + "{NNNN}", false],
  ];
  let parityOk = true;
  let parityDetail = "";
  for (const [fmt, yearly] of formatCases) {
    const ts = patientCodeFormatError(fmt, yearly);
    const { data: db, error } = await admin.rpc("patient_code_format_error", { p_format: fmt, p_reset_yearly: yearly });
    if (error || (db ?? null) !== ts) {
      parityOk = false;
      parityDetail += `\n    "${fmt}" yearly=${yearly}: TS=${JSON.stringify(ts)} BD=${JSON.stringify(db)} ${error?.message ?? ""}`;
    }
  }
  check("la validación en pantalla coincide con la de la base de datos (16 casos)", parityOk, parityDetail);
  check("formato válido por defecto", patientCodeFormatError("{AAAA}-{NNNN}", true) === null, "");
  check("{AAAA} obligatorio si reinicia cada año", patientCodeFormatError("{NNNN}", true) !== null, "");
  const renderCases: [string, string, number][] = [
    ["{AAAA}-{NNNN}", "2026", 7],
    ["CL-{AAAA}-{NNN}", "2027", 1234],
    ["{NNNN}/{AAAA}", "2026", 99999],
    ["H.{NN}", "2026", 5],
  ];
  let renderOk = true;
  let renderDetail = "";
  for (const [fmt, year, n] of renderCases) {
    const ts = renderPatientCode(fmt, year, n);
    const { data: db } = await admin.rpc("render_patient_code", { p_format: fmt, p_year: year, p_number: n });
    if (db !== ts) {
      renderOk = false;
      renderDetail += `\n    "${fmt}" ${year} ${n}: TS=${ts} BD=${db}`;
    }
  }
  check("el render en pantalla coincide con el de la base de datos", renderOk, renderDetail);
  check("0001 con relleno", renderPatientCode("{AAAA}-{NNNN}", "2026", 1) === "2026-0001", "");
  check("un número más largo que el relleno no se recorta", renderPatientCode("{NN}", "2026", 123) === "123", "");

  console.log("\nAprovisionando clínicas y usuarios sintéticos...");
  const owner = await createUser("owner");
  const medico = await createUser("medico");
  const recepcion = await createUser("recepcion");
  const ownerB = await createUser("ownerB");
  const cidA = await createClinic(owner, "A");
  const cidB = await createClinic(ownerB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cidA, user_id: medico.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cidA, user_id: recepcion.userId, role: "recepcion" });
  const year = drYear();

  console.log("\nAsignación del código:");
  const p1 = await insertAndGetCode(owner.client, cidA);
  check(`el primer paciente recibe ${year}-0001`, p1.record_number === `${year}-0001`, p1.record_number);
  const p2 = await insertAndGetCode(medico.client, cidA);
  check("el segundo (creado por un médico) recibe -0002", p2.record_number === `${year}-0002`, p2.record_number);
  const p3 = await insertAndGetCode(recepcion.client, cidA);
  check("el tercero (creado por recepción) recibe -0003", p3.record_number === `${year}-0003`, p3.record_number);
  const forged = await insertAndGetCode(owner.client, cidA, { record_number: "HACKEADO-1" });
  check("un código enviado por el cliente se ignora", forged.record_number === `${year}-0004`, forged.record_number);
  const pB = await insertAndGetCode(ownerB.client, cidB);
  check("la otra clínica lleva su propia cuenta (-0001)", pB.record_number === `${year}-0001`, pB.record_number);
  const { data: asRecepcion } = await recepcion.client.from("patients").select("record_number").eq("id", p1.id).single();
  check("recepción ve el código del paciente", asRecepcion?.record_number === `${year}-0001`, JSON.stringify(asRecepcion));

  const { error: editErr } = await owner.client.from("patients").update({ record_number: "OTRO-1" }).eq("id", p1.id);
  check("un usuario no puede editar el código", editErr !== null && editErr.message.includes("no se puede modificar"), editErr?.message ?? "no falló");
  const { error: editSvcErr } = await admin.from("patients").update({ record_number: "OTRO-2" }).eq("id", p1.id);
  check("ni siquiera service_role", editSvcErr !== null && editSvcErr.message.includes("no se puede modificar"), editSvcErr?.message ?? "no falló");
  const { error: otherFieldErr } = await owner.client.from("patients").update({ phone: "8095550101" }).eq("id", p1.id);
  check("editar otros campos sigue funcionando", otherFieldErr === null, otherFieldErr?.message ?? "");

  await admin.from("patients").delete().eq("id", forged.id);
  const p5 = await insertAndGetCode(owner.client, cidA);
  check("un número de un paciente borrado no se reutiliza", p5.record_number === `${year}-0005`, p5.record_number);

  console.log("\nAltas simultáneas:");
  const burst = await Promise.all(Array.from({ length: 15 }, () => admin.from("patients").insert(newPatient(cidA)).select("record_number").single()));
  const burstCodes = burst.map((r) => r.data?.record_number as string | undefined);
  check("las 15 altas se crearon", burstCodes.every(Boolean), JSON.stringify(burst.map((r) => r.error?.message)));
  const burstNumbers = burstCodes.map((c) => Number.parseInt(String(c).split("-")[1], 10)).sort((a, b) => a - b);
  check("15 códigos distintos", new Set(burstCodes).size === 15, burstCodes.join(","));
  check("y consecutivos (6 a 20)", burstNumbers.join(",") === Array.from({ length: 15 }, (_, i) => i + 6).join(","), burstNumbers.join(","));

  console.log("\nReinicio anual (año en hora de República Dominicana):");
  const nextYear = String(Number.parseInt(year, 10) + 1);
  const { data: c26 } = await admin.rpc("next_patient_code", { p_clinic_id: cidB, p_at: `${nextYear}-01-01T02:00:00Z` });
  check("1-ene 02:00 UTC todavía es el año anterior en RD", String(c26).startsWith(`${year}-`), String(c26));
  const { data: c27a } = await admin.rpc("next_patient_code", { p_clinic_id: cidB, p_at: `${nextYear}-01-01T05:00:00Z` });
  check("1-ene 05:00 UTC ya es el año nuevo y reinicia en -0001", c27a === `${nextYear}-0001`, String(c27a));
  const { data: c27b } = await admin.rpc("next_patient_code", { p_clinic_id: cidB, p_at: `${nextYear}-06-15T12:00:00Z` });
  check("el siguiente del año nuevo es -0002", c27b === `${nextYear}-0002`, String(c27b));

  console.log("\nPermisos de la configuración:");
  const { data: nextCode, error: prevErr } = await owner.client.rpc("preview_next_patient_code", { p_clinic_id: cidA });
  check("el admin ve la vista previa del siguiente código", prevErr === null && nextCode === `${year}-0021`, `${nextCode} ${prevErr?.message ?? ""}`);
  for (const [label, who, clinic] of [
    ["médico", medico, cidA],
    ["recepción", recepcion, cidA],
    ["admin de otra clínica", ownerB, cidA],
  ] as const) {
    const { error: pErr } = await who.client.rpc("preview_next_patient_code", { p_clinic_id: clinic });
    check(`${label} NO puede pedir la vista previa`, pErr !== null, "no falló");
    const { error: sErr } = await who.client.rpc("save_patient_code_settings", {
      p_clinic_id: clinic,
      p_format: "ZZ-{NNNN}",
      p_start_number: 1,
      p_reset_yearly: false,
    });
    check(`${label} NO puede guardar el formato`, sErr !== null, "no falló");
  }
  const { data: none } = await admin.from("clinic_patient_code_settings").select("clinic_id").eq("clinic_id", cidA);
  check("tras los intentos no se creó ninguna configuración", (none ?? []).length === 0, JSON.stringify(none));

  const { error: directIns } = await owner.client
    .from("clinic_patient_code_settings")
    .insert({ clinic_id: cidA, format: "ZZ-{NNNN}", reset_yearly: false });
  check("el admin no escribe la tabla de configuración directo", directIns !== null, "no falló");
  const { data: counterRead, error: counterErr } = await owner.client.from("clinic_patient_code_counters").select("*");
  check("los contadores no se pueden leer con la sesión del usuario", counterErr !== null || (counterRead ?? []).length === 0, JSON.stringify(counterRead));
  const { error: counterWrite } = await owner.client
    .from("clinic_patient_code_counters")
    .update({ last_value: 0 })
    .eq("clinic_id", cidA);
  check("ni escribirse", counterWrite !== null, "no falló");
  const { error: nextDirect } = await owner.client.rpc("next_patient_code", { p_clinic_id: cidA });
  check("el generador no es llamable por usuarios", nextDirect !== null, "no falló");

  console.log("\nGuardar el formato:");
  const save = (format: string, start: number, yearly: boolean) =>
    owner.client.rpc("save_patient_code_settings", { p_clinic_id: cidA, p_format: format, p_start_number: start, p_reset_yearly: yearly });
  const { error: bad1 } = await save("{NNNN}", 1, true);
  check("rechaza reinicio anual sin {AAAA}", bad1 !== null && bad1.message.includes("{AAAA}"), bad1?.message ?? "no falló");
  const { error: bad2 } = await save("A-{NNNN}-{NN}", 1, false);
  check("rechaza dos grupos de números", bad2 !== null, "no falló");
  const { error: bad3 } = await save("A B-{NNNN}", 1, false);
  check("rechaza caracteres no permitidos", bad3 !== null, "no falló");
  const { error: bad4 } = await save("{AAAA}-{NNNN}", 0, true);
  check("rechaza número inicial menor que 1", bad4 !== null, "no falló");
  const { error: bad5 } = await save("{AAAA}-{NNNN}", 10, true);
  check("rechaza un número inicial por debajo de lo ya usado (ya van 20)", bad5 !== null && bad5.message.includes("20"), bad5?.message ?? "no falló");
  const { data: stillNone } = await admin.from("clinic_patient_code_settings").select("clinic_id").eq("clinic_id", cidA);
  check("los rechazos no dejaron configuración a medias", (stillNone ?? []).length === 0, JSON.stringify(stillNone));

  const { error: ok1 } = await save("CL-{AAAA}-{NNN}", 1, true);
  check("el admin guarda un formato válido", ok1 === null, ok1?.message ?? "");
  const p21 = await insertAndGetCode(owner.client, cidA);
  check("el cambio de formato aplica al paciente nuevo y sigue la cuenta", p21.record_number === `CL-${year}-021`, p21.record_number);
  const { data: old1 } = await admin.from("patients").select("record_number").eq("id", p1.id).single();
  check("los códigos anteriores no cambian", old1?.record_number === `${year}-0001`, JSON.stringify(old1));

  const { error: ok2 } = await save("CL-{AAAA}-{NNN}", 100, true);
  check("subir el número inicial por encima de lo usado se permite", ok2 === null, ok2?.message ?? "");
  const p100 = await insertAndGetCode(owner.client, cidA);
  check("el contador salta hasta el número inicial", p100.record_number === `CL-${year}-100`, p100.record_number);

  console.log("\nSin reinicio anual y red de seguridad de unicidad:");
  const { error: ok3 } = await save("{NNNN}", 1, false);
  check("formato sin año y sin reinicio", ok3 === null, ok3?.message ?? "");
  const q1 = await insertAndGetCode(owner.client, cidA);
  const q2 = await insertAndGetCode(owner.client, cidA);
  check("numera 0001 y 0002 en el contador sin reinicio", q1.record_number === "0001" && q2.record_number === "0002", `${q1.record_number} ${q2.record_number}`);
  await admin.from("clinic_patient_code_counters").update({ last_value: 0 }).eq("clinic_id", cidA).eq("period", "total");
  const q3 = await insertAndGetCode(owner.client, cidA);
  check("si el contador apuntara a un código existente, salta al siguiente libre", q3.record_number === "0003", q3.record_number);
  const { data: dupes } = await admin.from("patients").select("record_number").eq("clinic_id", cidA);
  const codes = (dupes ?? []).map((d) => d.record_number as string);
  check("ningún código repetido en la clínica", new Set(codes).size === codes.length, `${codes.length} filas`);

  console.log("\nModo solo lectura:");
  const today = new Date();
  today.setUTCDate(today.getUTCDate() - 40);
  const { error: subErr } = await admin
    .from("clinic_subscriptions")
    .update({ trial_ends_at: today.toISOString().slice(0, 10), next_payment_due_on: null })
    .eq("clinic_id", cidA);
  if (subErr) throw new Error(`No se pudo vencer la suscripción: ${subErr.message}`);
  const { error: roSave } = await save("RO-{NNNN}", 1, false);
  check("no se puede guardar el formato", roSave !== null && roSave.message.includes("modo solo lectura"), roSave?.message ?? "no falló");
  const { error: roInsert } = await owner.client.from("patients").insert(newPatient(cidA));
  check("no se puede crear un paciente (ni gastar un número)", roInsert !== null && roInsert.message.includes("modo solo lectura"), roInsert?.message ?? "no falló");
  const { data: cfg } = await admin.from("clinic_patient_code_settings").select("format").eq("clinic_id", cidA).single();
  check("el formato guardado quedó intacto", cfg?.format === "{NNNN}", JSON.stringify(cfg));
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
    console.log("OK: código automático de paciente verificado.");
  });
