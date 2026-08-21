// supabase/functions/sign-consent/index.ts
//
// Primera Edge Function del proyecto. Único camino para insertar en
// `consents` -- esa tabla no tiene política de INSERT para `authenticated`
// (ver supabase/migrations/20260821070000_informed_consent.sql), a
// propósito: el rastro de auditoría (hash/IP/user-agent/timestamp) no debe
// poder forjarse desde el cliente.
//
// Se invoca desde una Server Action de Next.js (nunca directo desde el
// navegador) pasando el access_token de la sesión del usuario en
// `Authorization: Bearer <token>` -- ver
// src/app/(clinic)/patients/[id]/consents/actions.ts.
//
// withSupabase({ auth: "user" }) hace dos cosas antes de que este código
// corra: (1) la puerta de enlace de Supabase valida la firma del JWT
// (verify_jwt, ajuste de plataforma), (2) @supabase/server valida que sea
// un JWT de usuario real y entrega ctx.supabase (RLS, como ese usuario) y
// ctx.supabaseAdmin (service_role, bypassa RLS). No hace falta un header
// `apikey` aparte para este modo -- solo el Bearer token.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const VALID_RELATIONSHIPS = ["paciente", "tutor", "representante"];

type SignConsentRequest = {
  patientId?: string;
  encounterId?: string | null;
  consentTemplateId?: string;
  signerName?: string;
  signerNationalId?: string | null;
  signerRelationship?: string;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const handler = {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return jsonError("Método no soportado.", 405);
    }

    const userId = ctx.userClaims?.id;
    if (!userId) {
      return jsonError("No se pudo identificar al usuario autenticado.", 401);
    }

    let body: SignConsentRequest;
    try {
      body = await req.json();
    } catch {
      return jsonError("Cuerpo de la solicitud inválido.", 400);
    }

    const patientId = body.patientId?.trim();
    const consentTemplateId = body.consentTemplateId?.trim();
    const signerName = body.signerName?.trim();
    const encounterId = body.encounterId?.trim() || null;
    const signerNationalId = body.signerNationalId?.trim() || null;
    const signerRelationship = body.signerRelationship ?? "paciente";

    if (!patientId || !consentTemplateId || !signerName) {
      return jsonError(
        "Faltan campos requeridos (patientId, consentTemplateId, signerName).",
        400
      );
    }
    if (!VALID_RELATIONSHIPS.includes(signerRelationship)) {
      return jsonError("signerRelationship inválido.", 400);
    }

    // 1. Resolver la clínica del paciente -- SIEMPRE server-side, nunca se
    // confía en un clinicId que mande el cliente.
    const { data: patient, error: patientError } = await ctx.supabaseAdmin
      .from("patients")
      .select("id, clinic_id")
      .eq("id", patientId)
      .maybeSingle();
    if (patientError) return jsonError("No se pudo verificar el paciente.", 500);
    if (!patient) return jsonError("Paciente no encontrado.", 404);

    // 2. El llamador debe ser miembro de esa clínica y la clínica debe
    // estar activa -- réplica manual de is_member_of_active_clinic()
    // porque esta función corre fuera de Postgres.
    const [{ data: membership }, { data: clinic }] = await Promise.all([
      ctx.supabaseAdmin
        .from("clinic_members")
        .select("id")
        .eq("clinic_id", patient.clinic_id)
        .eq("user_id", userId)
        .maybeSingle(),
      ctx.supabaseAdmin.from("clinics").select("is_active").eq("id", patient.clinic_id).maybeSingle(),
    ]);
    if (!membership || !clinic?.is_active) {
      return jsonError("No tienes acceso a esta clínica.", 403);
    }

    // 3. Si viene encounterId, debe pertenecer al mismo paciente.
    if (encounterId) {
      const { data: encounter } = await ctx.supabaseAdmin
        .from("encounters")
        .select("id, patient_id")
        .eq("id", encounterId)
        .maybeSingle();
      if (!encounter || encounter.patient_id !== patientId) {
        return jsonError("La consulta indicada no pertenece a este paciente.", 400);
      }
    }

    // 4. Plantilla activa -- el contenido se resuelve AQUÍ, nunca se
    // confía en texto que mande el cliente.
    const { data: template } = await ctx.supabaseAdmin
      .from("consent_templates")
      .select("id, title, body, is_active")
      .eq("id", consentTemplateId)
      .maybeSingle();
    if (!template || !template.is_active) {
      return jsonError("Plantilla de consentimiento no encontrada o inactiva.", 404);
    }

    const signedAt = new Date().toISOString();
    // Hash atado a QUIÉN firmó y CUÁNDO, no solo al texto -- ver la
    // migración para el razonamiento completo.
    const documentHash = await sha256Hex(
      JSON.stringify({
        document_title: template.title,
        document_content: template.body,
        patient_id: patientId,
        signer_name: signerName,
        signer_national_id: signerNationalId,
        signer_relationship: signerRelationship,
        signed_at: signedAt,
      })
    );

    const forwardedFor = req.headers.get("x-forwarded-for");
    const signerIp = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
    const signerUserAgent = req.headers.get("user-agent");

    const { data: consent, error: insertError } = await ctx.supabaseAdmin
      .from("consents")
      .insert({
        patient_id: patientId,
        encounter_id: encounterId,
        consent_template_id: consentTemplateId,
        document_title: template.title,
        document_content: template.body,
        document_hash: documentHash,
        signer_name: signerName,
        signer_national_id: signerNationalId,
        signer_relationship: signerRelationship,
        signed_at: signedAt,
        signer_ip: signerIp,
        signer_user_agent: signerUserAgent,
        recorded_by: userId,
      })
      .select("id, document_hash, signed_at")
      .single();

    if (insertError || !consent) {
      return jsonError("No se pudo registrar la firma.", 500);
    }

    return Response.json(
      { id: consent.id, documentHash: consent.document_hash, signedAt: consent.signed_at },
      { status: 201 }
    );
  }),
};

export default handler;
