import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./env";

/**
 * Cliente con la service_role key — bypassa RLS por completo. SOLO para
 * código de servidor de confianza (Server Actions que ya validaron la
 * autorización del llamador contra su propia sesión, o scripts internos
 * como scripts/provision-clinic.ts). NUNCA importar desde un Client
 * Component.
 *
 * Nota deliberada: este módulo NO tiene `import "server-only"` porque
 * scripts/provision-clinic.ts lo importa fuera de Next.js (vía tsx), y ese
 * paquete revienta en cualquier entorno que no sea el bundler de Next.js
 * con la condición "react-server" activa. La guarda de build-time vive en
 * el punto real de riesgo dentro de la app: src/app/team/actions.ts (el
 * único lugar en el código de la app que importa este módulo) tiene su
 * propio `import "server-only"`. La garantía estructural de fondo, igual
 * en ambos casos: SUPABASE_SERVICE_ROLE_KEY no lleva prefijo NEXT_PUBLIC_,
 * así que ni siquiera aparece en un bundle de cliente — como mucho fallaría
 * en runtime con "falta la variable de entorno", nunca filtraría el secreto.
 *
 * Patrón esperado en las Server Actions que lo usan: el INSERT/UPDATE/
 * DELETE real en tablas de tenant sigue haciéndose con el cliente normal
 * del llamador (src/lib/supabase/server.ts), para que RLS lo valide de
 * forma independiente. Este cliente admin se reserva para lo que RLS
 * estructuralmente no puede hacer — p. ej. resolver un email a un
 * user_id, ya que auth.users no está expuesto vía la Data API.
 */
export function createAdminClient(): SupabaseClient<Database> {
  return createSupabaseClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Busca un usuario existente por email (paginando auth.admin.listUsers) o,
 * si no existe, lo invita por correo. Nunca genera ni conoce una
 * contraseña en texto plano.
 *
 * Compartido entre scripts/provision-clinic.ts (aprovisionamiento interno)
 * y src/app/team/actions.ts (invitar desde la app) — antes duplicado.
 *
 * Busca ANTES de invitar (no al revés): el envío de invitación por correo
 * del servicio integrado de Supabase (sin SMTP propio configurado en este
 * proyecto) tiene un límite de tasa muy bajo
 * (`over_email_send_rate_limit`, confirmado en pruebas). Agregar a alguien
 * que ya tiene cuenta — el caso más común al armar un equipo — no debe
 * gastar cupo de envío de correo. Antes de producción real, configurar
 * SMTP propio en el proyecto Supabase (Authentication → Settings → SMTP).
 */
export async function findOrInviteUserByEmail(
  admin: SupabaseClient<Database>,
  email: string
): Promise<{ userId: string; invited: boolean }> {
  const existing = await findUserByEmail(admin, email);
  if (existing) {
    return { userId: existing.id, invited: false };
  }

  const invite = await admin.auth.admin.inviteUserByEmail(email);
  if (invite.error) {
    throw new Error(`No se pudo invitar a ${email}: ${invite.error.message}`);
  }
  return { userId: invite.data.user.id, invited: true };
}

async function findUserByEmail(admin: SupabaseClient<Database>, email: string) {
  const normalized = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`No se pudo listar usuarios: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (match) return match;
    if (data.users.length < 200) break; // última página
  }
  return null;
}
