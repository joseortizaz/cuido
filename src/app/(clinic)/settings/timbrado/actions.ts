"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { MAX_LOGO_BYTES, sniffLogoMime } from "@/lib/domain/prescriptions";
import { sanitizeStudyFileName } from "@/lib/domain/study-results";

export type LetterheadState = { error?: string; success?: string } | undefined;

const BUCKET = "clinic-letterhead";

/**
 * Timbrado de la clínica (solo admin). La barrera real es save_clinic_letterhead (verifica admin, longitudes, correo y
 * que el logo exista en el bucket de ESTA clínica) y las políticas de Storage; el chequeo de aquí es comodidad.
 */
async function adminContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") return { supabase, membership, error: "Solo el administrador cambia el timbrado." as string | null };
  const blocked = await readOnlyBlock(supabase);
  if (blocked) return { supabase, membership, error: blocked as string | null };
  return { supabase, membership, error: null as string | null };
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "22023" || error.code === "42501" || error.message.includes("modo solo lectura")) return error.message;
  return "No se pudo guardar. Intenta de nuevo.";
}

export async function saveLetterhead(_prev: LetterheadState, formData: FormData): Promise<LetterheadState> {
  const ctx = await adminContext();
  if (ctx.error) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("save_clinic_letterhead", {
    p_clinic_id: ctx.membership.clinicId,
    p_name: String(formData.get("name") ?? ""),
    p_address: String(formData.get("address") ?? ""),
    p_phones: String(formData.get("phones") ?? ""),
    p_email: String(formData.get("email") ?? ""),
    p_rnc: String(formData.get("rnc") ?? ""),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/settings/timbrado");
  return { success: "Timbrado guardado. Las recetas nuevas lo usarán (las ya emitidas conservan el suyo)." };
}

export type PrepareLogoResult = { path: string; token: string } | { error: string };

/** Autoriza la subida directa del logo desde el navegador (Vercel limita el cuerpo de una función). */
export async function prepareLetterheadLogoUpload(fileName: string, size: number, declaredMime: string): Promise<PrepareLogoResult> {
  const ctx = await adminContext();
  if (ctx.error) return { error: ctx.error };
  if (declaredMime !== "image/png" && declaredMime !== "image/jpeg") return { error: "El logo debe ser PNG o JPG." };
  if (!Number.isFinite(size) || size < 1) return { error: "El archivo está vacío." };
  if (size > MAX_LOGO_BYTES) return { error: "El logo no puede pasar de 2 MB." };
  const { data: existing } = await ctx.supabase.from("clinic_letterhead").select("clinic_id").eq("clinic_id", ctx.membership.clinicId).maybeSingle();
  if (!existing) return { error: "Guarda primero los datos del timbrado y después sube el logo." };

  const path = `${ctx.membership.clinicId}/${crypto.randomUUID()}-${sanitizeStudyFileName(fileName)}`;
  const { data, error } = await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: "No se pudo preparar la subida del logo." };
  return { path, token: data.token };
}

/** Verifica el logo ya subido (tipo REAL por sus primeros bytes y tamaño) y lo asigna al timbrado. */
export async function finalizeLetterheadLogo(path: string): Promise<LetterheadState> {
  const ctx = await adminContext();
  if (ctx.error) return { error: ctx.error };
  if (!path.startsWith(`${ctx.membership.clinicId}/`)) return { error: "La ruta del logo no corresponde a esta clínica." };
  const discard = async () => {
    await createAdminClient().storage.from(BUCKET).remove([path]);
  };

  const { data: signed } = await ctx.supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (!signed?.signedUrl) return { error: "No se encontró el archivo subido." };
  const res = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-15" }, cache: "no-store" });
  if (!res.ok && res.status !== 206) {
    await discard();
    return { error: "No se pudo verificar el logo." };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const total = Number((res.headers.get("content-range") ?? "").split("/")[1] ?? res.headers.get("content-length") ?? 0);
  if (!sniffLogoMime(bytes)) {
    await discard();
    return { error: "El archivo no es un PNG o JPG válido." };
  }
  if (!Number.isFinite(total) || total < 1 || total > MAX_LOGO_BYTES) {
    await discard();
    return { error: "El logo no puede pasar de 2 MB." };
  }

  const { data: current } = await ctx.supabase.from("clinic_letterhead").select("*").eq("clinic_id", ctx.membership.clinicId).maybeSingle();
  if (!current) {
    await discard();
    return { error: "Guarda primero los datos del timbrado." };
  }
  const { error } = await ctx.supabase.rpc("save_clinic_letterhead", {
    p_clinic_id: ctx.membership.clinicId,
    p_name: current.name,
    p_address: current.address ?? "",
    p_phones: current.phones ?? "",
    p_email: current.email ?? "",
    p_rnc: current.rnc ?? "",
    p_logo_path: path,
  });
  if (error) {
    await discard();
    return { error: friendly(error) };
  }
  // El logo anterior ya no se usa en recetas nuevas (las emitidas guardan su ruta y NO se tocan): se conserva si alguna
  // receta lo cita; si no, se retira del bucket.
  if (current.logo_path && current.logo_path !== path) await removeLogoIfUnused(ctx.supabase, ctx.membership.clinicId, current.logo_path);
  revalidatePath("/settings/timbrado");
  return { success: "Logo actualizado." };
}

export async function removeLetterheadLogo(): Promise<LetterheadState> {
  const ctx = await adminContext();
  if (ctx.error) return { error: ctx.error };
  const { data: current } = await ctx.supabase.from("clinic_letterhead").select("*").eq("clinic_id", ctx.membership.clinicId).maybeSingle();
  if (!current) return { error: "No hay timbrado configurado." };
  const { error } = await ctx.supabase.rpc("save_clinic_letterhead", {
    p_clinic_id: ctx.membership.clinicId,
    p_name: current.name,
    p_address: current.address ?? "",
    p_phones: current.phones ?? "",
    p_email: current.email ?? "",
    p_rnc: current.rnc ?? "",
    p_remove_logo: true,
  });
  if (error) return { error: friendly(error) };
  if (current.logo_path) await removeLogoIfUnused(ctx.supabase, ctx.membership.clinicId, current.logo_path);
  revalidatePath("/settings/timbrado");
  return { success: "Logo quitado." };
}

/** Retira un logo del bucket solo si ninguna receta emitida lo cita en su copia del timbrado. */
async function removeLogoIfUnused(supabase: Awaited<ReturnType<typeof createClient>>, clinicId: string, path: string) {
  const { count } = await supabase
    .from("prescriptions")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .filter("letterhead->>logo_path", "eq", path);
  if ((count ?? 0) === 0) await createAdminClient().storage.from(BUCKET).remove([path]);
}
