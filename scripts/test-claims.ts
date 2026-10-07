/**
 * Prueba de las reclamaciones a ARS: bloque A.1 a A.3
 * (supabase/migrations/20261012100000_ars_claims_enrichment.sql y
 * src/lib/domain/claims.ts).
 *
 * Qué verifica, con clínicas sintéticas:
 *   1. DOMINIO (sin base de datos): normalización y validación de CIE-10/CIE-11,
 *      requisitos de cada estado (enviada exige diagnóstico, aprobada exige
 *      monto, rechazada exige motivo), cobro y «por cobrar».
 *   2. CATÁLOGO DE ARS: lo leen todos y solo lo escribe el operador; los nombres
 *      se reconocen por nombre o alias sin acentos ni «ARS»; el nombre se
 *      sincroniza al elegir del catálogo; no se duplican nombres equivalentes.
 *   3. INTEGRIDAD: la reclamación no puede mezclar pacientes ni clínicas (la
 *      aseguradora y el comprobante deben ser del paciente de la consulta), ni
 *      siquiera con service_role; montos y cobro coherentes.
 *   4. DIAGNÓSTICOS CODIFICADOS: formato CIE-10, un solo principal, sin
 *      repetidos, clinic_id derivado de la reclamación, aislamiento entre clínicas,
 *      solo-lectura y bloqueo total.
 *   5. COBERTURA: ninguna tabla nueva queda sin guard ni sin política «de clínica
 *      activa» justificada.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";
import {
  claimStatusError,
  normalizeCie10Code,
  pendingToCollect,
  validateDiagnosis,
  validatePayment,
} from "../src/lib/domain/claims";

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
const createdInsurerIds: string[] = [];

async function createUser(label: string) {
  const email = `claims-${label}-${randomUUID()}@example.invalid`;
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
    clinic_name: `[TEST] Reclamaciones ${label} ${randomUUID().slice(0, 8)}`,
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

async function main() {
  // ------------------------------------------------------------------ 1. dominio
  console.log("\nDominio (CIE, estados y cobro):");
  check(
    "CIE-10: j00 -> J00, e119 -> E11.9, s72001a -> S72.001A, ' k 29.7 ' -> K29.7",
    normalizeCie10Code("j00") === "J00" &&
      normalizeCie10Code("e119") === "E11.9" &&
      normalizeCie10Code("s72001a") === "S72.001A" &&
      normalizeCie10Code(" k 29.7 ") === "K29.7",
    [normalizeCie10Code("j00"), normalizeCie10Code("e119"), normalizeCie10Code("s72001a"), normalizeCie10Code(" k 29.7 ")].join(" | ")
  );
  const okDx = validateDiagnosis({ codeSystem: "CIE-10", code: "e119", description: "  Diabetes mellitus tipo 2 " });
  check(
    "validateDiagnosis acepta CIE-10 y devuelve código y descripción normalizados",
    okDx.ok && okDx.code === "E11.9" && okDx.description === "Diabetes mellitus tipo 2",
    JSON.stringify(okDx)
  );
  check("CIE-10 con formato inválido se rechaza", !validateDiagnosis({ codeSystem: "CIE-10", code: "ZZ", description: "x" }).ok, "aceptó ZZ");
  check("sin descripción se rechaza", !validateDiagnosis({ codeSystem: "CIE-10", code: "J00", description: " " }).ok, "aceptó sin descripción");
  check("sistema desconocido se rechaza", !validateDiagnosis({ codeSystem: "CIE-9", code: "J00", description: "x" }).ok, "aceptó CIE-9");
  check("CIE-11 se acepta como texto no vacío (mayúsculas)", (() => {
    const r = validateDiagnosis({ codeSystem: "CIE-11", code: "ba00", description: "Hipertensión" });
    return r.ok && r.code === "BA00";
  })(), "no aceptó CIE-11");
  check(
    "«enviada» exige al menos un diagnóstico codificado",
    claimStatusError({ next: "enviada", diagnosesCount: 0, rejectionReason: "", approvedAmount: null }) !== null &&
      claimStatusError({ next: "enviada", diagnosesCount: 1, rejectionReason: "", approvedAmount: null }) === null,
    "regla de «enviada» incorrecta"
  );
  check(
    "«aprobada» exige monto aprobado; «rechazada» exige motivo",
    claimStatusError({ next: "aprobada", diagnosesCount: 0, rejectionReason: "", approvedAmount: null }) !== null &&
      claimStatusError({ next: "aprobada", diagnosesCount: 0, rejectionReason: "", approvedAmount: 0 }) === null &&
      claimStatusError({ next: "rechazada", diagnosesCount: 0, rejectionReason: " ", approvedAmount: null }) !== null &&
      claimStatusError({ next: "rechazada", diagnosesCount: 0, rejectionReason: "Sin cobertura", approvedAmount: null }) === null,
    "reglas incorrectas"
  );
  check("un estado desconocido se rechaza; «pendiente» siempre procede", claimStatusError({ next: "x", diagnosesCount: 0, rejectionReason: "", approvedAmount: null }) !== null && claimStatusError({ next: "pendiente", diagnosesCount: 0, rejectionReason: "", approvedAmount: null }) === null, "reglas incorrectas");
  check(
    "cobro: monto válido y fecha no futura",
    validatePayment("1500.50", "2026-10-07", "2026-10-07").ok &&
      !validatePayment("", "2026-10-07", "2026-10-07").ok &&
      !validatePayment("-5", "2026-10-07", "2026-10-07").ok &&
      !validatePayment("10", "2026-10-08", "2026-10-07").ok &&
      !validatePayment("10", "", "2026-10-07").ok,
    "validación de cobro incorrecta"
  );
  check(
    "por cobrar = aprobado - cobrado (no negativo); null si no hay aprobado",
    pendingToCollect({ status: "aprobada", approved_amount: 1000, paid_amount: 400 }) === 600 &&
      pendingToCollect({ status: "aprobada", approved_amount: 1000, paid_amount: 1200 }) === 0 &&
      pendingToCollect({ status: "enviada", approved_amount: null, paid_amount: null }) === null,
    "cálculo incorrecto"
  );

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
  const newPatient = async (clinicId: string, first: string) => {
    const { data, error } = await admin
      .from("patients")
      .insert({ clinic_id: clinicId, first_name: first, last_name: "Prueba", date_of_birth: "1990-01-01", sex: "femenino" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert paciente: ${error?.message}`);
    return data.id;
  };
  const newEncounter = async (clinicId: string, patientId: string, providerId: string) => {
    const { data, error } = await admin
      .from("encounters")
      .insert({ clinic_id: clinicId, patient_id: patientId, provider_id: providerId, specialty_template_id: tpl!.id, specialty_data: {} })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert consulta: ${error?.message}`);
    return data.id;
  };
  const newDoc = async (clinicId: string, patientId: string, ncf: string, userId: string) => {
    const { data, error } = await admin
      .from("fiscal_documents")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        e_ncf: ncf,
        comprador_nombre: "Comprador",
        monto_gravado_total: 0,
        monto_exento: 100,
        total_itbis: 0,
        monto_total: 100,
        status: "aceptado",
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert comprobante: ${error?.message}`);
    return data.id;
  };

  const p1 = await newPatient(cidA, "Uno");
  const p2 = await newPatient(cidA, "Dos");
  const pB = await newPatient(cidB, "Bruno");
  const e1 = await newEncounter(cidA, p1, adminA.userId);
  const d1 = await newDoc(cidA, p1, "E320000008001", adminA.userId);
  const d2 = await newDoc(cidA, p2, "E320000008002", adminA.userId);
  const dB = await newDoc(cidB, pB, "E320000008003", adminB.userId);

  // ------------------------------------------------------------ 2. catálogo
  console.log("\nCatálogo de ARS:");
  const { data: catalogForAdmin } = await adminA.client.from("insurers").select("id, name, aliases, is_active");
  check("un admin de clínica lee el catálogo (con la lista inicial)", (catalogForAdmin ?? []).length >= 10, `filas: ${catalogForAdmin?.length}`);
  const senasa = (catalogForAdmin ?? []).find((i) => i.name === "SENASA");
  check("SENASA está en el catálogo", !!senasa, "falta SENASA");
  check(
    "el catálogo trae SEMMA y «Primera de Humano» (con «ARS Humano» como alias)",
    (catalogForAdmin ?? []).some((i) => i.name === "SEMMA") &&
      (catalogForAdmin ?? []).some((i) => i.name === "Primera de Humano" && i.aliases.includes("ARS Humano")) &&
      !(catalogForAdmin ?? []).some((i) => i.name === "ARS Humano"),
    JSON.stringify((catalogForAdmin ?? []).map((i) => i.name))
  );

  const { error: adminInsert } = await adminA.client.from("insurers").insert({ name: "ARS Pirata" });
  check("un admin de clínica NO puede escribir el catálogo", adminInsert !== null, "insertó");
  const { error: adminRpc } = await adminA.client.rpc("upsert_insurer", { p_name: "ARS Pirata", p_aliases: [], p_is_active: true });
  check("ni usar la RPC del operador", adminRpc !== null, "la RPC se lo permitió");

  const { data: newInsurerId, error: opCreate } = await op.rpc("upsert_insurer", {
    p_name: "ARS Prueba Catalogo",
    p_aliases: ["Prueba Cat", "  "],
    p_is_active: true,
  });
  check("el operador agrega una aseguradora", opCreate === null && !!newInsurerId, opCreate?.message ?? "");
  if (newInsurerId) createdInsurerIds.push(newInsurerId as string);
  const { error: dupErr } = await op.rpc("upsert_insurer", { p_name: "  prueba   catalogo ", p_aliases: [], p_is_active: true });
  check("un nombre equivalente (sin «ARS», mayúsculas, espacios) se rechaza", dupErr !== null && /Ya existe/.test(dupErr.message), dupErr?.message ?? "lo permitió");
  const { error: editErr } = await op.rpc("upsert_insurer", {
    p_name: "ARS Prueba Catalogo",
    p_aliases: ["Prueba Cat", "PC Test"],
    p_is_active: false,
    p_id: newInsurerId as string,
  });
  const { data: edited } = await admin.from("insurers").select("aliases, is_active").eq("id", newInsurerId as string).single();
  check(
    "el operador edita alias y la desactiva (alias limpios, sin vacíos)",
    editErr === null && edited?.is_active === false && (edited?.aliases ?? []).length === 2,
    JSON.stringify(edited)
  );

  const normalized = await admin.rpc("normalize_insurer_name", { p_name: "  ARS  Palic.  Salud " });
  check("normalize_insurer_name: «  ARS  Palic.  Salud » -> «palic salud»", normalized.data === "palic salud", String(normalized.data));
  const matchCases: [string, boolean][] = [
    ["senasa", true],
    ["Senasa ", true],
    ["Seguro Nacional de Salud", true],
    ["ARS Humano", true],
    ["humano", true],
    ["Palic", true],
    ["Primera de Humano", true],
    ["semma", true],
    ["ARS SEMMA", true],
    ["ARS Desconocida XYZ", false],
  ];
  const matchResults: string[] = [];
  for (const [text, shouldMatch] of matchCases) {
    const { data } = await admin.rpc("match_insurer", { p_name: text });
    if (Boolean(data) !== shouldMatch) matchResults.push(`${text} -> ${data}`);
  }
  check("match_insurer reconoce nombre y alias (y no inventa)", matchResults.length === 0, matchResults.join(" | "));

  const { data: unmatchedForAdmin, error: unmatchedAdminErr } = await adminA.client.rpc("operator_unmatched_insurers");
  check("un admin de clínica NO puede pedir la lista de aseguradoras sin catálogo", unmatchedAdminErr !== null || (unmatchedForAdmin ?? []).length === 0, "la RPC del operador respondió");

  // patient_insurers: se sincroniza el nombre con el catálogo.
  const { data: i1, error: i1Err } = await admin
    .from("patient_insurers")
    .insert({ clinic_id: cidA, patient_id: p1, insurer_id: senasa!.id, insurer_name: "escrito a mano", affiliate_number: "A-1", recorded_by: adminA.userId })
    .select("id, insurer_name")
    .single();
  check("al elegir del catálogo, insurer_name se sincroniza con el nombre del catálogo", i1Err === null && i1?.insurer_name === "SENASA", i1Err?.message ?? JSON.stringify(i1));
  const { data: i2 } = await admin
    .from("patient_insurers")
    .insert({ clinic_id: cidA, patient_id: p2, insurer_name: "Seguro Local Raro", affiliate_number: "B-2", recorded_by: adminA.userId })
    .select("id, insurer_id, insurer_name")
    .single();
  check("«otra aseguradora» (sin catálogo) conserva el nombre escrito", i2?.insurer_id === null && i2?.insurer_name === "Seguro Local Raro", JSON.stringify(i2));
  const { data: unmatchedForOp } = await op.rpc("operator_unmatched_insurers");
  check(
    "el operador ve «Seguro Local Raro» entre las aseguradoras sin catálogo (solo nombre y conteo)",
    (unmatchedForOp ?? []).some((r: { insurer_name: string; uses: number }) => r.insurer_name === "Seguro Local Raro"),
    JSON.stringify(unmatchedForOp)
  );

  // ----------------------------------------------------------- 3. integridad
  console.log("\nIntegridad de la reclamación:");
  const claimBase = { clinic_id: cidA, created_by: adminA.userId };
  const { data: ok1, error: ok1Err } = await admin
    .from("insurance_claims")
    .insert({ ...claimBase, encounter_id: e1, patient_insurer_id: i1!.id, fiscal_document_id: d1, authorization_number: "AUT-1" })
    .select("id")
    .single();
  check("reclamación válida (aseguradora y comprobante del mismo paciente)", ok1Err === null && !!ok1, ok1Err?.message ?? "");
  const claimId = ok1!.id;

  const { error: wrongInsurer } = await admin
    .from("insurance_claims")
    .insert({ ...claimBase, encounter_id: e1, patient_insurer_id: i2!.id });
  check(
    "aseguradora de OTRO paciente se rechaza en la base de datos (también con service_role)",
    wrongInsurer !== null && /no pertenece al paciente/.test(wrongInsurer.message),
    wrongInsurer?.message ?? "la aceptó"
  );
  const { error: wrongDoc } = await admin
    .from("insurance_claims")
    .insert({ ...claimBase, encounter_id: e1, patient_insurer_id: i1!.id, fiscal_document_id: d2 });
  check("comprobante de OTRO paciente se rechaza", wrongDoc !== null && /comprobante/.test(wrongDoc.message), wrongDoc?.message ?? "lo aceptó");
  const { error: otherClinicDoc } = await admin
    .from("insurance_claims")
    .insert({ ...claimBase, encounter_id: e1, patient_insurer_id: i1!.id, fiscal_document_id: dB });
  check("comprobante de OTRA clínica se rechaza", otherClinicDoc !== null, "lo aceptó");
  const { error: reLink } = await admin.from("insurance_claims").update({ fiscal_document_id: d2 }).eq("id", claimId);
  check("re-vincular a un comprobante ajeno también se rechaza", reLink !== null, "lo aceptó");
  const { error: statusOnly } = await admin.from("insurance_claims").update({ status: "enviada" }).eq("id", claimId);
  check("cambiar solo el estado no vuelve a validar enlaces y procede", statusOnly === null, statusOnly?.message ?? "");

  const { error: payNoDate } = await admin.from("insurance_claims").update({ paid_amount: 50 }).eq("id", claimId);
  check("cobro sin fecha se rechaza (monto y fecha van juntos)", payNoDate !== null, "lo aceptó");
  const { error: negApproved } = await admin.from("insurance_claims").update({ approved_amount: -1 }).eq("id", claimId);
  check("monto aprobado negativo se rechaza", negApproved !== null, "lo aceptó");
  const { error: payOk } = await admin
    .from("insurance_claims")
    .update({ status: "aprobada", approved_amount: 100, paid_amount: 40, paid_on: today })
    .eq("id", claimId);
  check("aprobado y cobro con su fecha se guardan", payOk === null, payOk?.message ?? "");

  // ----------------------------------------------------------- 4. diagnósticos
  console.log("\nDiagnósticos codificados:");
  const dxBase = { claim_id: claimId, created_by: adminA.userId, description: "Rinofaringitis aguda" };
  const { data: dx1, error: dx1Err } = await adminA.client
    .from("insurance_claim_diagnoses")
    .insert({ ...dxBase, clinic_id: cidB, code: "J00", is_primary: true }) // clínica equivocada a propósito
    .select("id, clinic_id")
    .single();
  check("el admin registra un diagnóstico CIE-10 y clinic_id se deriva de la reclamación (no del cliente)", dx1Err === null && dx1?.clinic_id === cidA, dx1Err?.message ?? JSON.stringify(dx1));
  const { error: badFormat } = await adminA.client.from("insurance_claim_diagnoses").insert({ ...dxBase, clinic_id: cidA, code: "ZZ" });
  check("un código CIE-10 con formato inválido se rechaza", badFormat !== null, "lo aceptó");
  const { error: secondPrimary } = await adminA.client
    .from("insurance_claim_diagnoses")
    .insert({ ...dxBase, clinic_id: cidA, code: "J01.9", is_primary: true });
  check("un segundo diagnóstico principal se rechaza", secondPrimary !== null, "lo aceptó");
  const { error: secondary } = await adminA.client
    .from("insurance_claim_diagnoses")
    .insert({ ...dxBase, clinic_id: cidA, code: "J01.9", position: 2 });
  check("un diagnóstico secundario se acepta", secondary === null, secondary?.message ?? "");
  const { error: repeated } = await adminA.client.from("insurance_claim_diagnoses").insert({ ...dxBase, clinic_id: cidA, code: "J01.9", position: 3 });
  check("el mismo código repetido se rechaza", repeated !== null, "lo aceptó");
  const { error: cie11 } = await adminA.client
    .from("insurance_claim_diagnoses")
    .insert({ ...dxBase, clinic_id: cidA, code_system: "CIE-11", code: "CA07.0", position: 4 });
  check("CIE-11 se acepta como texto", cie11 === null, cie11?.message ?? "");

  const { data: seenByMedico } = await medicoA.client.from("insurance_claim_diagnoses").select("id").eq("claim_id", claimId);
  const { error: medicoInsert } = await medicoA.client
    .from("insurance_claim_diagnoses")
    .insert({ ...dxBase, clinic_id: cidA, code: "K29.7", position: 5 });
  check("un médico LEE los diagnósticos pero NO los registra (personal de facturación)", (seenByMedico ?? []).length === 3 && medicoInsert !== null, JSON.stringify({ vio: seenByMedico?.length, error: medicoInsert?.message }));
  const { data: seenByB } = await adminB.client.from("insurance_claim_diagnoses").select("id");
  const { data: seenByOp } = await op.from("insurance_claim_diagnoses").select("id");
  check("otra clínica y el operador NO ven los diagnósticos", (seenByB ?? []).length === 0 && (seenByOp ?? []).length === 0, JSON.stringify({ B: seenByB?.length, op: seenByOp?.length }));
  const { error: delOk } = await adminA.client.from("insurance_claim_diagnoses").delete().eq("claim_id", claimId).eq("code", "CA07.0");
  const { data: afterDel } = await admin.from("insurance_claim_diagnoses").select("id").eq("claim_id", claimId);
  check("el personal de facturación puede quitar un diagnóstico", delOk === null && (afterDel ?? []).length === 2, JSON.stringify({ error: delOk?.message, quedan: afterDel?.length }));

  // Solo lectura y bloqueo total.
  await admin.from("clinic_subscriptions").update({ trial_ends_at: addDays(today, -31), next_payment_due_on: null }).eq("clinic_id", cidA);
  const { error: roInsert } = await adminA.client
    .from("insurance_claim_diagnoses")
    .insert({ ...dxBase, clinic_id: cidA, code: "R50.9", position: 6 });
  check("en solo lectura no se registran diagnósticos", roInsert !== null && /modo solo lectura/.test(roInsert.message), roInsert?.message ?? "lo aceptó");
  const { data: roRead } = await adminA.client.from("insurance_claim_diagnoses").select("id").eq("claim_id", claimId);
  check("pero se siguen leyendo", (roRead ?? []).length === 2, `leyó ${roRead?.length}`);
  await admin.from("clinic_subscriptions").update({ trial_ends_at: addDays(today, -121), next_payment_due_on: null }).eq("clinic_id", cidA);
  const { data: blockedRead } = await adminA.client.from("insurance_claim_diagnoses").select("id");
  check("con la clínica bloqueada no se lee ninguno", (blockedRead ?? []).length === 0, `leyó ${blockedRead?.length}`);

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
  for (const id of createdInsurerIds) {
    await admin.from("insurers").delete().eq("id", id);
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
    console.log("\nOK: reclamaciones a ARS (A.1 a A.3) verificadas.");
  });
