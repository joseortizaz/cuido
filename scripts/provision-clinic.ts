/**
 * Aprovisionamiento manual de una clínica (uso interno del equipo de Narnia).
 *
 * Camino para el Modelo E (canal asociativo/franquicia) y para dar de alta
 * la primera clínica piloto sin depender del signup público. Usa
 * SUPABASE_SERVICE_ROLE_KEY — bypassa RLS intencionalmente. NUNCA exponer
 * este script como endpoint ni correrlo con datos que no sean de una
 * clínica real y autorizada.
 *
 * A diferencia del signup público (que usa el RPC create_clinic_with_admin
 * con contraseña elegida por el propio usuario), este script invita al
 * admin por correo — nunca genera ni conoce una contraseña en texto plano.
 *
 * Uso:
 *   npm run provision:clinic -- \
 *     --name "Clínica Ejemplo" \
 *     --province "Distrito Nacional" \
 *     --business-model modelo_c \
 *     --admin-email admin@clinica-ejemplo.com
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadDotenv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VALID_BUSINESS_MODELS = ["modelo_c", "modelo_e", "modelo_f"] as const;
type BusinessModel = (typeof VALID_BUSINESS_MODELS)[number];

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Falta el valor de --${key}`);
    }
    out[key] = value;
    i++;
  }
  return out;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local"
    );
  }

  const args = parseArgs(process.argv.slice(2));
  const name = args["name"];
  const province = args["province"];
  const businessModel = args["business-model"] as BusinessModel | undefined;
  const adminEmail = args["admin-email"];

  if (!name || !province || !businessModel || !adminEmail) {
    console.error(
      "Uso: npm run provision:clinic -- --name <nombre> --province <provincia> " +
        "--business-model <modelo_c|modelo_e|modelo_f> --admin-email <email>"
    );
    process.exit(1);
  }
  if (!VALID_BUSINESS_MODELS.includes(businessModel)) {
    throw new Error(`--business-model debe ser uno de: ${VALID_BUSINESS_MODELS.join(", ")}`);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Buscando/invitando al admin (${adminEmail})...`);
  let adminUserId: string;
  const invite = await admin.auth.admin.inviteUserByEmail(adminEmail);
  if (invite.error) {
    const alreadyExists = /already|existe|registrad/i.test(invite.error.message);
    if (!alreadyExists) {
      throw new Error(`No se pudo invitar al admin: ${invite.error.message}`);
    }
    console.log("  Ya existe una cuenta con ese correo, la reutilizo.");
    const existing = await findUserByEmail(admin, adminEmail);
    if (!existing) {
      throw new Error(
        `El correo ${adminEmail} ya está registrado pero no lo pude encontrar en la lista de usuarios.`
      );
    }
    adminUserId = existing.id;
  } else {
    adminUserId = invite.data.user.id;
    console.log("  Invitación enviada. El admin debe revisar su correo para fijar su contraseña.");
  }

  console.log(`Creando clínica "${name}" (${province}, ${businessModel})...`);
  const { data: clinic, error: clinicError } = await admin
    .from("clinics")
    .insert({ name, province, business_model: businessModel })
    .select("id")
    .single();
  if (clinicError || !clinic) {
    throw new Error(`No se pudo crear la clínica: ${clinicError?.message}`);
  }

  const { error: memberError } = await admin.from("clinic_members").insert({
    clinic_id: clinic.id,
    user_id: adminUserId,
    role: "admin",
  });
  if (memberError) {
    throw new Error(
      `Clínica creada (${clinic.id}) pero no se pudo asociar al admin: ${memberError.message}`
    );
  }

  console.log("\nListo.");
  console.log(`  Clínica: ${clinic.id}`);
  console.log(`  Admin:   ${adminEmail} (${adminUserId})`);
}

async function findUserByEmail(admin: SupabaseClient, email: string) {
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

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
