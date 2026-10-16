/**
 * Prueba de los recordatorios de citas por WhatsApp, parte 2A (sin envío):
 * supabase/migrations/20261018100000_whatsapp_reminders_base.sql y src/lib/domain/phone.ts.
 *
 * Qué verifica:
 *   1. PURO: normalización de teléfonos dominicanos.
 *   2. BASE DE DATOS (datos sintéticos): la función que elige a quién recordar
 *      (claim_due_appointment_reminders) incluye lo elegible y deja fuera cada caso excluido (sin
 *      consentimiento, revocado, interruptor apagado, Salud Mental, cita cancelada o completada, fuera
 *      de ventana, clínica en solo lectura, ya recordada, otra clínica), reclama una sola vez (también
 *      con dos llamadas simultáneas) y respeta el día de RD; consentimientos (quién escribe, que el
 *      historial no se reescribe, un activo por paciente); interruptor de la clínica; permisos de
 *      appointment_reminders; y que la cobertura de guard/políticas sigue vacía.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";
import { formatDominicanPhone, normalizeDominicanPhone, samePhone } from "../src/lib/domain/phone";
import { addDays, drDateOf, drToday, parseDrDateTime } from "../src/lib/domain/dr-time";

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

type TestUser = { userId: string; email: string; client: SupabaseClient<Database> };

async function createUser(label: string): Promise<TestUser> {
  const email = `wa-reminders-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient<Database>(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, email, client };
}

async function createClinic(owner: TestUser, label: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] Recordatorios ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

async function addMember(clinicId: string, user: TestUser, role: "medico" | "recepcion") {
  const { error } = await admin.from("clinic_members").insert({ clinic_id: clinicId, user_id: user.userId, role });
  if (error) throw new Error(`No se pudo agregar al miembro ${role}: ${error.message}`);
}

async function newPatient(clinicId: string, owner: TestUser) {
  const { data, error } = await owner.client
    .from("patients")
    .insert({ clinic_id: clinicId, first_name: "Paciente", last_name: `Rec ${randomUUID().slice(0, 6)}`, date_of_birth: "1990-01-01", sex: "femenino" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo crear paciente: ${error?.message}`);
  return data.id;
}

async function newAppointment(opts: { clinicId: string; patientId: string; providerId: string; templateId: string; at: Date; status?: string; createdBy: string }) {
  const { data, error } = await admin
    .from("appointments")
    .insert({
      clinic_id: opts.clinicId,
      patient_id: opts.patientId,
      provider_id: opts.providerId,
      specialty_template_id: opts.templateId,
      scheduled_at: opts.at.toISOString(),
      status: opts.status ?? "pendiente",
      created_by: opts.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo crear la cita: ${error?.message}`);
  return data.id;
}

function addDaysIso(isoDate: string, days: number): string {
  return addDays(isoDate, days);
}

async function main() {
  // ------------------------------------------------------------------ teléfonos
  console.log("\nTeléfonos dominicanos:");
  check("10 dígitos con guiones", normalizeDominicanPhone("809-663-5279") === "+18096635279", String(normalizeDominicanPhone("809-663-5279")));
  check("con paréntesis y espacios", normalizeDominicanPhone("(829) 663 5279") === "+18296635279", String(normalizeDominicanPhone("(829) 663 5279")));
  check("con +1", normalizeDominicanPhone("+1 849 663 5279") === "+18496635279", String(normalizeDominicanPhone("+1 849 663 5279")));
  check("con 1 al inicio", normalizeDominicanPhone("18096635279") === "+18096635279", String(normalizeDominicanPhone("18096635279")));
  check(
    "no dominicanos o incompletos se rechazan",
    normalizeDominicanPhone("555-663-5279") === null &&
      normalizeDominicanPhone("663-5279") === null &&
      normalizeDominicanPhone("+34 600 000 000") === null &&
      normalizeDominicanPhone("28096635279") === null &&
      normalizeDominicanPhone("") === null &&
      normalizeDominicanPhone(null) === null &&
      normalizeDominicanPhone(8096635279) === null,
    "aceptó un número inválido"
  );
  check("formato para mostrar", formatDominicanPhone("+18096635279") === "(809) 663-5279" && formatDominicanPhone(null) === "", formatDominicanPhone("+18096635279"));
  check("mismo número escrito distinto", samePhone("809-663-5279", "+1 (809) 663 5279") && !samePhone("809-663-5279", "809-663-5270") && !samePhone("x", "x"), "comparación incorrecta");

  // ----------------------------------------------------------------- base de datos
  const owner = await createUser("admin");
  const medico = await createUser("medico");
  const recepcion = await createUser("recepcion");
  const otherOwner = await createUser("otra");
  const clinic = await createClinic(owner, "A");
  const clinicB = await createClinic(otherOwner, "B");
  await addMember(clinic, medico, "medico");
  await addMember(clinic, recepcion, "recepcion");

  const { data: templates } = await admin.from("specialty_templates").select("id, requires_explicit_access, name");
  const normalTemplate = templates!.find((t) => !t.requires_explicit_access)!;
  const sensitiveTemplate = templates!.find((t) => t.requires_explicit_access)!;

  const today = drToday();
  const tomorrow = addDaysIso(today, 1);
  const dayAfter = addDaysIso(today, 2);
  const at = (date: string, time: string) => parseDrDateTime(date, time)!;
  const now = new Date();

  const phone = "+18096635279";
  async function grant(clinicId: string, patientId: string, by: TestUser = owner) {
    const { data, error } = await by.client
      .from("patient_messaging_consents")
      .insert({ clinic_id: clinicId, patient_id: patientId, phone_e164: phone, source: "verbal" })
      .select("id")
      .single();
    return { data, error };
  }

  console.log("\nInterruptor de la clínica:");
  const { error: anonSetting } = await medico.client.from("clinic_whatsapp_settings").insert({ clinic_id: clinic, reminders_enabled: true });
  check("el médico no puede activar el interruptor", anonSetting !== null, "lo activó");
  const { error: recSetting } = await recepcion.client.from("clinic_whatsapp_settings").insert({ clinic_id: clinic, reminders_enabled: true });
  check("recepción tampoco (solo el admin)", recSetting !== null, "lo activó");
  const { error: adminSetting } = await owner.client.from("clinic_whatsapp_settings").insert({ clinic_id: clinic, reminders_enabled: false });
  check("el admin crea el ajuste (apagado)", adminSetting === null, adminSetting?.message ?? "");
  const { data: stamped } = await admin.from("clinic_whatsapp_settings").select("updated_by").eq("clinic_id", clinic).single();
  check("updated_by lo pone la base con la sesión", stamped?.updated_by === owner.userId, JSON.stringify(stamped));
  const { data: medicoSees } = await medico.client.from("clinic_whatsapp_settings").select("clinic_id").eq("clinic_id", clinic);
  check("el médico sí lo puede leer", (medicoSees ?? []).length === 1, `filas: ${(medicoSees ?? []).length}`);
  const { data: otherSees } = await otherOwner.client.from("clinic_whatsapp_settings").select("clinic_id").eq("clinic_id", clinic);
  check("otra clínica no lo ve", (otherSees ?? []).length === 0, `filas: ${(otherSees ?? []).length}`);

  console.log("\nConsentimientos:");
  const pOk = await newPatient(clinic, owner);
  const g1 = await grant(clinic, pOk);
  check("el admin registra un consentimiento", g1.error === null, g1.error?.message ?? "");
  const { data: consentRow } = await admin.from("patient_messaging_consents").select("clinic_id, granted_by, revoked_at").eq("id", g1.data!.id).single();
  check("clinic_id lo deriva el trigger del paciente y granted_by es quien lo registró", consentRow?.clinic_id === clinic && consentRow.granted_by === owner.userId, JSON.stringify(consentRow));
  const g1dup = await grant(clinic, pOk);
  check("no puede haber dos consentimientos activos del mismo paciente", g1dup.error !== null, "aceptó el duplicado");
  const pRec = await newPatient(clinic, owner);
  const gRec = await grant(clinic, pRec, recepcion);
  check("recepción registra consentimientos", gRec.error === null, gRec.error?.message ?? "");
  const pMed = await newPatient(clinic, owner);
  const gMed = await grant(clinic, pMed, medico);
  check("el médico NO registra consentimientos", gMed.error !== null, "lo registró");
  const { error: badPhone } = await owner.client.from("patient_messaging_consents").insert({ clinic_id: clinic, patient_id: pMed, phone_e164: "809-663-5279", source: "verbal" });
  check("el teléfono debe estar en formato internacional", badPhone !== null, "aceptó un teléfono sin normalizar");
  const { error: forged } = await owner.client.from("patient_messaging_consents").insert({ clinic_id: clinicB, patient_id: pMed, phone_e164: phone, source: "verbal" });
  check("mandar el clinic_id de otra clínica no sirve (se deriva del paciente)", forged === null ? (await admin.from("patient_messaging_consents").select("clinic_id").eq("patient_id", pMed).single()).data?.clinic_id === clinic : true, "quedó en la clínica ajena");
  await admin.from("patient_messaging_consents").delete().eq("patient_id", pMed);
  const { data: otherConsents } = await otherOwner.client.from("patient_messaging_consents").select("id");
  check("otra clínica no ve los consentimientos", (otherConsents ?? []).length === 0, `filas: ${(otherConsents ?? []).length}`);
  const { error: editPhone } = await owner.client.from("patient_messaging_consents").update({ phone_e164: "+18296635279" }).eq("id", g1.data!.id);
  check("no se puede cambiar el teléfono de un consentimiento (se registra uno nuevo)", editPhone !== null, "lo cambió");
  await owner.client.from("patient_messaging_consents").delete().eq("id", g1.data!.id);
  const { data: stillThere } = await admin.from("patient_messaging_consents").select("id").eq("id", g1.data!.id);
  check("no se borra (sin política de DELETE)", (stillThere ?? []).length === 1, "se borró");

  // ---------------------------------------------------------------- elegibilidad
  console.log("\nA quién se le recuerda (claim_due_appointment_reminders):");
  // Activar el interruptor (el admin).
  await owner.client.from("clinic_whatsapp_settings").update({ reminders_enabled: true }).eq("clinic_id", clinic);

  const aOk = await newAppointment({ clinicId: clinic, patientId: pOk, providerId: owner.userId, templateId: normalTemplate.id, at: at(tomorrow, "10:00"), createdBy: owner.userId });
  const aConfirmada = await newAppointment({ clinicId: clinic, patientId: pRec, providerId: owner.userId, templateId: normalTemplate.id, at: at(tomorrow, "00:30"), status: "confirmada", createdBy: owner.userId });
  const pNoConsent = await newPatient(clinic, owner);
  const aNoConsent = await newAppointment({ clinicId: clinic, patientId: pNoConsent, providerId: owner.userId, templateId: normalTemplate.id, at: at(tomorrow, "11:00"), createdBy: owner.userId });
  const pSensitive = await newPatient(clinic, owner);
  await grant(clinic, pSensitive);
  const aSensitive = await newAppointment({ clinicId: clinic, patientId: pSensitive, providerId: owner.userId, templateId: sensitiveTemplate.id, at: at(tomorrow, "12:00"), createdBy: owner.userId });
  const pCancelled = await newPatient(clinic, owner);
  await grant(clinic, pCancelled);
  const aCancelled = await newAppointment({ clinicId: clinic, patientId: pCancelled, providerId: owner.userId, templateId: normalTemplate.id, at: at(tomorrow, "13:00"), status: "cancelada", createdBy: owner.userId });
  const pDone = await newPatient(clinic, owner);
  await grant(clinic, pDone);
  const aDone = await newAppointment({ clinicId: clinic, patientId: pDone, providerId: owner.userId, templateId: normalTemplate.id, at: at(tomorrow, "14:00"), status: "completada", createdBy: owner.userId });
  const pFar = await newPatient(clinic, owner);
  await grant(clinic, pFar);
  const aFar = await newAppointment({ clinicId: clinic, patientId: pFar, providerId: owner.userId, templateId: normalTemplate.id, at: at(dayAfter, "10:00"), createdBy: owner.userId });
  const pPast = await newPatient(clinic, owner);
  await grant(clinic, pPast);
  const aPast = await newAppointment({ clinicId: clinic, patientId: pPast, providerId: owner.userId, templateId: normalTemplate.id, at: new Date(now.getTime() - 3 * 3600_000), createdBy: owner.userId });
  const pRevoked = await newPatient(clinic, owner);
  const gRevoked = await grant(clinic, pRevoked);
  await owner.client.from("patient_messaging_consents").update({ revoked_at: new Date().toISOString(), revoke_source: "personal" }).eq("id", gRevoked.data!.id);
  const aRevoked = await newAppointment({ clinicId: clinic, patientId: pRevoked, providerId: owner.userId, templateId: normalTemplate.id, at: at(tomorrow, "15:00"), createdBy: owner.userId });

  // Otra clínica con el interruptor APAGADO y consentimiento: no debe salir.
  const pB = await newPatient(clinicB, otherOwner);
  await grant(clinicB, pB, otherOwner);
  const aB = await newAppointment({ clinicId: clinicB, patientId: pB, providerId: otherOwner.userId, templateId: normalTemplate.id, at: at(tomorrow, "10:00"), createdBy: otherOwner.userId });

  // Mismo día: una más de 2 h adelante (si cabe antes de medianoche de RD) y una de menos de 2 h.
  const soon = new Date(now.getTime() + 60 * 60_000);
  const pSoon = await newPatient(clinic, owner);
  await grant(clinic, pSoon);
  const aSoon = await newAppointment({ clinicId: clinic, patientId: pSoon, providerId: owner.userId, templateId: normalTemplate.id, at: soon, createdBy: owner.userId });

  // Una de hoy con 3 horas de anticipación (solo si todavía cae dentro del día de RD).
  const later = new Date(now.getTime() + 3 * 3600_000);
  const sameDay = drDateOf(later) === today;
  const pLater = await newPatient(clinic, owner);
  await grant(clinic, pLater);
  const aLater = await newAppointment({ clinicId: clinic, patientId: pLater, providerId: owner.userId, templateId: normalTemplate.id, at: later, createdBy: owner.userId });

  const { data: claimed1, error: claim1Err } = await admin.rpc("claim_due_appointment_reminders", { p_now: now.toISOString() });
  check("la función corre sin error", claim1Err === null, claim1Err?.message ?? "");
  const ids1 = new Set((claimed1 ?? []).map((r) => r.out_appointment_id));
  check("incluye la cita elegible de mañana", ids1.has(aOk), JSON.stringify([...ids1]));
  check("incluye la de mañana a las 12:30 a. m. (ya es mañana en RD)", ids1.has(aConfirmada), "no la incluyó");
  check("excluye al paciente SIN consentimiento", !ids1.has(aNoConsent), "lo incluyó");
  check("excluye la especialidad sensible (Salud Mental)", !ids1.has(aSensitive), "la incluyó");
  check("excluye la cita cancelada", !ids1.has(aCancelled), "la incluyó");
  check("excluye la cita completada", !ids1.has(aDone), "la incluyó");
  check("excluye la de pasado mañana", !ids1.has(aFar), "la incluyó");
  check("excluye la que ya pasó", !ids1.has(aPast), "la incluyó");
  check("excluye al paciente con consentimiento REVOCADO", !ids1.has(aRevoked), "lo incluyó");
  check("excluye a otra clínica con el interruptor apagado", !ids1.has(aB), "la incluyó");
  // La regla de «menos de 2 horas» solo aplica a citas de HOY: pasada la noche, +1 h ya es mañana (se recuerda).
  if (drDateOf(soon) === today) {
    check("excluye la de hoy que falta menos de 2 horas", !ids1.has(aSoon), "la incluyó");
  } else {
    check("a esta hora +1 h ya es mañana en RD y por eso sí se incluye", ids1.has(aSoon), "no la incluyó");
  }
  if (sameDay) {
    check("incluye la de hoy con 3 horas de anticipación (agendada después del lote)", ids1.has(aLater), "no la incluyó");
  } else {
    console.log("  · (omitida: a esta hora, +3 h ya cae en el día siguiente de RD)");
  }
  const mine = (claimed1 ?? []).filter((r) => r.out_clinic_id === clinic);
  check("devuelve el teléfono del consentimiento y el nombre de la clínica", mine.length > 0 && mine.every((r) => r.out_phone_e164 === phone && r.out_clinic_name.startsWith("[TEST] Recordatorios A")), JSON.stringify(mine[0]));
  const { data: rem1 } = await admin.from("appointment_reminders").select("appointment_id, status").eq("clinic_id", clinic);
  check("deja una fila «en_envio» por cada cita reclamada", (rem1 ?? []).length === ids1.size && (rem1 ?? []).every((r) => r.status === "en_envio"), JSON.stringify(rem1));

  const { data: claimed2 } = await admin.rpc("claim_due_appointment_reminders", { p_now: now.toISOString() });
  check("una segunda llamada no reclama nada de lo ya reclamado", (claimed2 ?? []).filter((r) => ids1.has(r.out_appointment_id)).length === 0, JSON.stringify(claimed2));

  // Dos llamadas SIMULTÁNEAS sobre una cita nueva: solo una la reclama.
  const pRace = await newPatient(clinic, owner);
  await grant(clinic, pRace);
  const aRace = await newAppointment({ clinicId: clinic, patientId: pRace, providerId: owner.userId, templateId: normalTemplate.id, at: at(tomorrow, "16:00"), createdBy: owner.userId });
  const [r1, r2] = await Promise.all([
    admin.rpc("claim_due_appointment_reminders", { p_now: now.toISOString() }),
    admin.rpc("claim_due_appointment_reminders", { p_now: now.toISOString() }),
  ]);
  const times = [...(r1.data ?? []), ...(r2.data ?? [])].filter((r) => r.out_appointment_id === aRace).length;
  check("dos ejecuciones simultáneas la reclaman UNA sola vez", times === 1, `la reclamaron ${times} veces`);
  const { data: raceRows } = await admin.from("appointment_reminders").select("id").eq("appointment_id", aRace);
  check("y hay una sola fila de recordatorio", (raceRows ?? []).length === 1, `filas: ${(raceRows ?? []).length}`);

  // ---------------------------------------------------------------- solo lectura
  console.log("\nClínica en solo lectura:");
  const pRO = await newPatient(clinic, owner);
  await grant(clinic, pRO);
  const aRO = await newAppointment({ clinicId: clinic, patientId: pRO, providerId: owner.userId, templateId: normalTemplate.id, at: at(tomorrow, "17:00"), createdBy: owner.userId });
  const { data: todayData } = await admin.rpc("dr_today");
  await admin
    .from("clinic_subscriptions")
    .update({ trial_ends_at: addDaysIso(todayData as string, -31), next_payment_due_on: null })
    .eq("clinic_id", clinic);
  const { data: claimedRO } = await admin.rpc("claim_due_appointment_reminders", { p_now: now.toISOString() });
  check("una clínica en solo lectura no recibe recordatorios", !(claimedRO ?? []).some((r) => r.out_appointment_id === aRO), "la incluyó");

  // ---------------------------------------------------------- permisos de lectura/escritura
  console.log("\nPermisos de appointment_reminders:");
  // Para estas lecturas se usa la otra clínica (la A está en solo lectura): reclamo uno ahí.
  await otherOwner.client.from("clinic_whatsapp_settings").insert({ clinic_id: clinicB, reminders_enabled: true });
  const pB2 = await newPatient(clinicB, otherOwner);
  await grant(clinicB, pB2, otherOwner);
  const aB2 = await newAppointment({ clinicId: clinicB, patientId: pB2, providerId: otherOwner.userId, templateId: normalTemplate.id, at: at(tomorrow, "09:00"), createdBy: otherOwner.userId });
  const { data: claimedB } = await admin.rpc("claim_due_appointment_reminders", { p_now: now.toISOString() });
  check("la otra clínica (con interruptor activo) sí recibe lo suyo", (claimedB ?? []).some((r) => r.out_appointment_id === aB2), "no la incluyó");
  const { data: ownRem } = await otherOwner.client.from("appointment_reminders").select("id");
  check("el admin de la clínica ve sus recordatorios", (ownRem ?? []).length >= 1, `filas: ${(ownRem ?? []).length}`);
  const { data: crossRem } = await owner.client.from("appointment_reminders").select("id").eq("clinic_id", clinicB);
  check("otra clínica no ve los recordatorios ajenos", (crossRem ?? []).length === 0, `filas: ${(crossRem ?? []).length}`);
  const { error: insRem } = await otherOwner.client.from("appointment_reminders").insert({ clinic_id: clinicB, appointment_id: randomUUID() });
  await otherOwner.client.from("appointment_reminders").update({ response: "confirmar" }).eq("clinic_id", clinicB);
  const { data: afterUpd } = await admin.from("appointment_reminders").select("response").eq("clinic_id", clinicB);
  check("ningún usuario escribe en appointment_reminders", insRem !== null && (afterUpd ?? []).every((r) => r.response === null), JSON.stringify(afterUpd));
  const rpcAsUser = await otherOwner.client.rpc("claim_due_appointment_reminders" as never, { p_now: now.toISOString() } as never);
  check("la función de reclamo no es ejecutable por usuarios", rpcAsUser.error !== null, "la ejecutó");
  // El médico de la clínica A solo ve los recordatorios de SUS citas; aquí el proveedor de todas es el admin.
  const { data: medRows } = await medico.client.from("appointment_reminders").select("id");
  check("el médico solo ve los recordatorios de sus propias citas (aquí ninguna es suya)", (medRows ?? []).length === 0, `filas: ${(medRows ?? []).length}`);

  console.log("\nCobertura:");
  const { data: unguarded, error: ugErr } = await admin.rpc("list_unguarded_tables");
  check("ninguna tabla queda sin readonly_guard", ugErr === null && (unguarded ?? []).length === 0, ugErr?.message ?? JSON.stringify(unguarded));
  const { data: open, error: openErr } = await admin.rpc("list_policies_open_when_blocked");
  check("ninguna política queda abierta con la clínica bloqueada", openErr === null && (open ?? []).length === 0, openErr?.message ?? JSON.stringify(open));
}

async function cleanup() {
  for (const id of createdClinicIds) await admin.from("clinics").delete().eq("id", id);
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
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
    console.log("\nOK: recordatorios de WhatsApp (selección y consentimiento) verificados.");
  });
