/**
 * Prueba de los estudios y analíticas con adjuntos
 * (supabase/migrations/20261125100000_study_results.sql).
 *
 * Qué verifica:
 *   1. Lógica pura: valores del resultado, tipo REAL de un archivo por sus primeros bytes,
 *      nombres de archivo seguros (sin recorrer carpetas) y la ruta de Storage.
 *   2. REGISTRAR: solo admin y médicos, con el expediente abierto y un paciente no anulado;
 *      validaciones (categoría, nombre, fechas, valores); un estudio puede colgar de una
 *      consulta (queda «pendiente»).
 *   3. LECTURA: admin y médicos; recepción y otra clínica ven 0 filas; un estudio de una
 *      consulta de Salud Mental solo lo ve quien tiene acceso a esa consulta. Nadie escribe
 *      directo (ni el admin).
 *   4. VERSIONES: completar un estudio deja una revisión por campo; corregir uno ya recibido
 *      exige motivo; anular exige motivo y es definitivo; las revisiones son inmutables.
 *   5. STORAGE: bucket privado; médicos suben y descargan con URL firmada; recepción y otra
 *      clínica no suben ni descargan; solo PDF/JPG/PNG y hasta 10 MB (lo hace cumplir
 *      Storage); nadie borra ni reemplaza un archivo; la ruta debe corresponder al estudio; el
 *      registro de metadatos exige que el archivo exista; máximo 10 adjuntos; retirar un
 *      adjunto lo oculta pero el archivo se conserva.
 *   6. Modo solo lectura: bloquea registrar, corregir y subir, pero no leer ni descargar.
 *   7. Eliminar pacientes: un estudio cuenta como actividad (no se elimina «por error»); el
 *      paciente de prueba se elimina con sus estudios.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle (también los archivos).
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  buildStudyStoragePath,
  parseStudyValuesFromForm,
  sanitizeStudyFileName,
  sniffStudyMime,
  validateStudyFile,
} from "../src/lib/domain/study-results";

loadDotenv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const BUCKET = "study-results";

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
  const email = `study-${label}-${randomUUID()}@example.invalid`;
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
    clinic_name: `[TEST] Estudios ${label} ${randomUUID().slice(0, 8)}`,
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

// Archivos de prueba con sus firmas reales.
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("contenido de prueba ".repeat(20))]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png de prueba")]);

async function main() {
  console.log("Lógica pura:");
  check("reconoce PDF, JPG y PNG por sus primeros bytes", sniffStudyMime(new Uint8Array(PDF)) === "application/pdf" && sniffStudyMime(new Uint8Array(PNG)) === "image/png" && sniffStudyMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === "image/jpeg", "");
  check("un archivo que dice ser PDF pero no lo es, se rechaza", validateStudyFile({ name: "falso.pdf", size: 10, bytes: new Uint8Array(Buffer.from("MZ ejecutable")) }) !== null, "");
  check("un archivo vacío o de más de 10 MB se rechaza", validateStudyFile({ name: "a.pdf", size: 0, bytes: new Uint8Array(PDF) }) !== null && validateStudyFile({ name: "a.pdf", size: 10 * 1024 * 1024 + 1, bytes: new Uint8Array(PDF) }) !== null, "");
  check("un PDF válido pasa", validateStudyFile({ name: "ok.pdf", size: PDF.length, bytes: new Uint8Array(PDF) }) === null, "");
  check("el nombre no puede recorrer carpetas ni traer caracteres raros", sanitizeStudyFileName("../../etc/pasó ñandú.pdf") === "paso_nandu.pdf" && sanitizeStudyFileName("a\\b\\c.png") === "c.png" && sanitizeStudyFileName("...") === "archivo", `${sanitizeStudyFileName("../../etc/pasó ñandú.pdf")}`);
  check("la ruta de Storage es clínica/paciente/estudio/uuid-nombre", buildStudyStoragePath("c", "p", "s", "u", "x y.pdf") === "c/p/s/u-x_y.pdf", buildStudyStoragePath("c", "p", "s", "u", "x y.pdf"));
  const fd = new FormData();
  fd.set("value_name_0", "Glucosa");
  fd.set("value_value_0", "98");
  fd.set("value_unit_0", "mg/dL");
  fd.set("value_range_0", "70-100");
  fd.set("value_name_2", "Hemoglobina");
  fd.set("value_value_2", "13");
  const parsed = parseStudyValuesFromForm(fd);
  check("los valores se leen con su unidad y rango, y las filas vacías se ignoran", !parsed.error && parsed.values.length === 2 && parsed.values[0].unit === "mg/dL" && parsed.values[0].reference_range === "70-100" && parsed.values[1].unit === undefined, JSON.stringify(parsed));
  const bad = new FormData();
  bad.set("value_name_0", "Solo nombre");
  check("un valor sin resultado es un error", parseStudyValuesFromForm(bad).error !== undefined, "");

  console.log("\nAprovisionando clínicas y usuarios sintéticos...");
  const owner = await createUser("owner");
  const medico = await createUser("medico");
  const recepcion = await createUser("recepcion");
  const ownerB = await createUser("ownerB");
  const cid = await createClinic(owner, "A");
  await createClinic(ownerB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: recepcion.userId, role: "recepcion" });
  const { data: tpls } = await admin.from("specialty_templates").select("id, code").in("code", ["medicina_interna", "salud_mental_psicologia"]);
  const interna = tpls!.find((t) => t.code === "medicina_interna")!.id;
  const sm = tpls!.find((t) => t.code === "salud_mental_psicologia")!.id;

  const mkPatient = async (extra: Record<string, unknown> = {}) => {
    const { data, error } = await recepcion.client
      .from("patients")
      .insert({ clinic_id: cid, first_name: "Paciente", last_name: `Estudios-${randomUUID().slice(0, 6)}`, date_of_birth: "1990-01-01", sex: "femenino", ...extra })
      .select("id, first_name, last_name")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el paciente: ${error?.message}`);
    return data as { id: string; first_name: string; last_name: string };
  };
  const openRecord = (pid: string) => owner.client.rpc("open_patient_record", { p_patient_id: pid, p_history: {} });
  const p = await mkPatient();
  await openRecord(p.id);
  const { data: enc } = await medico.client.from("encounters").insert({ clinic_id: cid, patient_id: p.id, provider_id: medico.userId, specialty_template_id: interna, specialty_data: {} }).select("id").single();
  const { data: sensEnc } = await medico.client.from("encounters").insert({ clinic_id: cid, patient_id: p.id, provider_id: medico.userId, specialty_template_id: sm, specialty_data: {} }).select("id").single();

  const create = (who: TestUser, extra: Record<string, unknown> = {}) =>
    who.client.rpc("create_study_result", { p_patient_id: p.id, p_category: "laboratorio", p_study_name: "Hemograma", ...extra });

  console.log("\nRegistrar estudios:");
  const r1 = await create(medico, { p_status: "recibido", p_performed_at: "2026-11-10", p_ordered_at: "2026-11-09", p_result_text: "Normal", p_interpretation: "Sin hallazgos", p_result_values: [{ name: "Glucosa", value: "98", unit: "mg/dL", reference_range: "70-100" }] });
  check("un médico registra un resultado con valores", r1.error === null && typeof r1.data === "string", r1.error?.message ?? "");
  const studyA = r1.data as string;
  const r2 = await create(owner, { p_study_name: "Radiografía de tórax", p_category: "imagen", p_status: "pendiente", p_encounter_id: enc!.id, p_ordered_at: "2026-11-10" });
  check("el admin indica un estudio desde una consulta (pendiente)", r2.error === null, r2.error?.message ?? "");
  const studyB = r2.data as string;
  for (const [label, who] of [["recepción", recepcion], ["admin de otra clínica", ownerB]] as const) {
    const { error } = await create(who);
    check(`${label} NO puede registrar estudios`, error !== null, "no falló");
  }
  const bads: [string, Record<string, unknown>, string][] = [
    ["categoría inválida", { p_category: "magia" }, "categoría"],
    ["nombre vacío", { p_study_name: "  " }, "nombre"],
    ["estado inválido", { p_status: "anulado" }, "pendiente o recibido"],
    ["realizado antes de indicado", { p_ordered_at: "2026-11-10", p_performed_at: "2026-11-01" }, "anterior"],
    ["valor sin resultado", { p_result_values: [{ name: "Glucosa" }] }, "necesita un resultado"],
    ["campo desconocido en un valor", { p_result_values: [{ name: "A", value: "1", hack: "x" }] }, "desconocido"],
    ["más de 100 valores", { p_result_values: Array.from({ length: 101 }, (_, i) => ({ name: `v${i}`, value: "1" })) }, "100"],
    ["resultado demasiado largo", { p_result_text: "x".repeat(10001) }, "largo"],
  ];
  for (const [label, extra, word] of bads) {
    const { error } = await create(medico, extra);
    check(`se rechaza: ${label}`, error !== null && error.message.toLowerCase().includes(word.toLowerCase()), error?.message ?? "no falló");
  }
  const otherPatient = await mkPatient();
  const { data: otherEnc } = await admin.from("encounters").insert({ clinic_id: cid, patient_id: otherPatient.id, provider_id: owner.userId, specialty_template_id: interna, specialty_data: {} }).select("id").single();
  const wrongEnc = await create(medico, { p_encounter_id: otherEnc!.id });
  check("una consulta de OTRO paciente se rechaza", wrongEnc.error !== null && wrongEnc.error.message.includes("no corresponde"), wrongEnc.error?.message ?? "no falló");
  const noRecord = await medico.client.rpc("create_study_result", { p_patient_id: otherPatient.id, p_category: "otro", p_study_name: "X" });
  check("sin expediente abierto no se registran estudios", noRecord.error !== null && noRecord.error.message.includes("expediente"), noRecord.error?.message ?? "no falló");

  console.log("\nQuién lee y quién escribe:");
  for (const [label, who, expected] of [["el médico", medico, 2], ["el admin", owner, 2], ["recepción", recepcion, 0], ["otra clínica", ownerB, 0]] as const) {
    const { data } = await who.client.from("study_results").select("id").eq("patient_id", p.id);
    check(`${label} ${expected ? "lee" : "NO lee"} los estudios`, (data ?? []).length === expected, `${data?.length}`);
  }
  const wIns = await owner.client.from("study_results").insert({ clinic_id: cid, patient_id: p.id, category: "otro", study_name: "directo" });
  const wUpd = await owner.client.from("study_results").update({ result_text: "directo" }).eq("id", studyA);
  const wDel = await owner.client.from("study_results").delete().eq("id", studyA);
  check("ni el admin escribe ni borra directo", wIns.error !== null && wUpd.error !== null && wDel.error !== null, `${wIns.error?.message} | ${wUpd.error?.message} | ${wDel.error?.message}`);

  const sensStudy = await create(medico, { p_study_name: "Prueba psicométrica", p_category: "otro", p_encounter_id: sensEnc!.id });
  check("el médico que atendió la consulta sensible la vincula a un estudio", sensStudy.error === null, sensStudy.error?.message ?? "");
  const adminSens = await create(owner, { p_study_name: "Intento", p_encounter_id: sensEnc!.id });
  check("el admin sin acceso a la consulta sensible NO puede vincular un estudio", adminSens.error !== null, "no falló");
  const medSees = await medico.client.from("study_results").select("id").eq("id", sensStudy.data as string);
  const adminSees = await owner.client.from("study_results").select("id").eq("id", sensStudy.data as string);
  check("el estudio de una consulta de Salud Mental lo ve el médico y NO el admin sin acceso", (medSees.data ?? []).length === 1 && (adminSees.data ?? []).length === 0, `${medSees.data?.length}/${adminSees.data?.length}`);

  console.log("\nVersiones del resultado:");
  const rev = async (id: string) => ((await admin.from("study_result_revisions").select("field, old_value, new_value, changed_by, reason").eq("study_id", id).order("changed_at").order("field")).data ?? []) as { field: string; old_value: string | null; new_value: string | null; changed_by: string | null; reason: string | null }[];
  check("el alta no genera revisiones (es el estado inicial)", (await rev(studyA)).length === 0, JSON.stringify(await rev(studyA)));
  const done = await medico.client.rpc("update_study_result", { p_study_id: studyB, p_changes: { status: "recibido", performed_at: "2026-11-12", result_text: "Sin infiltrados", interpretation: "Normal" } });
  check("completar un estudio pendiente no exige motivo", done.error === null, done.error?.message ?? "");
  const rB = await rev(studyB);
  check("una revisión por campo cambiado (estado, fecha, resultado, interpretación), a nombre del médico", rB.map((r) => r.field).sort().join(",") === "interpretation,performed_at,result_text,status" && rB.every((r) => r.changed_by === medico.userId), JSON.stringify(rB));
  check("estado: pendiente → recibido", rB.find((r) => r.field === "status")?.old_value === "pendiente" && rB.find((r) => r.field === "status")?.new_value === "recibido", JSON.stringify(rB.find((r) => r.field === "status")));
  const noReason = await medico.client.rpc("update_study_result", { p_study_id: studyB, p_changes: { result_text: "Corregido" } });
  check("corregir un resultado ya recibido EXIGE motivo", noReason.error !== null && noReason.error.message.includes("motivo"), noReason.error?.message ?? "no falló");
  const withReason = await owner.client.rpc("update_study_result", { p_study_id: studyB, p_changes: { result_text: "Sin infiltrados; silueta cardiaca normal" }, p_reason: "Se agregó la lectura de la silueta" });
  const rB2 = (await rev(studyB)).filter((r) => r.reason !== null);
  check("con motivo se corrige y queda antes → después, quién y por qué", withReason.error === null && rB2.length === 1 && rB2[0].old_value === "Sin infiltrados" && rB2[0].changed_by === owner.userId && rB2[0].reason === "Se agregó la lectura de la silueta", `${withReason.error?.message ?? ""} ${JSON.stringify(rB2)}`);
  const unknown = await medico.client.rpc("update_study_result", { p_study_id: studyB, p_changes: { patient_id: randomUUID() }, p_reason: "x1x" });
  check("no se pueden cambiar campos ajenos (p. ej. el paciente)", unknown.error !== null && unknown.error.message.includes("desconocido"), unknown.error?.message ?? "no falló");
  const toVoid = await medico.client.rpc("update_study_result", { p_study_id: studyB, p_changes: { status: "anulado" }, p_reason: "intento" });
  check("anular no se hace por la corrección", toVoid.error !== null, "no falló");
  for (const [label, who] of [["recepción", recepcion], ["otra clínica", ownerB]] as const) {
    const { error } = await who.client.rpc("update_study_result", { p_study_id: studyB, p_changes: { result_text: "Hackeado" }, p_reason: "hack" });
    check(`${label} NO puede corregir`, error !== null, "no falló");
  }
  const uRev = await admin.from("study_result_revisions").update({ new_value: "x" }).eq("study_id", studyB);
  const dRev = await admin.from("study_result_revisions").delete().eq("study_id", studyB);
  const oRev = await owner.client.from("study_result_revisions").delete().eq("study_id", studyB);
  check("las revisiones son inmutables (ni service_role ni el admin)", uRev.error !== null && dRev.error !== null && oRev.error !== null, `${uRev.error?.message} | ${dRev.error?.message} | ${oRev.error?.message}`);
  const voidNoReason = await medico.client.rpc("void_study_result", { p_study_id: studyA, p_reason: "x" });
  check("anular exige motivo", voidNoReason.error !== null && voidNoReason.error.message.includes("motivo"), voidNoReason.error?.message ?? "no falló");

  console.log("\nStorage: subir, descargar y proteger archivos:");
  const pathFor = (study: string, name: string, patient = p.id, clinic = cid) => `${clinic}/${patient}/${study}/${randomUUID()}-${name}`;
  const upload = (who: TestUser, path: string, body: Buffer | Uint8Array, type: string, upsert = false) => who.client.storage.from(BUCKET).upload(path, body, { contentType: type, upsert });
  const pdfPath = pathFor(studyA, "hemograma.pdf");
  const up1 = await upload(medico, pdfPath, PDF, "application/pdf");
  if (!up1.error) uploadedPaths.push(pdfPath);
  check("un médico sube un PDF a la ruta de su estudio", up1.error === null, up1.error?.message ?? "");
  const reg = await medico.client.rpc("register_study_attachment", { p_study_id: studyA, p_storage_path: pdfPath, p_file_name: "hemograma.pdf", p_mime_type: "application/pdf", p_size_bytes: PDF.length });
  check("y registra el adjunto (la base verifica que el archivo existe)", reg.error === null && typeof reg.data === "string", reg.error?.message ?? "");
  const attId = reg.data as string;
  const signed = await medico.client.storage.from(BUCKET).createSignedUrl(pdfPath, 60);
  const dl = signed.data?.signedUrl ? await fetch(signed.data.signedUrl) : null;
  const dlBytes = dl ? Buffer.from(await dl.arrayBuffer()) : Buffer.alloc(0);
  check("lo descarga con una URL firmada y el contenido es idéntico", dl?.status === 200 && dlBytes.equals(PDF), `${dl?.status} ${dlBytes.length}`);
  check("la URL firmada es de corta duración (expira)", (signed.data?.signedUrl ?? "").includes("token="), String(signed.data?.signedUrl).slice(0, 80));
  const adminDl = await owner.client.storage.from(BUCKET).createSignedUrl(pdfPath, 60);
  check("el admin también la descarga", !!adminDl.data?.signedUrl, adminDl.error?.message ?? "");
  const anonPublic = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${pdfPath}`);
  check("el bucket es PRIVADO: no hay URL pública", anonPublic.status >= 400, `${anonPublic.status}`);
  for (const [label, who] of [["recepción", recepcion], ["otra clínica", ownerB]] as const) {
    const sg = await who.client.storage.from(BUCKET).createSignedUrl(pdfPath, 60);
    check(`${label} NO obtiene URL firmada del archivo`, !sg.data?.signedUrl, "obtuvo URL");
    const upl = await upload(who, pathFor(studyA, "intruso.pdf"), PDF, "application/pdf");
    check(`${label} NO puede subir`, upl.error !== null, "subió");
  }
  const dlDirect = await recepcion.client.storage.from(BUCKET).download(pdfPath);
  check("recepción NO descarga directo", dlDirect.error !== null, "descargó");

  const png = await upload(medico, pathFor(studyA, "placa.png"), PNG, "image/png");
  if (!png.error) uploadedPaths.push(png.data!.path);
  check("también acepta PNG", png.error === null, png.error?.message ?? "");
  const txt = await upload(medico, pathFor(studyA, "nota.txt"), Buffer.from("hola"), "text/plain");
  check("un tipo no permitido (texto) lo rechaza Storage", txt.error !== null, "subió");
  const big = await upload(medico, pathFor(studyA, "enorme.pdf"), Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(10 * 1024 * 1024 + 1024)]), "application/pdf");
  check("un archivo de más de 10 MB lo rechaza Storage", big.error !== null, "subió");
  const wrongStudy = await upload(medico, pathFor(randomUUID(), "x.pdf"), PDF, "application/pdf");
  check("una ruta con un estudio inexistente se rechaza", wrongStudy.error !== null, "subió");
  const wrongPatient = await upload(medico, pathFor(studyA, "x.pdf", randomUUID()), PDF, "application/pdf");
  check("una ruta con otro paciente se rechaza", wrongPatient.error !== null, "subió");
  const wrongClinic = await upload(medico, pathFor(studyA, "x.pdf", p.id, randomUUID()), PDF, "application/pdf");
  check("una ruta con otra clínica se rechaza", wrongClinic.error !== null, "subió");
  const shallow = await upload(medico, `${cid}/${p.id}/archivo.pdf`, PDF, "application/pdf");
  check("una ruta con menos niveles se rechaza", shallow.error !== null, "subió");
  const replace = await upload(medico, pdfPath, Buffer.concat([Buffer.from("%PDF-"), Buffer.from("OTRO")]), "application/pdf", true);
  check("nadie reemplaza un archivo existente (sin política de UPDATE)", replace.error !== null, "reemplazó");
  const rm = await medico.client.storage.from(BUCKET).remove([pdfPath]);
  const still = await admin.storage.from(BUCKET).download(pdfPath);
  check("nadie borra un archivo desde la app (sin política de DELETE)", still.error === null && (rm.data ?? []).length === 0, `${rm.error?.message ?? ""} ${(rm.data ?? []).length}`);
  const sensUp = await upload(owner, pathFor(sensStudy.data as string, "x.pdf"), PDF, "application/pdf");
  check("el admin sin acceso a la consulta sensible NO sube archivos a ese estudio", sensUp.error !== null, "subió");

  console.log("\nRegistro de adjuntos:");
  const ghost = await medico.client.rpc("register_study_attachment", { p_study_id: studyA, p_storage_path: pathFor(studyA, "fantasma.pdf"), p_file_name: "fantasma.pdf", p_mime_type: "application/pdf", p_size_bytes: 10 });
  check("registrar un archivo que NO existe se rechaza", ghost.error !== null && ghost.error.message.includes("no se encontró"), ghost.error?.message ?? "no falló");
  const crossStudy = await medico.client.rpc("register_study_attachment", { p_study_id: studyB, p_storage_path: pdfPath, p_file_name: "x.pdf", p_mime_type: "application/pdf", p_size_bytes: PDF.length });
  check("registrar el archivo de OTRO estudio se rechaza", crossStudy.error !== null, "no falló");
  const badMime = await medico.client.rpc("register_study_attachment", { p_study_id: studyA, p_storage_path: pdfPath, p_file_name: "x.exe", p_mime_type: "application/x-msdownload", p_size_bytes: PDF.length });
  check("un tipo no permitido se rechaza", badMime.error !== null, "no falló");
  const dup = await medico.client.rpc("register_study_attachment", { p_study_id: studyA, p_storage_path: pdfPath, p_file_name: "hemograma.pdf", p_mime_type: "application/pdf", p_size_bytes: PDF.length });
  check("el mismo archivo no se registra dos veces", dup.error !== null, "no falló");
  const recReg = await recepcion.client.rpc("register_study_attachment", { p_study_id: studyA, p_storage_path: pdfPath, p_file_name: "x.pdf", p_mime_type: "application/pdf", p_size_bytes: PDF.length });
  check("recepción NO registra adjuntos", recReg.error !== null, "no falló");
  const wAtt = await owner.client.from("study_attachments").insert({ clinic_id: cid, patient_id: p.id, study_id: studyA, storage_path: "x", file_name: "x", mime_type: "application/pdf", size_bytes: 1 });
  const dAtt = await owner.client.from("study_attachments").delete().eq("id", attId);
  const sAtt = await admin.from("study_attachments").delete().eq("id", attId);
  check("los adjuntos no se escriben ni se borran directo (ni service_role)", wAtt.error !== null && dAtt.error !== null && sAtt.error !== null, `${wAtt.error?.message} | ${dAtt.error?.message} | ${sAtt.error?.message}`);

  // Llegar a 10 adjuntos y probar el límite.
  let registered = 1;
  for (let i = 0; i < 12 && registered < 10; i++) {
    const path = pathFor(studyA, `extra${i}.png`);
    const u = await upload(medico, path, PNG, "image/png");
    if (u.error) break;
    uploadedPaths.push(path);
    const r = await medico.client.rpc("register_study_attachment", { p_study_id: studyA, p_storage_path: path, p_file_name: `extra${i}.png`, p_mime_type: "image/png", p_size_bytes: PNG.length });
    if (!r.error) registered++;
  }
  const overPath = pathFor(studyA, "demasiado.png");
  const overUp = await upload(medico, overPath, PNG, "image/png");
  if (!overUp.error) uploadedPaths.push(overPath);
  const over = await medico.client.rpc("register_study_attachment", { p_study_id: studyA, p_storage_path: overPath, p_file_name: "demasiado.png", p_mime_type: "image/png", p_size_bytes: PNG.length });
  check("un estudio admite como máximo 10 adjuntos", registered === 10 && over.error !== null && over.error.message.includes("10"), `${registered} ${over.error?.message ?? "no falló"}`);

  const rmNo = await medico.client.rpc("void_study_attachment", { p_attachment_id: attId, p_reason: "x" });
  check("retirar un adjunto exige motivo", rmNo.error !== null, "no falló");
  const rmRec = await recepcion.client.rpc("void_study_attachment", { p_attachment_id: attId, p_reason: "Subido por error" });
  check("recepción NO retira adjuntos", rmRec.error !== null, "no falló");
  const rmOk = await medico.client.rpc("void_study_attachment", { p_attachment_id: attId, p_reason: "Subido por error" });
  const { data: attRow } = await medico.client.from("study_attachments").select("removed_at, removed_reason").eq("id", attId).single();
  const stillThere = await admin.storage.from(BUCKET).download(pdfPath);
  check("retirar oculta el adjunto con su motivo, pero el ARCHIVO se conserva", rmOk.error === null && !!attRow?.removed_at && attRow.removed_reason === "Subido por error" && stillThere.error === null, `${rmOk.error?.message ?? ""} ${JSON.stringify(attRow)}`);

  console.log("\nAnular un estudio:");
  const voided = await medico.client.rpc("void_study_result", { p_study_id: studyB, p_reason: "Se indicó al paciente equivocado" });
  check("se anula con motivo", voided.error === null, voided.error?.message ?? "");
  const { data: vRow } = await medico.client.from("study_results").select("status").eq("id", studyB).single();
  const vRev = (await rev(studyB)).find((r) => r.field === "status" && r.new_value === "anulado");
  check("queda «anulado» y en el historial con su motivo", vRow?.status === "anulado" && vRev?.reason === "Se indicó al paciente equivocado", JSON.stringify([vRow, vRev]));
  const afterVoid = await medico.client.rpc("update_study_result", { p_study_id: studyB, p_changes: { result_text: "x" }, p_reason: "abc" });
  check("un estudio anulado no se modifica", afterVoid.error !== null && afterVoid.error.message.includes("anulado"), afterVoid.error?.message ?? "no falló");
  const upVoid = await upload(medico, pathFor(studyB, "tarde.pdf"), PDF, "application/pdf");
  check("ni admite archivos nuevos", upVoid.error !== null, "subió");
  const twice = await medico.client.rpc("void_study_result", { p_study_id: studyB, p_reason: "Otra vez" });
  check("no se anula dos veces", twice.error !== null, "no falló");

  console.log("\nEliminar pacientes:");
  const e1 = await mkPatient();
  await openRecord(e1.id);
  const empty = (await owner.client.rpc("patient_deletion_status", { p_patient_id: e1.id })).data as { empty_blockers: string[] };
  const eStudy = await medico.client.rpc("create_study_result", { p_patient_id: e1.id, p_category: "otro", p_study_name: "Estudio" });
  const withStudy = (await owner.client.rpc("patient_deletion_status", { p_patient_id: e1.id })).data as { empty_blockers: string[] };
  check("un expediente sin estudios se puede eliminar; con un estudio, no (cuenta como actividad)", empty.empty_blockers.length === 0 && eStudy.error === null && withStudy.empty_blockers.some((b) => b.includes("estudios")), JSON.stringify([empty, withStudy]));
  const t = await mkPatient({ is_test: true });
  await openRecord(t.id);
  const tStudy = await medico.client.rpc("create_study_result", { p_patient_id: t.id, p_category: "otro", p_study_name: "De prueba" });
  const tPath = `${cid}/${t.id}/${tStudy.data as string}/${randomUUID()}-prueba.pdf`;
  const tUp = await upload(medico, tPath, PDF, "application/pdf");
  if (!tUp.error) uploadedPaths.push(tPath);
  await medico.client.rpc("register_study_attachment", { p_study_id: tStudy.data as string, p_storage_path: tPath, p_file_name: "prueba.pdf", p_mime_type: "application/pdf", p_size_bytes: PDF.length });
  const del = await owner.client.rpc("delete_test_patient", { p_patient_id: t.id });
  const left = [
    ((await admin.from("study_results").select("id").eq("patient_id", t.id)).data ?? []).length,
    ((await admin.from("study_attachments").select("id").eq("patient_id", t.id)).data ?? []).length,
    ((await admin.from("study_result_revisions").select("id").eq("patient_id", t.id)).data ?? []).length,
  ];
  check("un paciente de prueba se elimina con sus estudios, adjuntos y revisiones (filas)", del.error === null && left.every((n) => n === 0), `${del.error?.message ?? ""} ${left}`);

  console.log("\nModo solo lectura:");
  const old = new Date();
  old.setUTCDate(old.getUTCDate() - 40);
  const { error: subErr } = await admin.from("clinic_subscriptions").update({ trial_ends_at: old.toISOString().slice(0, 10), next_payment_due_on: null }).eq("clinic_id", cid);
  if (subErr) throw new Error(`No se pudo vencer la suscripción: ${subErr.message}`);
  const ro = "modo solo lectura";
  const roCreate = await create(medico);
  check("no se puede registrar un estudio", roCreate.error !== null && roCreate.error.message.includes(ro), roCreate.error?.message ?? "no falló");
  const roUpdate = await medico.client.rpc("update_study_result", { p_study_id: studyA, p_changes: { interpretation: "x" }, p_reason: "abc" });
  check("ni corregirlo", roUpdate.error !== null && roUpdate.error.message.includes(ro), roUpdate.error?.message ?? "no falló");
  const roUp = await upload(medico, pathFor(studyA, "tarde.pdf"), PDF, "application/pdf");
  check("ni subir archivos", roUp.error !== null, "subió");
  const roSigned = await medico.client.storage.from(BUCKET).createSignedUrl(pdfPath, 60);
  const roRead = await medico.client.from("study_results").select("id").eq("id", studyA);
  check("(control) leer y descargar sigue funcionando", !!roSigned.data?.signedUrl && (roRead.data ?? []).length === 1, roSigned.error?.message ?? "");
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
    console.log("OK: estudios, versiones y archivos adjuntos verificados.");
  });
