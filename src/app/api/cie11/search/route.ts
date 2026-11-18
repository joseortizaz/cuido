import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { allowCie11Search } from "@/lib/cie11/rate-limit";
import { getIcdRelease, searchCie11 } from "@/lib/cie11/who-client";

/**
 * GET /api/cie11/search?q=… -- proxy del buscador de CIE-11 de la OMS.
 *
 * Solo médicos y administradores (no recepción), con sesión y clínica. Límite de uso por usuario y por clínica.
 * `q` entre 3 y 100 caracteres. A la OMS solo viaja ese texto (nunca datos del paciente); la respuesta trae
 * únicamente código, título, URI y si es hoja. Si la OMS no responde o faltan credenciales devuelve
 * `available: false` (200) y la interfaz ofrece escribir el código a mano: nunca bloquea el guardado.
 * Nada de esto se guarda en caché (licencia CC BY-ND) ni se registra en logs.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "No has iniciado sesión." }, 401);

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership || (membership.role !== "admin" && membership.role !== "medico")) {
    return json({ error: "No tienes permiso para buscar diagnósticos." }, 403);
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (q.length < 3 || q.length > 100) return json({ error: "Escribe entre 3 y 100 caracteres." }, 400);

  if (!allowCie11Search(user.id, membership.clinicId)) {
    return json({ error: "Demasiadas búsquedas seguidas. Espera un momento." }, 429);
  }

  const outcome = await searchCie11(q);
  if (outcome.status === "unavailable") {
    return json({ available: false, reason: outcome.reason, release: getIcdRelease(), results: [] });
  }
  return json({ available: true, release: getIcdRelease(), results: outcome.results });
}
