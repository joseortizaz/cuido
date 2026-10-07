/**
 * Prueba de la exportación de consultas y de pacientes
 * (src/lib/bulk-import/export-encounters.ts, export.ts, fetch-all.ts).
 *
 * Qué verifica, con una clínica sintética de MÁS de 1000 pacientes/consultas:
 *   1. COMPLETITUD: nada se trunca en el límite de 1000 filas de PostgREST
 *      (antes la exportación de pacientes entregaba un archivo truncado sin
 *      avisar), y las alergias de todos los pacientes llegan (antes se pedían
 *      con un .in() de miles de ids que reventaba la URL).
 *   2. CONTROL DE ACCESO: las consultas de Salud Mental de otro profesional NO
 *      aparecen en la exportación del admin (RLS), y el profesional tratante sí
 *      las ve -- sin ningún código de aislamiento en la exportación.
 *   3. CONTENIDO: una columna por campo de la plantilla, signos vitales, fecha
 *      en hora de Santo Domingo, y las claves que la plantilla actual ya no
 *      tiene no se pierden ("Datos adicionales", solo si hace falta).
 *   4. SEGURIDAD DEL ARCHIVO: el CSV escapa celdas que empiezan por = + - @
 *      (inyección de fórmulas) y lleva BOM UTF-8; el libro .xlsx usa nombres de
 *      hoja válidos y únicos.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";
import { parseTemplateSchema } from "../src/lib/domain/specialty-template";
import {
  EXTRA_DATA_HEADER,
  buildEncounterTable,
  fetchEncounterExportData,
  formatEncounterDateTime,
  generateEncountersCsv,
  generateEncountersExportXlsx,
  safeSheetName,
} from "../src/lib/bulk-import/export-encounters";
import {
  fetchPatientsExportData,
  generatePatientsExportCsv,
  generatePatientsExportXlsx,
} from "../src/lib/bulk-import/export";

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
  const email = `export-encounters-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, client: client as unknown as SupabaseClient<Database> };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const N = 1050; // por encima del límite de 1000 filas de PostgREST

async function main() {
  const adminUser = await createUser("admin");
  const medicoUser = await createUser("medico");

  const { data: clinicId, error: clinicErr } = await adminUser.client.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] Exportación ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (clinicErr || !clinicId) throw new Error(`create_clinic_with_admin falló: ${clinicErr?.message}`);
  createdClinicIds.push(clinicId as string);
  const cid = clinicId as string;
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medicoUser.userId, role: "medico" });

  const { data: templates } = await admin
    .from("specialty_templates")
    .select("id, code, name, schema, requires_explicit_access")
    .in("code", ["medicina_interna", "pediatria"]);
  const interna = templates?.find((t) => t.code === "medicina_interna");
  const pediatria = templates?.find((t) => t.code === "pediatria");
  const { data: saludMental } = await admin
    .from("specialty_templates")
    .select("id, name, schema")
    .eq("requires_explicit_access", true)
    .limit(1)
    .single();
  if (!interna || !pediatria || !saludMental) throw new Error("Faltan plantillas base.");

  const internaFields = parseTemplateSchema(interna.schema).fields;
  const textKeys = internaFields.filter((f) => f.type === "text" || f.type === "textarea").map((f) => f.key);
  const [k1, k2] = textKeys;
  const pediatriaFirstText = parseTemplateSchema(pediatria.schema).fields.find(
    (f) => f.type === "text" || f.type === "textarea"
  )!;

  console.log(`\nPreparando datos sintéticos (${N} pacientes, ${N} consultas, ${N} alergias)...`);
  const patientRows = Array.from({ length: N }, (_, i) => ({
    clinic_id: cid,
    first_name: i === 0 ? "=EVIL()" : `Nombre${i}`,
    last_name: `Apellido${String(i).padStart(4, "0")}`,
    national_id: `EXP-${String(i).padStart(5, "0")}`,
    date_of_birth: "1990-01-01",
    sex: i % 2 === 0 ? "masculino" : "femenino",
  }));
  for (const part of chunks(patientRows, 500)) {
    const { error } = await admin.from("patients").insert(part);
    if (error) throw new Error(`insert pacientes: ${error.message}`);
  }
  // Se releen ordenados por national_id (EXP-00000...) para que el índice i de los
  // datos de prueba coincida con el paciente i (PostgREST corta cada respuesta en 1000).
  const { data: ordered } = await admin
    .from("patients")
    .select("id, national_id")
    .eq("clinic_id", cid)
    .order("national_id", { ascending: true })
    .range(0, 999);
  const { data: orderedRest } = await admin
    .from("patients")
    .select("id, national_id")
    .eq("clinic_id", cid)
    .order("national_id", { ascending: true })
    .range(1000, N);
  const idByIndex = [...(ordered ?? []), ...(orderedRest ?? [])].map((r) => r.id);
  if (idByIndex.length !== N) throw new Error(`se esperaban ${N} pacientes y hay ${idByIndex.length}`);

  for (const part of chunks(idByIndex, 500)) {
    const { error } = await admin
      .from("allergies")
      .insert(part.map((id) => ({ clinic_id: cid, patient_id: id, substance: "Penicilina", severity: "leve" })));
    if (error) throw new Error(`insert alergias: ${error.message}`);
  }

  const baseDate = new Date("2026-01-01T15:00:00Z").getTime();
  const internaRows = idByIndex.map((patientId, i) => ({
    clinic_id: cid,
    patient_id: patientId,
    provider_id: adminUser.userId,
    specialty_template_id: interna.id,
    chief_complaint: `Motivo ${i}`,
    encounter_date: new Date(baseDate + i * 60_000).toISOString(),
    specialty_data: { [k1]: `Dato A ${i}`, [k2]: `Dato B ${i}` },
  }));
  const internaIds: string[] = [];
  for (const part of chunks(internaRows, 500)) {
    const { data, error } = await admin.from("encounters").insert(part).select("id, chief_complaint");
    if (error) throw new Error(`insert consultas: ${error.message}`);
    for (const r of data ?? []) internaIds.push(r.id);
  }
  // Consultas pediátricas con una clave huérfana y valores que parecen fórmulas.
  const { error: pedErr } = await admin.from("encounters").insert(
    idByIndex.slice(0, 5).map((patientId, i) => ({
      clinic_id: cid,
      patient_id: patientId,
      provider_id: adminUser.userId,
      specialty_template_id: pediatria.id,
      chief_complaint: i === 0 ? "- sin fiebre" : `Control ${i}`,
      specialty_data: { [pediatriaFirstText.key]: i === 0 ? "=CMD|'/C calc'!A0" : `Texto ${i}`, clave_removida: `valor huérfano ${i}` },
    }))
  );
  if (pedErr) throw new Error(`insert pediatría: ${pedErr.message}`);
  // Salud Mental atendida por el MÉDICO: el admin no debe verla.
  const { error: smErr } = await admin.from("encounters").insert(
    idByIndex.slice(0, 2).map((patientId) => ({
      clinic_id: cid,
      patient_id: patientId,
      provider_id: medicoUser.userId,
      specialty_template_id: saludMental.id,
      specialty_data: {},
    }))
  );
  if (smErr) throw new Error(`insert salud mental: ${smErr.message}`);
  // Signos vitales en las primeras 3 consultas de medicina interna.
  const { data: firstInterna } = await admin
    .from("encounters")
    .select("id")
    .eq("clinic_id", cid)
    .eq("specialty_template_id", interna.id)
    .order("encounter_date", { ascending: true })
    .limit(3);
  const vitalEncounterId = firstInterna?.[0]?.id as string;
  for (const [i, e] of (firstInterna ?? []).entries()) {
    await admin.from("vital_signs").insert({
      clinic_id: cid,
      encounter_id: e.id,
      systolic_bp: 120 + i,
      diastolic_bp: 80,
      heart_rate: 72,
      temperature_celsius: 36.6,
    });
  }

  console.log("\nCompletitud (más de 1000 filas):");
  // Control del propio test: una consulta SIN paginar se corta en 1000. Si esto fallara, el
  // límite no estaría activo en este entorno y las pruebas de abajo pasarían en vacío.
  const unpaginated = await adminUser.client.from("patients").select("id");
  check(
    "el límite de 1000 filas de PostgREST está activo (una consulta sin paginar se trunca)",
    (unpaginated.data ?? []).length === 1000,
    `una consulta simple devolvió ${(unpaginated.data ?? []).length} filas`
  );
  const data = await fetchPatientsExportData(adminUser.client, { withDetail: true });
  check(`pacientes: llegan los ${N}, no solo 1000`, data.patients.length === N, `llegaron ${data.patients.length}`);
  check(
    `alergias: llegan las ${N} (antes un .in() con miles de ids las perdía)`,
    data.allergies.length === N,
    `llegaron ${data.allergies.length}`
  );
  const patientsCsv = generatePatientsExportCsv(data.patients);
  const parsedPatientsCsv = Papa.parse<Record<string, string>>(patientsCsv.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  check(`CSV de pacientes: ${N} filas`, parsedPatientsCsv.data.length === N, `filas ${parsedPatientsCsv.data.length}`);
  check("CSV de pacientes lleva BOM UTF-8", patientsCsv.charCodeAt(0) === 0xfeff, "sin BOM");
  check(
    "CSV de pacientes escapa una celda que empieza por = (inyección de fórmulas)",
    parsedPatientsCsv.data.some((r) => r["Nombre"] === "'=EVIL()") && !parsedPatientsCsv.data.some((r) => r["Nombre"] === "=EVIL()"),
    "la celda quedó sin escapar"
  );
  const patientsXlsx = new ExcelJS.Workbook();
  await patientsXlsx.xlsx.load(
    (await generatePatientsExportXlsx(data.patients, data.allergies, data.medications)) as unknown as ExcelJS.Buffer
  );
  check(
    `XLSX de pacientes: hojas con ${N} pacientes y ${N} alergias (+ encabezado)`,
    patientsXlsx.getWorksheet("Pacientes")?.rowCount === N + 1 && patientsXlsx.getWorksheet("Alergias")?.rowCount === N + 1,
    `${patientsXlsx.getWorksheet("Pacientes")?.rowCount} / ${patientsXlsx.getWorksheet("Alergias")?.rowCount}`
  );

  const all = await fetchEncounterExportData(adminUser.client);
  check(
    `consultas del admin: ${N} de medicina interna + 5 de pediatría = ${N + 5} (sin truncar)`,
    all.length === N + 5,
    `llegaron ${all.length}`
  );
  const allIds = new Set(all.map((e) => e.id));
  check("sin consultas repetidas entre páginas", allIds.size === all.length, `únicas ${allIds.size} de ${all.length}`);
  const sorted = all.every((e, i) => i === 0 || all[i - 1].encounter_date <= e.encounter_date);
  check("orden estable por fecha", sorted, "fuera de orden");

  console.log("\nControl de acceso (Salud Mental):");
  check(
    "el admin NO recibe las consultas de Salud Mental de otro profesional",
    !all.some((e) => e.specialty_template_id === saludMental.id),
    "aparecieron consultas sensibles"
  );
  const adminSm = await fetchEncounterExportData(adminUser.client, saludMental.id);
  const medicoSm = await fetchEncounterExportData(medicoUser.client, saludMental.id);
  check("por especialidad: el admin recibe 0 de Salud Mental", adminSm.length === 0, `recibió ${adminSm.length}`);
  check("el profesional tratante sí recibe las 2 suyas", medicoSm.length === 2, `recibió ${medicoSm.length}`);

  console.log("\nContenido:");
  const emails = new Map<string, string>([[adminUser.userId, "admin@example.invalid"]]);
  const internaTable = buildEncounterTable(interna, all.filter((e) => e.specialty_template_id === interna.id), emails);
  check(`tabla de medicina interna: ${N} filas`, internaTable.rows.length === N, `filas ${internaTable.rows.length}`);
  check(
    "una columna por campo de la plantilla",
    internaFields.every((f) => internaTable.headers.includes(f.label)),
    "falta alguna columna de plantilla"
  );
  check(
    "encabezados únicos (ninguna columna pisa a otra)",
    new Set(internaTable.headers).size === internaTable.headers.length,
    "hay encabezados repetidos"
  );
  check("sin 'Datos adicionales' si no hace falta", !internaTable.headers.includes(EXTRA_DATA_HEADER), "apareció sin necesidad");
  const idCol = internaTable.headers.indexOf("ID de consulta");
  const vitalRow = internaTable.rows.find((r) => r[idCol] === vitalEncounterId);
  check(
    "signos vitales incluidos (PA sistólica 120 como número)",
    vitalRow?.[internaTable.headers.indexOf("PA sistólica")] === 120 &&
      vitalRow?.[internaTable.headers.indexOf("FC (lpm)")] === 72,
    JSON.stringify(vitalRow)
  );
  check(
    "profesional como correo y paciente por apellido/nombre",
    vitalRow?.[internaTable.headers.indexOf("Profesional")] === "admin@example.invalid" &&
      String(vitalRow?.[internaTable.headers.indexOf("Apellido")]).startsWith("Apellido"),
    JSON.stringify(vitalRow)
  );
  check(
    "fecha en hora de Santo Domingo (2026-01-01 15:00 UTC = 11:00 allá)",
    formatEncounterDateTime("2026-01-01T15:00:00Z") === "2026-01-01 11:00" &&
      formatEncounterDateTime("2026-01-02T03:30:00Z") === "2026-01-01 23:30",
    `${formatEncounterDateTime("2026-01-01T15:00:00Z")} / ${formatEncounterDateTime("2026-01-02T03:30:00Z")}`
  );
  const pedTable = buildEncounterTable(pediatria, all.filter((e) => e.specialty_template_id === pediatria.id), emails);
  const extraCol = pedTable.headers.indexOf(EXTRA_DATA_HEADER);
  check("pediatría: la clave que la plantilla ya no tiene va en 'Datos adicionales'", extraCol >= 0 && String(pedTable.rows[0][extraCol]).includes("clave_removida"), JSON.stringify(pedTable.headers.slice(-2)));

  console.log("\nSeguridad del archivo:");
  const csv = generateEncountersCsv(pedTable);
  check("CSV de consultas lleva BOM UTF-8", csv.charCodeAt(0) === 0xfeff, "sin BOM");
  const parsedCsv = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  check("CSV de pediatría: 5 filas", parsedCsv.data.length === 5, `filas ${parsedCsv.data.length}`);
  check(
    "CSV escapa el motivo '- sin fiebre' y el valor '=CMD...' (inyección de fórmulas)",
    parsedCsv.data.some((r) => r["Motivo de consulta"] === "'- sin fiebre") &&
      parsedCsv.data.some((r) => (r[pediatriaFirstText.label] ?? "").startsWith("'=CMD")),
    JSON.stringify(parsedCsv.data[0])
  );
  const used = new Set<string>(["resumen"]);
  const sheetNames = [
    "Ginecología y Obstetricia — Consulta prenatal",
    "Ginecología y Obstetricia — Consulta prenatal",
    "A/B:C?[x]*",
    "Resumen",
  ].map((n) => safeSheetName(n, used));
  check(
    "nombres de hoja válidos: ≤31 caracteres, sin \\ / ? * [ ] :, y únicos",
    sheetNames.every((n) => n.length <= 31 && !/[\\/?*[\]:]/.test(n)) && new Set(sheetNames.map((n) => n.toLowerCase())).size === sheetNames.length,
    JSON.stringify(sheetNames)
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    (await generateEncountersExportXlsx([internaTable, pedTable], { generatedOn: "2026-10-07" })) as unknown as ExcelJS.Buffer
  );
  const sheetTitles = book.worksheets.map((w) => w.name);
  check("libro: Resumen + una hoja por especialidad con consultas (sin Salud Mental)", sheetTitles.length === 3 && sheetTitles[0] === "Resumen", JSON.stringify(sheetTitles));
  const resumen = book.getWorksheet("Resumen")!;
  const totalRow = (resumen.getRows(1, resumen.rowCount) ?? []).find((r) => r.getCell(1).value === "Total");
  check(`hoja Resumen: total ${N + 5}`, totalRow?.getCell(2).value === N + 5, JSON.stringify(totalRow?.values));
  check(
    `hoja de medicina interna: ${N} consultas (+ encabezado)`,
    book.worksheets[1].rowCount === N + 1,
    `filas ${book.worksheets[1].rowCount}`
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
    console.log("\nOK: exportación de pacientes y consultas verificada.");
  });
