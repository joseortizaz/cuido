/**
 * Prueba de A5 (paquete en Excel) y A6 (reportes e historial de estados) de las reclamaciones a ARS
 * (supabase/migrations/20261014100000_claim_status_history.sql, src/lib/domain/claims-report.ts,
 * src/lib/bulk-import/claims-package.ts y claims-report-data.ts).
 *
 * Qué verifica:
 *   1. DOMINIO (sin base de datos): tasa de rechazo, tramos de antigüedad en sus bordes, días de
 *      respuesta, agrupación de motivos, montos, periodos, zona horaria de Santo Domingo y la clave de
 *      aseguradora.
 *   2. HISTORIAL (clínicas sintéticas): el trigger registra la creación y cada cambio REAL de estado
 *      (quién, motivo, monto) y no un UPDATE que no cambia el estado; nadie escribe en el historial
 *      directamente; aislamiento entre clínicas; solo lectura rechaza el cambio y no deja fila; clínica
 *      bloqueada sin lectura.
 *   3. PAQUETE: con más de 1,000 reclamaciones no trunca; filtra por ARS, estado y fechas de servicio;
 *      trae líneas del e-CF y diagnósticos; «Por completar» detecta cada faltante; el libro .xlsx abre;
 *      otra clínica no ve nada.
 *   4. REPORTE: lo calculado con datos reales coincide con lo sembrado, y solo con los de la clínica.
 *   5. COBERTURA: ninguna tabla nueva queda sin guard ni sin política «de clínica activa» justificada.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";
import { insurerKey, normalizeInsurerName } from "../src/lib/domain/claims";
import {
  AGING_BUCKETS,
  agingBucketIndex,
  buildClaimsReport,
  dateInSantoDomingo,
  daysBetween,
  normalizeReason,
  periodStart,
  reportTables,
  type ReportClaim,
  type ReportTransition,
} from "../src/lib/domain/claims-report";
import {
  buildPackageTables,
  claimIssues,
  fetchPackageData,
  listPackageInsurers,
  packageProviderIds,
} from "../src/lib/bulk-import/claims-package";
import { loadClaimsReport } from "../src/lib/bulk-import/claims-report-data";
import { generateTablesXlsx } from "../src/lib/bulk-import/export-tables";

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
  const email = `claims-reports-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, email, client: client as unknown as SupabaseClient<Database> };
}
type TestUser = Awaited<ReturnType<typeof createUser>>;

async function createClinic(owner: TestUser, label: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] Reportes ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const N_BULK = 1050; // por encima del límite de 1000 filas de PostgREST

async function main() {
  // ------------------------------------------------------------------ 1. dominio
  console.log("\nDominio (reportes):");
  const TODAY = "2026-10-20";
  const at = (daysAgo: number, hour = 15) => `${addDays(TODAY, -daysAgo)}T${String(hour).padStart(2, "0")}:00:00Z`;

  check(
    "zona horaria: 2026-10-21T02:30Z es todavía 2026-10-20 en Santo Domingo; 2026-10-21T04:00Z ya es el 21",
    dateInSantoDomingo("2026-10-21T02:30:00Z") === "2026-10-20" && dateInSantoDomingo("2026-10-21T04:00:00Z") === "2026-10-21",
    `${dateInSantoDomingo("2026-10-21T02:30:00Z")} / ${dateInSantoDomingo("2026-10-21T04:00:00Z")}`
  );
  check("daysBetween cuenta días calendario", daysBetween("2026-10-01", "2026-10-20") === 19 && daysBetween("2026-10-20", "2026-10-20") === 0, "mal conteo");
  check(
    "tramos de antigüedad en sus bordes (7/8, 15/16, 30/31, 60/61 y negativos)",
    [0, 7, 8, 15, 16, 30, 31, 60, 61, 400, -3].map(agingBucketIndex).join(",") === "0,0,1,1,2,2,3,3,4,4,0",
    [0, 7, 8, 15, 16, 30, 31, 60, 61, 400, -3].map(agingBucketIndex).join(",")
  );
  check("periodStart: 30 días y «todo»", periodStart("30", TODAY) === "2026-09-20" && periodStart("todo", TODAY) === null && periodStart("x", TODAY) === null, String(periodStart("30", TODAY)));
  check(
    "motivos: mayúsculas, acentos y espacios se agrupan",
    normalizeReason("  Sin  COBERTURA ") === normalizeReason("sin cobertura") && normalizeReason("Código inválido") === "codigo invalido",
    normalizeReason("  Sin  COBERTURA ")
  );
  check(
    "clave de aseguradora: catálogo por id; a mano por nombre normalizado (sin «ARS», acentos ni puntuación)",
    insurerKey({ insurer_id: "abc", insurer_name: "X" }) === "abc" &&
      insurerKey({ insurer_id: null, insurer_name: "  ARS Yunén. " }) === "name:yunen" &&
      normalizeInsurerName("ARS  Palic. Salud") === "palic salud",
    insurerKey({ insurer_id: null, insurer_name: "  ARS Yunén. " })
  );

  const mk = (id: string, status: string, o: Partial<ReportClaim> = {}): ReportClaim => ({
    id,
    status,
    claimed_amount: 100,
    approved_amount: null,
    paid_amount: null,
    rejection_reason: null,
    created_at: at(100),
    insurer_key: "A",
    insurer_label: "ARS A",
    ...o,
  });
  const tr = (claim_id: string, to_status: string, daysAgo: number): ReportTransition => ({ claim_id, to_status, changed_at: at(daysAgo) });

  const r1 = buildClaimsReport(
    [
      mk("c1", "aprobada", { approved_amount: 80, paid_amount: 30 }),
      mk("c2", "aprobada", { approved_amount: 50, paid_amount: 50 }),
      mk("c3", "rechazada", { rejection_reason: "Sin cobertura" }),
      mk("c4", "rechazada", { rejection_reason: "  sin  COBERTURA " }),
      mk("c5", "rechazada", { rejection_reason: "Código inválido" }),
      mk("c6", "pendiente"),
      mk("c7", "enviada", { insurer_key: "B", insurer_label: "ARS B" }),
    ],
    [
      tr("c1", "enviada", 20), tr("c1", "aprobada", 17), // 3 días
      tr("c2", "enviada", 10), tr("c2", "aprobada", 9), // 1 día
      tr("c3", "enviada", 5), tr("c3", "rechazada", 5), // 0 días
      tr("c7", "enviada", 12),
    ],
    TODAY
  );
  check("totales: 7 reclamaciones, reclamado 700, aprobado 130, cobrado 80, por cobrar 50", r1.totals.count === 7 && r1.totals.claimed === 700 && r1.totals.approved === 130 && r1.totals.paid === 80 && r1.totals.pending === 50, JSON.stringify(r1.totals));
  check("tasa de rechazo = 3 rechazadas / 5 resueltas = 60 %", Math.abs((r1.totals.rejectionRate ?? -1) - 0.6) < 1e-9, String(r1.totals.rejectionRate));
  check("días promedio de respuesta = (3 + 1 + 0) / 3", Math.abs((r1.totals.avgResponseDays ?? -1) - 4 / 3) < 1e-9, String(r1.totals.avgResponseDays));
  check(
    "motivos agrupados: «Sin cobertura» 2 y «Código inválido» 1 (más frecuente primero)",
    r1.byReason.length === 2 && r1.byReason[0].count === 2 && r1.byReason[0].reason === "Sin cobertura" && r1.byReason[1].count === 1,
    JSON.stringify(r1.byReason)
  );
  check("por ARS: ARS A (6) y ARS B (1), A primero", r1.byInsurer.map((r) => `${r.label}:${r.count}`).join(",") === "ARS A:6,ARS B:1", JSON.stringify(r1.byInsurer.map((r) => r.label)));
  check("enviada sin respuesta (c7, desde hace 12 días) cae en el tramo 8–15", r1.sentWithoutResponse.count === 1 && r1.sentWithoutResponse.buckets[1].count === 1 && r1.sentWithoutResponse.amount === 100, JSON.stringify(r1.sentWithoutResponse.buckets));
  check("aprobada con saldo (c1: 50 pendientes desde hace 17 días) cae en el tramo 16–30; c2 (saldo 0) no cuenta", r1.approvedWithBalance.count === 1 && r1.approvedWithBalance.buckets[2].count === 1 && r1.approvedWithBalance.amount === 50, JSON.stringify(r1.approvedWithBalance.buckets));
  const empty = buildClaimsReport([], [], TODAY);
  check("sin reclamaciones: tasas y promedios nulos, sin errores", empty.totals.rejectionRate === null && empty.totals.avgResponseDays === null && empty.totals.count === 0, JSON.stringify(empty.totals));
  const noResolved = buildClaimsReport([mk("x", "enviada")], [], TODAY);
  check("sin resueltas la tasa de rechazo es nula (no 0 %); sin historial se usa la fecha de registro", noResolved.totals.rejectionRate === null && noResolved.sentWithoutResponse.buckets[4].count === 1, JSON.stringify(noResolved.sentWithoutResponse.buckets));
  const tables = reportTables(r1);
  check("el reporte como tablas: Resumen, Por ARS, Motivos de rechazo y Antigüedad", tables.map((t) => t.name).join("|") === "Resumen|Por ARS|Motivos de rechazo|Antigüedad" && tables[3].rows.length === AGING_BUCKETS.length, tables.map((t) => t.name).join("|"));

  // ------------------------------------------------------------- preparación BD
  const adminA = await createUser("admin-a");
  const medicoA = await createUser("medico-a");
  const adminB = await createUser("admin-b");
  const operator = await createUser("operador");
  await admin.from("platform_operators").insert({ user_id: operator.userId });
  const op = operator.client;

  const cidA = await createClinic(adminA, "A");
  const cidB = await createClinic(adminB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cidA, user_id: medicoA.userId, role: "medico" });
  const { data: todayData } = await admin.rpc("dr_today");
  const today = todayData as string;

  const { data: tpl } = await admin.from("specialty_templates").select("id").eq("code", "medicina_interna").single();
  const { data: senasa } = await admin.from("insurers").select("id, name").eq("name", "SENASA").single();
  if (!tpl || !senasa) throw new Error("Faltan la plantilla base o SENASA en el catálogo.");

  const newPatient = async (clinicId: string, first: string, nationalId: string | null) => {
    const { data, error } = await admin
      .from("patients")
      .insert({ clinic_id: clinicId, first_name: first, last_name: "Reporte", national_id: nationalId, date_of_birth: "1990-01-01", sex: "femenino" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert paciente: ${error?.message}`);
    return data.id;
  };
  const newEncounter = async (clinicId: string, patientId: string, daysAgo: number) => {
    const { data, error } = await admin
      .from("encounters")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        provider_id: adminA.userId,
        specialty_template_id: tpl.id,
        specialty_data: {},
        encounter_date: `${addDays(today, -daysAgo)}T15:00:00Z`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert consulta: ${error?.message}`);
    return data.id;
  };
  const newInsurer = async (clinicId: string, patientId: string, opts: { catalogId?: string; name: string; affiliate: string }) => {
    const { data, error } = await admin
      .from("patient_insurers")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        insurer_id: opts.catalogId ?? null,
        insurer_name: opts.name,
        affiliate_number: opts.affiliate,
        recorded_by: adminA.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert seguro: ${error?.message}`);
    return data.id;
  };
  const newDoc = async (clinicId: string, patientId: string, ncf: string, status = "aceptado") => {
    const { data, error } = await admin
      .from("fiscal_documents")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        e_ncf: ncf,
        comprador_nombre: "Comprador",
        monto_gravado_total: 0,
        monto_exento: 300,
        total_itbis: 0,
        monto_total: 300,
        status,
        created_by: adminA.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert comprobante: ${error?.message}`);
    return data.id;
  };

  const p1 = await newPatient(cidA, "Completa", "RPT-1");
  const p2 = await newPatient(cidA, "ALocal", "RPT-2");
  const p3 = await newPatient(cidA, "Incompleta", null); // sin cédula
  const pBulk = await newPatient(cidA, "Volumen", "RPT-V");
  const pB = await newPatient(cidB, "Bruno", "RPT-B");
  const i1 = await newInsurer(cidA, p1, { catalogId: senasa.id, name: senasa.name, affiliate: "AF-1" });
  const i2 = await newInsurer(cidA, p2, { name: "Seguro Local Reporte", affiliate: "AF-2" });
  const i3 = await newInsurer(cidA, p3, { catalogId: senasa.id, name: senasa.name, affiliate: "AF-3" });
  const iBulk = await newInsurer(cidA, pBulk, { name: "ARS Prueba Volumen", affiliate: "AF-V" });
  const iB = await newInsurer(cidB, pB, { catalogId: senasa.id, name: senasa.name, affiliate: "AF-B" });

  const e1 = await newEncounter(cidA, p1, 10);
  const e1old = await newEncounter(cidA, p1, 60); // servicio antiguo, para el filtro de fechas
  const e2 = await newEncounter(cidA, p2, 5);
  const e3 = await newEncounter(cidA, p3, 4);
  const eBulk = await newEncounter(cidA, pBulk, 3);
  const eB = await newEncounter(cidB, pB, 2);
  const d1 = await newDoc(cidA, p1, "E320000006001");
  const d3 = await newDoc(cidA, p3, "E320000006003", "anulado"); // comprobante anulado
  await admin.from("fiscal_document_items").insert([
    { fiscal_document_id: d1, line_number: 1, description: "Consulta", quantity: 1, unit_price: 200, itbis_indicator: "E", line_total: 200 },
    { fiscal_document_id: d1, line_number: 2, description: "Procedimiento", quantity: 1, unit_price: 100, itbis_indicator: "E", line_total: 100 },
  ]);

  const insertClaim = async (row: Partial<Database["public"]["Tables"]["insurance_claims"]["Insert"]> & { encounter_id: string; patient_insurer_id: string; clinic_id: string }) => {
    const { data, error } = await admin
      .from("insurance_claims")
      .insert({ created_by: adminA.userId, status: "pendiente", ...row })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert reclamación: ${error?.message}`);
    return data.id;
  };

  // c1: completa (SENASA, comprobante, autorización, diagnóstico, cédula)
  const c1 = await insertClaim({ clinic_id: cidA, encounter_id: e1, patient_insurer_id: i1, fiscal_document_id: d1, authorization_number: "AUT-1", claimed_amount: 300 });
  await admin.from("insurance_claim_diagnoses").insert({ clinic_id: cidA, claim_id: c1, code: "J00", description: "Rinofaringitis aguda", is_primary: true, created_by: adminA.userId });
  await admin.from("insurance_claim_diagnoses").insert({ clinic_id: cidA, claim_id: c1, code: "R50.9", description: "Fiebre", position: 2, created_by: adminA.userId });
  // c1old: servicio de hace 60 días (queda fuera de un filtro reciente)
  const c1old = await insertClaim({ clinic_id: cidA, encounter_id: e1old, patient_insurer_id: i1, claimed_amount: 50 });
  // c2: otra ARS (a mano, sin catálogo)
  const c2 = await insertClaim({ clinic_id: cidA, encounter_id: e2, patient_insurer_id: i2, claimed_amount: 120 });
  // c3: incompleta a propósito (sin dx, comprobante anulado, sin autorización, sin cédula, sin monto)
  const c3 = await insertClaim({ clinic_id: cidA, encounter_id: e3, patient_insurer_id: i3, fiscal_document_id: d3 });
  // B: otra clínica con la misma ARS de catálogo
  await insertClaim({ clinic_id: cidB, encounter_id: eB, patient_insurer_id: iB, claimed_amount: 999 });

  // ------------------------------------------------------------ 2. historial
  console.log("\nHistorial de estados:");
  const history = async (claimId: string) => {
    const { data } = await admin
      .from("insurance_claim_status_history")
      .select("from_status, to_status, changed_by, rejection_reason, approved_amount")
      .eq("claim_id", claimId)
      .order("changed_at", { ascending: true })
      .order("id", { ascending: true });
    return data ?? [];
  };
  const h0 = await history(c1);
  check("la creación deja una fila (de nada a «pendiente», con quien la registró)", h0.length === 1 && h0[0].from_status === null && h0[0].to_status === "pendiente" && h0[0].changed_by === adminA.userId, JSON.stringify(h0));

  const { error: notesOnly } = await adminA.client.from("insurance_claims").update({ notes: "solo una nota" }).eq("id", c1);
  check("un UPDATE que no cambia el estado NO deja fila de historial", notesOnly === null && (await history(c1)).length === 1, notesOnly?.message ?? "dejó fila");
  const { error: sameStatus } = await adminA.client.from("insurance_claims").update({ status: "pendiente" }).eq("id", c1);
  check("ni escribir el mismo estado otra vez", sameStatus === null && (await history(c1)).length === 1, sameStatus?.message ?? "dejó fila");

  const { error: toSent } = await adminA.client.from("insurance_claims").update({ status: "enviada" }).eq("id", c1);
  const { error: toApproved } = await adminA.client
    .from("insurance_claims")
    .update({ status: "aprobada", approved_amount: 250 })
    .eq("id", c1);
  const h1 = await history(c1);
  check(
    "cada cambio real queda: pendiente -> enviada -> aprobada (con el monto aprobado y quién lo hizo)",
    toSent === null &&
      toApproved === null &&
      h1.length === 3 &&
      h1[1].from_status === "pendiente" && h1[1].to_status === "enviada" &&
      h1[2].from_status === "enviada" && h1[2].to_status === "aprobada" && h1[2].approved_amount === 250 &&
      h1[2].changed_by === adminA.userId,
    JSON.stringify(h1)
  );
  await admin.from("insurance_claims").update({ paid_amount: 100, paid_on: today }).eq("id", c1); // cobro parcial: no es cambio de estado
  check("registrar un cobro no es un cambio de estado", (await history(c1)).length === 3, "dejó fila");

  await adminA.client.from("insurance_claims").update({ status: "enviada" }).eq("id", c2);
  await adminA.client.from("insurance_claims").update({ status: "rechazada", rejection_reason: "Sin cobertura" }).eq("id", c2);
  const h2 = await history(c2);
  check("el motivo de rechazo queda en el historial", h2.length === 3 && h2[2].to_status === "rechazada" && h2[2].rejection_reason === "Sin cobertura", JSON.stringify(h2));

  const { error: directInsert } = await adminA.client
    .from("insurance_claim_status_history")
    .insert({ clinic_id: cidA, claim_id: c1, to_status: "rechazada", changed_by: adminA.userId });
  check("un admin NO puede escribir en el historial directamente", directInsert !== null, "insertó");
  await adminA.client.from("insurance_claim_status_history").update({ to_status: "pendiente" }).eq("claim_id", c1);
  await adminA.client.from("insurance_claim_status_history").delete().eq("claim_id", c1);
  const h1b = await history(c1);
  check("ni modificarlo ni borrarlo (las filas siguen intactas)", h1b.length === 3 && h1b[2].to_status === "aprobada", JSON.stringify(h1b));

  const { data: seenByMedico } = await medicoA.client.from("insurance_claim_status_history").select("id").eq("claim_id", c1);
  const { data: seenByB } = await adminB.client.from("insurance_claim_status_history").select("id").eq("claim_id", c1);
  const { data: seenByOp } = await op.from("insurance_claim_status_history").select("id");
  check(
    "un médico de la clínica lo lee; otra clínica y el operador NO",
    (seenByMedico ?? []).length === 3 && (seenByB ?? []).length === 0 && (seenByOp ?? []).length === 0,
    JSON.stringify({ medico: seenByMedico?.length, B: seenByB?.length, op: seenByOp?.length })
  );

  // Solo lectura: el cambio de estado se rechaza y no deja fila. Bloqueada: no se lee.
  await admin.from("clinic_subscriptions").update({ trial_ends_at: addDays(today, -31), next_payment_due_on: null }).eq("clinic_id", cidA);
  const { error: roUpdate } = await adminA.client.from("insurance_claims").update({ status: "enviada" }).eq("id", c3);
  check("en solo lectura el cambio de estado se rechaza", roUpdate !== null && /modo solo lectura/.test(roUpdate.message), roUpdate?.message ?? "lo aceptó");
  check("y no deja fila de historial (solo la de creación)", (await history(c3)).length === 1, "dejó fila");
  await admin.from("clinic_subscriptions").update({ trial_ends_at: addDays(today, -121), next_payment_due_on: null }).eq("clinic_id", cidA);
  const { data: blockedRead } = await adminA.client.from("insurance_claim_status_history").select("id");
  check("con la clínica bloqueada no se lee ninguna fila", (blockedRead ?? []).length === 0, `leyó ${blockedRead?.length}`);
  await admin.from("clinic_subscriptions").update({ trial_ends_at: addDays(today, 30), next_payment_due_on: null }).eq("clinic_id", cidA);

  // ------------------------------------------------------------- 3. paquete
  console.log("\nPaquete en Excel:");
  const bulk = Array.from({ length: N_BULK }, (_, i) => ({
    clinic_id: cidA,
    encounter_id: eBulk,
    patient_insurer_id: iBulk,
    status: "pendiente",
    claimed_amount: 10 + i,
    created_by: adminA.userId,
  }));
  for (const part of chunks(bulk, 500)) {
    const { error } = await admin.from("insurance_claims").insert(part);
    if (error) throw new Error(`insert reclamaciones masivas: ${error.message}`);
  }

  const senasaKey = senasa.id;
  const localKey = insurerKey({ insurer_id: null, insurer_name: "Seguro Local Reporte" });
  const bulkKey = insurerKey({ insurer_id: null, insurer_name: "ARS Prueba Volumen" });

  const pkgBulk = await fetchPackageData(adminA.client, { insurerKey: bulkKey, status: "pendiente" });
  check(`${N_BULK} reclamaciones de una ARS llegan completas (sin truncar en 1,000)`, pkgBulk.claims.length === N_BULK, `llegaron ${pkgBulk.claims.length}`);
  check("numeradas de 1 a N sin repetir", new Set(pkgBulk.claims.map((c) => c.number)).size === N_BULK && pkgBulk.claims[N_BULK - 1].number === N_BULK, "numeración incorrecta");
  const bulkBook = new ExcelJS.Workbook();
  await bulkBook.xlsx.load(
    (await generateTablesXlsx(buildPackageTables(pkgBulk, new Map([[adminA.userId, adminA.email]])), {
      generatedOn: today,
      summaryLabel: "Hoja",
      countLabel: "Filas",
      note: "prueba",
    })) as unknown as ExcelJS.Buffer
  );
  check(
    `el libro abre con las hojas esperadas y ${N_BULK} filas en «Reclamaciones»`,
    bulkBook.worksheets.map((w) => w.name).join("|") === "Resumen|Reclamaciones|Servicios facturados|Diagnósticos|Por completar" &&
      bulkBook.getWorksheet("Reclamaciones")!.rowCount === N_BULK + 1,
    `${bulkBook.worksheets.map((w) => `${w.name}:${w.rowCount}`).join(" ")}`
  );

  const pkgSenasa = await fetchPackageData(adminA.client, { insurerKey: senasaKey, status: "pendiente" });
  const senasaIds = pkgSenasa.claims.map((c) => c.raw.id);
  check(
    "filtro por ARS del catálogo: SENASA trae sus pendientes (c1 ya está aprobada; quedan c1old y c3) y no las de otra ARS ni otra clínica",
    senasaIds.length === 2 && senasaIds.includes(c1old) && senasaIds.includes(c3) && !senasaIds.includes(c2),
    JSON.stringify(senasaIds)
  );
  const pkgLocal = await fetchPackageData(adminA.client, { insurerKey: localKey, status: "todas" });
  check("una ARS escrita a mano se elige por su nombre normalizado", pkgLocal.claims.length === 1 && pkgLocal.claims[0].raw.id === c2, JSON.stringify(pkgLocal.claims.map((c) => c.raw.id)));
  const pkgAll = await fetchPackageData(adminA.client, { insurerKey: senasaKey, status: "todas" });
  check("estado «todas»: SENASA trae c1, c1old y c3", pkgAll.claims.length === 3, `trajo ${pkgAll.claims.length}`);
  const pkgRecent = await fetchPackageData(adminA.client, { insurerKey: senasaKey, status: "todas", from: addDays(today, -30) });
  check("filtro de fechas del servicio: desde hace 30 días excluye el servicio de hace 60", pkgRecent.claims.length === 2 && !pkgRecent.claims.some((c) => c.raw.id === c1old), JSON.stringify(pkgRecent.claims.map((c) => c.raw.id)));
  const pkgRange = await fetchPackageData(adminA.client, { insurerKey: senasaKey, status: "todas", from: addDays(today, -11), to: addDays(today, -9) });
  check("rango cerrado (hace 11 a 9 días): solo el servicio de hace 10", pkgRange.claims.length === 1 && pkgRange.claims[0].raw.id === c1, JSON.stringify(pkgRange.claims.map((c) => c.raw.id)));
  const pkgApproved = await fetchPackageData(adminA.client, { insurerKey: senasaKey, status: "aprobada" });
  check("filtro por estado: aprobadas de SENASA = c1", pkgApproved.claims.length === 1 && pkgApproved.claims[0].raw.id === c1, JSON.stringify(pkgApproved.claims.map((c) => c.raw.id)));

  const tablesAll = buildPackageTables(pkgAll, new Map([[adminA.userId, adminA.email]]));
  const byName = (n: string) => tablesAll.find((t) => t.name === n)!;
  const claimsT = byName("Reclamaciones");
  const col = (t: { headers: string[] }, h: string) => t.headers.indexOf(h);
  const row1 = claimsT.rows.find((r) => r[col(claimsT, "e-NCF")] === "E320000006001")!;
  check(
    "la reclamación completa trae paciente, afiliado, profesional, comprobante, autorización, diagnóstico principal y otros diagnósticos",
    row1[col(claimsT, "Número de afiliado")] === "AF-1" &&
      row1[col(claimsT, "Cédula o pasaporte")] === "RPT-1" &&
      row1[col(claimsT, "Profesional")] === adminA.email &&
      row1[col(claimsT, "Monto del comprobante")] === 300 &&
      row1[col(claimsT, "Autorización")] === "AUT-1" &&
      row1[col(claimsT, "Diagnóstico principal (código)")] === "J00" &&
      row1[col(claimsT, "Sistema")] === "CIE-10" &&
      String(row1[col(claimsT, "Otros diagnósticos")]).includes("R50.9") &&
      row1[col(claimsT, "Monto reclamado")] === 300,
    JSON.stringify(row1)
  );
  const services = byName("Servicios facturados");
  check("«Servicios facturados» trae las 2 líneas del e-CF con su e-NCF", services.rows.length === 2 && services.rows.every((r) => r[1] === "E320000006001"), JSON.stringify(services.rows));
  check("«Diagnósticos» trae los 2 diagnósticos codificados (el principal marcado)", byName("Diagnósticos").rows.length === 2 && byName("Diagnósticos").rows.some((r) => r[2] === "J00" && r[5] === "Sí"), JSON.stringify(byName("Diagnósticos").rows));

  const missingT = byName("Por completar");
  const num3 = pkgAll.claims.find((c) => c.raw.id === c3)!.number;
  const issues3 = missingT.rows.filter((r) => r[0] === num3).map((r) => String(r[2]));
  check(
    "«Por completar» detecta lo que le falta a la incompleta: sin diagnóstico, comprobante anulado, sin autorización, sin cédula y sin monto",
    issues3.length === 5 &&
      issues3.some((i) => /diagnóstico/.test(i)) &&
      issues3.some((i) => /anulado/.test(i)) &&
      issues3.some((i) => /autorización/.test(i)) &&
      issues3.some((i) => /cédula/.test(i)) &&
      issues3.some((i) => /monto/.test(i)),
    JSON.stringify(issues3)
  );
  const num1 = pkgAll.claims.find((c) => c.raw.id === c1)!.number;
  check("la completa no aparece en «Por completar»", !missingT.rows.some((r) => r[0] === num1) && claimIssues(pkgAll.claims.find((c) => c.raw.id === c1)!).length === 0, "apareció");
  check("los profesionales a resolver son los de las consultas del paquete", packageProviderIds(pkgAll).has(adminA.userId), "falta el profesional");

  const optionsA = await listPackageInsurers(adminA.client);
  const optSenasa = optionsA.find((o) => o.key === senasaKey);
  const optBulk = optionsA.find((o) => o.key === bulkKey);
  check(
    "el selector lista las ARS con sus pendientes (SENASA 2 de 3; Volumen 1050)",
    optSenasa?.pending === 2 && optSenasa?.total === 3 && optBulk?.pending === N_BULK && optionsA.length === 3,
    JSON.stringify(optionsA)
  );
  const pkgB = await fetchPackageData(adminB.client, { insurerKey: senasaKey, status: "todas" });
  const optionsB = await listPackageInsurers(adminB.client);
  check("otra clínica con la misma ARS de catálogo solo ve las suyas (1) y sus opciones", pkgB.claims.length === 1 && pkgB.claims[0].raw.id !== c1 && optionsB.length === 1 && optionsB[0].total === 1, JSON.stringify({ n: pkgB.claims.length, optionsB }));
  const pkgMedico = await fetchPackageData(medicoA.client, { insurerKey: senasaKey, status: "todas" });
  check("(la restricción a admin y recepción la aplica la ruta; RLS solo aísla clínicas: un médico de la clínica lee las mismas filas)", pkgMedico.claims.length === 3, `leyó ${pkgMedico.claims.length}`);

  // ------------------------------------------------------------- 4. reporte
  console.log("\nReporte con datos reales:");
  const { report } = await loadClaimsReport(adminA.client, "todo");
  const expectedCount = 4 + N_BULK; // c1, c1old, c2, c3 + volumen
  check(`el reporte de la clínica cuenta ${expectedCount} reclamaciones (y no cuenta las de otra clínica)`, report.totals.count === expectedCount, `contó ${report.totals.count}`);
  check(
    "por estado: 1 aprobada (c1), 1 rechazada (c2), el resto pendientes",
    report.totals.byStatus.aprobada === 1 && report.totals.byStatus.rechazada === 1 && report.totals.byStatus.pendiente === expectedCount - 2,
    JSON.stringify(report.totals.byStatus)
  );
  check("tasa de rechazo 50 % (1 aprobada, 1 rechazada)", Math.abs((report.totals.rejectionRate ?? -1) - 0.5) < 1e-9, String(report.totals.rejectionRate));
  check("aprobado 250, cobrado 100, por cobrar 150", report.totals.approved === 250 && report.totals.paid === 100 && report.totals.pending === 150, JSON.stringify(report.totals));
  check("motivo de rechazo «Sin cobertura» (1)", report.byReason.length === 1 && report.byReason[0].reason === "Sin cobertura", JSON.stringify(report.byReason));
  check("respuesta de la ARS medida desde el historial (mismo día = 0 días)", report.totals.avgResponseDays === 0, String(report.totals.avgResponseDays));
  check("por ARS: SENASA, Seguro Local Reporte y ARS Prueba Volumen", report.byInsurer.length === 3 && report.byInsurer[0].label === "ARS Prueba Volumen", JSON.stringify(report.byInsurer.map((r) => r.label)));
  const reportB = await loadClaimsReport(adminB.client, "todo");
  check("la otra clínica ve solo su reclamación (1) en su reporte", reportB.report.totals.count === 1 && reportB.report.totals.claimed === 999, JSON.stringify(reportB.report.totals));
  const reportRecent = await loadClaimsReport(adminA.client, "30");
  check("un periodo de 30 días sigue incluyendo lo registrado hoy", reportRecent.report.totals.count === expectedCount && reportRecent.since === addDays(reportRecent.today, -30), `${reportRecent.report.totals.count} / ${reportRecent.since}`);

  // ------------------------------------------------------------ 5. cobertura
  console.log("\nCobertura:");
  const { data: unguarded } = await admin.rpc("list_unguarded_tables");
  check("ninguna tabla pública queda sin guard fuera de la lista explícita", (unguarded ?? []).length === 0, JSON.stringify(unguarded));
  const { data: openPolicies } = await admin.rpc("list_policies_open_when_blocked");
  check("ninguna política queda abierta al bloqueo sin justificar", (openPolicies ?? []).length === 0, JSON.stringify(openPolicies));
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
    console.log("\nOK: paquete en Excel, reportes e historial de reclamaciones verificados.");
  });
