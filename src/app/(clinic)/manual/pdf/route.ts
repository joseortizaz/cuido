import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { getCurrentClinicAccess } from "@/lib/supabase/clinic-access";
import { MANUAL_PDF_FILE, getManualPdf } from "@/lib/manual";

/**
 * GET /manual/pdf -- el Manual del Usuario para imprimir. El PDF NO está en public/ (sería accesible sin
 * sesión): vive en content/manual/ y solo se entrega con sesión y clínica activa -- el mismo chequeo que
 * el layout de (clinic) (sesión, membresía y clínica no bloqueada/suspendida). Los tres roles pueden
 * descargarlo y no depende de que la clínica pueda escribir.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTo(request: Request, pathname: string) {
  return NextResponse.redirect(new URL(pathname, request.url));
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectTo(request, "/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) return redirectTo(request, "/onboarding");

  // Misma regla que el layout: con bloqueo total o suspensión solo se ve la pantalla explicativa.
  const access = await getCurrentClinicAccess();
  if (access?.state === "bloqueada" || access?.state === "suspendida") return redirectTo(request, "/dashboard");

  const pdf = getManualPdf();
  if (!pdf) return new NextResponse("El manual no está disponible por el momento.", { status: 404 });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${MANUAL_PDF_FILE}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
