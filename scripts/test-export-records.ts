/**
 * Prueba de la exportación del resto de registros de la clínica
 * (src/lib/bulk-import/export-records.ts y export-tables.ts): consentimientos,
 * comprobantes fiscales y sus líneas, reclamaciones, citas, seguros y
 * verificaciones de elegibilidad.
 *
 * Qué verifica, con una clínica sintética:
 *   1. COMPLETITUD: más de 1000 filas (citas) llegan enteras, sin repetir ni
 *      omitir, y la clínica ajena NO aparece (RLS: lectura con el cliente del admin).
 *   2. CONTENIDO: un consentimiento revocado conserva su revocación; un
 *      comprobante anulado conserva su anulación y sus líneas; una reclamación
 *      rechazada conserva su motivo; una cita quirúrgica trae su lista de
 *      verificación; los nombres (paciente, aseguradora, especialidad, correo del
 *      usuario) se resuelven, y las fechas salen en hora de Santo Domingo.
 *   3. SEGURIDAD DEL ARCHIVO: el CSV escapa fórmulas y lleva BOM; un texto de
 *      más de 32,767 caracteres (XML de un comprobante grande) se recorta en el
 *      .xlsx avisándolo -- el libro abre -- y queda COMPLETO en el .csv.
 *   4. LIBRO COMPLETO: una hoja por conjunto, con su Resumen.
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
import {
  RECORD_DATASETS,
  buildPatientTables,
  buildRecordTable,
  collectUserIds,
  fetchRecordsData,
} from "../src/lib/bulk-import/export-records";
import {
  EXCEL_CELL_LIMIT,
  clipForExcel,
  generateTableCsv,
  generateTablesXlsx,
} from "../src/lib/bulk-import/export-tables";
import { fetchPatientsExportData } from "../src/lib/bulk-import/export";

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

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
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
  const email = `export-records-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, email, client: client as unknown as SupabaseClient<Database> };
}

async function createClinic(owner: Awaited<ReturnType<typeof createUser>>, label: string) {
  const { data, error } = await owner.client.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] Export registros ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const N_APPOINTMENTS = 1050; // por encima del límite de 1000 filas de PostgREST

async function main() {
  const adminUser = await createUser("admin");
  const otherUser = await createUser("otra");
  const cid = await createClinic(adminUser, "A");
  const otherCid = await createClinic(otherUser, "B");

  const { data: templates } = await admin
    .from("specialty_templates")
    .select("id, code, name")
    .in("code", ["medicina_interna", "cirugia_general"]);
  const interna = templates?.find((t) => t.code === "medicina_interna");
  const cirugia = templates?.find((t) => t.code === "cirugia_general");
  if (!interna || !cirugia) throw new Error("Faltan plantillas base.");
  const { data: consentTemplate } = await admin.from("consent_templates").select("id").limit(1).single();
  if (!consentTemplate) throw new Error("Falta una plantilla de consentimiento.");

  console.log("\nPreparando datos sintéticos...");
  const { data: patients, error: pErr } = await admin
    .from("patients")
    .insert([
      { clinic_id: cid, first_name: "Ana", last_name: "Peña", national_id: "EXP-R-0001", date_of_birth: "1990-01-01", sex: "femenino" },
      { clinic_id: cid, first_name: "=EVIL()", last_name: "Rosario", national_id: "EXP-R-0002", date_of_birth: "1985-05-05", sex: "masculino" },
    ])
    .select("id, first_name");
  if (pErr || !patients) throw new Error(`insert pacientes: ${pErr?.message}`);
  const ana = patients.find((p) => p.first_name === "Ana")!.id;
  const evil = patients.find((p) => p.first_name === "=EVIL()")!.id;
  const { data: otherPatient } = await admin
    .from("patients")
    .insert({ clinic_id: otherCid, first_name: "Ajeno", last_name: "OtraClinica", national_id: "EXP-R-AJENO", date_of_birth: "1980-01-01", sex: "masculino" })
    .select("id")
    .single();

  // Encounter de la clínica (las reclamaciones y los consentimientos cuelgan de una consulta).
  const { data: enc, error: eErr } = await admin
    .from("encounters")
    .insert({
      clinic_id: cid,
      patient_id: ana,
      provider_id: adminUser.userId,
      specialty_template_id: interna.id,
      chief_complaint: "Control",
      specialty_data: {},
    })
    .select("id")
    .single();
  if (eErr || !enc) throw new Error(`insert consulta: ${eErr?.message}`);

  // Consentimientos: uno vigente (con texto muy largo) y uno revocado.
  const longText = "Texto del consentimiento. ".repeat(2000); // ~52,000 caracteres
  const { error: cErr } = await admin.from("consents").insert([
    {
      clinic_id: cid,
      patient_id: ana,
      encounter_id: enc.id,
      consent_template_id: consentTemplate.id,
      document_title: "Consentimiento informado",
      document_content: longText,
      document_hash: "hash-vigente",
      signer_name: "Ana Peña",
      signer_national_id: "EXP-R-0001",
      signer_relationship: "paciente",
      status: "firmado",
      signer_ip: "203.0.113.7",
      signer_user_agent: "Mozilla/5.0 (test)",
      signed_at: "2026-03-01T15:00:00Z",
      recorded_by: adminUser.userId,
    },
    {
      clinic_id: cid,
      patient_id: evil,
      consent_template_id: consentTemplate.id,
      document_title: "Consentimiento informado",
      document_content: "Texto corto",
      document_hash: "hash-revocado",
      signer_name: "=CMD|'/C calc'!A0",
      signer_relationship: "tutor",
      signed_at: "2026-03-02T03:30:00Z", // 23:30 del día 1 en Santo Domingo
      recorded_by: adminUser.userId,
      status: "revocado",
      revoked_at: "2026-03-05T12:00:00Z",
      revoked_by: adminUser.userId,
      revoked_reason: "El tutor retiró el consentimiento",
    },
  ]);
  if (cErr) throw new Error(`insert consentimientos: ${cErr.message}`);

  // Comprobantes: uno aceptado con 2 líneas y XML enorme, uno anulado con 1 línea.
  const hugeXml = "<Linea>" + "x".repeat(40_000) + "</Linea>";
  const { data: docs, error: fErr } = await admin
    .from("fiscal_documents")
    .insert([
      {
        clinic_id: cid,
        patient_id: ana,
        encounter_id: enc.id,
        e_ncf: "E320000000001",
        comprador_nombre: "Ana Peña",
        comprador_rnc_cedula: "00100000001",
        monto_gravado_total: 100,
        monto_exento: 50,
        total_itbis: 18,
        monto_total: 168,
        status: "aceptado",
        xml_sin_firmar: hugeXml,
        xml_firmado: hugeXml,
        created_by: adminUser.userId,
        created_at: "2026-03-03T15:00:00Z",
      },
      {
        clinic_id: cid,
        patient_id: evil,
        e_ncf: "E320000000002",
        comprador_nombre: "Rosario",
        monto_gravado_total: 0,
        monto_exento: 10,
        total_itbis: 0,
        monto_total: 10,
        status: "anulado",
        voided_at: "2026-03-04T15:00:00Z",
        voided_by: adminUser.userId,
        voided_reason: "Error de digitación",
        created_by: adminUser.userId,
        created_at: "2026-03-03T16:00:00Z",
      },
    ])
    .select("id, e_ncf");
  if (fErr || !docs) throw new Error(`insert comprobantes: ${fErr?.message}`);
  const doc1 = docs.find((d) => d.e_ncf === "E320000000001")!.id;
  const doc2 = docs.find((d) => d.e_ncf === "E320000000002")!.id;
  const { error: iErr } = await admin.from("fiscal_document_items").insert([
    { fiscal_document_id: doc1, line_number: 1, description: "Consulta médica", quantity: 1, unit_price: 100, itbis_indicator: "1", line_total: 100 },
    { fiscal_document_id: doc1, line_number: 2, description: "Laboratorio exento", quantity: 2, unit_price: 25, itbis_indicator: "E", line_total: 50 },
    { fiscal_document_id: doc2, line_number: 1, description: "Línea del comprobante anulado", quantity: 1, unit_price: 10, itbis_indicator: "E", line_total: 10 },
  ]);
  if (iErr) throw new Error(`insert líneas: ${iErr.message}`);

  // Seguros, verificaciones y reclamaciones (una rechazada).
  const { data: ins, error: sErr } = await admin
    .from("patient_insurers")
    .insert({ clinic_id: cid, patient_id: ana, insurer_name: "SENASA", affiliate_number: "AF-123", recorded_by: adminUser.userId })
    .select("id")
    .single();
  if (sErr || !ins) throw new Error(`insert seguro: ${sErr?.message}`);
  const { error: elErr } = await admin.from("eligibility_checks").insert({
    clinic_id: cid,
    patient_id: ana,
    patient_insurer_id: ins.id,
    result: "elegible",
    notes: "Verificado por teléfono",
    checked_by: adminUser.userId,
  });
  if (elErr) throw new Error(`insert elegibilidad: ${elErr.message}`);
  const { error: clErr } = await admin.from("insurance_claims").insert({
    clinic_id: cid,
    encounter_id: enc.id,
    patient_insurer_id: ins.id,
    claimed_amount: 1500.5,
    status: "rechazada",
    rejection_reason: "Cobertura vencida",
    created_by: adminUser.userId,
  });
  if (clErr) throw new Error(`insert reclamación: ${clErr.message}`);

  // Citas: una quirúrgica (con su lista de verificación, creada por trigger) y más de 1000 en total.
  const baseDate = new Date("2026-04-01T13:00:00Z").getTime();
  const apptRows = Array.from({ length: N_APPOINTMENTS }, (_, i) => ({
    clinic_id: cid,
    patient_id: i % 2 === 0 ? ana : evil,
    provider_id: adminUser.userId,
    specialty_template_id: i === 0 ? cirugia.id : interna.id,
    appointment_type: i === 0 ? "procedimiento_quirurgico" : "consulta",
    scheduled_at: new Date(baseDate + i * 60_000).toISOString(),
    reason: i === 0 ? "- sin fiebre, hernia" : `Motivo ${i}`,
    created_by: adminUser.userId,
  }));
  for (const part of chunks(apptRows, 500)) {
    const { error } = await admin.from("appointments").insert(part);
    if (error) throw new Error(`insert citas: ${error.message}`);
  }
  await admin
    .from("appointment_surgical_checklist")
    .update({ analiticas_sangre: "si", evaluacion_cardiovascular: "no" })
    .eq("clinic_id", cid);
  // Cita de la otra clínica (no debe aparecer).
  await admin.from("appointments").insert({
    clinic_id: otherCid,
    patient_id: otherPatient!.id,
    provider_id: otherUser.userId,
    specialty_template_id: interna.id,
    scheduled_at: new Date(baseDate).toISOString(),
    created_by: otherUser.userId,
  });

  const emails = new Map<string, string>([[adminUser.userId, adminUser.email]]);

  console.log("\nCompletitud y aislamiento:");
  const data = await fetchRecordsData(adminUser.client, [...RECORD_DATASETS]);
  check(
    `citas: llegan las ${N_APPOINTMENTS}, no solo 1000`,
    data.appointments.length === N_APPOINTMENTS,
    `llegaron ${data.appointments.length}`
  );
  check(
    "sin citas repetidas entre páginas",
    new Set(data.appointments.map((a) => a.id)).size === data.appointments.length,
    "hay ids repetidos"
  );
  check("solo la clínica del admin (RLS): 2 pacientes, 0 ajenos", data.patients.length === 2 && !data.patients.some((p) => p.id === otherPatient!.id), JSON.stringify(data.patients.map((p) => p.id)));
  check(
    "consentimientos 2, comprobantes 2 con 3 líneas, reclamaciones 1, seguros 1, elegibilidad 1",
    data.consents.length === 2 &&
      data.fiscalDocs.length === 2 &&
      data.fiscalItems.length === 3 &&
      data.claims.length === 1 &&
      data.insurers.length === 1 &&
      data.eligibility.length === 1,
    JSON.stringify({
      c: data.consents.length,
      f: data.fiscalDocs.length,
      i: data.fiscalItems.length,
      r: data.claims.length,
      s: data.insurers.length,
      e: data.eligibility.length,
    })
  );
  const userIds = collectUserIds(data);
  check("collectUserIds incluye al admin", userIds.has(adminUser.userId), JSON.stringify([...userIds]));

  const table = (ds: (typeof RECORD_DATASETS)[number]) => buildRecordTable(ds, data, emails);
  const col = (t: ReturnType<typeof table>, header: string) => t.headers.indexOf(header);
  for (const ds of RECORD_DATASETS) {
    const t = table(ds);
    check(
      `${t.name}: encabezados únicos y filas del ancho correcto`,
      new Set(t.headers).size === t.headers.length && t.rows.every((r) => r.length === t.headers.length),
      "encabezados repetidos o filas desalineadas"
    );
  }

  console.log("\nContenido:");
  const consents = table("consents");
  const revoked = consents.rows.find((r) => r[col(consents, "Estado")] === "revocado")!;
  check(
    "consentimiento revocado conserva fecha, quién y motivo",
    revoked[col(consents, "Revocado el")] === "2026-03-05 08:00" &&
      revoked[col(consents, "Revocado por")] === adminUser.email &&
      revoked[col(consents, "Motivo de revocación")] === "El tutor retiró el consentimiento" &&
      revoked[col(consents, "Parentesco del firmante")] === "tutor",
    JSON.stringify(revoked)
  );
  check(
    "fecha de firma en hora de Santo Domingo (2026-03-02 03:30 UTC = 2026-03-01 23:30)",
    revoked[col(consents, "Fecha de firma")] === "2026-03-01 23:30",
    String(revoked[col(consents, "Fecha de firma")])
  );
  const valid = consents.rows.find((r) => r[col(consents, "Estado")] === "firmado")!;
  check(
    "consentimiento vigente: paciente resuelto, IP y texto completo (~52,000 caracteres)",
    valid[col(consents, "Apellido del paciente")] === "Peña" &&
      String(valid[col(consents, "IP del firmante")]).includes("203.0.113.7") &&
      String(valid[col(consents, "Texto del documento firmado")]).length === longText.length,
    JSON.stringify(valid.slice(0, 6))
  );

  const fiscal = table("fiscal");
  const voided = fiscal.rows.find((r) => r[col(fiscal, "e-NCF")] === "E320000000002")!;
  check(
    "comprobante anulado conserva estado, motivo y quién anuló",
    voided[col(fiscal, "Estado")] === "anulado" &&
      voided[col(fiscal, "Motivo de anulación")] === "Error de digitación" &&
      voided[col(fiscal, "Anulado por")] === adminUser.email,
    JSON.stringify(voided)
  );
  const accepted = fiscal.rows.find((r) => r[col(fiscal, "e-NCF")] === "E320000000001")!;
  check(
    "comprobante aceptado: montos como números y XML completo",
    accepted[col(fiscal, "Total")] === 168 &&
      accepted[col(fiscal, "ITBIS")] === 18 &&
      String(accepted[col(fiscal, "XML firmado")]).length === hugeXml.length,
    JSON.stringify(accepted.slice(0, 16))
  );
  const lines = table("fiscal_lines");
  check(
    "líneas: 3, ordenadas por comprobante y línea, con el e-NCF de su comprobante",
    lines.rows.length === 3 &&
      lines.rows[0][0] === "E320000000001" &&
      lines.rows[0][2] === 1 &&
      lines.rows[1][2] === 2 &&
      lines.rows[2][0] === "E320000000002",
    JSON.stringify(lines.rows.map((r) => [r[0], r[2]]))
  );

  const claims = table("claims");
  const claim = claims.rows[0];
  check(
    "reclamación rechazada: aseguradora, afiliado, monto, estado y motivo",
    claim[col(claims, "Aseguradora")] === "SENASA" &&
      claim[col(claims, "Número de afiliado")] === "AF-123" &&
      claim[col(claims, "Monto reclamado")] === 1500.5 &&
      claim[col(claims, "Estado")] === "rechazada" &&
      claim[col(claims, "Motivo de rechazo")] === "Cobertura vencida" &&
      claim[col(claims, "Apellido del paciente")] === "Peña",
    JSON.stringify(claim)
  );

  const appts = table("appointments");
  const surgical = appts.rows.find((r) => r[col(appts, "Tipo de cita")] === "procedimiento_quirurgico")!;
  check(
    "cita quirúrgica: especialidad por nombre, profesional por correo y su lista de verificación",
    surgical[col(appts, "Especialidad")] === cirugia.name &&
      surgical[col(appts, "Profesional")] === adminUser.email &&
      surgical[col(appts, "Lista quirúrgica: analíticas de sangre")] === "si" &&
      surgical[col(appts, "Lista quirúrgica: evaluación cardiovascular")] === "no" &&
      surgical[col(appts, "Lista quirúrgica: implantes aprobados por el seguro")] === "pendiente",
    JSON.stringify(surgical)
  );
  const normal = appts.rows.find((r) => r[col(appts, "Tipo de cita")] === "consulta")!;
  check("cita normal: columnas de la lista quirúrgica vacías", normal[col(appts, "Lista quirúrgica: analíticas de sangre")] === "", JSON.stringify(normal));

  const insurers = table("insurers");
  const elig = table("eligibility");
  check(
    "seguro y verificación de elegibilidad",
    insurers.rows[0][col(insurers, "Aseguradora")] === "SENASA" &&
      elig.rows[0][col(elig, "Resultado")] === "elegible" &&
      elig.rows[0][col(elig, "Aseguradora")] === "SENASA" &&
      elig.rows[0][col(elig, "Verificado por")] === adminUser.email,
    JSON.stringify([insurers.rows[0], elig.rows[0]])
  );

  console.log("\nSeguridad del archivo:");
  const apptCsv = generateTableCsv(appts);
  check("CSV lleva BOM UTF-8", apptCsv.charCodeAt(0) === 0xfeff, "sin BOM");
  const parsedAppts = Papa.parse<Record<string, string>>(apptCsv.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  check(`CSV de citas: ${N_APPOINTMENTS} filas`, parsedAppts.data.length === N_APPOINTMENTS, `filas ${parsedAppts.data.length}`);
  check(
    "CSV escapa el motivo '- sin fiebre, hernia' y el nombre '=EVIL()' (inyección de fórmulas)",
    parsedAppts.data.some((r) => r["Motivo"] === "'- sin fiebre, hernia") &&
      parsedAppts.data.some((r) => r["Nombre del paciente"] === "'=EVIL()") &&
      !parsedAppts.data.some((r) => r["Nombre del paciente"] === "=EVIL()"),
    JSON.stringify(parsedAppts.data[0])
  );
  const consentsCsv = Papa.parse<Record<string, string>>(generateTableCsv(consents).replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  check(
    "CSV de consentimientos conserva el texto largo COMPLETO y escapa '=CMD...'",
    consentsCsv.data.some((r) => r["Texto del documento firmado"]?.length === longText.length) &&
      consentsCsv.data.some((r) => (r["Firmante"] ?? "").startsWith("'=CMD")),
    JSON.stringify(consentsCsv.data.map((r) => r["Texto del documento firmado"]?.length))
  );
  const fiscalCsv = Papa.parse<Record<string, string>>(generateTableCsv(fiscal).replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  check(
    "CSV de comprobantes conserva el XML completo",
    fiscalCsv.data.some((r) => r["XML firmado"]?.length === hugeXml.length),
    JSON.stringify(fiscalCsv.data.map((r) => r["XML firmado"]?.length))
  );
  const clipped = clipForExcel("a".repeat(EXCEL_CELL_LIMIT + 500)) as string;
  check(
    `texto >${EXCEL_CELL_LIMIT} caracteres: se recorta a ≤ el límite y lo avisa`,
    clipped.length === EXCEL_CELL_LIMIT && clipped.includes("recortado"),
    `largo ${clipped.length}`
  );
  check("texto corto y números no se tocan", clipForExcel("hola") === "hola" && clipForExcel(42) === 42, "se alteró");

  console.log("\nLibro completo:");
  const patientData = await fetchPatientsExportData(adminUser.client, { withDetail: true });
  const tables = [
    ...buildPatientTables(patientData.patients, patientData.allergies, patientData.medications),
    ...RECORD_DATASETS.map((ds) => buildRecordTable(ds, data, emails)),
  ];
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    (await generateTablesXlsx(tables, {
      generatedOn: "2026-10-07",
      summaryLabel: "Hoja",
      countLabel: "Filas exportadas",
      note: "prueba",
    })) as unknown as ExcelJS.Buffer
  );
  const titles = book.worksheets.map((w) => w.name);
  check(
    `libro: Resumen + ${tables.length} hojas con nombres únicos`,
    titles.length === tables.length + 1 && titles[0] === "Resumen" && new Set(titles.map((t) => t.toLowerCase())).size === titles.length,
    JSON.stringify(titles)
  );
  const consentSheet = book.getWorksheet("Consentimientos")!;
  const textCol = consents.headers.indexOf("Texto del documento firmado") + 1;
  const maxLen = Math.max(...[2, 3].map((r) => String(consentSheet.getRow(r).getCell(textCol).value ?? "").length));
  check(
    "en el .xlsx el texto largo quedó recortado dentro del límite de Excel (el libro abre)",
    maxLen <= EXCEL_CELL_LIMIT && maxLen > 30_000,
    `largo máximo ${maxLen}`
  );
  const resumen = book.getWorksheet("Resumen")!;
  const rows = (resumen.getRows(1, resumen.rowCount) ?? []).map((r) => [r.getCell(1).value, r.getCell(2).value]);
  const rowCount = (name: string) => rows.find((r) => r[0] === name)?.[1];
  check(
    "hoja Resumen: filas por hoja",
    rowCount("Citas") === N_APPOINTMENTS && rowCount("Comprobantes fiscales") === 2 && rowCount("Líneas de comprobantes") === 3 && rowCount("Pacientes") === 2,
    JSON.stringify(rows)
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
    console.log("\nOK: exportación de consentimientos, comprobantes, reclamaciones, citas y seguros verificada.");
  });
