/**
 * Otorga el rol de operador de plataforma (Nivel 1) a un usuario — uso
 * interno del equipo de Narnia. Usa SUPABASE_SERVICE_ROLE_KEY — bypassa
 * RLS intencionalmente. Deliberadamente NO existe ningún camino desde la
 * app ni ningún RPC autoservicio para otorgar este rol — solo este
 * script, corrido a mano, para evitar auto-escalamiento de privilegios
 * (mismo principio que create_clinic_with_admin usa para clinic_members).
 *
 * Uso:
 *   npm run grant:operator -- --email operador@narniats.com
 */

import { config as loadDotenv } from "dotenv";
import { createAdminClient, findOrInviteUserByEmail } from "../src/lib/supabase/admin";

loadDotenv({ path: ".env.local" });

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
  const args = parseArgs(process.argv.slice(2));
  const email = args["email"];

  if (!email) {
    console.error("Uso: npm run grant:operator -- --email <email>");
    process.exit(1);
  }

  const admin = createAdminClient();

  console.log(`Buscando/invitando a ${email}...`);
  const { userId, invited } = await findOrInviteUserByEmail(admin, email);
  console.log(
    invited
      ? "  Invitación enviada. Debe revisar su correo para fijar su contraseña."
      : "  Ya existe una cuenta con ese correo, la reutilizo."
  );

  const { error } = await admin
    .from("platform_operators")
    .insert({ user_id: userId, role: "operador_nivel_1" });
  if (error) {
    const alreadyOperator = /duplicate|unique/i.test(error.message);
    if (alreadyOperator) {
      console.log("\nListo — ya era operador de plataforma, sin cambios.");
      return;
    }
    throw new Error(`No se pudo otorgar el rol: ${error.message}`);
  }

  console.log("\nListo.");
  console.log(`  Usuario: ${email} (${userId})`);
  console.log("  Rol: operador_nivel_1");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
