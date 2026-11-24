/**
 * Prueba de la ficha de identificación del paciente
 * (supabase/migrations/20261128100000_patient_identity.sql).
 *
 * Qué verifica:
 *   1. Lógica pura: edad calculada (días, meses, años; hora de República Dominicana, no UTC), lectura y
 *      validación del formulario (listas cerradas, informante, longitudes, religión), importación (alias de
 *      encabezados, listas que no coinciden = error de fila, la columna Religión se rechaza) y que la receta use
 *      el mismo cálculo de edad.
 *   2. COLUMNAS DE patients: recepción las llena al crear; los CHECK de la base rechazan valores fuera de lista,
 *      un informante sin nombre (o con nombre siendo el mismo paciente), textos vacíos o de más de 200
 *      caracteres; los pacientes existentes quedan con nulos.
 *   3. EDICIÓN: admin y médicos editan y queda una fila de historial por campo; recepción NO modifica nada
 *      (sigue pudiendo cambiar teléfono y correo por update_patient_contact); otra clínica no lee ni edita.
 *   4. RELIGIÓN (dato sensible): solo admin y médicos la leen y la guardan (save_patient_religion); recepción y
 *      otra clínica ven 0 filas y no pueden guardarla; «otra» exige texto; sin cambio no hay historial; nadie
 *      escribe directo (ni service_role edita el historial); un paciente anulado no admite cambios; se va con el
 *      paciente de prueba que se elimina.
 *   5. Modo solo lectura: bloquea crear y editar la ficha y guardar la religión.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { ageLabel } from "../src/lib/domain/age";
import { patientAgeLabel } from "../src/lib/domain/prescriptions";
import {
  DR_PROVINCES,
  EDUCATION_LEVELS,
  INFORMANT_TYPES,
  MARITAL_STATUSES,
  RELIGIONS,
  parseIdentityFromForm,
  parseReligionFromForm,
  religionDisplay,
} from "../src/lib/domain/patient-identity";
import { generatePatientImportTemplateCsv, parsePatientImportFile, validatePatientRows } from "../src/lib/bulk-import/patients";

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
  const email = `idf-${label}-${randomUUID()}@example.invalid`;
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
    clinic_name: `[TEST] Ficha ${label} ${randomUUID().slice(0, 8)}`,
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

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

async function main() {
  console.log("Edad calculada:");
  const at = (iso: string) => new Date(iso);
  check("recién nacidos y menores de un mes: en días", ageLabel("2026-11-10", at("2026-11-22T15:00:00Z")) === "12 días" && ageLabel("2026-11-21", at("2026-11-22T15:00:00Z")) === "1 día" && ageLabel("2026-11-22", at("2026-11-22T15:00:00Z")) === "0 días", `${ageLabel("2026-11-10", at("2026-11-22T15:00:00Z"))}`);
  check("menores de 2 años: en meses (con singular)", ageLabel("2026-05-10", at("2026-11-18T15:00:00Z")) === "6 meses" && ageLabel("2026-10-10", at("2026-11-18T15:00:00Z")) === "1 mes" && ageLabel("2024-12-20", at("2026-11-18T15:00:00Z")) === "22 meses", `${ageLabel("2024-12-20", at("2026-11-18T15:00:00Z"))}`);
  check("desde los 2 años: en años", ageLabel("2024-11-18", at("2026-11-18T15:00:00Z")) === "2 años" && ageLabel("1990-06-15", at("2026-11-18T15:00:00Z")) === "36 años" && ageLabel("1940-01-01", at("2026-11-18T15:00:00Z")) === "86 años", `${ageLabel("1990-06-15", at("2026-11-18T15:00:00Z"))}`);
  check("cumpleaños: se usa el día de República Dominicana, no el de UTC", ageLabel("1990-11-19", at("2026-11-19T02:00:00Z")) === "35 años" && ageLabel("1990-11-19", at("2026-11-19T05:00:00Z")) === "36 años", `${ageLabel("1990-11-19", at("2026-11-19T02:00:00Z"))} / ${ageLabel("1990-11-19", at("2026-11-19T05:00:00Z"))}`);
  check("fin de mes: 31 de enero a 1 de marzo = 1 mes", ageLabel("2026-01-31", at("2026-03-01T15:00:00Z")) === "1 mes", ageLabel("2026-01-31", at("2026-03-01T15:00:00Z")));
  check("fecha futura, inválida o vacía = sin edad", ageLabel("2027-01-01", at("2026-11-18T15:00:00Z")) === "" && ageLabel("2026-02-30") === "" && ageLabel("") === "" && ageLabel(null) === "", "");
  check("la receta usa el mismo cálculo", patientAgeLabel("1990-06-15", "2026-11-18T12:00:00Z") === ageLabel("1990-06-15", "2026-11-18T12:00:00Z") && patientAgeLabel("2026-11-10", "2026-11-22T15:00:00Z") === "12 días", patientAgeLabel("2026-11-10", "2026-11-22T15:00:00Z"));

  console.log("\nFormulario (lógica pura):");
  const okForm = parseIdentityFromForm(form({ education_level: "tecnico", marital_status: "union_libre", residence: "  Av. 27 de Febrero   #10, Santiago ", place_of_origin: "Moca", occupation: "Maestra", informant_type: "madre_padre", informant_name: " Ana Pérez " }));
  check("lee la ficha, recorta y compacta los espacios", !okForm.error && okForm.values.residence === "Av. 27 de Febrero #10, Santiago" && okForm.values.informant_name === "Ana Pérez" && okForm.values.education_level === "tecnico", JSON.stringify(okForm));
  const def = parseIdentityFromForm(form({}));
  check("sin nada: el informante por defecto es el mismo paciente y lo demás queda vacío", !def.error && def.values.informant_type === "paciente" && def.values.informant_name === null && def.values.occupation === null && def.values.education_level === null, JSON.stringify(def));
  check("un nombre de informante no se guarda si el informante es el mismo paciente", parseIdentityFromForm(form({ informant_type: "paciente", informant_name: "Alguien" })).values.informant_name === null, "");
  const bad = (entries: Record<string, string>) => parseIdentityFromForm(form(entries)).error !== undefined;
  check("rechaza: escolaridad o estado civil fuera de lista, informante inventado, informante sin nombre, texto de más de 200", bad({ education_level: "doctorado" }) && bad({ marital_status: "complicado" }) && bad({ informant_type: "vecino" }) && bad({ informant_type: "conyuge", informant_name: "  " }) && bad({ occupation: "x".repeat(201) }), "");
  check("religión: «otra» exige texto; las demás lo descartan; fuera de lista se rechaza", parseReligionFromForm(form({ religion: "otra" })).error !== undefined && parseReligionFromForm(form({ religion: "otra", religion_other: "Bahá'í" })).value?.religion_other === "Bahá'í" && parseReligionFromForm(form({ religion: "catolica", religion_other: "x" })).value?.religion_other === null && parseReligionFromForm(form({ religion: "secta" })).error !== undefined && parseReligionFromForm(form({})).value === null, "");
  check("se muestra «Otra: texto»", religionDisplay({ religion: "otra", religion_other: "Bahá'í" }) === "Otra: Bahá'í" && religionDisplay({ religion: "catolica", religion_other: null }) === "Católica" && religionDisplay(null) === "", religionDisplay({ religion: "otra", religion_other: "Bahá'í" }));
  check("hay 32 provincias sin repetir", DR_PROVINCES.length === 32 && new Set(DR_PROVINCES).size === 32, `${DR_PROVINCES.length}`);

  console.log("\nImportación de pacientes (lógica pura):");
  const header = "Nombre,Apellido,Fecha de nacimiento,Sexo,Escolaridad,Estado civil,Residencia,Procedencia,Ocupación,Informante,Nombre del informante";
  const csv = (rows: string[]) => Buffer.from([header, ...rows].join("\n"), "utf8");
  const parsed = await parsePatientImportFile(csv(["Ana,Pérez,1985-04-12,femenino,Secundaria completa,Soltero/a,Santiago,Moca,Maestra,Madre/padre,Rosa Pérez", "Luis,Gómez,2020-01-05,masculino,,,,,,,"]), "p.csv");
  check("el archivo con las columnas nuevas se lee (sinónimos en español)", !parsed.parseError && parsed.rows.length === 2 && parsed.rows[0].education_level === "Secundaria completa" && parsed.rows[0].informant_name === "Rosa Pérez", JSON.stringify(parsed));
  const validated = validatePatientRows(parsed.rows, new Set());
  check("los textos de las listas se convierten a su clave (con o sin acentos y mayúsculas)", validated[0].errors.length === 0 && validated[0].data?.education_level === "secundaria_completa" && validated[0].data?.marital_status === "soltero" && validated[0].data?.informant_type === "madre_padre" && validated[0].data?.occupation === "Maestra", JSON.stringify(validated[0]));
  check("las columnas vacías quedan en null (no se adivina)", validated[1].errors.length === 0 && validated[1].data?.education_level === null && validated[1].data?.informant_type === null && validated[1].data?.informant_name === null, JSON.stringify(validated[1]));
  const bad2 = validatePatientRows((await parsePatientImportFile(csv(["Ana,Pérez,1985-04-12,femenino,Doctorado,Complicado,,,,Vecino,", "Ana,Pérez,1985-04-12,femenino,,,,,,Hijo/a,", "Ana,Pérez,1985-04-12,femenino,,,,,,El mismo paciente,Alguien", "Ana,Pérez,1985-04-12,femenino,,,,,,,Alguien"]), "p.csv")).rows, new Set());
  check("fuera de lista, informante sin nombre o nombre sin informante = error de fila, con la lista de opciones", bad2.every((r) => r.errors.length > 0 && r.data === null) && bad2[0].errors.some((e) => e.includes("Escolaridad")) && bad2[0].errors.some((e) => e.includes("Estado civil")) && bad2[0].errors.some((e) => e.includes("Informante")) && bad2[1].errors.some((e) => e.includes("obligatorio")), JSON.stringify(bad2.map((r) => r.errors)));
  const withReligion = await parsePatientImportFile(Buffer.from(`${header},Religión\nAna,Pérez,1985-04-12,femenino,,,,,,,,Católica`, "utf8"), "p.csv");
  check("la columna Religión NO se importa (dato sensible) y se avisa", !!withReligion.parseError && withReligion.parseError.includes("Religión"), JSON.stringify(withReligion));
  const oldFormat = await parsePatientImportFile(Buffer.from("Nombre,Apellido,Fecha de nacimiento,Sexo\nAna,Pérez,1985-04-12,femenino", "utf8"), "p.csv");
  check("un archivo con el formato anterior (sin columnas nuevas) sigue funcionando", !oldFormat.parseError && oldFormat.rows.length === 1, JSON.stringify(oldFormat));
  const tpl = generatePatientImportTemplateCsv();
  check("la plantilla trae las columnas nuevas y no la religión", ["Escolaridad", "Estado civil", "Residencia", "Procedencia", "Ocupación", "Informante", "Nombre del informante"].every((h) => tpl.includes(h)) && !tpl.includes("Religión"), tpl);

  console.log("\nAprovisionando clínicas y usuarios sintéticos...");
  const owner = await createUser("owner");
  const medico = await createUser("medico");
  const recepcion = await createUser("recepcion");
  const ownerB = await createUser("ownerB");
  const cid = await createClinic(owner, "A");
  await createClinic(ownerB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: recepcion.userId, role: "recepcion" });

  const base = { clinic_id: cid, first_name: "Paciente", date_of_birth: "1990-06-15", sex: "femenino" };
  const insert = (who: TestUser, extra: Record<string, unknown>) =>
    who.client.from("patients").insert({ ...base, last_name: `Ficha-${randomUUID().slice(0, 6)}`, ...extra }).select("*").single();
  const full = await insert(recepcion, { education_level: "tecnico", marital_status: "casado", residence: "Santiago", place_of_origin: "Moca, Espaillat", occupation: "Maestra", informant_type: "madre_padre", informant_name: "Rosa Pérez" });
  check("recepción crea un paciente con la ficha completa", full.error === null && full.data?.education_level === "tecnico" && full.data?.informant_name === "Rosa Pérez" && full.data?.occupation === "Maestra", full.error?.message ?? "");
  const p = full.data!;
  const plain = await insert(recepcion, {});
  check("un paciente sin esos datos queda con nulos (como los existentes)", plain.error === null && plain.data?.education_level === null && plain.data?.informant_type === null && plain.data?.occupation === null, plain.error?.message ?? "");
  const sameIsOk = await insert(recepcion, { informant_type: "paciente" });
  check("«el mismo paciente» sin nombre es válido", sameIsOk.error === null, sameIsOk.error?.message ?? "");

  console.log("\nLos CHECK de la base:");
  const rejects: [string, Record<string, unknown>][] = [
    ["escolaridad fuera de lista", { education_level: "doctorado" }],
    ["estado civil fuera de lista", { marital_status: "complicado" }],
    ["informante fuera de lista", { informant_type: "vecino", informant_name: "x" }],
    ["informante que no es el paciente, sin nombre", { informant_type: "conyuge" }],
    ["nombre de informante siendo el mismo paciente", { informant_type: "paciente", informant_name: "Alguien" }],
    ["nombre de informante sin tipo", { informant_name: "Alguien" }],
    ["residencia vacía", { residence: "" }],
    ["ocupación solo con espacios", { occupation: "   " }],
    ["procedencia de más de 200 caracteres", { place_of_origin: "x".repeat(201) }],
  ];
  for (const [label, extra] of rejects) {
    const r = await insert(recepcion, extra);
    check(`se rechaza: ${label}`, r.error !== null, "no falló");
  }

  console.log("\nEditar la ficha:");
  const upd = (who: TestUser, patch: Record<string, unknown>) => who.client.from("patients").update(patch).eq("id", p.id).select("id");
  const byMedico = await upd(medico, { occupation: "Directora", marital_status: "divorciado" });
  const byAdmin = await upd(owner, { residence: "Santo Domingo" });
  check("el médico y el admin editan la ficha", byMedico.error === null && (byMedico.data ?? []).length === 1 && byAdmin.error === null && (byAdmin.data ?? []).length === 1, `${byMedico.error?.message} | ${byAdmin.error?.message}`);
  const { data: log } = await admin.from("patient_change_log").select("field, old_value, new_value, changed_by").eq("patient_id", p.id).order("changed_at");
  const logOf = (field: string) => (log ?? []).find((l) => l.field === field);
  check("cada campo cambiado deja su fila de historial (antes → después y quién), sin tocar el código", logOf("occupation")?.old_value === "Maestra" && logOf("occupation")?.new_value === "Directora" && logOf("occupation")?.changed_by === medico.userId && logOf("marital_status")?.new_value === "divorciado" && logOf("residence")?.changed_by === owner.userId && !(log ?? []).some((l) => l.field === "record_number"), JSON.stringify(log));
  const byRec = await upd(recepcion, { occupation: "Hackeada" });
  const { data: afterRec } = await admin.from("patients").select("occupation").eq("id", p.id).single();
  check("recepción NO modifica la ficha (la fila no cambia)", (byRec.data ?? []).length === 0 && afterRec?.occupation === "Directora", JSON.stringify([byRec.error?.message, afterRec]));
  const contact = await recepcion.client.rpc("update_patient_contact", { p_patient_id: p.id, p_phone: "8095550101", p_phone_e164: "+18095550101", p_email: "ficha@example.invalid" });
  const { data: afterContact } = await admin.from("patients").select("phone, email, occupation").eq("id", p.id).single();
  check("recepción sigue cambiando el contacto (teléfono y correo) y nada más", contact.error === null && afterContact?.email === "ficha@example.invalid" && afterContact.occupation === "Directora", contact.error?.message ?? JSON.stringify(afterContact));
  const seenB = await ownerB.client.from("patients").select("id").eq("id", p.id);
  const updB = await upd(ownerB, { occupation: "Otra clínica" });
  check("otra clínica no ve ni edita la ficha", (seenB.data ?? []).length === 0 && (updB.data ?? []).length === 0, `${seenB.data?.length}/${updB.data?.length}`);
  const badEdit = await upd(medico, { education_level: "doctorado" });
  check("una edición con un valor fuera de lista se rechaza", badEdit.error !== null, "no falló");

  console.log("\nReligión (dato sensible):");
  const save = (who: TestUser, religion: string | null, other: string | null = null, patient: string = p.id) =>
    who.client.rpc("save_patient_religion", { p_patient_id: patient, p_religion: religion as string, p_other: other as string });
  const r1 = await save(medico, "catolica");
  check("el médico registra la religión", r1.error === null, r1.error?.message ?? "");
  const r2 = await save(owner, "otra", "Bahá'í");
  const { data: relRow } = await admin.from("patient_religion").select("*").eq("patient_id", p.id).single();
  check("el admin la cambia a «otra» con su texto (queda a su nombre)", r2.error === null && relRow?.religion === "otra" && relRow.religion_other === "Bahá'í" && relRow.updated_by === owner.userId && relRow.clinic_id === cid, r2.error?.message ?? JSON.stringify(relRow));
  const noText = await save(medico, "otra", "  ");
  const badRel = await save(medico, "secta");
  const noRel = await save(medico, null);
  check("«otra» sin texto, una religión fuera de lista o vacía se rechazan", noText.error !== null && badRel.error !== null && noRel.error !== null, `${noText.error?.message} | ${badRel.error?.message} | ${noRel.error?.message}`);
  const r3 = await save(medico, "ninguna", "texto que debe descartarse");
  const { data: relRow3 } = await admin.from("patient_religion").select("religion, religion_other").eq("patient_id", p.id).single();
  check("una opción distinta de «otra» descarta el texto", r3.error === null && relRow3?.religion === "ninguna" && relRow3.religion_other === null, JSON.stringify(relRow3));
  const { data: relLogBefore } = await admin.from("patient_religion_log").select("id").eq("patient_id", p.id);
  const same = await save(medico, "ninguna");
  const { data: relLogAfter } = await admin.from("patient_religion_log").select("id").eq("patient_id", p.id);
  check("guardar lo mismo no genera historial", same.error === null && (relLogAfter ?? []).length === (relLogBefore ?? []).length, `${relLogBefore?.length}→${relLogAfter?.length}`);
  const { data: relLog } = await admin.from("patient_religion_log").select("old_religion, old_religion_other, new_religion, new_religion_other, changed_by").eq("patient_id", p.id).order("changed_at");
  check("el historial guarda el alta y cada cambio (antes → después y quién)", (relLog ?? []).length === 3 && relLog![0].old_religion === null && relLog![0].new_religion === "catolica" && relLog![1].old_religion === "catolica" && relLog![1].new_religion === "otra" && relLog![1].new_religion_other === "Bahá'í" && relLog![2].old_religion === "otra" && relLog![2].old_religion_other === "Bahá'í" && relLog![2].new_religion === "ninguna" && relLog![1].changed_by === owner.userId, JSON.stringify(relLog));
  for (const [label, who, expected] of [["el médico", medico, 1], ["el admin", owner, 1], ["recepción", recepcion, 0], ["otra clínica", ownerB, 0]] as const) {
    const { data } = await who.client.from("patient_religion").select("patient_id").eq("patient_id", p.id);
    const { data: lg } = await who.client.from("patient_religion_log").select("id").eq("patient_id", p.id);
    check(`${label} ${expected ? "lee" : "NO lee"} la religión y su historial`, (data ?? []).length === expected && (lg ?? []).length === (expected ? 3 : 0), `${data?.length}/${lg?.length}`);
  }
  for (const [label, who] of [["recepción", recepcion], ["el admin de otra clínica", ownerB]] as const) {
    const r = await save(who, "catolica");
    check(`${label} NO guarda la religión`, r.error !== null, "no falló");
  }
  const dIns = await owner.client.from("patient_religion").insert({ patient_id: plain.data!.id, clinic_id: cid, religion: "catolica" });
  const dUpd = await owner.client.from("patient_religion").update({ religion: "ninguna" }).eq("patient_id", p.id);
  const dDel = await owner.client.from("patient_religion").delete().eq("patient_id", p.id);
  const sDel = await admin.from("patient_religion").delete().eq("patient_id", p.id);
  const lUpd = await admin.from("patient_religion_log").update({ new_religion: "x" }).eq("patient_id", p.id);
  const lDel = await admin.from("patient_religion_log").delete().eq("patient_id", p.id);
  check("nadie escribe ni borra directo (ni el admin, ni service_role el historial ni la fila)", dIns.error !== null && dUpd.error !== null && dDel.error !== null && sDel.error !== null && lUpd.error !== null && lDel.error !== null, `${dIns.error?.message} | ${dUpd.error?.message} | ${dDel.error?.message} | ${sDel.error?.message} | ${lUpd.error?.message} | ${lDel.error?.message}`);
  const forged = await admin.from("patient_religion").insert({ patient_id: plain.data!.id, clinic_id: randomUUID(), religion: "catolica" });
  check("la clínica de la religión debe ser la del paciente (también para service_role)", forged.error !== null, "no falló");

  console.log("\nPaciente anulado y eliminación:");
  const pv = (await insert(recepcion, {})).data!;
  const voidIt = await owner.client.rpc("void_patient", { p_patient_id: pv.id, p_reason: "Prueba de la ficha" });
  const saveVoided = await save(medico, "catolica", null, pv.id);
  const editVoided = await medico.client.from("patients").update({ occupation: "x" }).eq("id", pv.id).select("id");
  check("a un paciente anulado no se le cambia la religión ni la ficha", voidIt.error === null && saveVoided.error !== null && (editVoided.data ?? []).length === 0, `${voidIt.error?.message ?? ""} | ${saveVoided.error?.message ?? "no falló"}`);
  const t = (await insert(recepcion, { is_test: true, occupation: "Prueba" })).data!;
  await save(medico, "catolica", null, t.id);
  const delT = await owner.client.rpc("delete_test_patient", { p_patient_id: t.id });
  const left = [
    ((await admin.from("patient_religion").select("patient_id").eq("patient_id", t.id)).data ?? []).length,
    ((await admin.from("patient_religion_log").select("id").eq("patient_id", t.id)).data ?? []).length,
  ];
  check("un paciente de prueba se elimina con su religión y el historial de ella", delT.error === null && left.every((n) => n === 0), `${delT.error?.message ?? ""} ${left}`);

  // Las listas del código y las de la base deben ser las mismas: si alguna se desalinea, esta parte falla.
  console.log("\nLas listas del código son las que acepta la base:");
  const okLists: string[] = [];
  for (const v of EDUCATION_LEVELS) if ((await insert(recepcion, { education_level: v })).error === null) okLists.push(v);
  for (const v of MARITAL_STATUSES) if ((await insert(recepcion, { marital_status: v })).error === null) okLists.push(v);
  for (const v of INFORMANT_TYPES) if ((await insert(recepcion, { informant_type: v, informant_name: v === "paciente" ? null : "Alguien" })).error === null) okLists.push(v);
  const expectedLists = EDUCATION_LEVELS.length + MARITAL_STATUSES.length + INFORMANT_TYPES.length;
  check("la base acepta cada escolaridad, estado civil e informante del código", okLists.length === expectedLists, `${okLists.length} de ${expectedLists}`);
  const okRel: string[] = [];
  const listPatient = (await insert(recepcion, {})).data!;
  for (const v of RELIGIONS) if ((await save(medico, v, v === "otra" ? "Otra fe" : null, listPatient.id)).error === null) okRel.push(v);
  check("y cada religión del código", okRel.length === RELIGIONS.length, `${okRel.length} de ${RELIGIONS.length}`);

  console.log("\nModo solo lectura:");
  const old = new Date();
  old.setUTCDate(old.getUTCDate() - 40);
  const { error: subErr } = await admin.from("clinic_subscriptions").update({ trial_ends_at: old.toISOString().slice(0, 10), next_payment_due_on: null }).eq("clinic_id", cid);
  if (subErr) throw new Error(`No se pudo vencer la suscripción: ${subErr.message}`);
  const ro = "modo solo lectura";
  const roCreate = await insert(recepcion, { occupation: "x" });
  const roEdit = await medico.client.from("patients").update({ occupation: "Otra" }).eq("id", p.id).select("id");
  const roRel = await save(medico, "catolica");
  check("no se puede crear al paciente con la ficha", roCreate.error !== null && roCreate.error.message.includes(ro), roCreate.error?.message ?? "no falló");
  check("ni editar la ficha", roEdit.error !== null && roEdit.error.message.includes(ro), roEdit.error?.message ?? "no falló");
  check("ni guardar la religión", roRel.error !== null && roRel.error.message.includes(ro), roRel.error?.message ?? "no falló");
  const roRead = await medico.client.from("patient_religion").select("patient_id").eq("patient_id", p.id);
  check("(control) leer sigue funcionando", (roRead.data ?? []).length === 1, roRead.error?.message ?? "");
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
    console.log("OK: ficha de identificación, religión (dato sensible), importación y edad verificadas.");
  });
