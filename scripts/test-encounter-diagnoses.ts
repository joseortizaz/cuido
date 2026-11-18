/**
 * Prueba de los diagnósticos codificados CIE-11 en las consultas
 * (supabase/migrations/20261127100000_encounter_diagnoses.sql).
 *
 * Qué verifica:
 *   1. CREAR LA CONSULTA CON SUS DIAGNÓSTICOS en una sola transacción (create_encounter_with_diagnoses): si un
 *      diagnóstico es inválido (código, repetido, dos principales, campo desconocido, URI ajena…) NO queda
 *      ninguna consulta a medias. Sin diagnósticos también funciona.
 *   2. PERMISOS: médico y admin sí; recepción y el admin de otra clínica no (ni crear, ni agregar, ni leer).
 *   3. LECTURA: admin y médicos; recepción y otra clínica ven 0 filas; una consulta de Salud Mental solo la ve
 *      (y codifica) quien tiene acceso. Nadie escribe directo (ni el admin, ni service_role).
 *   4. REGLAS: un solo principal vigente por consulta y tipo; el mismo código no se repite vigente; el mismo
 *      código sí puede ser presuntivo y definitivo; máximo 20; verified = viene con la URI de la OMS.
 *   5. INMUTABLES: ni UPDATE ni DELETE (tampoco service_role); corregir = fila nueva + la anterior marcada con
 *      motivo y quién; retirar sin sustituto; no se corrige dos veces el mismo; el motivo es obligatorio.
 *   6. Paciente anulado, modo solo lectura y eliminación de pacientes de prueba (se van con sus diagnósticos).
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
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
  const email = `dx-${label}-${randomUUID()}@example.invalid`;
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
    clinic_name: `[TEST] Dx ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
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

const URI = (n: number) => `http://id.who.int/icd/release/11/2026-01/mms/${n}`;
const DX = (kind: "presuntivo" | "definitivo", code: string, extra: Record<string, unknown> = {}) => ({
  kind,
  code,
  title: `Título oficial de ${code}`,
  entity_uri: URI(Math.abs(code.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 1000000),
  is_primary: false,
  doctor_note: null,
  ...extra,
});

async function main() {
  console.log("Aprovisionando clínicas y usuarios sintéticos...");
  const owner = await createUser("owner");
  const medico = await createUser("medico");
  const medico2 = await createUser("medico2");
  const recepcion = await createUser("recepcion");
  const ownerB = await createUser("ownerB");
  const cid = await createClinic(owner, "A");
  await createClinic(ownerB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico2.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: recepcion.userId, role: "recepcion" });
  const { data: tpls } = await admin.from("specialty_templates").select("id, code").in("code", ["medicina_interna", "salud_mental_psicologia"]);
  const interna = tpls!.find((t) => t.code === "medicina_interna")!.id;
  const sm = tpls!.find((t) => t.code === "salud_mental_psicologia")!.id;

  const mkPatient = async (extra: Record<string, unknown> = {}) => {
    const { data, error } = await recepcion.client
      .from("patients")
      .insert({ clinic_id: cid, first_name: "Paciente", last_name: `Dx-${randomUUID().slice(0, 6)}`, date_of_birth: "1990-06-15", sex: "femenino", ...extra })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el paciente: ${error?.message}`);
    return data as { id: string };
  };
  const openRecord = (pid: string) => owner.client.rpc("open_patient_record", { p_patient_id: pid, p_history: {} });
  const p = await mkPatient();
  await openRecord(p.id);
  const p2 = await mkPatient();
  await openRecord(p2.id);
  const pNoRecord = await mkPatient();

  const create = (who: TestUser, diagnoses: unknown, extra: Record<string, unknown> = {}) =>
    who.client.rpc("create_encounter_with_diagnoses", {
      p_patient_id: p.id,
      p_template_id: interna,
      p_encounter_type: "inicial",
      p_chief_complaint: "Control",
      p_present_illness: "",
      p_specialty_data: {},
      p_diagnoses: diagnoses,
      p_release: "2026-01",
      ...extra,
    });
  const countEnc = async (patientId = p.id) => ((await admin.from("encounters").select("id").eq("patient_id", patientId)).data ?? []).length;
  const dxOf = async (encId: string) => ((await admin.from("encounter_diagnoses").select("*").eq("encounter_id", encId).order("created_at")).data ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

  console.log("\nCrear la consulta con sus diagnósticos (una sola transacción):");
  const c1 = await create(medico, [DX("definitivo", "5A11", { is_primary: true, doctor_note: "Desde hace 5 años" }), DX("presuntivo", "BA00"), { ...DX("presuntivo", "XX99"), entity_uri: null }]);
  check("un médico crea la consulta con 3 diagnósticos", c1.error === null && typeof c1.data === "string", c1.error?.message ?? "");
  const enc1 = c1.data as string;
  const rows1 = await dxOf(enc1);
  const { data: encRow } = await admin.from("encounters").select("provider_id, clinic_id, patient_id, encounter_type, chief_complaint").eq("id", enc1).single();
  check("la consulta queda a nombre del médico, de su clínica y de su paciente", encRow?.provider_id === medico.userId && encRow.clinic_id === cid && encRow.patient_id === p.id && encRow.encounter_type === "inicial" && encRow.chief_complaint === "Control", JSON.stringify(encRow));
  check("los 3 diagnósticos quedan con la clínica y el paciente de la consulta", rows1.length === 3 && rows1.every((r) => r.clinic_id === cid && r.patient_id === p.id && r.created_by === medico.userId && r.icd_release === "2026-01" && r.code_system === "CIE-11" && r.language === "es"), JSON.stringify(rows1.map((r) => r.code)));
  const bycode = (code: string) => rows1.find((r) => r.code === code);
  check("verified = viene con la URI de la OMS; la entrada manual queda «no verificada»", bycode("5A11")?.verified === true && bycode("XX99")?.verified === false && bycode("XX99")?.entity_uri === null, JSON.stringify(rows1.map((r) => [r.code, r.verified])));
  check("conserva el título tal cual, el principal y la nota del médico", bycode("5A11")?.title === "Título oficial de 5A11" && bycode("5A11")?.is_primary === true && bycode("5A11")?.doctor_note === "Desde hace 5 años", JSON.stringify(bycode("5A11")));
  const c0 = await create(medico, null);
  check("una consulta sin diagnósticos sigue funcionando (son opcionales)", c0.error === null && (await dxOf(c0.data as string)).length === 0, c0.error?.message ?? "");
  const c0b = await create(medico, []);
  check("y con una lista vacía también", c0b.error === null, c0b.error?.message ?? "");

  const before = await countEnc();
  const atomic: [string, unknown, string][] = [
    ["código con formato CIE-10", [DX("definitivo", "J00")], "formato"],
    ["código vacío", [{ ...DX("definitivo", "5A11"), code: "" }], "formato"],
    ["tipo inválido", [{ ...DX("definitivo", "5A11"), kind: "probable" }], "presuntivo o definitivo"],
    ["título vacío", [{ ...DX("definitivo", "5A11"), title: "  " }], "título"],
    ["campo desconocido", [{ ...DX("definitivo", "5A11"), hack: "x" }], "desconocido"],
    ["URI que no es de la OMS", [{ ...DX("definitivo", "5A11"), entity_uri: "http://evil.example.com/x" }], "dirección"],
    ["nota de más de 500 caracteres", [DX("definitivo", "5A11", { doctor_note: "x".repeat(501) })], "nota"],
    ["el mismo código repetido en el mismo tipo", [DX("definitivo", "5A11"), DX("definitivo", "5A11")], "ya está registrado"],
    ["dos principales del mismo tipo", [DX("definitivo", "5A11", { is_primary: true }), DX("definitivo", "BA00", { is_primary: true })], "principal"],
    ["más de 20 diagnósticos", Array.from({ length: 21 }, (_, i) => DX("presuntivo", `1A0${String.fromCharCode(65 + (i % 26))}${i > 25 ? "." + String.fromCharCode(65 + (i % 26)) : ""}`)), "entre 1 y 20"],
    ["lista que no es una lista", { kind: "definitivo" }, "lista"],
  ];
  for (const [label, dx, word] of atomic) {
    const r = await create(medico, dx);
    check(`se rechaza «${label}» y NO queda la consulta a medias`, r.error !== null && (!word || r.error.message.toLowerCase().includes(word.toLowerCase())) && (await countEnc()) === before, `${r.error?.message ?? "no falló"} | consultas ${before}→${await countEnc()}`);
  }
  const badRelease = await create(medico, [DX("definitivo", "5A11")], { p_release: "latest" });
  check("una versión de la clasificación inválida se rechaza (sin consulta a medias)", badRelease.error !== null && (await countEnc()) === before, badRelease.error?.message ?? "no falló");
  const noRec = await create(medico, [DX("definitivo", "5A11")], { p_patient_id: pNoRecord.id });
  check("sin expediente abierto no se crea la consulta ni sus diagnósticos", noRec.error !== null && noRec.error.message.includes("expediente") && (await countEnc(pNoRecord.id)) === 0, noRec.error?.message ?? "no falló");
  const asOwner = await create(owner, [DX("definitivo", "5A11")]);
  check("el admin también crea consultas con diagnósticos", asOwner.error === null, asOwner.error?.message ?? "");

  console.log("\nQuién puede crear y codificar:");
  const beforeDenied = await countEnc();
  for (const [label, who] of [["recepción", recepcion], ["admin de otra clínica", ownerB]] as const) {
    const r = await create(who, [DX("definitivo", "5A11")]);
    check(`${label} NO crea consultas con diagnósticos (ni queda nada)`, r.error !== null && (await countEnc()) === beforeDenied, r.error?.message ?? "no falló");
    const a = await who.client.rpc("add_encounter_diagnoses", { p_encounter_id: enc1, p_items: [DX("presuntivo", "CA40")], p_release: "2026-01" });
    check(`${label} NO agrega diagnósticos a una consulta`, a.error !== null, "no falló");
  }

  console.log("\nQuién lee y quién escribe:");
  for (const [label, who, expected] of [["el médico", medico, 3], ["el admin", owner, 3], ["recepción", recepcion, 0], ["otra clínica", ownerB, 0]] as const) {
    const { data } = await who.client.from("encounter_diagnoses").select("id").eq("encounter_id", enc1);
    check(`${label} ${expected ? "lee" : "NO lee"} los diagnósticos de la consulta (${expected})`, (data ?? []).length === expected, `${data?.length}`);
  }
  const wIns = await owner.client.from("encounter_diagnoses").insert({ clinic_id: cid, encounter_id: enc1, patient_id: p.id, kind: "definitivo", code: "CA40", title: "directo", icd_release: "2026-01" });
  const wUpd = await owner.client.from("encounter_diagnoses").update({ title: "directo" }).eq("encounter_id", enc1);
  const wDel = await owner.client.from("encounter_diagnoses").delete().eq("encounter_id", enc1);
  check("ni el admin escribe, edita ni borra directo", wIns.error !== null && wUpd.error !== null && wDel.error !== null, `${wIns.error?.message} | ${wUpd.error?.message} | ${wDel.error?.message}`);
  const sIns = await admin.from("encounter_diagnoses").insert({ clinic_id: cid, encounter_id: enc1, patient_id: p2.id, kind: "definitivo", code: "CA40", title: "otro paciente", icd_release: "2026-01" });
  check("ni service_role inserta directo (y menos con el paciente de otra consulta)", sIns.error !== null, "no falló");

  console.log("\nReglas al agregar a una consulta existente:");
  const add = (who: TestUser, items: unknown, encId = enc1, release = "2026-01") => who.client.rpc("add_encounter_diagnoses", { p_encounter_id: encId, p_items: items, p_release: release });
  const addOk = await add(medico2, [DX("definitivo", "CA40")]);
  check("otro médico de la clínica agrega un diagnóstico (queda a su nombre)", addOk.error === null && (await dxOf(enc1)).find((r) => r.code === "CA40")?.created_by === medico2.userId, addOk.error?.message ?? "");
  const secondPrimary = await add(medico, [DX("definitivo", "CA41", { is_primary: true })]);
  check("no se agrega un segundo principal del mismo tipo (hay que corregir el existente)", secondPrimary.error !== null && secondPrimary.error.message.includes("principal"), secondPrimary.error?.message ?? "no falló");
  const otherKindPrimary = await add(medico, [DX("presuntivo", "CA41", { is_primary: true })]);
  check("pero sí un principal presuntivo (uno por tipo)", otherKindPrimary.error === null, otherKindPrimary.error?.message ?? "");
  const dup = await add(medico, [DX("definitivo", "5A11")]);
  check("el mismo código no se repite vigente en el mismo tipo", dup.error !== null && dup.error.message.includes("ya está registrado"), dup.error?.message ?? "no falló");
  const sameCodeOtherKind = await add(medico, [DX("presuntivo", "5A11")]);
  check("pero el mismo código puede ser presuntivo y definitivo", sameCodeOtherKind.error === null, sameCodeOtherKind.error?.message ?? "");
  const emptyList = await add(medico, []);
  const badRel = await add(medico, [DX("definitivo", "CA42")], enc1, "2026");
  check("lista vacía y versión inválida se rechazan", emptyList.error !== null && badRel.error !== null, "no falló");
  const many = await add(medico, Array.from({ length: 20 }, (_, i) => DX("presuntivo", `2A0${String.fromCharCode(65 + (i % 26))}`)));
  check("pasar de 20 diagnósticos vigentes en una consulta se rechaza", many.error !== null, many.error?.message ?? "no falló");
  const otherPatientEnc = await create(owner, null, { p_patient_id: p2.id });
  const crossAdd = await add(medico, [DX("definitivo", "CA43")], otherPatientEnc.data as string);
  check("se puede codificar la consulta de otro paciente de la misma clínica (es un médico con acceso)", crossAdd.error === null, crossAdd.error?.message ?? "");
  const ghostEnc = await add(medico, [DX("definitivo", "CA43")], randomUUID());
  check("una consulta que no existe se rechaza", ghostEnc.error !== null, "no falló");

  console.log("\nInmutables y correcciones:");
  const sUpd = await admin.from("encounter_diagnoses").update({ title: "cambiado" }).eq("encounter_id", enc1);
  const sCode = await admin.from("encounter_diagnoses").update({ code: "ZZ99" }).eq("encounter_id", enc1);
  const sSup = await admin.from("encounter_diagnoses").update({ superseded_at: new Date().toISOString(), superseded_reason: "directo" }).eq("encounter_id", enc1);
  const sDel = await admin.from("encounter_diagnoses").delete().eq("encounter_id", enc1);
  check("ni service_role edita, cambia el código, marca como reemplazado ni borra (solo lo hace la función)", sUpd.error !== null && sCode.error !== null && sSup.error !== null && sDel.error !== null, `${sUpd.error?.message} | ${sCode.error?.message} | ${sSup.error?.message} | ${sDel.error?.message}`);
  const primaryRow = (await dxOf(enc1)).find((r) => r.code === "5A11" && r.kind === "definitivo")!;
  const corr = (who: TestUser, id: string, reason: string, repl: unknown = null, release = "2026-01") => who.client.rpc("correct_encounter_diagnosis", { p_diagnosis_id: id, p_reason: reason, p_new: repl, p_release: release });
  const noReason = await corr(medico, primaryRow.id, "x", DX("definitivo", "5A12", { is_primary: true }));
  check("corregir exige un motivo", noReason.error !== null && noReason.error.message.includes("motivo"), noReason.error?.message ?? "no falló");
  for (const [label, who] of [["recepción", recepcion], ["otra clínica", ownerB]] as const) {
    const r = await corr(who, primaryRow.id, "Intento ajeno", DX("definitivo", "5A12"));
    check(`${label} NO corrige`, r.error !== null, "no falló");
  }
  const repl = await corr(medico2, primaryRow.id, "Era el tipo 1, no el tipo 2", DX("definitivo", "5A10", { is_primary: true }));
  const afterRows = await dxOf(enc1);
  const oldRow = afterRows.find((r) => r.id === primaryRow.id)!;
  const newRow = afterRows.find((r) => r.code === "5A10")!;
  check("reemplazar el PRINCIPAL por otro principal funciona (el nuevo es el vigente)", repl.error === null && newRow?.is_primary === true && newRow.superseded_at === null && repl.data === newRow.id, repl.error?.message ?? JSON.stringify(newRow));
  check("el anterior se conserva marcado: cuándo, quién, motivo y por cuál se reemplazó (título y código intactos)", !!oldRow.superseded_at && oldRow.superseded_by === newRow.id && oldRow.superseded_by_user === medico2.userId && oldRow.superseded_reason === "Era el tipo 1, no el tipo 2" && oldRow.code === "5A11" && oldRow.title === "Título oficial de 5A11", JSON.stringify(oldRow));
  const twice = await corr(medico, primaryRow.id, "Otra vez", DX("definitivo", "5A13"));
  check("lo ya reemplazado no se corrige de nuevo", twice.error !== null && twice.error.message.includes("ya fue"), twice.error?.message ?? "no falló");
  const manualRow = (await dxOf(enc1)).find((r) => r.code === "XX99")!;
  const retire = await corr(medico, manualRow.id, "Código escrito a mano y equivocado");
  const retired = (await dxOf(enc1)).find((r) => r.id === manualRow.id)!;
  check("retirar sin sustituto marca el diagnóstico con su motivo (no se borra)", retire.error === null && retire.data === null && !!retired.superseded_at && retired.superseded_by === null && retired.superseded_reason === "Código escrito a mano y equivocado", retire.error?.message ?? JSON.stringify(retired));
  const dupNew = await corr(medico, (await dxOf(enc1)).find((r) => r.code === "BA00")!.id, "Cambio a un código ya vigente", DX("definitivo", "CA40"));
  check("no se reemplaza por un código que ya está vigente en ese tipo (y el original sigue vigente)", dupNew.error !== null && (await dxOf(enc1)).find((r) => r.code === "BA00")?.superseded_at === null, dupNew.error?.message ?? "no falló");
  const activeCount = (await dxOf(enc1)).filter((r) => r.superseded_at === null).length;
  check("el total de filas conserva la historia (nada se perdió)", (await dxOf(enc1)).length === activeCount + 2, `${(await dxOf(enc1)).length} filas, ${activeCount} vigentes`);
  const visible = await medico.client.from("encounter_diagnoses").select("id, superseded_at").eq("encounter_id", enc1);
  check("el médico ve también las reemplazadas (historial)", (visible.data ?? []).filter((r) => r.superseded_at).length === 2, `${visible.data?.length}`);

  console.log("\nConsultas de Salud Mental (acceso reforzado):");
  const smEnc = await create(medico, [DX("definitivo", "6A70")], { p_template_id: sm });
  check("el médico que atiende la consulta de Salud Mental la crea con su diagnóstico", smEnc.error === null, smEnc.error?.message ?? "");
  const smId = smEnc.data as string;
  for (const [label, who, expected] of [["el médico que la atendió", medico, 1], ["el admin sin acceso", owner, 0], ["otro médico sin acceso", medico2, 0], ["recepción", recepcion, 0]] as const) {
    const { data } = await who.client.from("encounter_diagnoses").select("id").eq("encounter_id", smId);
    check(`${label} ${expected ? "ve" : "NO ve"} los diagnósticos de Salud Mental`, (data ?? []).length === expected, `${data?.length}`);
  }
  const smAddAdmin = await add(owner, [DX("presuntivo", "6A71")], smId);
  const smAddOther = await add(medico2, [DX("presuntivo", "6A71")], smId);
  const smAddOwn = await add(medico, [DX("presuntivo", "6A71")], smId);
  check("solo quien tiene acceso agrega diagnósticos a esa consulta", smAddAdmin.error !== null && smAddOther.error !== null && smAddOwn.error === null, `${smAddAdmin.error?.message} | ${smAddOther.error?.message} | ${smAddOwn.error?.message}`);
  const smRow = (await dxOf(smId)).find((r) => r.code === "6A71")!;
  const smCorrAdmin = await corr(owner, smRow.id, "Sin acceso", DX("presuntivo", "6A72"));
  check("y solo ellos corrigen", smCorrAdmin.error !== null, "no falló");

  console.log("\nPaciente anulado y eliminación:");
  const pv = await mkPatient();
  await openRecord(pv.id);
  const encV = await create(medico, [DX("definitivo", "5A11")], { p_patient_id: pv.id });
  const voidIt = await owner.client.rpc("void_patient", { p_patient_id: pv.id, p_reason: "Prueba de anulación" });
  const addVoided = await add(medico, [DX("presuntivo", "BA00")], encV.data as string);
  check("a un paciente anulado no se le agregan diagnósticos", voidIt.error === null && addVoided.error !== null, `${voidIt.error?.message ?? ""} | ${addVoided.error?.message ?? "no falló"}`);
  const createVoided = await create(medico, [DX("definitivo", "5A11")], { p_patient_id: pv.id });
  check("ni se le crea una consulta con diagnósticos", createVoided.error !== null, "no falló");
  const t = await mkPatient({ is_test: true });
  await openRecord(t.id);
  const tEnc = await create(medico, [DX("definitivo", "5A11"), DX("presuntivo", "BA00")], { p_patient_id: t.id });
  const delT = await owner.client.rpc("delete_test_patient", { p_patient_id: t.id });
  check("un paciente de prueba se elimina con sus consultas y diagnósticos", tEnc.error === null && delT.error === null && (await dxOf(tEnc.data as string)).length === 0, `${delT.error?.message ?? ""}`);
  const blockers = await mkPatient();
  await openRecord(blockers.id);
  await create(medico, [DX("definitivo", "5A11")], { p_patient_id: blockers.id });
  const st = (await owner.client.rpc("patient_deletion_status", { p_patient_id: blockers.id })).data as { empty_blockers: string[] };
  check("un paciente con consultas codificadas no se elimina «por error» (cuenta como actividad)", st.empty_blockers.some((b) => b.includes("consultas")), JSON.stringify(st));

  console.log("\nModo solo lectura:");
  const old = new Date();
  old.setUTCDate(old.getUTCDate() - 31);
  const { error: subErr } = await admin.from("clinic_subscriptions").update({ trial_ends_at: old.toISOString().slice(0, 10), next_payment_due_on: null }).eq("clinic_id", cid);
  if (subErr) throw new Error(`No se pudo vencer la suscripción: ${subErr.message}`);
  const ro = "modo solo lectura";
  const roCreate = await create(medico, [DX("definitivo", "5A11")]);
  check("no se puede crear una consulta con diagnósticos", roCreate.error !== null && roCreate.error.message.includes(ro), roCreate.error?.message ?? "no falló");
  const roAdd = await add(medico, [DX("presuntivo", "CA44")]);
  check("ni agregar diagnósticos", roAdd.error !== null && roAdd.error.message.includes(ro), roAdd.error?.message ?? "no falló");
  const roCorr = await corr(medico, newRow.id, "Prueba de solo lectura", DX("definitivo", "5A14"));
  check("ni corregirlos", roCorr.error !== null && roCorr.error.message.includes(ro), roCorr.error?.message ?? "no falló");
  const roRead = await medico.client.from("encounter_diagnoses").select("id").eq("encounter_id", enc1);
  check("(control) leer sigue funcionando", (roRead.data ?? []).length > 0, roRead.error?.message ?? "");
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
    console.log("OK: diagnósticos CIE-11 (atomicidad, permisos, inmutabilidad y correcciones) verificados.");
  });
