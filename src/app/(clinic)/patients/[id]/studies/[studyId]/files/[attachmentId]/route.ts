import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

/**
 * Descarga de un adjunto de un estudio: redirige a una URL FIRMADA de 60 segundos (nunca hay una URL pública
 * permanente). Todo se lee con la sesión del usuario: si RLS (o la política de Storage) no le deja ver el
 * adjunto, no hay URL. Solo admin y médicos.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; studyId: string; attachmentId: string }> }
) {
  const { id, studyId, attachmentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership || (membership.role !== "admin" && membership.role !== "medico")) {
    return NextResponse.json({ error: "Sin acceso." }, { status: 403 });
  }

  const { data: attachment } = await supabase
    .from("study_attachments")
    .select("storage_path, file_name, patient_id, study_id")
    .eq("id", attachmentId)
    .eq("study_id", studyId)
    .eq("patient_id", id)
    .maybeSingle();
  if (!attachment) return NextResponse.json({ error: "No se encontró el archivo." }, { status: 404 });

  const { data, error } = await supabase.storage.from("study-results").createSignedUrl(attachment.storage_path, 60);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "No se pudo generar el enlace." }, { status: 404 });

  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
