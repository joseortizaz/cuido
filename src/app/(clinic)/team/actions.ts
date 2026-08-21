"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, findOrInviteUserByEmail } from "@/lib/supabase/admin";
import { getCurrentClinicMembership, type ClinicMembership } from "@/lib/supabase/clinic-context";
import type { Database } from "@/lib/supabase/database.types";

export type TeamActionState = { error?: string; success?: string } | undefined;

type ClinicMemberRole = Database["public"]["Enums"]["clinic_member_role"];
const VALID_ROLES: ClinicMemberRole[] = ["admin", "medico", "recepcion"];
function isValidRole(value: string): value is ClinicMemberRole {
  return (VALID_ROLES as string[]).includes(value);
}

async function requireAdminMembership(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  membership: ClinicMembership;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  return { supabase, membership };
}

async function countClinicAdmins(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string
): Promise<number> {
  const { count } = await supabase
    .from("clinic_members")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("role", "admin");
  return count ?? 0;
}

/**
 * service_role SOLO se usa para resolver email -> user_id (findOrInviteUserByEmail
 * — auth.users no está expuesto vía la Data API, ningún cliente con RLS
 * puede hacer esto). El INSERT real en clinic_members pasa por el cliente
 * normal del llamador: RLS (clinic_members_insert_by_admin) lo vuelve a
 * validar de forma independiente, no confiamos solo en el chequeo de rol
 * de arriba.
 */
export async function inviteMember(
  _prevState: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  const { supabase, membership } = await requireAdminMembership();
  if (membership.role !== "admin") {
    return { error: "Solo un admin puede invitar miembros." };
  }

  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (!email) return { error: "El correo es requerido." };
  if (!isValidRole(role)) return { error: "Selecciona un rol válido." };

  let userId: string;
  try {
    const admin = createAdminClient();
    const result = await findOrInviteUserByEmail(admin, email);
    userId = result.userId;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo invitar a esa persona." };
  }

  const { error } = await supabase.from("clinic_members").insert({
    clinic_id: membership.clinicId,
    user_id: userId,
    role,
  });
  if (error) {
    const alreadyMember = /duplicate|unique/i.test(error.message);
    return {
      error: alreadyMember
        ? "Esa persona ya es miembro de esta clínica."
        : "No se pudo agregar al miembro.",
    };
  }

  revalidatePath("/team");
  return { success: "Miembro agregado." };
}

export async function updateMemberRole(
  memberId: string,
  _prevState: TeamActionState,
  formData: FormData
): Promise<TeamActionState> {
  const { supabase, membership } = await requireAdminMembership();
  if (membership.role !== "admin") {
    return { error: "Solo un admin puede cambiar roles." };
  }

  const newRole = String(formData.get("role") ?? "");
  if (!isValidRole(newRole)) return { error: "Selecciona un rol válido." };

  const { data: target } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("id", memberId)
    .eq("clinic_id", membership.clinicId)
    .maybeSingle();
  if (!target) return { error: "Miembro no encontrado." };

  if (target.role === "admin" && newRole !== "admin") {
    const admins = await countClinicAdmins(supabase, membership.clinicId);
    if (admins <= 1) return { error: "No puedes quitar el último admin de la clínica." };
  }

  const { error } = await supabase
    .from("clinic_members")
    .update({ role: newRole })
    .eq("id", memberId)
    .eq("clinic_id", membership.clinicId);
  if (error) return { error: "No se pudo actualizar el rol." };

  revalidatePath("/team");
  return { success: "Rol actualizado." };
}

export async function removeMember(
  memberId: string,
  _prevState: TeamActionState,
  _formData: FormData
): Promise<TeamActionState> {
  const { supabase, membership } = await requireAdminMembership();
  if (membership.role !== "admin") {
    return { error: "Solo un admin puede quitar miembros." };
  }

  const { data: target } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("id", memberId)
    .eq("clinic_id", membership.clinicId)
    .maybeSingle();
  if (!target) return { error: "Miembro no encontrado." };

  if (target.role === "admin") {
    const admins = await countClinicAdmins(supabase, membership.clinicId);
    if (admins <= 1) return { error: "No puedes quitar el último admin de la clínica." };
  }

  const { error } = await supabase
    .from("clinic_members")
    .delete()
    .eq("id", memberId)
    .eq("clinic_id", membership.clinicId);
  if (error) return { error: "No se pudo quitar al miembro." };

  revalidatePath("/team");
  return { success: "Miembro eliminado." };
}
