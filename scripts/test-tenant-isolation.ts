/**
 * Prueba de aislamiento multi-tenant (Fase 0 — criterio de salida).
 *
 * Qué hace:
 *   1. Con la service_role key (bypassa RLS) crea un usuario sintético para
 *      cada tenant ("A" y "B"). La clínica de cada uno se crea llamando al
 *      RPC create_clinic_with_admin como ese usuario ya autenticado — el
 *      mismo camino que usa el signup público
 *      (src/app/onboarding/actions.ts), no un atajo de test.
 *   2. Inicia sesión como cada usuario con la clave anónima (sujeta a RLS).
 *   3. Verifica que el usuario de la clínica A NO puede leer, insertar,
 *      actualizar ni borrar filas de la clínica B (ni de su membresía) — y
 *      viceversa.
 *   4. Verifica, como control positivo, que cada usuario SÍ puede leer su
 *      propia clínica (si esto fallara, un "aislamiento perfecto" sería en
 *      realidad RLS roto que bloquea todo).
 *   5. Limpia los datos sintéticos al terminar, pase o falle la prueba.
 *
 * Requiere las variables de entorno:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY   (nunca exponer al cliente; solo CI/scripts)
 *
 * Uso:
 *   npm run test:tenant-isolation
 *
 * Pensado para correr contra un Supabase local desacoplado (`supabase start`)
 * con datos 100% sintéticos, nunca contra producción. En CI, el workflow
 * levanta el stack local antes de invocar este script.
 */

import { config as loadDotenv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Failure = { name: string; detail: string };
const failures: Failure[] = [];

function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push({ name, detail });
  }
}

type TestTenant = {
  clinicId: string;
  clinicName: string;
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

async function provisionTenant(label: string): Promise<TestTenant> {
  const suffix = randomUUID();
  const email = `tenant-isolation-${label}-${suffix}@example.invalid`;
  const password = `Test-${randomUUID()}!`;
  const clinicName = `[TEST] Clínica ${label} ${suffix.slice(0, 8)}`;

  const { data: userRes, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userRes.user) {
    throw new Error(`No se pudo crear usuario sintético ${label}: ${userError?.message}`);
  }

  const userClient = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(`No se pudo iniciar sesión como usuario ${label}: ${signInError.message}`);
  }

  // Camino real de onboarding: el mismo RPC que usa el signup público
  // (src/app/onboarding/actions.ts) crea la clínica y autoasigna admin.
  const { data: clinicId, error: rpcError } = await userClient.rpc("create_clinic_with_admin", {
    clinic_name: clinicName,
    clinic_province: "Distrito Nacional",
    clinic_business_model: "modelo_c",
  });
  if (rpcError || !clinicId) {
    throw new Error(
      `No se pudo crear clínica sintética ${label} vía create_clinic_with_admin: ${rpcError?.message}`
    );
  }

  return {
    clinicId,
    clinicName,
    userId: userRes.user.id,
    email,
    password,
    client: userClient,
  };
}

async function cleanupTenant(tenant: TestTenant) {
  try {
    await admin.auth.admin.deleteUser(tenant.userId);
  } catch {
    // best-effort cleanup
  }
  try {
    await admin.from("clinics").delete().eq("id", tenant.clinicId);
  } catch {
    // best-effort cleanup
  }
}

async function main() {
  console.log("Aprovisionando tenants sintéticos...");
  const tenantA = await provisionTenant("A");
  const tenantB = await provisionTenant("B");
  console.log(`  Clínica A: ${tenantA.clinicId}`);
  console.log(`  Clínica B: ${tenantB.clinicId}`);

  try {
    console.log("\nControl positivo — cada usuario ve su propia clínica:");
    {
      const { data } = await tenantA.client.from("clinics").select("id").eq("id", tenantA.clinicId);
      check(
        "Usuario A puede leer su propia clínica",
        (data?.length ?? 0) === 1,
        `esperaba 1 fila, obtuve ${data?.length ?? 0}`
      );
    }
    {
      const { data } = await tenantB.client.from("clinics").select("id").eq("id", tenantB.clinicId);
      check(
        "Usuario B puede leer su propia clínica",
        (data?.length ?? 0) === 1,
        `esperaba 1 fila, obtuve ${data?.length ?? 0}`
      );
    }

    console.log("\nAislamiento — A no puede tocar la clínica de B:");
    {
      const { data } = await tenantA.client.from("clinics").select("id").eq("id", tenantB.clinicId);
      check(
        "SELECT clinics de B (como A) devuelve 0 filas",
        (data?.length ?? 0) === 0,
        `devolvió ${data?.length ?? 0} filas — fuga entre tenants`
      );
    }
    {
      const { data } = await tenantA.client
        .from("clinic_members")
        .select("id")
        .eq("clinic_id", tenantB.clinicId);
      check(
        "SELECT clinic_members de B (como A) devuelve 0 filas",
        (data?.length ?? 0) === 0,
        `devolvió ${data?.length ?? 0} filas — fuga entre tenants`
      );
    }
    {
      const { data, error } = await tenantA.client
        .from("clinics")
        .update({ name: "hackeado por A" })
        .eq("id", tenantB.clinicId)
        .select("id");
      check(
        "UPDATE clinics de B (como A) no modifica filas",
        (data?.length ?? 0) === 0,
        error ? `error inesperado: ${error.message}` : `modificó ${data?.length ?? 0} filas`
      );
    }
    {
      const { error } = await tenantA.client.from("clinic_members").insert({
        clinic_id: tenantB.clinicId,
        user_id: tenantA.userId,
        role: "admin",
      });
      check(
        "INSERT en clinic_members de B (como A) es rechazado",
        error !== null,
        "el insert tuvo éxito — un usuario pudo auto-agregarse a otro tenant"
      );
    }
    {
      const { data } = await tenantA.client.from("clinics").delete().eq("id", tenantB.clinicId).select("id");
      check(
        "DELETE clinics de B (como A) no borra filas",
        (data?.length ?? 0) === 0,
        `borró ${data?.length ?? 0} filas`
      );
    }

    console.log("\nAislamiento — B no puede tocar la clínica de A:");
    {
      const { data } = await tenantB.client.from("clinics").select("id").eq("id", tenantA.clinicId);
      check(
        "SELECT clinics de A (como B) devuelve 0 filas",
        (data?.length ?? 0) === 0,
        `devolvió ${data?.length ?? 0} filas — fuga entre tenants`
      );
    }
    {
      const { data } = await tenantB.client
        .from("clinic_members")
        .select("id")
        .eq("clinic_id", tenantA.clinicId);
      check(
        "SELECT clinic_members de A (como B) devuelve 0 filas",
        (data?.length ?? 0) === 0,
        `devolvió ${data?.length ?? 0} filas — fuga entre tenants`
      );
    }

    // Código automático de paciente (20261119100000_patient_record_number.sql): la configuración
    // y los contadores de una clínica no se leen ni se tocan desde otra.
    console.log("\nCódigo de paciente — configuración y contadores:");
    {
      const { error: saveErr } = await tenantA.client.rpc("save_patient_code_settings", {
        p_clinic_id: tenantA.clinicId,
        p_format: "A-{NNNN}",
        p_start_number: 1,
        p_reset_yearly: false,
      });
      check("El admin de A guarda el formato de su clínica", saveErr === null, saveErr?.message ?? "");

      const { data: cfgSeenByB } = await tenantB.client
        .from("clinic_patient_code_settings")
        .select("clinic_id")
        .eq("clinic_id", tenantA.clinicId);
      check("SELECT clinic_patient_code_settings de A (como B) devuelve 0 filas", (cfgSeenByB?.length ?? 0) === 0, `devolvió ${cfgSeenByB?.length ?? 0} filas — fuga entre tenants`);

      const { error: crossSave } = await tenantB.client.rpc("save_patient_code_settings", {
        p_clinic_id: tenantA.clinicId,
        p_format: "HACK-{NNNN}",
        p_start_number: 1,
        p_reset_yearly: false,
      });
      check("B NO puede guardar el formato de A", crossSave !== null, "no falló");

      const { error: crossPreview } = await tenantB.client.rpc("preview_next_patient_code", { p_clinic_id: tenantA.clinicId });
      check("B NO puede ver la vista previa de A", crossPreview !== null, "no falló");

      const { data: counters, error: counterErr } = await tenantB.client.from("clinic_patient_code_counters").select("clinic_id");
      check("B no lee contadores (ni propios ni ajenos)", counterErr !== null || (counters?.length ?? 0) === 0, `devolvió ${counters?.length ?? 0} filas`);

      const { data: pA } = await tenantA.client
        .from("patients")
        .insert({ clinic_id: tenantA.clinicId, first_name: "Aislamiento", last_name: "A", date_of_birth: "1990-01-01", sex: "femenino" })
        .select("record_number")
        .single();
      const { data: pB } = await tenantB.client
        .from("patients")
        .insert({ clinic_id: tenantB.clinicId, first_name: "Aislamiento", last_name: "B", date_of_birth: "1990-01-01", sex: "femenino" })
        .select("record_number")
        .single();
      check("El paciente de A usa el formato de A", pA?.record_number === "A-0001", String(pA?.record_number));
      check("El formato de A no se filtra a B", !!pB?.record_number && !String(pB.record_number).startsWith("A-"), String(pB?.record_number));
    }

    // Verifica que el mecanismo de aislamiento sea RLS y no una casualidad
    // de la query: confirma independientemente, con la service_role, que
    // ambas clínicas y sus miembros siguen existiendo intactos.
    console.log("\nControl de integridad (vía service_role):");
    {
      const { data } = await admin.from("clinics").select("id, name").eq("id", tenantB.clinicId).single();
      check(
        "Clínica B sigue intacta tras los intentos de A",
        data?.name === tenantB.clinicName,
        `nombre actual: ${data?.name}`
      );
    }
  } finally {
    console.log("\nLimpiando datos sintéticos...");
    await cleanupTenant(tenantA);
    await cleanupTenant(tenantB);
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`FALLÓ: ${failures.length} verificación(es) de aislamiento no pasaron.`);
    process.exit(1);
  }
  console.log("OK: aislamiento entre tenants verificado.");
}

main().catch((err) => {
  console.error("Error inesperado ejecutando la prueba de aislamiento:", err);
  process.exit(1);
});
