/**
 * Prueba de las recetas digitales con impresión A6
 * (supabase/migrations/20261126100000_prescriptions.sql).
 *
 * Qué verifica:
 *   1. Lógica pura: lectura de renglones del formulario, número, edad, formato, tipo real del logo y
 *      paginación de la hoja A6 (cada renglón sale una sola vez, en orden, y las indicaciones al final).
 *   2. DATOS PROFESIONALES: cada quien edita solo los suyos; recepción y otra clínica no; sin nombre y
 *      exequátur no se emite ninguna receta (pista «profile_incomplete»).
 *   3. EMITIR: solo admin y médicos, con expediente abierto; validaciones de renglones; número consecutivo
 *      por clínica (independiente entre clínicas); una consulta de otro paciente se rechaza; una consulta
 *      de Salud Mental solo la vincula quien tiene acceso.
 *   4. LECTURA: admin y médicos; recepción y otra clínica ven 0 filas; la receta de una consulta sensible
 *      no la ve el admin sin acceso. Nadie escribe directo (ni service_role edita o borra).
 *   5. INMUTABLES: una receta no se edita; se anula con motivo (quien la emitió o el admin) y es definitiva;
 *      una anulada no se imprime. Copia (snapshot) del médico, el timbrado y el paciente al emitirla.
 *   6. IMPRESIONES: la primera es el original, las siguientes «COPIA»; recepción no imprime ni lee.
 *   7. TIMBRADO: solo el admin lo cambia; se valida; lo leen admin y médicos.
 *   8. STORAGE del logo: bucket privado; solo el admin sube (PNG/JPG, máx. 2 MB); médicos descargan con
 *      URL firmada; recepción y otra clínica no; nadie borra ni reemplaza; la ruta debe ser de la clínica.
 *   9. Eliminar pacientes: una receta cuenta como actividad; el paciente de prueba se elimina con ellas.
 *  10. Modo solo lectura: bloquea emitir, anular, imprimir y cambiar el timbrado, no leer.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle (también los archivos).
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  MAX_RX_ITEMS,
  RX_CONTINUE_MM,
  RX_PAGE_BODY_MM,
  estimateItemHeightMm,
  estimateNotesHeightMm,
  formatRxNumber,
  isPrintFormat,
  paginateRx,
  parseRxItemsFromForm,
  patientAgeLabel,
  rxItemDetail,
  sniffLogoMime,
  summarizeRxItems,
} from "../src/lib/domain/prescriptions";

loadDotenv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const BUCKET = "clinic-letterhead";

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
const uploadedPaths: string[] = [];

type TestUser = { userId: string; client: SupabaseClient };

async function createUser(label: string): Promise<TestUser> {
  const email = `rx-${label}-${randomUUID()}@example.invalid`;
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
    clinic_name: `[TEST] Recetas ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

async function cleanup() {
  try {
    for (let i = 0; i < uploadedPaths.length; i += 50) await admin.storage.from(BUCKET).remove(uploadedPaths.slice(i, i + 50));
  } catch {
    // best-effort
  }
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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("logo de prueba")]);
const ITEM = { medication: "Losartán 50 mg tabletas", dose: "1 tableta", route: "oral", frequency: "cada 24 horas", duration: "30 días", quantity: "30 tabletas", instructions: "En la mañana" };

async function main() {
  console.log("Lógica pura:");
  const fd = new FormData();
  fd.set("rx_medication_0", "  Metformina 850 mg ");
  fd.set("rx_dose_0", "1 tableta");
  fd.set("rx_medication_2", "Aspirina 81 mg");
  fd.set("rx_instructions_2", "Con comida");
  const parsed = parseRxItemsFromForm(fd);
  check("los renglones se leen recortados y las filas vacías se ignoran", !parsed.error && parsed.items.length === 2 && parsed.items[0].medication === "Metformina 850 mg" && parsed.items[1].instructions === "Con comida", JSON.stringify(parsed));
  const orphan = new FormData();
  orphan.set("rx_dose_0", "1 tableta");
  check("datos sin nombre de medicamento son un error", parseRxItemsFromForm(orphan).error !== undefined, "");
  check("sin ningún medicamento es un error", parseRxItemsFromForm(new FormData()).error !== undefined, "");
  const long = new FormData();
  long.set("rx_medication_0", "x".repeat(201));
  check("un nombre de más de 200 caracteres es un error", parseRxItemsFromForm(long).error !== undefined, "");
  check("el número se imprime con 6 dígitos", formatRxNumber(7) === "000007" && formatRxNumber(123456) === "123456", formatRxNumber(7));
  check("la edad sale en años (y en meses si es menor de 2 años)", patientAgeLabel("1990-06-15", "2026-11-18T12:00:00Z") === "36 años" && patientAgeLabel("2026-05-10", "2026-11-18T12:00:00Z") === "6 meses" && patientAgeLabel("2025-11-19", "2026-11-18T12:00:00Z") === "11 meses", `${patientAgeLabel("1990-06-15", "2026-11-18T12:00:00Z")} ${patientAgeLabel("2026-05-10", "2026-11-18T12:00:00Z")} ${patientAgeLabel("2025-11-19", "2026-11-18T12:00:00Z")}`);
  check("solo existen los formatos a6 y a4", isPrintFormat("a6") && isPrintFormat("a4") && !isPrintFormat("a5") && !isPrintFormat(undefined), "");
  check("el logo se reconoce por sus bytes (PNG/JPG); un ejecutable no", sniffLogoMime(new Uint8Array(PNG)) === "image/png" && sniffLogoMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === "image/jpeg" && sniffLogoMime(new Uint8Array(Buffer.from("MZ exe"))) === null, "");
  check("la línea de detalle une dosis, vía, frecuencia, duración y cantidad", rxItemDetail(ITEM) === "1 tableta · oral · cada 24 horas · 30 días · Cant.: 30 tabletas", rxItemDetail(ITEM));
  check("el resumen lista los medicamentos con su dosis", summarizeRxItems([{ medication: "A", dose: "1" }, { medication: "B" }]) === "A 1, B", summarizeRxItems([{ medication: "A", dose: "1" }, { medication: "B" }]));
  const many = Array.from({ length: 14 }, (_, i) => ({ medication: `Medicamento ${i + 1} 500 mg`, dose: "1 tableta", frequency: "cada 8 horas", duration: "7 días", instructions: "Con las comidas" }));
  const pages = paginateRx(many, "Reposo relativo e hidratación abundante.");
  const flat = pages.flatMap((pg) => pg.items.map((i) => i.medication));
  check("14 medicamentos se reparten en varias hojas, cada uno una sola vez y en orden", pages.length > 1 && flat.length === 14 && flat.every((m, i) => m === many[i].medication), `${pages.length} hojas, ${flat.length} renglones`);
  check("el índice de inicio de cada hoja es correcto", pages.every((pg, i) => pg.startIndex === pages.slice(0, i).reduce((n, q) => n + q.items.length, 0) || pg.items.length === 0), JSON.stringify(pages.map((pg) => pg.startIndex)));
  check("las indicaciones generales salen una sola vez, al final", pages.filter((pg) => pg.notes).length === 1 && pages[pages.length - 1].notes !== null, JSON.stringify(pages.map((pg) => pg.notes)));
  const fits = (list: typeof many, notes: string | null) => {
    const pgs = paginateRx(list, notes);
    return pgs.every((pg, i) => {
      const used = pg.items.reduce((n, it) => n + estimateItemHeightMm(it), 0) + (pg.notes ? estimateNotesHeightMm(pg.notes) : 0);
      const reserve = i < pgs.length - 1 ? RX_CONTINUE_MM : 0;
      return pg.items.length + (pg.notes ? 1 : 0) <= 1 || used <= RX_PAGE_BODY_MM - reserve;
    });
  };
  const longNotes = "Indicación general larga. ".repeat(12);
  check("ninguna hoja pasa de su presupuesto, y las que continúan dejan sitio a «Continúa en la hoja siguiente…»", [1, 2, 3, 4, 5, 7, 12, 30].every((n) => fits(Array.from({ length: n }, (_, i) => ({ ...many[i % many.length], medication: `Medicamento ${i}` })), null) && fits(Array.from({ length: n }, (_, i) => ({ ...many[i % many.length], medication: `Medicamento ${i}` })), longNotes)), "");
  check("una receta corta cabe en una sola hoja", paginateRx(many.slice(0, 2), null).length === 1 && paginateRx([], null).length === 1, "");
  check("el máximo de renglones coincide con la base de datos (30)", MAX_RX_ITEMS === 30, `${MAX_RX_ITEMS}`);

  console.log("\nAprovisionando clínicas y usuarios sintéticos...");
  const owner = await createUser("owner");
  const medico = await createUser("medico");
  const medico2 = await createUser("medico2");
  const recepcion = await createUser("recepcion");
  const ownerB = await createUser("ownerB");
  const cid = await createClinic(owner, "A");
  const cidB = await createClinic(ownerB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico2.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: recepcion.userId, role: "recepcion" });
  const { data: tpls } = await admin.from("specialty_templates").select("id, code").in("code", ["medicina_interna", "salud_mental_psicologia"]);
  const interna = tpls!.find((t) => t.code === "medicina_interna")!.id;
  const sm = tpls!.find((t) => t.code === "salud_mental_psicologia")!.id;

  const mkPatient = async (extra: Record<string, unknown> = {}) => {
    const { data, error } = await recepcion.client
      .from("patients")
      .insert({ clinic_id: cid, first_name: "Paciente", last_name: `Recetas-${randomUUID().slice(0, 6)}`, date_of_birth: "1990-06-15", sex: "femenino", ...extra })
      .select("id, first_name, last_name")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el paciente: ${error?.message}`);
    return data as { id: string; first_name: string; last_name: string };
  };
  const openRecord = (pid: string) => owner.client.rpc("open_patient_record", { p_patient_id: pid, p_history: {} });
  const p = await mkPatient();
  await openRecord(p.id);
  const p2 = await mkPatient();
  await openRecord(p2.id);
  const { data: enc } = await medico.client.from("encounters").insert({ clinic_id: cid, patient_id: p.id, provider_id: medico.userId, specialty_template_id: interna, specialty_data: {} }).select("id").single();
  const { data: sensEnc } = await medico.client.from("encounters").insert({ clinic_id: cid, patient_id: p.id, provider_id: medico.userId, specialty_template_id: sm, specialty_data: {} }).select("id").single();
  const { data: otherEnc } = await admin.from("encounters").insert({ clinic_id: cid, patient_id: p2.id, provider_id: owner.userId, specialty_template_id: interna, specialty_data: {} }).select("id").single();

  const profile = (who: TestUser, clinic: string, name: string, title: string, exeq: string) =>
    who.client.rpc("update_my_professional_profile", { p_clinic_id: clinic, p_name: name, p_title: title, p_exequatur: exeq });
  const issue = (who: TestUser, extra: Record<string, unknown> = {}, patient: string = p.id) =>
    who.client.rpc("issue_prescription", { p_patient_id: patient, p_items: [ITEM], ...extra });

  console.log("\nDatos profesionales:");
  const noProfile = await issue(medico);
  check("sin nombre y exequátur NO se emite (con la pista profile_incomplete)", noProfile.error !== null && noProfile.error.hint === "profile_incomplete", `${noProfile.error?.message ?? "no falló"} / ${noProfile.error?.hint}`);
  const okProfile = await profile(medico, cid, "Dr. Juan Pérez", "Medicina Interna", "123-45");
  check("un médico completa SUS datos profesionales", okProfile.error === null, okProfile.error?.message ?? "");
  await profile(owner, cid, "Dra. Ana Admin", "", "999-99");
  const { data: rows } = await admin.from("clinic_members").select("user_id, professional_name, professional_title, exequatur").eq("clinic_id", cid);
  const mine = rows!.find((r) => r.user_id === medico.userId);
  const adminRow = rows!.find((r) => r.user_id === owner.userId);
  const m2Row = rows!.find((r) => r.user_id === medico2.userId);
  check("solo cambia su propia fila (la del admin y la del otro médico quedan como estaban)", mine?.professional_name === "Dr. Juan Pérez" && mine.exequatur === "123-45" && adminRow?.professional_name === "Dra. Ana Admin" && adminRow.professional_title === null && m2Row?.professional_name === null, JSON.stringify(rows));
  for (const [label, who, clinic] of [["recepción", recepcion, cid], ["admin de otra clínica", ownerB, cid]] as const) {
    const { error } = await profile(who, clinic, "Intruso Total", "x", "000-00");
    check(`${label} NO tiene datos profesionales en esta clínica`, error !== null, "no falló");
  }
  const shortName = await profile(medico, cid, "Dr", "x", "123-45");
  const shortExeq = await profile(medico, cid, "Dr. Juan Pérez", "x", "1");
  const longTitle = await profile(medico, cid, "Dr. Juan Pérez", "x".repeat(121), "123-45");
  check("se rechazan nombre, exequátur o especialidad inválidos", shortName.error !== null && shortExeq.error !== null && longTitle.error !== null, `${shortName.error?.message} | ${shortExeq.error?.message} | ${longTitle.error?.message}`);
  const directMember = await medico.client.from("clinic_members").update({ exequatur: "HACK" }).eq("user_id", medico.userId);
  const { data: after } = await admin.from("clinic_members").select("exequatur").eq("user_id", medico.userId).eq("clinic_id", cid).single();
  check("no se puede editar el exequátur por fuera de la función", after?.exequatur === "123-45" && (directMember.error !== null || after.exequatur !== "HACK"), directMember.error?.message ?? "");

  console.log("\nTimbrado de la clínica:");
  const lhOk = await owner.client.rpc("save_clinic_letterhead", { p_clinic_id: cid, p_name: "Clínica Prueba", p_address: "Calle 1, Santo Domingo", p_phones: "809-555-0100", p_email: "info@prueba.example", p_rnc: "1-33-00000-0" });
  check("el admin guarda el timbrado", lhOk.error === null, lhOk.error?.message ?? "");
  for (const [label, who] of [["un médico", medico], ["recepción", recepcion], ["el admin de otra clínica", ownerB]] as const) {
    const { error } = await who.client.rpc("save_clinic_letterhead", { p_clinic_id: cid, p_name: "Hackeado" });
    check(`${label} NO cambia el timbrado`, error !== null, "no falló");
  }
  const lhBad = [
    ["nombre vacío", { p_name: " " }],
    ["correo inválido", { p_name: "X", p_email: "no-es-correo" }],
    ["dirección demasiado larga", { p_name: "X", p_address: "x".repeat(301) }],
  ] as const;
  for (const [label, args] of lhBad) {
    const { error } = await owner.client.rpc("save_clinic_letterhead", { p_clinic_id: cid, ...args });
    check(`se rechaza: ${label}`, error !== null, "no falló");
  }
  for (const [label, who, expected] of [["el admin", owner, 1], ["un médico", medico, 1], ["recepción", recepcion, 0], ["otra clínica", ownerB, 0]] as const) {
    const { data } = await who.client.from("clinic_letterhead").select("clinic_id").eq("clinic_id", cid);
    check(`${label} ${expected ? "lee" : "NO lee"} el timbrado`, (data ?? []).length === expected, `${data?.length}`);
  }
  const lhDirect = await owner.client.from("clinic_letterhead").update({ name: "directo" }).eq("clinic_id", cid);
  const lhInsert = await owner.client.from("clinic_letterhead").insert({ clinic_id: cid, name: "otro" });
  const { data: lhNow } = await admin.from("clinic_letterhead").select("name").eq("clinic_id", cid).single();
  check("el timbrado no se escribe directo", lhNow?.name === "Clínica Prueba" && lhInsert.error !== null && (lhDirect.error !== null || lhNow.name !== "directo"), `${lhDirect.error?.message} | ${lhInsert.error?.message}`);

  console.log("\nEmitir recetas:");
  const r1 = await issue(medico, { p_notes: "Reposo e hidratación", p_encounter_id: enc!.id });
  check("un médico emite una receta desde una consulta", r1.error === null && typeof r1.data === "string", r1.error?.message ?? "");
  const rx1 = r1.data as string;
  const r2 = await issue(owner, { p_items: [ITEM, { medication: "Paracetamol 500 mg", dose: "1 tableta" }] });
  check("el admin (con sus datos completos) también emite", r2.error === null, r2.error?.message ?? "");
  const rx2 = r2.data as string;
  const nums = await admin.from("prescriptions").select("id, number").in("id", [rx1, rx2]).order("number");
  check("el número es consecutivo por clínica (1, 2)", (nums.data ?? []).map((r) => r.number).join(",") === "1,2", JSON.stringify(nums.data));
  check("sin datos profesionales completos otro médico NO emite", (await issue(medico2)).error?.hint === "profile_incomplete", "");
  for (const [label, who] of [["recepción", recepcion], ["admin de otra clínica", ownerB]] as const) {
    const { error } = await issue(who);
    check(`${label} NO emite recetas`, error !== null, "no falló");
  }
  const noRecordPatient = await mkPatient();
  const noRec = await issue(medico, {}, noRecordPatient.id);
  check("sin expediente abierto no se emiten recetas", noRec.error !== null && noRec.error.message.includes("expediente"), noRec.error?.message ?? "no falló");
  const bads: [string, Record<string, unknown>, string][] = [
    ["lista vacía", { p_items: [] }, "entre 1 y 30"],
    ["más de 30 medicamentos", { p_items: Array.from({ length: 31 }, (_, i) => ({ medication: `M${i}` })) }, "entre 1 y 30"],
    ["no es una lista", { p_items: { medication: "x" } }, "entre 1 y 30"],
    ["renglón sin nombre", { p_items: [{ dose: "1" }] }, "nombre"],
    ["nombre en blanco", { p_items: [{ medication: "   " }] }, "nombre"],
    ["campo desconocido", { p_items: [{ medication: "A", hack: "x" }] }, "desconocido"],
    ["dosis demasiado larga", { p_items: [{ medication: "A", dose: "x".repeat(201) }] }, "largo"],
    ["indicaciones del renglón demasiado largas", { p_items: [{ medication: "A", instructions: "x".repeat(501) }] }, "largas"],
    ["indicaciones generales demasiado largas", { p_notes: "x".repeat(2001) }, "largas"],
    ["consulta de otro paciente", { p_encounter_id: otherEnc!.id }, "no corresponde"],
  ];
  for (const [label, extra, word] of bads) {
    const { error } = await issue(medico, extra);
    check(`se rechaza: ${label}`, error !== null && error.message.toLowerCase().includes(word.toLowerCase()), error?.message ?? "no falló");
  }
  const sensIssue = await issue(medico, { p_encounter_id: sensEnc!.id });
  check("el médico que atendió la consulta de Salud Mental la vincula a una receta", sensIssue.error === null, sensIssue.error?.message ?? "");
  const sensRx = sensIssue.data as string;
  const adminSens = await issue(owner, { p_encounter_id: sensEnc!.id });
  check("el admin sin acceso a esa consulta sensible NO puede vincular una receta", adminSens.error !== null, "no falló");
  // Otra clínica: su propia numeración empieza en 1.
  const pB = await admin.from("patients").insert({ clinic_id: cidB, first_name: "Paciente", last_name: "ClinicaB", date_of_birth: "1980-01-01", sex: "masculino" }).select("id").single();
  await ownerB.client.rpc("open_patient_record", { p_patient_id: pB.data!.id, p_history: {} });
  await profile(ownerB, cidB, "Dr. Otro Medico", "", "555-55");
  const rB = await issue(ownerB, {}, pB.data!.id);
  const { data: rBrow } = await admin.from("prescriptions").select("number").eq("id", rB.data as string).single();
  check("la numeración de otra clínica es independiente (empieza en 1)", rB.error === null && rBrow?.number === 1, `${rB.error?.message ?? ""} ${rBrow?.number}`);
  const cross = await issue(ownerB, {}, p.id);
  check("el admin de otra clínica NO emite recetas para pacientes de esta", cross.error !== null, "no falló");

  console.log("\nQuién lee y quién escribe:");
  for (const [label, who, expected] of [["el médico", medico, 3], ["el admin", owner, 2], ["recepción", recepcion, 0], ["otra clínica", ownerB, 0]] as const) {
    const { data } = await who.client.from("prescriptions").select("id").eq("patient_id", p.id);
    check(`${label} ${expected ? "lee" : "NO lee"} las recetas del paciente (${expected})`, (data ?? []).length === expected, `${data?.length}`);
  }
  for (const [label, who, expected] of [["el médico", medico, 3], ["recepción", recepcion, 0], ["otra clínica", ownerB, 0]] as const) {
    const { data } = await who.client.from("prescription_items").select("id").in("prescription_id", [rx1, rx2, sensRx]);
    check(`${label} ${expected ? "lee" : "NO lee"} los renglones`, (data ?? []).length === (expected ? 1 + 2 + 1 : 0), `${data?.length}`);
  }
  const wIns = await owner.client.from("prescriptions").insert({ clinic_id: cid, patient_id: p.id, number: 99, provider_name: "x", provider_exequatur: "x", letterhead: {}, patient_snapshot: {} });
  const wUpd = await owner.client.from("prescriptions").update({ notes: "directo" }).eq("id", rx1);
  const wDel = await owner.client.from("prescriptions").delete().eq("id", rx1);
  const wItem = await owner.client.from("prescription_items").insert({ clinic_id: cid, prescription_id: rx1, position: 9, medication: "directo" });
  check("ni el admin escribe ni borra directo", wIns.error !== null && wUpd.error !== null && wDel.error !== null && wItem.error !== null, `${wIns.error?.message} | ${wUpd.error?.message} | ${wDel.error?.message} | ${wItem.error?.message}`);
  const { data: untouched } = await admin.from("prescriptions").select("notes, status").eq("id", rx1).single();
  check("la receta sigue intacta", untouched?.notes === "Reposo e hidratación" && untouched.status === "emitida", JSON.stringify(untouched));

  console.log("\nInmutables y copia (snapshot):");
  const sUpd = await admin.from("prescriptions").update({ notes: "cambiada" }).eq("id", rx1);
  const sUpdName = await admin.from("prescriptions").update({ provider_name: "Otro" }).eq("id", rx1);
  const sDel = await admin.from("prescriptions").delete().eq("id", rx1);
  const iUpd = await admin.from("prescription_items").update({ medication: "cambiado" }).eq("prescription_id", rx1);
  const iDel = await admin.from("prescription_items").delete().eq("prescription_id", rx1);
  check("ni service_role edita ni borra una receta ni sus renglones", sUpd.error !== null && sUpdName.error !== null && sDel.error !== null && iUpd.error !== null && iDel.error !== null, `${sUpd.error?.message} | ${sDel.error?.message} | ${iUpd.error?.message} | ${iDel.error?.message}`);
  await profile(medico, cid, "Dr. Juan P. Nuevo", "Cardiología", "777-77");
  await owner.client.rpc("save_clinic_letterhead", { p_clinic_id: cid, p_name: "Clínica Renombrada", p_address: "Otra calle" });
  const { data: snap } = await admin.from("prescriptions").select("provider_name, provider_title, provider_exequatur, letterhead, patient_snapshot, provider_id").eq("id", rx1).single();
  const lhSnap = snap?.letterhead as { name?: string; address?: string };
  const ptSnap = snap?.patient_snapshot as { name?: string; date_of_birth?: string; record_number?: string };
  check("la receta conserva el médico y el timbrado con que se emitió, aunque luego cambien", snap?.provider_name === "Dr. Juan Pérez" && snap.provider_title === "Medicina Interna" && snap.provider_exequatur === "123-45" && lhSnap.name === "Clínica Prueba" && lhSnap.address === "Calle 1, Santo Domingo" && snap.provider_id === medico.userId, JSON.stringify(snap));
  check("y guarda nombre, fecha de nacimiento y código del paciente", ptSnap.name === `${p.first_name} ${p.last_name}` && ptSnap.date_of_birth === "1990-06-15" && !!ptSnap.record_number, JSON.stringify(ptSnap));
  const { data: items1 } = await admin.from("prescription_items").select("position, medication, dose").eq("prescription_id", rx2).order("position");
  check("los renglones conservan su orden", (items1 ?? []).map((i) => i.medication).join("|") === "Losartán 50 mg tabletas|Paracetamol 500 mg", JSON.stringify(items1));

  console.log("\nImpresiones (original y copia):");
  const pr1 = await medico.client.rpc("log_prescription_print", { p_prescription_id: rx1, p_format: "a6" });
  const pr2 = await owner.client.rpc("log_prescription_print", { p_prescription_id: rx1, p_format: "a4" });
  const pr3 = await medico.client.rpc("log_prescription_print", { p_prescription_id: rx1, p_format: "a6" });
  check("la primera impresión es el original (no es copia) y las siguientes son COPIA", pr1.error === null && pr1.data === false && pr2.data === true && pr3.data === true, `${pr1.data} ${pr2.data} ${pr3.data} ${pr1.error?.message ?? ""}`);
  const badFmt = await medico.client.rpc("log_prescription_print", { p_prescription_id: rx2, p_format: "a5" });
  check("un formato inválido se rechaza", badFmt.error !== null, "no falló");
  for (const [label, who] of [["recepción", recepcion], ["otra clínica", ownerB]] as const) {
    const { error } = await who.client.rpc("log_prescription_print", { p_prescription_id: rx2, p_format: "a6" });
    check(`${label} NO imprime recetas`, error !== null, "no falló");
  }
  const adminSensPrint = await owner.client.rpc("log_prescription_print", { p_prescription_id: sensRx, p_format: "a6" });
  check("el admin sin acceso a la consulta sensible NO imprime esa receta", adminSensPrint.error !== null, "no falló");
  const { data: printsSeen } = await medico.client.from("prescription_prints").select("is_copy").eq("prescription_id", rx1).order("printed_at");
  const { data: printsRec } = await recepcion.client.from("prescription_prints").select("id").eq("prescription_id", rx1);
  check("el historial de impresiones lo lee el médico (original, copia, copia) y recepción no", (printsSeen ?? []).map((x) => x.is_copy).join(",") === "false,true,true" && (printsRec ?? []).length === 0, JSON.stringify([printsSeen, printsRec]));
  const pDirect = await owner.client.from("prescription_prints").insert({ clinic_id: cid, patient_id: p.id, prescription_id: rx1, is_copy: false, format: "a6" });
  const pDel = await admin.from("prescription_prints").delete().eq("prescription_id", rx1);
  check("las impresiones no se escriben ni se borran directo (ni service_role)", pDirect.error !== null && pDel.error !== null, `${pDirect.error?.message} | ${pDel.error?.message}`);

  console.log("\nAnular:");
  const vShort = await medico.client.rpc("void_prescription", { p_prescription_id: rx1, p_reason: "x" });
  check("anular exige motivo", vShort.error !== null && vShort.error.message.includes("motivo"), vShort.error?.message ?? "no falló");
  const vOther = await medico2.client.rpc("void_prescription", { p_prescription_id: rx1, p_reason: "No es mía" });
  check("otro médico que no la emitió NO la anula", vOther.error !== null, "no falló");
  for (const [label, who] of [["recepción", recepcion], ["otra clínica", ownerB]] as const) {
    const { error } = await who.client.rpc("void_prescription", { p_prescription_id: rx1, p_reason: "Intento ajeno" });
    check(`${label} NO anula`, error !== null, "no falló");
  }
  const vOwn = await medico.client.rpc("void_prescription", { p_prescription_id: rx1, p_reason: "Dosis equivocada" });
  const { data: voided } = await admin.from("prescriptions").select("status, void_reason, voided_by, voided_at, notes").eq("id", rx1).single();
  check("quien la emitió la anula con motivo: queda «anulada», con quién y cuándo, y su contenido intacto", vOwn.error === null && voided?.status === "anulada" && voided.void_reason === "Dosis equivocada" && voided.voided_by === medico.userId && !!voided.voided_at && voided.notes === "Reposo e hidratación", `${vOwn.error?.message ?? ""} ${JSON.stringify(voided)}`);
  const vTwice = await owner.client.rpc("void_prescription", { p_prescription_id: rx1, p_reason: "Otra vez" });
  check("no se anula dos veces", vTwice.error !== null, "no falló");
  const vPrint = await medico.client.rpc("log_prescription_print", { p_prescription_id: rx1, p_format: "a6" });
  check("una receta anulada no se imprime", vPrint.error !== null, "no falló");
  const revive = await admin.from("prescriptions").update({ status: "emitida", void_reason: null, voided_at: null, voided_by: null }).eq("id", rx1);
  check("una receta anulada no se reactiva (ni service_role)", revive.error !== null, "no falló");
  const vAdmin = await owner.client.rpc("void_prescription", { p_prescription_id: rx2, p_reason: "Anulada por el administrador" });
  check("el admin anula la receta de un médico (con motivo)", vAdmin.error === null, vAdmin.error?.message ?? "");
  const vSens = await owner.client.rpc("void_prescription", { p_prescription_id: sensRx, p_reason: "Sin acceso" });
  check("el admin sin acceso a la consulta sensible NO anula esa receta", vSens.error !== null, "no falló");
  const reissue = await issue(medico, { p_items: [{ ...ITEM, dose: "1/2 tableta" }] });
  const { data: reNum } = await admin.from("prescriptions").select("number").eq("id", reissue.data as string).single();
  check("tras anular se emite otra, con un número nuevo (el número anulado no se reutiliza)", reissue.error === null && (reNum?.number ?? 0) >= 4, `${reissue.error?.message ?? ""} ${reNum?.number}`);

  console.log("\nLa receta de una consulta sensible:");
  for (const [label, who, expected] of [["el médico que la atendió", medico, 1], ["el admin sin acceso", owner, 0], ["recepción", recepcion, 0]] as const) {
    const { data } = await who.client.from("prescriptions").select("id").eq("id", sensRx);
    check(`${label} ${expected ? "ve" : "NO ve"} la receta de Salud Mental`, (data ?? []).length === expected, `${data?.length}`);
  }

  console.log("\nStorage: logo del timbrado:");
  const logoPath = `${cid}/${randomUUID()}-logo.png`;
  const upload = (who: TestUser, path: string, body: Buffer | Uint8Array, type: string, upsert = false) => who.client.storage.from(BUCKET).upload(path, body, { contentType: type, upsert });
  const up1 = await upload(owner, logoPath, PNG, "image/png");
  if (!up1.error) uploadedPaths.push(logoPath);
  check("el admin sube un logo PNG a la carpeta de su clínica", up1.error === null, up1.error?.message ?? "");
  for (const [label, who] of [["un médico", medico], ["recepción", recepcion], ["el admin de otra clínica", ownerB]] as const) {
    const u = await upload(who, `${cid}/${randomUUID()}-intruso.png`, PNG, "image/png");
    check(`${label} NO sube logos a esta clínica`, u.error !== null, "subió");
  }
  const txt = await upload(owner, `${cid}/${randomUUID()}-nota.txt`, Buffer.from("hola"), "text/plain");
  check("un tipo no permitido (texto) lo rechaza Storage", txt.error !== null, "subió");
  const big = await upload(owner, `${cid}/${randomUUID()}-enorme.png`, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1024)]), "image/png");
  check("un logo de más de 2 MB lo rechaza Storage", big.error !== null, "subió");
  const deep = await upload(owner, `${cid}/sub/${randomUUID()}-x.png`, PNG, "image/png");
  const shallow = await upload(owner, `${randomUUID()}-x.png`, PNG, "image/png");
  const otherClinicPath = await upload(owner, `${cidB}/${randomUUID()}-x.png`, PNG, "image/png");
  check("rutas con otros niveles o de otra clínica se rechazan", deep.error !== null && shallow.error !== null && otherClinicPath.error !== null, `${deep.error?.message} | ${shallow.error?.message} | ${otherClinicPath.error?.message}`);
  const replace = await upload(owner, logoPath, Buffer.concat([PNG, Buffer.from("otro")]), "image/png", true);
  check("nadie reemplaza un logo existente (sin política de UPDATE)", replace.error !== null, "reemplazó");
  const rm = await owner.client.storage.from(BUCKET).remove([logoPath]);
  const still = await admin.storage.from(BUCKET).download(logoPath);
  check("nadie borra un logo desde la app (sin política de DELETE)", still.error === null && (rm.data ?? []).length === 0, `${rm.error?.message ?? ""} ${(rm.data ?? []).length}`);
  const signed = await medico.client.storage.from(BUCKET).createSignedUrl(logoPath, 60);
  const dl = signed.data?.signedUrl ? await fetch(signed.data.signedUrl) : null;
  const dlBytes = dl ? Buffer.from(await dl.arrayBuffer()) : Buffer.alloc(0);
  check("un médico descarga el logo con una URL firmada y es idéntico", dl?.status === 200 && dlBytes.equals(PNG), `${dl?.status} ${dlBytes.length}`);
  for (const [label, who] of [["recepción", recepcion], ["otra clínica", ownerB]] as const) {
    const sg = await who.client.storage.from(BUCKET).createSignedUrl(logoPath, 60);
    check(`${label} NO obtiene URL firmada del logo`, !sg.data?.signedUrl, "obtuvo URL");
  }
  const pub = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${logoPath}`);
  check("el bucket es PRIVADO: no hay URL pública", pub.status >= 400, `${pub.status}`);
  const ghost = await owner.client.rpc("save_clinic_letterhead", { p_clinic_id: cid, p_name: "Clínica Renombrada", p_logo_path: `${cid}/${randomUUID()}-fantasma.png` });
  check("asignar un logo que NO existe se rechaza", ghost.error !== null, "no falló");
  const foreign = await owner.client.rpc("save_clinic_letterhead", { p_clinic_id: cid, p_name: "Clínica Renombrada", p_logo_path: `${cidB}/otro.png` });
  check("asignar un logo de otra clínica se rechaza", foreign.error !== null, "no falló");
  const setLogo = await owner.client.rpc("save_clinic_letterhead", { p_clinic_id: cid, p_name: "Clínica Renombrada", p_logo_path: logoPath });
  const { data: lhLogo } = await admin.from("clinic_letterhead").select("logo_path").eq("clinic_id", cid).single();
  check("el admin asigna el logo subido", setLogo.error === null && lhLogo?.logo_path === logoPath, setLogo.error?.message ?? "");
  const withLogo = await issue(medico);
  const { data: lhRx } = await admin.from("prescriptions").select("letterhead").eq("id", withLogo.data as string).single();
  check("una receta nueva guarda la ruta del logo en su copia del timbrado", (lhRx?.letterhead as { logo_path?: string })?.logo_path === logoPath, JSON.stringify(lhRx));
  const rmLogo = await owner.client.rpc("save_clinic_letterhead", { p_clinic_id: cid, p_name: "Clínica Renombrada", p_remove_logo: true });
  const { data: lhNone } = await admin.from("clinic_letterhead").select("logo_path").eq("clinic_id", cid).single();
  const { data: lhRxAfter } = await admin.from("prescriptions").select("letterhead").eq("id", withLogo.data as string).single();
  check("quitar el logo no cambia las recetas ya emitidas", rmLogo.error === null && lhNone?.logo_path === null && (lhRxAfter?.letterhead as { logo_path?: string })?.logo_path === logoPath, `${rmLogo.error?.message ?? ""}`);

  console.log("\nEliminar pacientes:");
  const e1 = await mkPatient();
  await openRecord(e1.id);
  const empty = (await owner.client.rpc("patient_deletion_status", { p_patient_id: e1.id })).data as { empty_blockers: string[] };
  const eRx = await issue(medico, {}, e1.id);
  const withRx = (await owner.client.rpc("patient_deletion_status", { p_patient_id: e1.id })).data as { empty_blockers: string[] };
  check("un expediente sin recetas se puede eliminar; con una receta, no (cuenta como actividad)", empty.empty_blockers.length === 0 && eRx.error === null && withRx.empty_blockers.some((b) => b.includes("recetas")), JSON.stringify([empty, withRx]));
  const t = await mkPatient({ is_test: true });
  await openRecord(t.id);
  const tRx = await issue(medico, {}, t.id);
  await medico.client.rpc("log_prescription_print", { p_prescription_id: tRx.data as string, p_format: "a6" });
  const del = await owner.client.rpc("delete_test_patient", { p_patient_id: t.id });
  const left = [
    ((await admin.from("prescriptions").select("id").eq("patient_id", t.id)).data ?? []).length,
    ((await admin.from("prescription_items").select("id").eq("prescription_id", tRx.data as string)).data ?? []).length,
    ((await admin.from("prescription_prints").select("id").eq("patient_id", t.id)).data ?? []).length,
  ];
  check("un paciente de prueba se elimina con sus recetas, renglones e impresiones", del.error === null && left.every((n) => n === 0), `${del.error?.message ?? ""} ${left}`);

  console.log("\nModo solo lectura:");
  const old = new Date();
  old.setUTCDate(old.getUTCDate() - 31);
  const { error: subErr } = await admin.from("clinic_subscriptions").update({ trial_ends_at: old.toISOString().slice(0, 10), next_payment_due_on: null }).eq("clinic_id", cid);
  if (subErr) throw new Error(`No se pudo vencer la suscripción: ${subErr.message}`);
  const ro = "modo solo lectura";
  const roIssue = await issue(medico);
  check("no se puede emitir una receta", roIssue.error !== null && roIssue.error.message.includes(ro), roIssue.error?.message ?? "no falló");
  const roVoid = await medico.client.rpc("void_prescription", { p_prescription_id: withLogo.data as string, p_reason: "Prueba de solo lectura" });
  check("ni anularla", roVoid.error !== null && roVoid.error.message.includes(ro), roVoid.error?.message ?? "no falló");
  const roPrint = await medico.client.rpc("log_prescription_print", { p_prescription_id: withLogo.data as string, p_format: "a6" });
  check("ni registrar una impresión", roPrint.error !== null && roPrint.error.message.includes(ro), roPrint.error?.message ?? "no falló");
  const roLh = await owner.client.rpc("save_clinic_letterhead", { p_clinic_id: cid, p_name: "Nuevo nombre" });
  check("ni cambiar el timbrado", roLh.error !== null && roLh.error.message.includes(ro), roLh.error?.message ?? "no falló");
  const roUp = await upload(owner, `${cid}/${randomUUID()}-tarde.png`, PNG, "image/png");
  check("ni subir un logo", roUp.error !== null, "subió");
  const roRead = await medico.client.from("prescriptions").select("id").eq("id", withLogo.data as string);
  const roSigned = await medico.client.storage.from(BUCKET).createSignedUrl(logoPath, 60);
  check("(control) leer recetas y descargar el logo sigue funcionando", (roRead.data ?? []).length === 1 && !!roSigned.data?.signedUrl, roSigned.error?.message ?? "");
}

main()
  .catch((err) => {
    console.error("Error inesperado:", err);
    failures.push({ name: "error inesperado", detail: String(err?.message ?? err) });
  })
  .finally(async () => {
    console.log("\nLimpiando datos sintéticos y archivos...");
    await cleanup();
    console.log("");
    if (failures.length > 0) {
      console.error(`FALLÓ: ${failures.length} verificación(es) no pasaron.`);
      process.exit(1);
    }
    console.log("OK: recetas, timbrado, impresiones y logo verificados.");
  });
