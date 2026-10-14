/**
 * Prueba del webhook de WhatsApp, el catálogo de plantillas y los estados de entrega --
 * supabase/migrations/20261016100000_whatsapp_templates_webhook.sql,
 * src/lib/whatsapp/webhook.ts, webhook-apply.ts y templates.ts.
 *
 * Qué verifica:
 *   1. PURO: firma X-Hub-Signature-256 (válida, ausente, alterada, formato raro, longitud
 *      distinta), saludo de verificación, análisis de cargas (estados, plantillas, calidad,
 *      categoría, mensajes entrantes ignorados, basura), orden de estados, clave de
 *      deduplicación, reglas de plantillas de Meta.
 *   2. BASE DE DATOS (datos sintéticos): los estados avanzan sin retroceder, un reintento no
 *      duplica, un fallo libera la clave para el reintento de Meta, el acuse se registra aunque la
 *      clínica esté en solo lectura, los avisos de plantilla actualizan el catálogo; RLS (solo el
 *      operador lee; nadie escribe salvo service_role; la RPC no es ejecutable por usuarios) y la
 *      cobertura de guard/políticas sigue vacía.
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
  eventKey,
  normalizeTemplateStatus,
  parseWebhook,
  shouldApplyMessageStatus,
  signBody,
  verifyHandshake,
  verifySignature,
} from "../src/lib/whatsapp/webhook";
import { applyWebhookEvents } from "../src/lib/whatsapp/webhook-apply";
import { validateTemplate } from "../src/lib/whatsapp/templates";

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
const createdTemplateIds: string[] = [];
const createdEventKeys: string[] = [];

type TestUser = { userId: string; client: SupabaseClient<Database> };

async function createUser(label: string): Promise<TestUser> {
  const email = `wa-webhook-${label}-${randomUUID()}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear usuario ${label}: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`No se pudo iniciar sesión ${label}: ${signInError.message}`);
  return { userId: data.user.id, client };
}

async function createClinic(owner: TestUser, label: string): Promise<string> {
  const { data, error } = await owner.client.rpc("create_clinic_with_admin", {
    clinic_name: `[TEST] WhatsApp ${label} ${randomUUID().slice(0, 8)}`,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (error || !data) throw new Error(`create_clinic_with_admin (${label}) falló: ${error?.message}`);
  createdClinicIds.push(data as string);
  return data as string;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// --------------------------------------------------------------- constructores de cargas

function statusPayload(wamid: string, status: string, ts: number, errors?: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15554874847", phone_number_id: "1406407242553678" },
              statuses: [{ id: wamid, status, timestamp: String(ts), recipient_id: "18095550000", ...(errors ? { errors } : {}) }],
            },
          },
        ],
      },
    ],
  };
}

function templatePayload(field: string, value: Record<string, unknown>, time = 1790000000) {
  return { object: "whatsapp_business_account", entry: [{ id: "WABA1", time, changes: [{ field, value }] }] };
}

async function apply(payload: unknown) {
  const { events } = parseWebhook(payload);
  return applyWebhookEvents(admin, events);
}

async function messageRow(id: string) {
  const { data } = await admin
    .from("whatsapp_messages")
    .select("status, delivered_at, read_at, meta_error_code, error_message, status_updated_at")
    .eq("id", id)
    .single();
  return data;
}

async function newMessage(clinicId: string | null, sentBy: string, status: "sent" | "failed" = "sent") {
  const wamid = `wamid.TEST${randomUUID().replace(/-/g, "")}`;
  const { data, error } = await admin
    .from("whatsapp_messages")
    .insert({
      clinic_id: clinicId,
      to_phone_number: "+18095550000",
      template_name: "recordatorio_cita_v1",
      template_language: "es",
      environment: "test",
      meta_app_id: "1088516603521677",
      status,
      meta_message_id: wamid,
      sent_by: sentBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo crear el mensaje de prueba: ${error?.message}`);
  createdMessageIds.push(data.id);
  return { id: data.id, wamid };
}

async function main() {
  // ------------------------------------------------------------------ puro
  console.log("\nFirma X-Hub-Signature-256:");
  const secret = `s3cret-${randomUUID()}`;
  const body = JSON.stringify(statusPayload("wamid.X", "delivered", 1790000000));
  const good = signBody(body, secret);
  check("una firma válida se acepta", verifySignature(body, good, secret), "la rechazó");
  check("sin firma se rechaza", !verifySignature(body, null, secret) && !verifySignature(body, "", secret), "la aceptó");
  check("cuerpo alterado se rechaza", !verifySignature(body + " ", good, secret), "la aceptó");
  check("otra clave se rechaza", !verifySignature(body, signBody(body, "otra"), secret), "la aceptó");
  check(
    "formato raro o longitud distinta se rechaza",
    !verifySignature(body, good.replace("sha256=", ""), secret) &&
      !verifySignature(body, "sha256=abc", secret) &&
      !verifySignature(body, `sha1=${good.slice(7)}`, secret) &&
      !verifySignature(body, `${good}00`, secret),
    "aceptó un formato inválido"
  );
  check("sin clave secreta configurada nunca acepta", !verifySignature(body, good, ""), "aceptó sin clave");
  check("acepta mayúsculas en el hexadecimal", verifySignature(body, `sha256=${good.slice(7).toUpperCase()}`, secret), "la rechazó");

  console.log("\nSaludo de verificación (GET):");
  check("token correcto devuelve el challenge", verifyHandshake({ mode: "subscribe", token: "tok", challenge: "123" }, "tok") === "123", "no lo devolvió");
  check("token incorrecto no", verifyHandshake({ mode: "subscribe", token: "mal", challenge: "123" }, "tok") === null, "lo devolvió");
  check("modo distinto no", verifyHandshake({ mode: "unsubscribe", token: "tok", challenge: "123" }, "tok") === null, "lo devolvió");
  check("sin token configurado nunca acepta", verifyHandshake({ mode: "subscribe", token: "x", challenge: "123" }, undefined) === null && verifyHandshake({ mode: "subscribe", token: "", challenge: "123" }, "") === null, "aceptó");
  check("sin challenge no", verifyHandshake({ mode: "subscribe", token: "tok", challenge: null }, "tok") === null, "lo devolvió");

  console.log("\nAnálisis de la carga:");
  const st = parseWebhook(statusPayload("wamid.A", "delivered", 1790000000));
  check(
    "estado de mensaje entregado",
    st.events.length === 1 && st.events[0].kind === "message_status" && st.events[0].status === "delivered" && st.events[0].metaMessageId === "wamid.A",
    JSON.stringify(st)
  );
  const failed = parseWebhook(statusPayload("wamid.B", "failed", 1790000000, [{ code: 131026, title: "Message undeliverable", message: "No se pudo entregar" }]));
  check(
    "estado fallido trae código y mensaje",
    failed.events[0]?.kind === "message_status" && failed.events[0].errorCode === "131026" && failed.events[0].errorMessage === "No se pudo entregar",
    JSON.stringify(failed)
  );
  const tplStatus = parseWebhook(templatePayload("message_template_status_update", { event: "REJECTED", message_template_id: 555, message_template_name: "x", message_template_language: "es", reason: "INVALID_FORMAT" }));
  check("aviso de plantilla rechazada con motivo", tplStatus.events[0]?.kind === "template_status" && tplStatus.events[0].status === "REJECTED" && tplStatus.events[0].reason === "INVALID_FORMAT" && tplStatus.events[0].metaTemplateId === "555", JSON.stringify(tplStatus));
  const tplNoReason = parseWebhook(templatePayload("message_template_status_update", { event: "APPROVED", message_template_id: "555", reason: "NONE" }));
  check("motivo NONE se guarda como nulo", tplNoReason.events[0]?.kind === "template_status" && tplNoReason.events[0].reason === null, JSON.stringify(tplNoReason));
  check("REINSTATED equivale a APROBADA", normalizeTemplateStatus("reinstated") === "APPROVED" && normalizeTemplateStatus("paused") === "PAUSED", "no normalizó");
  const quality = parseWebhook(templatePayload("message_template_quality_update", { new_quality_score: "red", message_template_id: "555" }));
  check("aviso de calidad", quality.events[0]?.kind === "template_quality" && quality.events[0].quality === "RED", JSON.stringify(quality));
  const category = parseWebhook(templatePayload("template_category_update", { new_category: "MARKETING", message_template_id: "555" }));
  check("aviso de cambio de categoría", category.events[0]?.kind === "template_category" && category.events[0].category === "MARKETING", JSON.stringify(category));
  const badCategory = parseWebhook(templatePayload("template_category_update", { new_category: "OTRA", message_template_id: "555" }));
  check("categoría desconocida se ignora", badCategory.events.length === 0 && badCategory.ignored === 1, JSON.stringify(badCategory));
  const inbound = parseWebhook({
    object: "whatsapp_business_account",
    entry: [{ id: "W", changes: [{ field: "messages", value: { messages: [{ from: "18095550000", id: "wamid.IN", text: { body: "hola" } }], statuses: [] } }] }],
  });
  check("mensajes entrantes de pacientes se ignoran (no se guardan)", inbound.events.length === 0 && inbound.ignored === 1, JSON.stringify(inbound));
  check("otro objeto o basura no rompe", parseWebhook({ object: "page" }).events.length === 0 && parseWebhook(null).events.length === 0 && parseWebhook("x").events.length === 0 && parseWebhook({ object: "whatsapp_business_account", entry: "mal" }).events.length === 0, "lanzó o devolvió eventos");
  check("estado desconocido se ignora", parseWebhook(statusPayload("wamid.C", "deleted", 1790000000)).events.length === 0, "lo aceptó");
  check("la clave de deduplicación es estable y distingue estados", eventKey("a", "b") === eventKey("a", "b") && eventKey("a", "b") !== eventKey("a", "c") && eventKey("ab", "") !== eventKey("a", "b") && /^[0-9a-f]{64}$/.test(eventKey("x")), "clave inestable");
  check(
    "el mismo evento repetido da la misma clave; otra hora, otra clave",
    parseWebhook(statusPayload("wamid.A", "delivered", 1)).events[0].key === parseWebhook(statusPayload("wamid.A", "delivered", 1)).events[0].key &&
      parseWebhook(statusPayload("wamid.A", "delivered", 1)).events[0].key !== parseWebhook(statusPayload("wamid.A", "delivered", 2)).events[0].key,
    "claves incorrectas"
  );

  console.log("\nOrden de estados:");
  check("sent -> delivered -> read avanza", shouldApplyMessageStatus("sent", "delivered") && shouldApplyMessageStatus("delivered", "read") && shouldApplyMessageStatus("sent", "read"), "no avanzó");
  check("no retrocede ni repite", !shouldApplyMessageStatus("read", "delivered") && !shouldApplyMessageStatus("delivered", "delivered") && !shouldApplyMessageStatus("read", "sent"), "retrocedió");
  check("failed solo reemplaza a sent y es final", shouldApplyMessageStatus("sent", "failed") && !shouldApplyMessageStatus("delivered", "failed") && !shouldApplyMessageStatus("failed", "failed") && !shouldApplyMessageStatus("failed", "delivered"), "regla de failed incorrecta");

  console.log("\nReglas de plantillas:");
  const okTpl = validateTemplate({
    name: "recordatorio_cita_v1",
    language: "es",
    body: "Recordatorio: tiene una cita en {{1}} el {{2}} a las {{3}}. Si no puede asistir, por favor avísenos con anticipación.",
    examples: ["Clínica Ejemplo", "15 de octubre", "10:00 a. m."],
    buttons: ["Confirmar", "Cancelar"],
  });
  check("la plantilla de recordatorio es válida y arma el cuerpo de Meta", okTpl.ok && okTpl.payload.category === "UTILITY" && okTpl.variableCount === 3 && okTpl.payload.components.length === 2, JSON.stringify(okTpl));
  const errsOf = (i: Partial<Parameters<typeof validateTemplate>[0]>) => {
    const r = validateTemplate({ name: "ok_v1", language: "es", body: "Hola {{1}} desde la clínica.", examples: ["Ana"], ...i });
    return r.ok ? [] : r.errors.join(" | ");
  };
  check("nombre con mayúsculas, espacios o acentos se rechaza", errsOf({ name: "Recordatorio" }) !== "" && errsOf({ name: "mi plantilla" }) !== "" && errsOf({ name: "citá" }) !== "", "aceptó un nombre inválido");
  check("variable al inicio o al final se rechaza", String(errsOf({ body: "{{1}} tiene cita.", examples: ["Ana"] })).includes("empezar") && String(errsOf({ body: "Su cita es con {{1}}", examples: ["Ana"] })).includes("terminar"), "aceptó variable en el borde");
  check("variables pegadas se rechazan", String(errsOf({ body: "Hola {{1}}{{2}} adiós.", examples: ["a", "b"] })).includes("pegadas"), "aceptó pegadas");
  check("variables fuera de orden o saltadas se rechazan", errsOf({ body: "Hola {{2}} y {{1}} adiós.", examples: ["a", "b"] }) !== "" && errsOf({ body: "Hola {{1}} y {{3}} adiós.", examples: ["a", "b"] }) !== "", "aceptó desorden");
  check("falta un ejemplo por variable se rechaza", errsOf({ examples: [] }) !== "" && errsOf({ examples: ["a", "b"] }) !== "" && errsOf({ examples: [""] }) !== "", "aceptó sin ejemplos");
  check("cuerpo vacío o de más de 1,024 se rechaza", errsOf({ body: "  ", examples: [] }) !== "" && errsOf({ body: "a".repeat(1025), examples: [] }) !== "", "aceptó cuerpo inválido");
  check("pie largo o con variables se rechaza", errsOf({ footer: "x".repeat(61) }) !== "" && errsOf({ footer: "Hola {{1}}" }) !== "", "aceptó un pie inválido");
  check("botones: máximo 3, 25 caracteres, sin repetir", errsOf({ buttons: ["a", "b", "c", "d"] }) !== "" && errsOf({ buttons: ["x".repeat(26)] }) !== "" && errsOf({ buttons: ["Sí", "sí"] }) !== "", "aceptó botones inválidos");
  check("cuerpo sin variables y sin ejemplos es válido", validateTemplate({ name: "aviso_v1", language: "es", body: "Su cita fue confirmada.", examples: [] }).ok, "lo rechazó");
  check("ejemplos sin variables se rechazan", errsOf({ body: "Su cita fue confirmada.", examples: ["x"] }) !== "", "los aceptó");

  // ------------------------------------------------------------ base de datos
  const operator = await createUser("operator");
  const owner = await createUser("admin");
  const plain = await createUser("normal");
  await admin.from("platform_operators").insert({ user_id: operator.userId });
  const clinicA = await createClinic(owner, "A");

  console.log("\nEstados de entrega (base de datos):");
  const m1 = await newMessage(clinicA, owner.userId);
  const t0 = Math.floor(Date.now() / 1000);
  const r1 = await apply(statusPayload(m1.wamid, "delivered", t0));
  const row1 = await messageRow(m1.id);
  check("«entregado» actualiza el estado y la fecha", r1.applied === 1 && row1?.status === "delivered" && !!row1.delivered_at && row1.read_at === null, JSON.stringify([r1, row1]));
  const r1b = await apply(statusPayload(m1.wamid, "delivered", t0));
  check("el mismo evento repetido se detecta como duplicado", r1b.duplicates === 1 && r1b.applied === 0, JSON.stringify(r1b));
  await apply(statusPayload(m1.wamid, "read", t0 + 5));
  const row1c = await messageRow(m1.id);
  check("«leído» avanza y guarda la fecha", row1c?.status === "read" && !!row1c.read_at, JSON.stringify(row1c));
  await apply(statusPayload(m1.wamid, "delivered", t0 + 1));
  const row1d = await messageRow(m1.id);
  check("un «entregado» tardío no baja un «leído»", row1d?.status === "read", JSON.stringify(row1d));
  await apply(statusPayload(m1.wamid, "failed", t0 + 9, [{ code: 131026, message: "tarde" }]));
  const row1e = await messageRow(m1.id);
  check("un «fallido» no pisa uno ya leído", row1e?.status === "read" && row1e.meta_error_code === null, JSON.stringify(row1e));

  const m2 = await newMessage(clinicA, owner.userId);
  await apply(statusPayload(m2.wamid, "failed", t0, [{ code: 131026, title: "Message undeliverable", message: "No se pudo entregar" }]));
  const row2 = await messageRow(m2.id);
  check("«fallido» guarda código y mensaje", row2?.status === "failed" && row2.meta_error_code === "131026" && row2.error_message === "No se pudo entregar", JSON.stringify(row2));
  await apply(statusPayload(m2.wamid, "read", t0 + 3));
  check("un fallido es final", (await messageRow(m2.id))?.status === "failed", "cambió");

  const m3 = await newMessage(null, operator.userId);
  await apply(statusPayload(m3.wamid, "read", t0));
  const row3 = await messageRow(m3.id);
  check("una entrega sin «enviado» previo sube directo y rellena las fechas", row3?.status === "read" && !!row3.delivered_at && !!row3.read_at, JSON.stringify(row3));

  const rUnknown = await apply(statusPayload(`wamid.NOEXISTE${randomUUID()}`, "delivered", t0));
  check("un mensaje desconocido no da error", rUnknown.failed === 0, JSON.stringify(rUnknown));
  const bad = await applyWebhookEvents(admin, [
    { kind: "message_status", key: eventKey("bad", randomUUID()), field: "messages", metaMessageId: m3.wamid, status: "bogus" as never, occurredAt: null, errorCode: null, errorMessage: null },
  ]);
  check("un evento que falla al aplicarse se cuenta como fallido", bad.failed === 1 && bad.applied === 0, JSON.stringify(bad));
  const badKey = eventKey("bad2", randomUUID());
  await applyWebhookEvents(admin, [
    { kind: "message_status", key: badKey, field: "messages", metaMessageId: m3.wamid, status: "bogus" as never, occurredAt: null, errorCode: null, errorMessage: null },
  ]);
  const { data: leftover } = await admin.from("whatsapp_webhook_events").select("id").eq("event_key", badKey);
  check("y no deja su clave guardada: el reintento de Meta lo procesará", (leftover ?? []).length === 0, JSON.stringify(leftover));

  console.log("\nClínica en solo lectura:");
  const m4 = await newMessage(clinicA, owner.userId);
  const { data: todayData } = await admin.rpc("dr_today");
  await admin.from("clinic_subscriptions").update({ trial_ends_at: addDays(todayData as string, -31), next_payment_due_on: null }).eq("clinic_id", clinicA);
  const { error: blocked } = await admin.from("whatsapp_messages").insert({
    clinic_id: clinicA, to_phone_number: "+18095550000", template_name: "x", template_language: "es", environment: "test",
    meta_app_id: "1", status: "sent", meta_message_id: `wamid.RO${randomUUID()}`, sent_by: owner.userId,
  });
  check("(control) la clínica está en solo lectura: un envío nuevo se rechaza", blocked !== null && (blocked.message ?? "").includes("modo solo lectura"), blocked?.message ?? "no falló");
  const r4 = await apply(statusPayload(m4.wamid, "delivered", t0));
  check("el acuse de entrega de un mensaje ya enviado se registra igual", r4.applied === 1 && (await messageRow(m4.id))?.status === "delivered", JSON.stringify(await messageRow(m4.id)));
  const { error: directUpdate } = await admin.from("whatsapp_messages").update({ status: "read" }).eq("id", m4.id);
  check("(control) un UPDATE directo sí sigue bloqueado: el bypass es solo de la RPC", directUpdate !== null, "el UPDATE directo pasó");

  console.log("\nAvisos de plantilla (base de datos):");
  const metaTplId = `TEST${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const { data: tplRow, error: tplErr } = await admin
    .from("whatsapp_templates")
    .insert({ waba_id: "TEST_WABA", meta_template_id: metaTplId, name: `test_${randomUUID().slice(0, 8).replace(/-/g, "")}`, language: "es", category: "UTILITY", status: "PENDING" })
    .select("id")
    .single();
  check("service_role escribe en whatsapp_templates", tplErr === null && !!tplRow, tplErr?.message ?? "");
  if (tplRow) createdTemplateIds.push(tplRow.id);
  await apply(templatePayload("message_template_status_update", { event: "APPROVED", message_template_id: metaTplId, reason: "NONE" }, 1790000001));
  let tpl = (await admin.from("whatsapp_templates").select("status, rejected_reason, quality_score, category").eq("meta_template_id", metaTplId).single()).data;
  check("«aprobada» actualiza el estado", tpl?.status === "APPROVED" && tpl.rejected_reason === null, JSON.stringify(tpl));
  await apply(templatePayload("message_template_quality_update", { new_quality_score: "YELLOW", message_template_id: metaTplId }, 1790000002));
  await apply(templatePayload("template_category_update", { new_category: "MARKETING", message_template_id: metaTplId }, 1790000003));
  await apply(templatePayload("message_template_status_update", { event: "PAUSED", message_template_id: metaTplId, reason: "NONE" }, 1790000004));
  tpl = (await admin.from("whatsapp_templates").select("status, rejected_reason, quality_score, category").eq("meta_template_id", metaTplId).single()).data;
  check("calidad, categoría y pausa se reflejan", tpl?.quality_score === "YELLOW" && tpl.category === "MARKETING" && tpl.status === "PAUSED", JSON.stringify(tpl));
  const rTplUnknown = await apply(templatePayload("message_template_status_update", { event: "APPROVED", message_template_id: "NOEXISTE", reason: "NONE" }, 1790000005));
  check("un aviso de una plantilla que no está en el catálogo no da error", rTplUnknown.failed === 0, JSON.stringify(rTplUnknown));

  console.log("\nPermisos (RLS):");
  const readable = async (u: TestUser, table: "whatsapp_templates" | "whatsapp_webhook_events" | "whatsapp_messages") =>
    ((await u.client.from(table).select("id")).data ?? []).length;
  check("el operador lee el catálogo, los eventos y los mensajes", (await readable(operator, "whatsapp_templates")) > 0 && (await readable(operator, "whatsapp_webhook_events")) > 0 && (await readable(operator, "whatsapp_messages")) > 0, "no leyó");
  check("el admin de una clínica no lee nada de eso", (await readable(owner, "whatsapp_templates")) === 0 && (await readable(owner, "whatsapp_webhook_events")) === 0 && (await readable(owner, "whatsapp_messages")) === 0, "leyó");
  check("un usuario normal tampoco", (await readable(plain, "whatsapp_templates")) === 0 && (await readable(plain, "whatsapp_webhook_events")) === 0 && (await readable(plain, "whatsapp_messages")) === 0, "leyó");
  const tplInsert = { waba_id: "X", meta_template_id: `NOPE${randomUUID()}`, name: "no_permitida", language: "es", category: "UTILITY" as const, status: "PENDING" };
  check("ni el operador ni un admin escriben en el catálogo directamente", (await operator.client.from("whatsapp_templates").insert(tplInsert)).error !== null && (await owner.client.from("whatsapp_templates").insert(tplInsert)).error !== null, "escribió");
  const evInsert = { event_key: eventKey("no", randomUUID()), field: "messages" };
  check("tampoco en la tabla de eventos", (await operator.client.from("whatsapp_webhook_events").insert(evInsert)).error !== null && (await owner.client.from("whatsapp_webhook_events").insert(evInsert)).error !== null, "escribió");
  await operator.client.from("whatsapp_templates").update({ status: "HACK" }).eq("meta_template_id", metaTplId);
  check("ni actualizan el estado de una plantilla", (await admin.from("whatsapp_templates").select("status").eq("meta_template_id", metaTplId).single()).data?.status === "PAUSED", "cambió");
  const rpcAsOperator = await operator.client.rpc("record_whatsapp_message_status", { p_meta_message_id: m1.wamid, p_status: "failed", p_occurred_at: new Date().toISOString() });
  const rpcAsOwner = await owner.client.rpc("record_whatsapp_message_status", { p_meta_message_id: m2.wamid, p_status: "read", p_occurred_at: new Date().toISOString() });
  check("la RPC de estados no es ejecutable por usuarios (ni operador)", rpcAsOperator.error !== null && rpcAsOwner.error !== null, JSON.stringify([rpcAsOperator.error, rpcAsOwner.error]));
  const { data: keys } = await admin.from("whatsapp_webhook_events").select("event_key, field").limit(5);
  check("la tabla de eventos solo guarda hash y campo (sin teléfonos ni cuerpo)", (keys ?? []).every((k) => /^[0-9a-f]{64}$/.test(k.event_key)), JSON.stringify(keys));

  console.log("\nCobertura:");
  const { data: unguarded, error: ugErr } = await admin.rpc("list_unguarded_tables");
  check("ninguna tabla queda sin readonly_guard", ugErr === null && (unguarded ?? []).length === 0, ugErr?.message ?? JSON.stringify(unguarded));
  const { data: open, error: openErr } = await admin.rpc("list_policies_open_when_blocked");
  check("ninguna política queda abierta con la clínica bloqueada", openErr === null && (open ?? []).length === 0, openErr?.message ?? JSON.stringify(open));

  // Las claves de este test se limpian al final.
  const { data: allKeys } = await admin.from("whatsapp_webhook_events").select("event_key").gte("received_at", new Date(Date.now() - 3600_000).toISOString());
  createdEventKeys.push(...(allKeys ?? []).map((k) => k.event_key));
}

async function cleanup() {
  // Primero las clínicas: el borrado en cascada pone clinic_id = null en sus mensajes (acción
  // referencial, exenta del guard). Después se borran los mensajes ya sin clínica; con la clínica
  // en solo lectura el DELETE directo lo bloquearía el guard.
  for (const id of createdClinicIds) await admin.from("clinics").delete().eq("id", id);
  for (const id of createdMessageIds) await admin.from("whatsapp_messages").delete().eq("id", id);
  for (const id of createdTemplateIds) await admin.from("whatsapp_templates").delete().eq("id", id);
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
    console.log("\nOK: webhook de WhatsApp, plantillas y estados de entrega verificados.");
  });
