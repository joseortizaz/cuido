/**
 * Prueba del expediente clínico y la historia general
 * (supabase/migrations/20261122100000_patient_record_and_history.sql).
 *
 * Qué verifica:
 *   1. Lógica pura de las secciones (src/lib/domain/medical-history.ts).
 *   2. ABRIR: solo admin y médicos; recepción y otra clínica no; no dos veces;
 *      un paciente anulado no; guarda la historia en la misma operación y deja
 *      una revisión por cada campo escrito (con «Apertura del expediente»).
 *   3. SIN EXPEDIENTE NO HAY CONSULTAS: un médico no puede registrar una consulta
 *      (mensaje claro); con el expediente abierto sí; service_role (backend de
 *      confianza) queda fuera del requisito.
 *   4. COMPLETAR / CORREGIR: solo cambian los campos enviados; una revisión por
 *      campo realmente modificado (antes, después, quién, motivo opcional);
 *      vaciar un campo también se registra; validaciones (campo desconocido,
 *      no texto, demasiado largo); nunca se sobrescribe sin dejar huella.
 *   5. LECTURA: admin y médicos; recepción y otra clínica no ven nada. Nadie
 *      escribe directo (ni admin), y las revisiones son inmutables (ni service_role).
 *   6. ALERGIAS Y MEDICAMENTOS guardan quién los registró y quién cambió su estado.
 *   7. ELIMINAR SIN ACTIVIDAD: un expediente con historia cuenta como actividad;
 *      uno vacío no; el expediente se va con el paciente de prueba.
 *   8. MODO SOLO LECTURA bloquea abrir y corregir.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  HISTORY_FIELD_KEYS,
  HISTORY_FIELD_LABELS,
  HISTORY_SECTIONS,
  isSectionEmpty,
  pickHistoryChanges,
  sectionsForSex,
} from "../src/lib/domain/medical-history";

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
  const email = `patient-record-${label}-${randomUUID()}@example.invalid`;
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
    clinic_name: `[TEST] Expediente ${label} ${randomUUID().slice(0, 8)}`,
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

async function main() {
  console.log("Secciones de la historia (lógica pura):");
  const allKeys = HISTORY_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
  check("cada columna de la historia está en exactamente una sección", HISTORY_FIELD_KEYS.every((k) => allKeys.filter((x) => x === k).length === 1) && allKeys.length === HISTORY_FIELD_KEYS.length, allKeys.join(","));
  check("no existe «antecedentes personales»", !allKeys.some((k) => /personal/.test(k)), allKeys.join(","));
  check("ginecoobstétricos solo cuando aplica (femenino)", sectionsForSex("femenino").some((s) => s.id === "gineco-obstetricos") && !sectionsForSex("masculino").some((s) => s.id === "gineco-obstetricos"), "");
  check("hábitos tóxicos agrupa tabaco, alcohol y otras sustancias", HISTORY_SECTIONS.find((s) => s.id === "toxicos")!.fields.map((f) => f.key).join(",") === "toxic_tobacco,toxic_alcohol,toxic_other_substances", "");
  check("toda clave tiene etiqueta para mostrar la revisión", HISTORY_FIELD_KEYS.every((k) => !!HISTORY_FIELD_LABELS[k]), "");
  const fd = new FormData();
  fd.set("family_history", "  Diabetes  ");
  fd.set("surgical_history", "");
  fd.set("clave_ajena", "x");
  const picked = pickHistoryChanges(fd, HISTORY_SECTIONS);
  check("pickHistoryChanges recorta, conserva los vacíos y descarta claves ajenas", picked.family_history === "Diabetes" && picked.surgical_history === "" && !("clave_ajena" in picked) && !("vaccines" in picked), JSON.stringify(picked));
  check("isSectionEmpty", isSectionEmpty(HISTORY_SECTIONS[0], { family_history: "  " }) && !isSectionEmpty(HISTORY_SECTIONS[0], { family_history: "x" }), "");

  console.log("\nAprovisionando clínicas y usuarios sintéticos...");
  const owner = await createUser("owner");
  const medico = await createUser("medico");
  const recepcion = await createUser("recepcion");
  const ownerB = await createUser("ownerB");
  const cid = await createClinic(owner, "A");
  await createClinic(ownerB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: recepcion.userId, role: "recepcion" });
  const { data: tpl } = await admin.from("specialty_templates").select("id").eq("code", "medicina_interna").single();
  if (!tpl) throw new Error("Falta la plantilla medicina_interna.");

  const mkPatient = async (extra: Record<string, unknown> = {}) => {
    const { data, error } = await recepcion.client
      .from("patients")
      .insert({ clinic_id: cid, first_name: "Prueba", last_name: `Expediente-${randomUUID().slice(0, 6)}`, date_of_birth: "1990-01-01", sex: "femenino", ...extra })
      .select("id, first_name, last_name")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el paciente: ${error?.message}`);
    return data as { id: string; first_name: string; last_name: string };
  };
  const revisions = async (patientId: string) =>
    ((await admin.from("patient_medical_history_revisions").select("field, old_value, new_value, changed_by, reason, changed_at").eq("patient_id", patientId).order("changed_at").order("field")).data ?? []) as {
      field: string; old_value: string | null; new_value: string | null; changed_by: string | null; reason: string | null;
    }[];
  const historyOf = async (patientId: string) =>
    (await admin.from("patient_medical_history").select("*").eq("patient_id", patientId).maybeSingle()).data as Record<string, string | null> | null;
  const encInsert = (client: SupabaseClient, patientId: string, userId: string) =>
    client.from("encounters").insert({ clinic_id: cid, patient_id: patientId, provider_id: userId, specialty_template_id: tpl.id, chief_complaint: "Control", specialty_data: {} });

  // ------------------------------------------------------------- abrir
  console.log("\nAbrir el expediente:");
  const p = await mkPatient();
  const noRecord = await admin.from("patient_records").select("id").eq("patient_id", p.id);
  check("un paciente nuevo NO tiene expediente", (noRecord.data ?? []).length === 0, JSON.stringify(noRecord.data));
  for (const [label, who] of [["recepción", recepcion], ["admin de otra clínica", ownerB]] as const) {
    const { error } = await who.client.rpc("open_patient_record", { p_patient_id: p.id, p_history: {} });
    check(`${label} NO puede abrirlo`, error !== null, "no falló");
  }
  const bad = await medico.client.rpc("open_patient_record", { p_patient_id: p.id, p_history: { campo_inventado: "x" } });
  check("un campo desconocido se rechaza y no se abre nada", bad.error !== null && bad.error.message.includes("desconocido") && ((await admin.from("patient_records").select("id").eq("patient_id", p.id)).data ?? []).length === 0, bad.error?.message ?? "no falló");
  const open = await medico.client.rpc("open_patient_record", {
    p_patient_id: p.id,
    p_history: { family_history: "  Madre con diabetes  ", pathological_history: "Hipertensión", toxic_tobacco: "No fuma", vaccines: "" },
  });
  check("un médico abre el expediente con su historia", open.error === null && typeof open.data === "string", open.error?.message ?? "");
  const { data: rec } = await admin.from("patient_records").select("opened_by, migrated, clinic_id").eq("patient_id", p.id).single();
  check("queda quién lo abrió, no migrado y con la clínica del paciente", rec?.opened_by === medico.userId && rec.migrated === false && rec.clinic_id === cid, JSON.stringify(rec));
  const h = await historyOf(p.id);
  check("la historia quedó guardada y limpia (recortada; vacío = sin dato)", h?.family_history === "Madre con diabetes" && h.pathological_history === "Hipertensión" && h.toxic_tobacco === "No fuma" && h.vaccines === null, JSON.stringify(h));
  const r0 = await revisions(p.id);
  check(
    "una revisión por campo escrito, de vacío al valor, «Apertura del expediente», a nombre del médico",
    r0.map((r) => r.field).join(",") === "family_history,pathological_history,toxic_tobacco" && r0.every((r) => r.old_value === null && r.reason === "Apertura del expediente" && r.changed_by === medico.userId),
    JSON.stringify(r0)
  );
  const twice = await owner.client.rpc("open_patient_record", { p_patient_id: p.id, p_history: {} });
  check("no se abre dos veces", twice.error !== null && twice.error.message.includes("ya tiene"), twice.error?.message ?? "no falló");

  // ------------------------------------------------- sin expediente no hay consultas
  console.log("\nSin expediente no hay consultas:");
  const q = await mkPatient();
  const blocked = await encInsert(medico.client, q.id, medico.userId);
  check("un médico NO puede registrar consultas sin expediente (mensaje claro)", blocked.error !== null && blocked.error.message.includes("expediente abierto"), blocked.error?.message ?? "no falló");
  const blockedAdmin = await encInsert(owner.client, q.id, owner.userId);
  check("el admin tampoco", blockedAdmin.error !== null && blockedAdmin.error.message.includes("expediente abierto"), blockedAdmin.error?.message ?? "no falló");
  const svc = await admin.from("encounters").insert({ clinic_id: cid, patient_id: q.id, provider_id: owner.userId, specialty_template_id: tpl.id, specialty_data: {} });
  check("service_role (backend de confianza) queda fuera del requisito", svc.error === null, svc.error?.message ?? "");
  const okEnc = await encInsert(medico.client, p.id, medico.userId);
  check("con el expediente abierto, cualquier médico registra consultas", okEnc.error === null, okEnc.error?.message ?? "");
  const okEnc2 = await encInsert(owner.client, p.id, owner.userId);
  check("también el admin", okEnc2.error === null, okEnc2.error?.message ?? "");

  // ------------------------------------------------- completar / corregir
  console.log("\nCompletar o corregir:");
  const save = (who: TestUser, changes: unknown, reason?: string) =>
    who.client.rpc("save_medical_history", { p_patient_id: p.id, p_changes: changes, p_reason: reason ?? "" });
  const nBefore = (await revisions(p.id)).length;
  const s1 = await owner.client.rpc("save_medical_history", { p_patient_id: p.id, p_changes: { pathological_history: "Hipertensión y diabetes tipo 2", family_history: "Madre con diabetes", surgical_history: "Apendicectomía 2015" }, p_reason: "El paciente trajo sus informes" });
  check("el admin corrige y completa", s1.error === null, s1.error?.message ?? "");
  const h1 = await historyOf(p.id);
  check("cambió lo enviado y NO lo que no se envió", h1?.pathological_history === "Hipertensión y diabetes tipo 2" && h1.surgical_history === "Apendicectomía 2015" && h1.toxic_tobacco === "No fuma", JSON.stringify(h1));
  const r1 = (await revisions(p.id)).slice(nBefore);
  const byField = new Map(r1.map((r) => [r.field, r]));
  check("revisiones solo de lo que cambió (2); lo igual no genera nada", r1.length === 2 && !byField.has("family_history"), JSON.stringify(r1));
  check("antes → después, quién y motivo", byField.get("pathological_history")?.old_value === "Hipertensión" && byField.get("pathological_history")?.new_value === "Hipertensión y diabetes tipo 2" && byField.get("pathological_history")?.changed_by === owner.userId && byField.get("pathological_history")?.reason === "El paciente trajo sus informes", JSON.stringify(byField.get("pathological_history")));
  const s2 = await save(medico, { toxic_tobacco: "" });
  const r2 = (await revisions(p.id)).slice(nBefore + 2);
  check("vaciar un campo también se registra (queda sin dato) y el motivo es opcional", s2.error === null && (await historyOf(p.id))?.toxic_tobacco === null && r2.length === 1 && r2[0].old_value === "No fuma" && r2[0].new_value === null && r2[0].reason === null, `${s2.error?.message ?? ""} ${JSON.stringify(r2)}`);
  const s3 = await save(medico, { vaccines: "x".repeat(5001) });
  check("un campo demasiado largo se rechaza", s3.error !== null && s3.error.message.includes("largo"), s3.error?.message ?? "no falló");
  const s4 = await save(medico, { vaccines: 123 });
  check("un valor que no es texto se rechaza", s4.error !== null && s4.error.message.includes("texto"), s4.error?.message ?? "no falló");
  const s5 = await save(medico, { campo_inventado: "x" });
  check("un campo desconocido se rechaza", s5.error !== null && s5.error.message.includes("desconocido"), s5.error?.message ?? "no falló");
  for (const [label, who] of [["recepción", recepcion], ["admin de otra clínica", ownerB]] as const) {
    const { error } = await save(who, { vaccines: "Hackeado" });
    check(`${label} NO puede corregirla`, error !== null, "no falló");
  }
  check("tras los rechazos la historia no cambió", (await historyOf(p.id))?.vaccines === null, JSON.stringify(await historyOf(p.id)));
  const noRec = await owner.client.rpc("save_medical_history", { p_patient_id: q.id, p_changes: { vaccines: "x" }, p_reason: "" });
  check("sin expediente abierto no hay nada que corregir", noRec.error !== null && noRec.error.message.includes("no tiene el expediente abierto"), noRec.error?.message ?? "no falló");

  // ---------------------------------------------------- lectura y escritura directa
  console.log("\nQuién lee y quién escribe:");
  for (const [label, who, expected] of [["el médico", medico, true], ["el admin", owner, true], ["recepción", recepcion, false], ["otra clínica", ownerB, false]] as const) {
    const a = await who.client.from("patient_records").select("id").eq("patient_id", p.id);
    const b = await who.client.from("patient_medical_history").select("patient_id").eq("patient_id", p.id);
    const c = await who.client.from("patient_medical_history_revisions").select("id").eq("patient_id", p.id);
    const sees = (a.data ?? []).length === 1 && (b.data ?? []).length === 1 && (c.data ?? []).length > 0;
    const sawNothing = (a.data ?? []).length === 0 && (b.data ?? []).length === 0 && (c.data ?? []).length === 0;
    check(`${label} ${expected ? "lee" : "NO lee"} el expediente, la historia y las revisiones`, expected ? sees : sawNothing, `${a.data?.length}/${b.data?.length}/${c.data?.length}`);
  }
  const wRec = await owner.client.from("patient_records").insert({ clinic_id: cid, patient_id: q.id });
  const wHist = await owner.client.from("patient_medical_history").update({ vaccines: "directo" }).eq("patient_id", p.id);
  const wRev = await owner.client.from("patient_medical_history_revisions").delete().eq("patient_id", p.id);
  check("ni el admin escribe directo (expediente, historia, revisiones)", wRec.error !== null && wHist.error !== null && wRev.error !== null, `${wRec.error?.message} | ${wHist.error?.message} | ${wRev.error?.message}`);
  check("la historia sigue sin ese cambio directo", (await historyOf(p.id))?.vaccines === null, "cambió");
  const uRev = await admin.from("patient_medical_history_revisions").update({ new_value: "x" }).eq("patient_id", p.id);
  const dRev = await admin.from("patient_medical_history_revisions").delete().eq("patient_id", p.id);
  check("las revisiones son inmutables (ni service_role edita ni borra)", uRev.error !== null && dRev.error !== null, `${uRev.error?.message} | ${dRev.error?.message}`);
  // service_role (backend de confianza) conserva su acceso por defecto, pero nada se sobrescribe sin huella:
  // el trigger deja la revisión también para sus cambios directos.
  const nRevBefore = (await revisions(p.id)).length;
  await admin.from("patient_medical_history").update({ vaccines: "Cambio de mantenimiento" }).eq("patient_id", p.id);
  const revAfterSvc = (await revisions(p.id)).slice(nRevBefore);
  check("incluso un cambio directo de service_role deja su revisión (sin autor)", revAfterSvc.length === 1 && revAfterSvc[0].field === "vaccines" && revAfterSvc[0].new_value === "Cambio de mantenimiento" && revAfterSvc[0].changed_by === null, JSON.stringify(revAfterSvc));
  await medico.client.rpc("save_medical_history", { p_patient_id: p.id, p_changes: { vaccines: "" }, p_reason: "Revierte la prueba" });

  // ------------------------------------------------------ alergias y medicamentos
  console.log("\nAlergias y medicamentos: quién y cuándo:");
  const { data: al } = await medico.client.from("allergies").insert({ clinic_id: cid, patient_id: p.id, substance: "Penicilina" }).select("id, recorded_by, status_changed_at").single();
  check("la alergia guarda quién la registró (sin cambio de estado todavía)", al?.recorded_by === medico.userId && al.status_changed_at === null, JSON.stringify(al));
  const { data: ro } = await owner.client.from("allergies").update({ status: "resuelta" }).eq("id", al!.id).select("status_changed_by, status_changed_at, recorded_by").single();
  check("al resolverla queda quién y cuándo (el autor original no cambia)", ro?.status_changed_by === owner.userId && !!ro.status_changed_at && ro.recorded_by === medico.userId, JSON.stringify(ro));
  const { data: md } = await medico.client.from("medications").insert({ clinic_id: cid, patient_id: p.id, name: "Metformina" }).select("id, created_by").single();
  check("el medicamento guarda quién lo registró", md?.created_by === medico.userId, JSON.stringify(md));
  const { data: md2 } = await owner.client.from("medications").update({ status: "descontinuado" }).eq("id", md!.id).select("status_changed_by, status_changed_at").single();
  check("al descontinuarlo queda quién y cuándo", md2?.status_changed_by === owner.userId && !!md2.status_changed_at, JSON.stringify(md2));

  // ------------------------------------------------------ eliminar sin actividad
  console.log("\nEliminar sin actividad:");
  const e1 = await mkPatient();
  await owner.client.rpc("open_patient_record", { p_patient_id: e1.id, p_history: {} });
  const st1 = (await owner.client.rpc("patient_deletion_status", { p_patient_id: e1.id })).data as { empty_blockers: string[] };
  check("un expediente abierto pero vacío NO cuenta como actividad", st1.empty_blockers.length === 0, JSON.stringify(st1));
  await owner.client.rpc("save_medical_history", { p_patient_id: e1.id, p_changes: { vaccines: "Completas" }, p_reason: "" });
  const st2 = (await owner.client.rpc("patient_deletion_status", { p_patient_id: e1.id })).data as { empty_blockers: string[] };
  check("con una historia escrita, sí (y pide anular)", st2.empty_blockers.some((b) => b.includes("historia clínica")), JSON.stringify(st2));
  const e2 = await mkPatient({ is_test: true });
  await owner.client.rpc("open_patient_record", { p_patient_id: e2.id, p_history: { family_history: "Ficticio" } });
  const delTest = await owner.client.rpc("delete_test_patient", { p_patient_id: e2.id });
  const left = [
    ((await admin.from("patient_records").select("id").eq("patient_id", e2.id)).data ?? []).length,
    ((await admin.from("patient_medical_history").select("patient_id").eq("patient_id", e2.id)).data ?? []).length,
    ((await admin.from("patient_medical_history_revisions").select("id").eq("patient_id", e2.id)).data ?? []).length,
  ];
  check("un paciente de prueba se elimina con su expediente, historia y revisiones", delTest.error === null && left.every((n) => n === 0), `${delTest.error?.message ?? ""} ${left}`);

  console.log("\nPacientes anulados:");
  const v = await mkPatient();
  await owner.client.rpc("open_patient_record", { p_patient_id: v.id, p_history: {} });
  await owner.client.rpc("void_patient", { p_patient_id: v.id, p_reason: "Duplicado" });
  const vSave = await owner.client.rpc("save_medical_history", { p_patient_id: v.id, p_changes: { vaccines: "x" }, p_reason: "" });
  check("la historia de un paciente anulado no se corrige", vSave.error !== null && vSave.error.message.includes("anulado"), vSave.error?.message ?? "no falló");
  const v2 = await mkPatient();
  await owner.client.rpc("void_patient", { p_patient_id: v2.id, p_reason: "Duplicado" });
  const vOpen = await owner.client.rpc("open_patient_record", { p_patient_id: v2.id, p_history: {} });
  check("a un paciente anulado no se le abre expediente", vOpen.error !== null && vOpen.error.message.includes("anulado"), vOpen.error?.message ?? "no falló");

  // ----------------------------------------------------------- solo lectura
  console.log("\nModo solo lectura:");
  const pro = await mkPatient();
  const old = new Date();
  old.setUTCDate(old.getUTCDate() - 40);
  const { error: subErr } = await admin.from("clinic_subscriptions").update({ trial_ends_at: old.toISOString().slice(0, 10), next_payment_due_on: null }).eq("clinic_id", cid);
  if (subErr) throw new Error(`No se pudo vencer la suscripción: ${subErr.message}`);
  const ro1 = await owner.client.rpc("open_patient_record", { p_patient_id: pro.id, p_history: {} });
  check("no se puede abrir un expediente", ro1.error !== null && ro1.error.message.includes("modo solo lectura"), ro1.error?.message ?? "no falló");
  const ro2 = await owner.client.rpc("save_medical_history", { p_patient_id: p.id, p_changes: { vaccines: "Solo lectura" }, p_reason: "" });
  check("ni corregir la historia", ro2.error !== null && ro2.error.message.includes("modo solo lectura"), ro2.error?.message ?? "no falló");
  check("lo anterior quedó intacto", (await historyOf(p.id))?.vaccines === null && ((await admin.from("patient_records").select("id").eq("patient_id", pro.id)).data ?? []).length === 0, "cambió");
  const roRead = await medico.client.from("patient_medical_history").select("patient_id").eq("patient_id", p.id);
  check("(control) la lectura sigue funcionando", (roRead.data ?? []).length === 1, JSON.stringify(roRead.data));
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
    console.log("OK: expediente clínico e historia general verificados.");
  });
