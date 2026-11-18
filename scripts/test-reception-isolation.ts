/**
 * Prueba de que recepción NO lee datos clínicos y aun así puede trabajar
 * (supabase/migrations/20261123100000_receptionist_clinical_isolation.sql).
 *
 * Qué verifica:
 *   1. LECTURA: consultas, signos vitales, alergias y medicamentos los leen
 *      admin y médicos; recepción y otra clínica ven 0 filas.
 *   2. encounter_stubs: recepción obtiene solo id, paciente, fecha, cita enlazada
 *      y quién atendió (nunca motivo, notas, diagnóstico, signos vitales ni
 *      especialidad); exige algún filtro; respeta el acceso reforzado de Salud
 *      Mental; no cruza clínicas.
 *   3. RECEPCIÓN SIGUE TRABAJANDO: crea una reclamación (el trigger que deriva
 *      la clínica ya no depende de leer la consulta), la actualiza, ve el
 *      paquete para la ARS y el reporte con fecha y paciente (vía los stubs), y
 *      no puede reclamar una consulta de otra clínica. La agenda reconoce la
 *      cita ya convertida.
 *   4. Admin y médicos siguen leyendo y escribiendo lo clínico como siempre.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y
 * SUPABASE_SERVICE_ROLE_KEY (mismas que test-tenant-isolation.ts).
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { fetchEncounterStubs } from "../src/lib/supabase/encounter-stubs";
import { fetchPackageData } from "../src/lib/bulk-import/claims-package";
import { loadClaimsReport } from "../src/lib/bulk-import/claims-report-data";
import { insurerKey } from "../src/lib/domain/claims";

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
  const email = `reception-${label}-${randomUUID()}@example.invalid`;
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
    clinic_name: `[TEST] Recepción ${label} ${randomUUID().slice(0, 8)}`,
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
  console.log("Aprovisionando clínicas y usuarios sintéticos...");
  const owner = await createUser("owner");
  const medico = await createUser("medico");
  const recepcion = await createUser("recepcion");
  const ownerB = await createUser("ownerB");
  const recepcionB = await createUser("recepcionB");
  const cid = await createClinic(owner, "A");
  const cidB = await createClinic(ownerB, "B");
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: medico.userId, role: "medico" });
  await admin.from("clinic_members").insert({ clinic_id: cid, user_id: recepcion.userId, role: "recepcion" });
  await admin.from("clinic_members").insert({ clinic_id: cidB, user_id: recepcionB.userId, role: "recepcion" });

  const { data: templates } = await admin.from("specialty_templates").select("id, code");
  const interna = templates?.find((t) => t.code === "medicina_interna");
  const saludMental = templates?.find((t) => t.code === "salud_mental_psicologia");
  if (!interna || !saludMental) throw new Error("Faltan plantillas base.");

  const mkPatient = async (clinic: string, client: SupabaseClient, last: string) => {
    const { data, error } = await client
      .from("patients")
      .insert({ clinic_id: clinic, first_name: "Paciente", last_name: last, national_id: `RI-${randomUUID().slice(0, 8)}`, date_of_birth: "1990-01-01", sex: "femenino" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el paciente: ${error?.message}`);
    return data.id as string;
  };
  const patientId = await mkPatient(cid, recepcion.client, "Reclamante");
  const patientB = await mkPatient(cidB, recepcionB.client, "AjenoB");
  for (const [who, pid] of [[owner, patientId], [ownerB, patientB]] as const) {
    const { error } = await who.client.rpc("open_patient_record", { p_patient_id: pid, p_history: {} });
    if (error) throw new Error(`No se pudo abrir el expediente: ${error.message}`);
  }

  // Datos clínicos de la clínica A.
  const { data: enc, error: encErr } = await medico.client
    .from("encounters")
    .insert({ clinic_id: cid, patient_id: patientId, provider_id: medico.userId, specialty_template_id: interna.id, chief_complaint: "Dolor torácico CONFIDENCIAL", specialty_data: { diagnostico_presuntivo: "Angina CONFIDENCIAL" } })
    .select("id")
    .single();
  if (encErr || !enc) throw new Error(`No se pudo crear la consulta: ${encErr?.message}`);
  await medico.client.from("vital_signs").insert({ clinic_id: cid, encounter_id: enc.id, heart_rate: 88 });
  await medico.client.from("allergies").insert({ clinic_id: cid, patient_id: patientId, substance: "Penicilina" });
  await medico.client.from("medications").insert({ clinic_id: cid, patient_id: patientId, name: "Metformina" });
  const { data: sens, error: sensErr } = await medico.client
    .from("encounters")
    .insert({ clinic_id: cid, patient_id: patientId, provider_id: medico.userId, specialty_template_id: saludMental.id, chief_complaint: "Salud mental SENSIBLE", specialty_data: {} })
    .select("id")
    .single();
  if (sensErr || !sens) throw new Error(`No se pudo crear la consulta sensible: ${sensErr?.message}`);
  const { data: encB } = await admin
    .from("encounters")
    .insert({ clinic_id: cidB, patient_id: patientB, provider_id: ownerB.userId, specialty_template_id: interna.id, specialty_data: {} })
    .select("id")
    .single();

  console.log("\nQuién lee lo clínico:");
  const tables = ["encounters", "vital_signs", "allergies", "medications"] as const;
  for (const [label, who, expectRows] of [
    ["el médico", medico, true],
    ["el admin", owner, true],
    ["recepción", recepcion, false],
    ["recepción de otra clínica", recepcionB, false],
    ["el admin de otra clínica", ownerB, false],
  ] as const) {
    const counts: number[] = [];
    for (const t of tables) {
      const { data } = await who.client.from(t).select("id");
      counts.push((data ?? []).filter(() => true).length);
    }
    if (expectRows) {
      check(`${label} lee consultas, signos vitales, alergias y medicamentos`, counts.every((n) => n >= 1), counts.join("/"));
    } else {
      // recepción B / ownerB pueden ver lo de SU clínica (ownerB es admin de B y la consulta de B existe): solo importa lo de A
      const { data: seenOfA } = await who.client.from("encounters").select("id").eq("clinic_id", cid);
      check(`${label} NO lee lo clínico de la clínica A`, (seenOfA ?? []).length === 0, `${seenOfA?.length}`);
      if (who === recepcion) check("recepción ve 0 filas en las 4 tablas", counts.every((n) => n === 0), counts.join("/"));
    }
  }
  const { data: adminEnc } = await owner.client.from("encounters").select("id").eq("clinic_id", cid);
  check("el admin lee la consulta normal pero NO la sensible (acceso reforzado, sin cambios)", (adminEnc ?? []).some((e) => e.id === enc.id) && !(adminEnc ?? []).some((e) => e.id === sens.id), JSON.stringify(adminEnc));

  console.log("\nencounter_stubs (lo único de una consulta que ve recepción):");
  const stubsRec = await recepcion.client.rpc("encounter_stubs", { p_patient_id: patientId });
  const rows = (stubsRec.data ?? []) as Record<string, unknown>[];
  check("recepción obtiene la consulta normal", stubsRec.error === null && rows.length === 1 && rows[0].id === enc.id, `${stubsRec.error?.message ?? ""} ${JSON.stringify(rows)}`);
  check("solo 5 columnas: id, paciente, fecha, cita y quién atendió", rows.length === 1 && Object.keys(rows[0]).sort().join(",") === "appointment_id,encounter_date,id,patient_id,provider_id", JSON.stringify(rows[0] ? Object.keys(rows[0]) : []));
  check("ni rastro del contenido clínico", !JSON.stringify(rows).includes("CONFIDENCIAL") && !JSON.stringify(rows).includes("SENSIBLE"), JSON.stringify(rows));
  check("la consulta de Salud Mental no aparece (acceso reforzado)", !rows.some((r) => r.id === sens.id), JSON.stringify(rows));
  const byIds = await recepcion.client.rpc("encounter_stubs", { p_encounter_ids: [enc.id, sens.id, encB!.id] });
  check("por ids: solo la consulta normal de su clínica", (byIds.data ?? []).length === 1 && (byIds.data as { id: string }[])[0].id === enc.id, JSON.stringify(byIds.data));
  const noFilter = await recepcion.client.rpc("encounter_stubs", {});
  check("sin ningún filtro no devuelve nada (no es un listado libre)", (noFilter.data ?? []).length === 0, JSON.stringify(noFilter.data));
  const otherClinic = await recepcionB.client.rpc("encounter_stubs", { p_patient_id: patientId });
  check("otra clínica no obtiene nada de la clínica A", (otherClinic.data ?? []).length === 0, JSON.stringify(otherClinic.data));
  const medStubs = await medico.client.rpc("encounter_stubs", { p_patient_id: patientId });
  check("el médico que atendió la consulta sensible sí la recibe", (medStubs.data ?? []).length === 2, JSON.stringify(medStubs.data));
  const adminStubs = await owner.client.rpc("encounter_stubs", { p_patient_id: patientId });
  check("el admin sin acceso a la sensible, solo la normal", (adminStubs.data ?? []).length === 1, JSON.stringify(adminStubs.data));
  const anon = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false } });
  const anonStubs = await anon.rpc("encounter_stubs", { p_patient_id: patientId });
  check("sin sesión no se obtiene nada", anonStubs.error !== null || (anonStubs.data ?? []).length === 0, JSON.stringify(anonStubs.data));
  const viaLib = await fetchEncounterStubs(recepcion.client as never, { encounterIds: [enc.id] });
  check("la función de la app (fetchEncounterStubs) devuelve lo mismo", viaLib.length === 1 && viaLib[0].patient_id === patientId, JSON.stringify(viaLib));

  console.log("\nLa agenda reconoce la cita convertida:");
  const { data: appt } = await admin
    .from("appointments")
    .insert({ clinic_id: cid, patient_id: patientId, provider_id: medico.userId, specialty_template_id: interna.id, scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: recepcion.userId })
    .select("id")
    .single();
  const { data: enc2 } = await medico.client
    .from("encounters")
    .insert({ clinic_id: cid, patient_id: patientId, provider_id: medico.userId, specialty_template_id: interna.id, specialty_data: {} })
    .select("id")
    .single();
  const conv = await medico.client.rpc("complete_appointment_with_encounter", { target_appointment_id: appt!.id, target_encounter_id: enc2!.id });
  check("el médico convierte la cita en consulta", conv.error === null, conv.error?.message ?? "");
  const linked = await fetchEncounterStubs(recepcion.client as never, { appointmentIds: [appt!.id] });
  check("recepción ve que esa cita ya tiene consulta, sin leer la consulta", linked.length === 1 && linked[0].appointment_id === appt!.id, JSON.stringify(linked));

  console.log("\nRecepción factura y reclama sin leer lo clínico:");
  const { data: insurer, error: insErr } = await recepcion.client
    .from("patient_insurers")
    .insert({ clinic_id: cid, patient_id: patientId, insurer_name: "SENASA", affiliate_number: "AF-RI-1", recorded_by: recepcion.userId })
    .select("id")
    .single();
  check("recepción registra el seguro del paciente", insErr === null && !!insurer, insErr?.message ?? "");
  const { data: claim, error: claimErr } = await recepcion.client
    .from("insurance_claims")
    .insert({ clinic_id: cid, encounter_id: enc.id, patient_insurer_id: insurer!.id, claimed_amount: 1500, status: "pendiente", created_by: recepcion.userId })
    .select("id, clinic_id")
    .single();
  check("recepción crea la reclamación de una consulta que NO puede leer (la clínica se deriva en la base)", claimErr === null && claim?.clinic_id === cid, claimErr?.message ?? "");
  const upd = await recepcion.client.from("insurance_claims").update({ authorization_number: "AUT-RI" }).eq("id", claim!.id).select("id");
  check("y la actualiza", upd.error === null && (upd.data ?? []).length === 1, upd.error?.message ?? "");
  const dx = await recepcion.client.from("insurance_claim_diagnoses").insert({ clinic_id: cid, claim_id: claim!.id, code: "J00", description: "Rinofaringitis aguda", is_primary: true, created_by: recepcion.userId });
  check("codifica el diagnóstico de la reclamación (único dato clínico que conserva)", dx.error === null, dx.error?.message ?? "");
  const claimsSeen = await recepcion.client.from("insurance_claims").select("id").eq("id", claim!.id);
  check("ve la reclamación", (claimsSeen.data ?? []).length === 1, "no la ve");

  const { data: insB } = await admin.from("patient_insurers").insert({ clinic_id: cidB, patient_id: patientB, insurer_name: "SENASA", affiliate_number: "AF-B", recorded_by: ownerB.userId }).select("id").single();
  const cross = await recepcion.client.from("insurance_claims").insert({ clinic_id: cid, encounter_id: encB!.id, patient_insurer_id: insurer!.id, claimed_amount: 1, status: "pendiente", created_by: recepcion.userId });
  check("no puede reclamar una consulta de OTRA clínica", cross.error !== null, "no falló");
  const crossB = await recepcionB.client.from("insurance_claims").insert({ clinic_id: cidB, encounter_id: enc.id, patient_insurer_id: insB!.id, claimed_amount: 1, status: "pendiente", created_by: recepcionB.userId });
  check("ni la otra clínica reclamar la consulta de A", crossB.error !== null, "no falló");

  const pkg = await fetchPackageData(recepcion.client as never, { insurerKey: insurerKey({ insurer_id: null, insurer_name: "SENASA" }), status: "todas" });
  check("el paquete para la ARS (como recepción) trae fecha del servicio y paciente", pkg.claims.length === 1 && pkg.claims[0].patientLastName === "Reclamante" && /^\d{4}-\d{2}-\d{2}$/.test(pkg.claims[0].serviceDate) && pkg.claims[0].providerId === medico.userId, JSON.stringify(pkg.claims.map((c) => [c.patientLastName, c.serviceDate])));
  check("y el diagnóstico codificado", (pkg.claims[0]?.raw.insurance_claim_diagnoses ?? []).some((d) => d.code === "J00"), "sin diagnóstico");
  const rep = await loadClaimsReport(recepcion.client as never, "todo");
  check("el reporte de reclamaciones (como recepción) cuenta la reclamación", rep.report.totals.count === 1, `${rep.report.totals.count}`);

  console.log("\nAdmin y médicos siguen igual:");
  const medRead = await medico.client.from("encounters").select("id, chief_complaint").eq("id", enc.id).single();
  check("el médico lee el contenido de su consulta", medRead.data?.chief_complaint === "Dolor torácico CONFIDENCIAL", JSON.stringify(medRead.data));
  const adminVitals = await owner.client.from("vital_signs").select("heart_rate").eq("encounter_id", enc.id).single();
  check("el admin lee los signos vitales", adminVitals.data?.heart_rate === 88, JSON.stringify(adminVitals.data));
  const medWrite = await medico.client.from("allergies").insert({ clinic_id: cid, patient_id: patientId, substance: "Látex" });
  check("el médico sigue registrando alergias", medWrite.error === null, medWrite.error?.message ?? "");
  const recWrite = await recepcion.client.from("allergies").insert({ clinic_id: cid, patient_id: patientId, substance: "Hackeada" });
  check("recepción NO puede escribir datos clínicos (ya no podía)", recWrite.error !== null, "no falló");
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
    console.log("OK: recepción sin datos clínicos verificado.");
  });
