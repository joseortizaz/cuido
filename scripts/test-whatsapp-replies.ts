/**
 * Prueba de los recordatorios por WhatsApp, parte 2B (envío, respuestas y baja):
 * supabase/migrations/20261019100000_whatsapp_reminders_replies.sql,
 * src/lib/whatsapp/reminders.ts, webhook.ts (respuestas entrantes) y webhook-apply.ts.
 *
 * Qué verifica:
 *   1. PURO: variables de la plantilla (clínica, fecha y hora de RD), botones con su payload, lectura
 *      de los botones, reconocimiento de BAJA (solo el mensaje ENTERO), autenticación del cron, y que
 *      el análisis del webhook reconoce las respuestas SIN guardar el texto del paciente.
 *   2. BASE DE DATOS (datos sintéticos): record_reminder_send (mensaje automático sin usuario,
 *      idempotente, también con la clínica en solo lectura), apply_reminder_response (Confirmar /
 *      Cancelar, teléfono distinto, repetidos, cambio de opinión, solo lectura), BAJA (revoca por
 *      teléfono en todas las clínicas y avisa a quién confirmarle), expire_stuck_appointment_reminders
 *      (nunca reenvía) y que ningún usuario ejecuta estas funciones.
 *
 * Todo con datos sintéticos que se limpian al terminar, pase o falle.
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";
import {
  OPT_OUT_CONFIRMATION_TEXT,
  buildReminderParams,
  isAuthorizedCron,
  isOptOutText,
  parseReminderPayload,
  reminderButtonPayloads,
} from "../src/lib/whatsapp/reminders";
import { eventKey, parseWebhook } from "../src/lib/whatsapp/webhook";
import { applyWebhookEvents } from "../src/lib/whatsapp/webhook-apply";
import { addDays, drToday, parseDrDateTime } from "../src/lib/domain/dr-time";

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
const createdMessageIds: string[] = [];
const createdEventKeys: string[] = [];

type TestUser = { userId: string; client: SupabaseClient<Database> };

async function createUser(label: string): Promise<TestUser> {
  const email = `wa-replies-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient<Database>(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, client };
}

async function createClinic(owner: TestUser, label: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] Respuestas ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

/** Teléfono ficticio de prueba que no tiene ningún consentimiento activo (la BAJA revoca por teléfono). */
async function freePhone(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = `+1849555${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const { data } = await admin.from("patient_messaging_consents").select("id").eq("phone_e164", candidate).is("revoked_at", null).limit(1);
    if ((data ?? []).length === 0) return candidate;
  }
  throw new Error("No se encontró un teléfono de prueba libre");
}

type Seed = { clinicId: string; patientId: string; appointmentId: string; reminderId: string; consentId: string };

/** Paciente con consentimiento + cita de mañana + recordatorio reclamado (en_envio). */
async function seedReminder(opts: { clinicId: string; owner: TestUser; phone: string; templateId: string; time?: string }): Promise<Seed> {
  const { data: patient, error: pe } = await opts.owner.client
    .from("patients")
    .insert({ clinic_id: opts.clinicId, first_name: "Paciente", last_name: `Resp ${randomUUID().slice(0, 6)}`, date_of_birth: "1990-01-01", sex: "femenino" })
    .select("id")
    .single();
  if (pe || !patient) throw new Error(`No se pudo crear paciente: ${pe?.message}`);
  const { data: consent, error: ce } = await opts.owner.client
    .from("patient_messaging_consents")
    .insert({ clinic_id: opts.clinicId, patient_id: patient.id, phone_e164: opts.phone, source: "verbal" })
    .select("id")
    .single();
  if (ce || !consent) throw new Error(`No se pudo crear consentimiento: ${ce?.message}`);
  const tomorrow = addDays(drToday(), 1);
  const { data: appt, error: ae } = await admin
    .from("appointments")
    .insert({
      clinic_id: opts.clinicId,
      patient_id: patient.id,
      provider_id: opts.owner.userId,
      specialty_template_id: opts.templateId,
      scheduled_at: parseDrDateTime(tomorrow, opts.time ?? "10:00")!.toISOString(),
      created_by: opts.owner.userId,
    })
    .select("id")
    .single();
  if (ae || !appt) throw new Error(`No se pudo crear la cita: ${ae?.message}`);
  const { data: claimed, error: claimErr } = await admin.rpc("claim_due_appointment_reminders", { p_now: new Date().toISOString() });
  if (claimErr) throw new Error(`claim falló: ${claimErr.message}`);
  const mine = (claimed ?? []).find((r) => r.out_appointment_id === appt.id);
  if (!mine) throw new Error("El recordatorio no fue reclamado (¿interruptor apagado?)");
  return { clinicId: opts.clinicId, patientId: patient.id, appointmentId: appt.id, reminderId: mine.out_reminder_id, consentId: consent.id };
}

const sendArgs = (reminderId: string, ok: boolean, wamid: string | null, phone: string) => ({
  p_reminder_id: reminderId,
  p_ok: ok,
  p_meta_message_id: wamid ?? "",
  p_error: ok ? "" : "Business eligibility payment issue",
  p_to_phone: phone,
  p_template_name: "recordatorio_cita_v3",
  p_template_language: "es",
  p_variables: ["Clínica Ejemplo", "16 de octubre", "10:00 a. m."],
  p_environment: "production",
  p_meta_app_id: "1088516603521677",
});

function inboundPayload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "W", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "1" }, messages: [message] } }] }],
  };
}
const buttonMessage = (from: string, payload: string) => ({ from, id: `wamid.IN${randomUUID().replace(/-/g, "")}`, timestamp: "1790000000", type: "button", button: { payload, text: "x" } });

async function applyInbound(message: Record<string, unknown>) {
  const { events } = parseWebhook(inboundPayload(message));
  createdEventKeys.push(...events.map((e) => e.key));
  return applyWebhookEvents(admin, events);
}

async function main() {
  // ------------------------------------------------------------------ puro
  console.log("\nVariables de la plantilla:");
  const p1 = buildReminderParams("Clínica Ejemplo", "2026-10-16T14:00:00Z");
  check("clínica, fecha y hora de RD (10:00 a. m.)", p1[0] === "Clínica Ejemplo" && p1[1] === "16 de octubre" && p1[2] === "10:00 a. m.", JSON.stringify(p1));
  const p2 = buildReminderParams("Clínica Ejemplo", "2026-10-17T00:30:00Z");
  check("a las 8:30 p. m. de RD sigue siendo el 16 (no el 17 de UTC)", p2[1] === "16 de octubre" && p2[2] === "8:30 p. m.", JSON.stringify(p2));
  const p3 = buildReminderParams("  Centro\n de   Salud\tSS  ", "2026-10-16T14:00:00Z");
  check("el nombre de la clínica no lleva saltos de línea ni espacios repetidos", p3[0] === "Centro de Salud SS", JSON.stringify(p3[0]));
  check("un nombre vacío cae a «su clínica»", buildReminderParams("   ", "2026-10-16T14:00:00Z")[0] === "su clínica", "no cayó al valor por defecto");
  check("las variables no llevan espacios no separables", buildReminderParams("X", "2026-10-16T14:00:00Z").every((v) => !/[  ]/.test(v)), "quedó un espacio no separable");
  check("nombres larguísimos se recortan", buildReminderParams("A".repeat(200), "2026-10-16T14:00:00Z")[0].length <= 60, "no recortó");

  console.log("\nBotones:");
  const rid = randomUUID();
  const [confirmPayload, cancelPayload] = reminderButtonPayloads(rid);
  check("payloads de Confirmar y Cancelar", confirmPayload === `r:${rid}:c` && cancelPayload === `r:${rid}:x`, `${confirmPayload} ${cancelPayload}`);
  check("se leen de vuelta", parseReminderPayload(confirmPayload)?.action === "confirmar" && parseReminderPayload(cancelPayload)?.action === "cancelar" && parseReminderPayload(confirmPayload)?.reminderId === rid, "no se leyó");
  check("UUID en mayúsculas se normaliza", parseReminderPayload(`r:${rid.toUpperCase()}:c`)?.reminderId === rid, "no se normalizó");
  check("payloads ajenos o dañados se ignoran", parseReminderPayload("hola") === null && parseReminderPayload(`r:${rid}:z`) === null && parseReminderPayload("r:no-es-uuid:c") === null && parseReminderPayload(null) === null && parseReminderPayload(5) === null, "aceptó un payload inválido");
  check("el payload cabe en el límite de Meta (256)", confirmPayload.length <= 256, String(confirmPayload.length));

  console.log("\nBAJA (solo el mensaje entero):");
  check("BAJA, baja, Baja., STOP, «no más», «No mas!»", ["BAJA", "baja", "  Baja. ", "STOP", "stop", "no más", "No mas!", "Parar", "dar de baja"].every(isOptOutText), "no reconoció una baja");
  check("una frase que contiene «baja» NO es baja", !isOptOutText("me baja la presión") && !isOptOutText("¿pueden dar de baja mi cita para el lunes?") && !isOptOutText("baja de peso"), "dio de baja por error");
  check("otras respuestas no son baja (sí, cancelar, hola, vacío, no texto)", !isOptOutText("sí") && !isOptOutText("Cancelar") && !isOptOutText("hola") && !isOptOutText("") && !isOptOutText(null) && !isOptOutText(undefined) && !isOptOutText(12), "lo tomó como baja");

  console.log("\nAutenticación del planificador:");
  check("el secreto correcto autoriza", isAuthorizedCron("Bearer s3cr3t", "s3cr3t"), "no autorizó");
  check("sin cabecera, con otro secreto o sin «Bearer» no", !isAuthorizedCron(null, "s3cr3t") && !isAuthorizedCron("Bearer otro", "s3cr3t") && !isAuthorizedCron("s3cr3t", "s3cr3t") && !isAuthorizedCron("Bearer s3cr3t ", "s3cr3t"), "autorizó de más");
  check("sin secreto configurado nunca autoriza", !isAuthorizedCron("Bearer ", "") && !isAuthorizedCron("Bearer undefined", undefined) && !isAuthorizedCron("Bearer ", undefined), "autorizó sin secreto");

  console.log("\nAnálisis de las respuestas entrantes:");
  const btn = parseWebhook(inboundPayload(buttonMessage("18096635279", confirmPayload)));
  check("botón Confirmar de un recordatorio", btn.events.length === 1 && btn.events[0].kind === "inbound_reply" && btn.events[0].action === "confirmar" && btn.events[0].reminderId === rid && btn.events[0].from === "18096635279", JSON.stringify(btn));
  const interactive = parseWebhook(inboundPayload({ from: "18096635279", id: "wamid.I1", type: "interactive", interactive: { type: "button_reply", button_reply: { id: cancelPayload, title: "Cancelar" } } }));
  check("botón interactivo Cancelar", interactive.events[0]?.kind === "inbound_reply" && interactive.events[0].action === "cancelar" && interactive.events[0].reminderId === rid, JSON.stringify(interactive));
  const baja = parseWebhook(inboundPayload({ from: "18096635279", id: "wamid.B1", type: "text", text: { body: "BAJA" } }));
  check("texto BAJA", baja.events[0]?.kind === "inbound_reply" && baja.events[0].action === "baja" && baja.events[0].reminderId === null, JSON.stringify(baja));
  const chat = parseWebhook(inboundPayload({ from: "18096635279", id: "wamid.C1", type: "text", text: { body: "Doctor, me duele mucho la cabeza desde ayer" } }));
  check("un mensaje clínico libre se ignora (no se guarda nada)", chat.events.length === 0 && chat.ignored === 1, JSON.stringify(chat));
  check("imágenes, audios y ubicaciones se ignoran", parseWebhook(inboundPayload({ from: "18096635279", id: "wamid.M1", type: "image", image: { id: "1" } })).events.length === 0, "no se ignoró");
  check("un botón que no es de un recordatorio se ignora", parseWebhook(inboundPayload(buttonMessage("18096635279", "otra-cosa"))).events.length === 0, "lo aceptó");
  check("un remitente raro se ignora", parseWebhook(inboundPayload({ ...buttonMessage("abc", confirmPayload) })).events.length === 0, "lo aceptó");
  const asString = JSON.stringify([...btn.events, ...baja.events, ...chat.events]);
  check("los eventos NO llevan el texto del paciente", !asString.includes("BAJA") && !asString.includes("me duele"), asString);
  check("la clave de deduplicación es el id del mensaje", baja.events[0].key === eventKey("inbound_reply", "wamid.B1"), baja.events[0].key);
  check("la confirmación de baja está redactada", OPT_OUT_CONFIRMATION_TEXT.includes("no recibirá más recordatorios"), OPT_OUT_CONFIRMATION_TEXT);

  // ----------------------------------------------------------- base de datos
  const owner = await createUser("admin");
  const otherOwner = await createUser("otra");
  const clinic = await createClinic(owner, "A");
  const clinicB = await createClinic(otherOwner, "B");
  const { error: s1 } = await admin.from("clinic_whatsapp_settings").insert({ clinic_id: clinic, reminders_enabled: true });
  const { error: s2 } = await admin.from("clinic_whatsapp_settings").insert({ clinic_id: clinicB, reminders_enabled: true });
  if (s1 || s2) throw new Error(`No se pudieron activar los interruptores: ${s1?.message ?? s2?.message}`);
  const { data: templates } = await admin.from("specialty_templates").select("id, requires_explicit_access");
  const templateId = templates!.find((t) => !t.requires_explicit_access)!.id;

  console.log("\nRegistrar el envío (record_reminder_send):");
  const phoneA = await freePhone();
  const sA = await seedReminder({ clinicId: clinic, owner, phone: phoneA, templateId, time: "09:00" });
  const wamid1 = `wamid.TESTREM${randomUUID().replace(/-/g, "")}`;
  const { data: msgId, error: sendErr } = await admin.rpc("record_reminder_send", sendArgs(sA.reminderId, true, wamid1, phoneA));
  check("registra el envío sin error", sendErr === null && !!msgId, sendErr?.message ?? "");
  if (msgId) createdMessageIds.push(msgId);
  const { data: msg1 } = await admin.from("whatsapp_messages").select("clinic_id, patient_id, appointment_id, sent_by, purpose, status, meta_message_id, environment, template_variables").eq("id", msgId!).single();
  check(
    "el mensaje queda automático (sin usuario), ligado a la cita y al paciente",
    msg1?.sent_by === null && msg1.purpose === "recordatorio_cita" && msg1.status === "sent" && msg1.meta_message_id === wamid1 && msg1.appointment_id === sA.appointmentId && msg1.patient_id === sA.patientId && msg1.clinic_id === clinic && msg1.environment === "production",
    JSON.stringify(msg1)
  );
  check("guarda las variables enviadas (clínica, fecha, hora)", Array.isArray(msg1?.template_variables) && (msg1!.template_variables as string[]).length === 3, JSON.stringify(msg1?.template_variables));
  const { data: rem1 } = await admin.from("appointment_reminders").select("status, whatsapp_message_id, sent_at").eq("id", sA.reminderId).single();
  check("el recordatorio pasa a «enviado» con su mensaje y su hora", rem1?.status === "enviado" && rem1.whatsapp_message_id === msgId && rem1.sent_at !== null, JSON.stringify(rem1));
  const { data: again } = await admin.rpc("record_reminder_send", sendArgs(sA.reminderId, true, `wamid.OTRO${randomUUID()}`, phoneA));
  const { data: msgCount } = await admin.from("whatsapp_messages").select("id").eq("appointment_id", sA.appointmentId);
  check("repetir el registro es inofensivo (no duplica el mensaje)", again === msgId && (msgCount ?? []).length === 1, `mensajes: ${(msgCount ?? []).length}`);
  const deliveredEvents = parseWebhook({
    object: "whatsapp_business_account",
    entry: [{ id: "W", changes: [{ field: "messages", value: { statuses: [{ id: wamid1, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "1" }] } }] }],
  }).events;
  createdEventKeys.push(...deliveredEvents.map((e) => e.key));
  const delivered = await applyWebhookEvents(admin, deliveredEvents);
  const { data: afterDelivered } = await admin.from("whatsapp_messages").select("status").eq("id", msgId!).single();
  check("el aviso de «entregado» de Meta actualiza ese mensaje automático", delivered.failed === 0 && afterDelivered?.status === "delivered", JSON.stringify([delivered, afterDelivered]));

  const sFail = await seedReminder({ clinicId: clinic, owner, phone: await freePhone(), templateId, time: "09:30" });
  const { data: failMsg } = await admin.rpc("record_reminder_send", sendArgs(sFail.reminderId, false, null, "+18495550001"));
  if (failMsg) createdMessageIds.push(failMsg);
  const { data: failRem } = await admin.from("appointment_reminders").select("status, skip_reason, sent_at").eq("id", sFail.reminderId).single();
  const { data: failRow } = await admin.from("whatsapp_messages").select("status, error_message, meta_message_id").eq("id", failMsg!).single();
  check("un fallo queda «fallido» con el motivo de Meta", failRem?.status === "fallido" && failRem.skip_reason?.includes("payment") === true && failRem.sent_at === null && failRow?.status === "failed" && failRow.meta_message_id === null, JSON.stringify([failRem, failRow]));

  console.log("\nResponder «Confirmar» / «Cancelar» (apply_reminder_response):");
  const phoneC = await freePhone();
  const sC = await seedReminder({ clinicId: clinic, owner, phone: phoneC, templateId, time: "10:00" });
  const [cPayload, xPayload] = reminderButtonPayloads(sC.reminderId);
  const wrongPhone = await applyInbound(buttonMessage("18495550999", cPayload));
  const { data: apptWrong } = await admin.from("appointments").select("status").eq("id", sC.appointmentId).single();
  const { data: remWrong } = await admin.from("appointment_reminders").select("response").eq("id", sC.reminderId).single();
  check("responde otro teléfono: se ignora y la cita no cambia", wrongPhone.failed === 0 && apptWrong?.status === "pendiente" && remWrong?.response === null, JSON.stringify([apptWrong, remWrong]));
  const conf = await applyInbound(buttonMessage(phoneC.replace("+", ""), cPayload));
  const { data: apptConf } = await admin.from("appointments").select("status").eq("id", sC.appointmentId).single();
  const { data: remConf } = await admin.from("appointment_reminders").select("response, responded_at").eq("id", sC.reminderId).single();
  check("«Confirmar» deja la cita confirmada y registra la respuesta", conf.applied === 1 && apptConf?.status === "confirmada" && remConf?.response === "confirmar" && remConf.responded_at !== null, JSON.stringify([conf, apptConf, remConf]));
  const msgSame = buttonMessage(phoneC.replace("+", ""), cPayload);
  const first = await applyInbound(msgSame);
  const second = await applyWebhookEvents(admin, parseWebhook(inboundPayload(msgSame)).events);
  check("el mismo mensaje repetido por Meta se detecta como duplicado", first.applied === 1 && second.duplicates === 1 && second.applied === 0, JSON.stringify([first, second]));
  const canc = await applyInbound(buttonMessage(phoneC.replace("+", ""), xPayload));
  const { data: apptCanc } = await admin.from("appointments").select("status").eq("id", sC.appointmentId).single();
  check("cambiar de opinión: «Cancelar» cancela una cita confirmada", canc.applied === 1 && apptCanc?.status === "cancelada", JSON.stringify([canc, apptCanc]));
  await applyInbound(buttonMessage(phoneC.replace("+", ""), cPayload));
  const { data: apptRevive } = await admin.from("appointments").select("status").eq("id", sC.appointmentId).single();
  const { data: remRevive } = await admin.from("appointment_reminders").select("response").eq("id", sC.reminderId).single();
  check("una cita cancelada no «revive» con un Confirmar tardío (la respuesta sí se registra)", apptRevive?.status === "cancelada" && remRevive?.response === "confirmar", JSON.stringify([apptRevive, remRevive]));
  const ghost = await applyInbound(buttonMessage("18495550888", `r:${randomUUID()}:c`));
  check("un recordatorio inexistente no da error", ghost.failed === 0, JSON.stringify(ghost));

  console.log("\nBAJA (revoca por teléfono, en todas las clínicas):");
  const shared = await freePhone();
  await seedReminder({ clinicId: clinic, owner, phone: shared, templateId, time: "12:00" });
  const newPatientIn = async (clinicId: string, who: TestUser, name: string) => {
    const { data, error } = await who.client
      .from("patients")
      .insert({ clinic_id: clinicId, first_name: "Familiar", last_name: `${name} ${randomUUID().slice(0, 5)}`, date_of_birth: "2015-01-01", sex: "masculino" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear paciente: ${error?.message}`);
    return data.id;
  };
  // El mismo teléfono (familia) consentido por un segundo paciente de la clínica A y por uno de la clínica B.
  const patA2 = await newPatientIn(clinic, owner, "ComparteA");
  const patB1 = await newPatientIn(clinicB, otherOwner, "ComparteB");
  const { error: shA } = await owner.client.from("patient_messaging_consents").insert({ clinic_id: clinic, patient_id: patA2, phone_e164: shared, source: "verbal" });
  const { error: shB } = await otherOwner.client.from("patient_messaging_consents").insert({ clinic_id: clinicB, patient_id: patB1, phone_e164: shared, source: "verbal" });
  if (shA || shB) throw new Error(`No se pudo crear el consentimiento compartido: ${shA?.message ?? shB?.message}`);
  const bajaResult = await applyInbound({ from: shared.replace("+", ""), id: `wamid.BAJA${randomUUID().replace(/-/g, "")}`, timestamp: "1790000000", type: "text", text: { body: " Baja " } });
  const { data: stillActive } = await admin.from("patient_messaging_consents").select("id").eq("phone_e164", shared).is("revoked_at", null);
  const { data: revokedRows } = await admin.from("patient_messaging_consents").select("revoke_source").eq("phone_e164", shared).not("revoked_at", "is", null);
  check(
    "BAJA revoca TODOS los consentimientos de ese teléfono (3 pacientes, 2 clínicas)",
    bajaResult.failed === 0 && (stillActive ?? []).length === 0 && (revokedRows ?? []).length === 3 && (revokedRows ?? []).every((r) => r.revoke_source === "baja_paciente"),
    JSON.stringify([bajaResult, revokedRows])
  );
  check("y devuelve ese teléfono UNA vez para confirmarle la baja", bajaResult.optOutPhones.length === 1 && bajaResult.optOutPhones[0] === shared, JSON.stringify(bajaResult.optOutPhones));
  // Una cita nueva del paciente dado de baja ya no recibe recordatorio.
  const { data: apptAfter, error: apptAfterErr } = await admin
    .from("appointments")
    .insert({ clinic_id: clinic, patient_id: patA2, provider_id: owner.userId, specialty_template_id: templateId, scheduled_at: parseDrDateTime(addDays(drToday(), 1), "14:00")!.toISOString(), created_by: owner.userId })
    .select("id")
    .single();
  if (apptAfterErr || !apptAfter) throw new Error(`No se pudo crear la cita: ${apptAfterErr?.message}`);
  const { data: claimedAfterBaja } = await admin.rpc("claim_due_appointment_reminders", { p_now: new Date().toISOString() });
  check("la cita nueva del paciente dado de baja no recibe recordatorio", !(claimedAfterBaja ?? []).some((r) => r.out_appointment_id === apptAfter.id), "se reclamó");
  const noOne = await applyInbound({ from: "18495550777", id: `wamid.BAJA${randomUUID().replace(/-/g, "")}`, timestamp: "1790000000", type: "text", text: { body: "STOP" } });
  check("BAJA de un número que no tenía consentimiento: no pasa nada y NO se le responde", noOne.failed === 0 && noOne.optOutPhones.length === 0, JSON.stringify(noOne));
  const { data: baja2 } = await admin.rpc("revoke_whatsapp_consent_by_phone", { p_phone: "no-es-un-telefono" });
  check("un teléfono mal formado no revoca nada", baja2 === 0, String(baja2));

  console.log("\nClínica en solo lectura:");
  const phoneRO = await freePhone();
  const sRO = await seedReminder({ clinicId: clinicB, owner: otherOwner, phone: phoneRO, templateId, time: "11:00" });
  const [roC] = reminderButtonPayloads(sRO.reminderId);
  const patRO2 = await newPatientIn(clinicB, otherOwner, "BajaRO");
  const phoneRO2 = await freePhone();
  const { error: ro2Err } = await otherOwner.client.from("patient_messaging_consents").insert({ clinic_id: clinicB, patient_id: patRO2, phone_e164: phoneRO2, source: "verbal" });
  if (ro2Err) throw new Error(`No se pudo crear el consentimiento: ${ro2Err.message}`);
  const { data: todayData } = await admin.rpc("dr_today");
  await admin.from("clinic_subscriptions").update({ trial_ends_at: addDays(todayData as string, -31), next_payment_due_on: null }).eq("clinic_id", clinicB);
  const { data: roMsg, error: roSendErr } = await admin.rpc("record_reminder_send", sendArgs(sRO.reminderId, true, `wamid.RO${randomUUID().replace(/-/g, "")}`, phoneRO));
  if (roMsg) createdMessageIds.push(roMsg);
  check("el envío ya hecho se registra aunque la clínica haya pasado a solo lectura", roSendErr === null && !!roMsg, roSendErr?.message ?? "");
  const ro = await applyInbound(buttonMessage(phoneRO.replace("+", ""), roC));
  const { data: roAppt } = await admin.from("appointments").select("status").eq("id", sRO.appointmentId).single();
  const { data: roRem } = await admin.from("appointment_reminders").select("response").eq("id", sRO.reminderId).single();
  check("responder en solo lectura: la respuesta se registra pero la cita NO cambia", ro.failed === 0 && roAppt?.status === "pendiente" && roRem?.response === "confirmar", JSON.stringify([ro, roAppt, roRem]));
  const roBaja = await applyInbound({ from: phoneRO2.replace("+", ""), id: `wamid.BAJA${randomUUID().replace(/-/g, "")}`, timestamp: "1790000000", type: "text", text: { body: "BAJA" } });
  const { data: roConsentAfter } = await admin.from("patient_messaging_consents").select("revoked_at").eq("phone_e164", phoneRO2).single();
  check("la BAJA se respeta aunque la clínica esté en solo lectura", roBaja.failed === 0 && roConsentAfter?.revoked_at !== null, JSON.stringify([roBaja, roConsentAfter]));


  console.log("\nRecordatorios atascados (expire_stuck_appointment_reminders):");
  const sStuck = await seedReminder({ clinicId: clinic, owner, phone: await freePhone(), templateId, time: "13:00" });
  const sFresh = await seedReminder({ clinicId: clinic, owner, phone: await freePhone(), templateId, time: "13:30" });
  await admin.from("appointment_reminders").update({ claimed_at: new Date(Date.now() - 3 * 3600_000).toISOString() }).eq("id", sStuck.reminderId);
  const { data: expired } = await admin.rpc("expire_stuck_appointment_reminders");
  const { data: stuckRow } = await admin.from("appointment_reminders").select("status, skip_reason").eq("id", sStuck.reminderId).single();
  const { data: freshRow } = await admin.from("appointment_reminders").select("status").eq("id", sFresh.reminderId).single();
  check("el que lleva 3 h en «en_envio» pasa a «fallido» (sin_resultado)", (expired ?? 0) >= 1 && stuckRow?.status === "fallido" && stuckRow.skip_reason === "sin_resultado", JSON.stringify([expired, stuckRow]));
  check("el reciente no se toca", freshRow?.status === "en_envio", JSON.stringify(freshRow));
  const { data: claimedStuck } = await admin.rpc("claim_due_appointment_reminders", { p_now: new Date().toISOString() });
  check("y NUNCA se reenvía: no se vuelve a reclamar", !(claimedStuck ?? []).some((r) => r.out_appointment_id === sStuck.appointmentId), "se reclamó otra vez");

  console.log("\nPermisos:");
  const asUser = (fn: string, args: Record<string, unknown>) => (owner.client as unknown as SupabaseClient).rpc(fn, args);
  const userCalls = await Promise.all([
    asUser("record_reminder_send", sendArgs(sFresh.reminderId, true, "wamid.X", "+18495550003")),
    asUser("apply_reminder_response", { p_reminder_id: sFresh.reminderId, p_response: "confirmar" }),
    asUser("revoke_whatsapp_consent_by_phone", { p_phone: shared }),
    asUser("expire_stuck_appointment_reminders", {}),
  ]);
  check("ningún usuario ejecuta las funciones del servidor (ni el admin de la clínica)", userCalls.every((c) => c.error !== null), JSON.stringify(userCalls.map((c) => c.error?.message)));
  const { data: untouched } = await admin.from("appointment_reminders").select("status, response").eq("id", sFresh.reminderId).single();
  check("y no cambiaron nada", untouched?.status === "en_envio" && untouched.response === null, JSON.stringify(untouched));

  console.log("\nCobertura:");
  const { data: unguarded, error: ugErr } = await admin.rpc("list_unguarded_tables");
  check("ninguna tabla queda sin readonly_guard", ugErr === null && (unguarded ?? []).length === 0, ugErr?.message ?? JSON.stringify(unguarded));
  const { data: open, error: openErr } = await admin.rpc("list_policies_open_when_blocked");
  check("ninguna política queda abierta con la clínica bloqueada", openErr === null && (open ?? []).length === 0, openErr?.message ?? JSON.stringify(open));
}

async function cleanup() {
  for (const id of createdClinicIds) await admin.from("clinics").delete().eq("id", id);
  for (const id of createdMessageIds) await admin.from("whatsapp_messages").delete().eq("id", id);
  if (createdEventKeys.length > 0) await admin.from("whatsapp_webhook_events").delete().in("event_key", createdEventKeys);
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
    console.log("\nOK: respuestas, baja y registro de envíos de los recordatorios verificados.");
  });
