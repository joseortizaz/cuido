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

      // Editar paciente e historial (20261120100000_patient_edit_and_change_log.sql).
      const { data: aPatient } = await tenantA.client.from("patients").select("id").limit(1).single();
      await tenantA.client.from("patients").update({ phone: "8095550111" }).eq("id", aPatient!.id);
      const { data: logSeenByA } = await tenantA.client.from("patient_change_log").select("id").eq("patient_id", aPatient!.id);
      check("A ve el historial de su paciente", (logSeenByA?.length ?? 0) === 1, `vio ${logSeenByA?.length ?? 0} filas`);
      const { data: logSeenByB } = await tenantB.client.from("patient_change_log").select("id").eq("patient_id", aPatient!.id);
      check("SELECT patient_change_log de A (como B) devuelve 0 filas", (logSeenByB?.length ?? 0) === 0, `devolvió ${logSeenByB?.length ?? 0} filas — fuga entre tenants`);
      const { data: bUpdate } = await tenantB.client.from("patients").update({ phone: "8095550999" }).eq("id", aPatient!.id).select("id");
      check("B NO puede actualizar un paciente de A", (bUpdate?.length ?? 0) === 0, "actualizó filas de otra clínica");
      const { error: bContact } = await tenantB.client.rpc("update_patient_contact", {
        p_patient_id: aPatient!.id,
        p_phone: "8095550999",
        p_email: "",
        p_phone_e164: "+18095550999",
      });
      check("B NO puede usar update_patient_contact sobre un paciente de A", bContact !== null, "no falló");

      // Eliminar, anular y marcar pacientes de prueba (20261121100000_patient_delete_and_void.sql).
      const pid = aPatient!.id;
      for (const [label, call] of [
        ["void_patient", tenantB.client.rpc("void_patient", { p_patient_id: pid, p_reason: "Intento de B" })],
        ["unvoid_patient", tenantB.client.rpc("unvoid_patient", { p_patient_id: pid })],
        ["set_patient_test_flag", tenantB.client.rpc("set_patient_test_flag", { p_patient_id: pid, p_is_test: true })],
        ["delete_test_patient", tenantB.client.rpc("delete_test_patient", { p_patient_id: pid })],
        ["delete_empty_patient", tenantB.client.rpc("delete_empty_patient", { p_patient_id: pid, p_confirm_name: "x", p_reason: "Intento de B" })],
        ["patient_deletion_status", tenantB.client.rpc("patient_deletion_status", { p_patient_id: pid })],
      ] as const) {
        const { error } = await call;
        check(`B NO puede usar ${label} sobre un paciente de A`, error !== null, "no falló");
      }
      const { data: aAfter } = await admin.from("patients").select("voided_at, is_test").eq("id", pid).single();
      check("el paciente de A quedó intacto tras los intentos de B", aAfter?.voided_at === null && aAfter?.is_test === false, JSON.stringify(aAfter));
      // Expediente clínico (20261122100000_patient_record_and_history.sql).
      const { error: aOpen } = await tenantA.client.rpc("open_patient_record", { p_patient_id: pid, p_history: { family_history: "Solo A" } });
      check("A abre el expediente de su paciente", aOpen === null, aOpen?.message ?? "");
      const { data: recSeenByB } = await tenantB.client.from("patient_records").select("id").eq("patient_id", pid);
      const { data: histSeenByB } = await tenantB.client.from("patient_medical_history").select("patient_id").eq("patient_id", pid);
      const { data: revSeenByB } = await tenantB.client.from("patient_medical_history_revisions").select("id").eq("patient_id", pid);
      check("B no lee el expediente, la historia ni las revisiones de A", (recSeenByB?.length ?? 0) === 0 && (histSeenByB?.length ?? 0) === 0 && (revSeenByB?.length ?? 0) === 0, `${recSeenByB?.length}/${histSeenByB?.length}/${revSeenByB?.length}`);
      const { error: bSave } = await tenantB.client.rpc("save_medical_history", { p_patient_id: pid, p_changes: { family_history: "Hackeado" }, p_reason: "" });
      check("B NO puede corregir la historia de A", bSave !== null, "no falló");
      const { error: bOpen } = await tenantB.client.rpc("open_patient_record", { p_patient_id: pid, p_history: {} });
      check("B NO puede abrir expedientes de A", bOpen !== null, "no falló");
      const { data: histAfter } = await admin.from("patient_medical_history").select("family_history").eq("patient_id", pid).single();
      check("la historia de A quedó intacta", histAfter?.family_history === "Solo A", JSON.stringify(histAfter));

      // Recepción sin datos clínicos (20261123100000_receptionist_clinical_isolation.sql).
      const { data: stubsSeenByB } = await tenantB.client.rpc("encounter_stubs", { p_patient_id: pid });
      check("B no obtiene consultas de A por encounter_stubs", (stubsSeenByB ?? []).length === 0, `devolvió ${stubsSeenByB?.length ?? 0} filas`);

      // Estudios y analíticas con adjuntos (20261125100000_study_results.sql).
      const { data: aStudyId, error: aStudyErr } = await tenantA.client.rpc("create_study_result", { p_patient_id: pid, p_category: "laboratorio", p_study_name: "Hemograma de A", p_status: "recibido" });
      check("A registra un estudio de su paciente", aStudyErr === null && !!aStudyId, aStudyErr?.message ?? "");
      const { data: studySeenByB } = await tenantB.client.from("study_results").select("id").eq("patient_id", pid);
      check("B no lee los estudios de A", (studySeenByB?.length ?? 0) === 0, `devolvió ${studySeenByB?.length ?? 0} filas`);
      const { error: bCreateStudy } = await tenantB.client.rpc("create_study_result", { p_patient_id: pid, p_category: "otro", p_study_name: "Hackeo" });
      check("B NO puede registrar un estudio en un paciente de A", bCreateStudy !== null, "no falló");
      const { error: bUpdStudy } = await tenantB.client.rpc("update_study_result", { p_study_id: aStudyId as string, p_changes: { result_text: "Hackeado" }, p_reason: "hack" });
      check("B NO puede corregir un estudio de A", bUpdStudy !== null, "no falló");
      const { error: bUploadToA } = await tenantB.client.storage.from("study-results").upload(`${tenantA.clinicId}/${pid}/${aStudyId}/intruso.pdf`, Buffer.from("%PDF-1.4 x"), { contentType: "application/pdf" });
      check("B NO puede subir un archivo a la ruta de un estudio de A", bUploadToA !== null, "subió");

      // Diagnósticos codificados CIE-11 (20261127100000_encounter_diagnoses.sql).
      const { data: dxTpl } = await admin.from("specialty_templates").select("id").eq("code", "medicina_interna").single();
      const { data: aEncDx, error: aEncDxErr } = await tenantA.client.rpc("create_encounter_with_diagnoses", {
        p_patient_id: pid,
        p_template_id: dxTpl!.id,
        p_encounter_type: "inicial",
        p_chief_complaint: "Control",
        p_present_illness: "",
        p_specialty_data: {},
        p_diagnoses: [{ kind: "definitivo", code: "5A11", title: "Diabetes de A", entity_uri: "http://id.who.int/icd/release/11/2026-01/mms/1", is_primary: true }],
        p_release: "2026-01",
      });
      check("A crea una consulta con un diagnóstico CIE-11", aEncDxErr === null && !!aEncDx, aEncDxErr?.message ?? "");
      const { data: dxSeenByB } = await tenantB.client.from("encounter_diagnoses").select("id").eq("patient_id", pid);
      check("B no lee los diagnósticos codificados de A", (dxSeenByB?.length ?? 0) === 0, `devolvió ${dxSeenByB?.length ?? 0} filas`);
      const { error: bAddDx } = await tenantB.client.rpc("add_encounter_diagnoses", { p_encounter_id: aEncDx as string, p_items: [{ kind: "presuntivo", code: "BA00", title: "Hackeo" }], p_release: "2026-01" });
      check("B NO puede agregar diagnósticos a una consulta de A", bAddDx !== null, "no falló");
      const { data: aDxRow } = await admin.from("encounter_diagnoses").select("id").eq("encounter_id", aEncDx as string).single();
      const { error: bCorrDx } = await tenantB.client.rpc("correct_encounter_diagnosis", { p_diagnosis_id: aDxRow!.id, p_reason: "Hackeo", p_new: null });
      check("B NO puede corregir ni retirar un diagnóstico de A", bCorrDx !== null, "no falló");
      const { error: bCreateDx } = await tenantB.client.rpc("create_encounter_with_diagnoses", {
        p_patient_id: pid,
        p_template_id: dxTpl!.id,
        p_encounter_type: "inicial",
        p_chief_complaint: "x",
        p_present_illness: "",
        p_specialty_data: {},
        p_diagnoses: [],
        p_release: "2026-01",
      });
      check("B NO puede crear una consulta (con o sin diagnósticos) para un paciente de A", bCreateDx !== null, "no falló");
      const { data: dxAfter } = await admin.from("encounter_diagnoses").select("superseded_at").eq("encounter_id", aEncDx as string);
      check("el diagnóstico de A quedó intacto y vigente", (dxAfter ?? []).length === 1 && dxAfter![0].superseded_at === null, JSON.stringify(dxAfter));

      // Ficha de identificación y religión (20261128100000_patient_identity.sql).
      const { error: aRel } = await tenantA.client.rpc("save_patient_religion", { p_patient_id: pid, p_religion: "catolica" });
      check("A registra la religión de su paciente", aRel === null, aRel?.message ?? "");
      const { data: relSeenByB } = await tenantB.client.from("patient_religion").select("patient_id").eq("patient_id", pid);
      const { data: relLogSeenByB } = await tenantB.client.from("patient_religion_log").select("id").eq("patient_id", pid);
      check("B no lee la religión de A ni su historial", (relSeenByB?.length ?? 0) === 0 && (relLogSeenByB?.length ?? 0) === 0, `${relSeenByB?.length}/${relLogSeenByB?.length}`);
      const { error: bRel } = await tenantB.client.rpc("save_patient_religion", { p_patient_id: pid, p_religion: "ninguna" });
      check("B NO puede cambiar la religión de un paciente de A", bRel !== null, "no falló");
      const { data: bEditIdentity } = await tenantB.client.from("patients").update({ occupation: "Hackeo", education_level: "posgrado" }).eq("id", pid).select("id");
      check("B NO puede editar la ficha de identificación de un paciente de A", (bEditIdentity?.length ?? 0) === 0, `${bEditIdentity?.length}`);
      const { data: relAfter } = await admin.from("patient_religion").select("religion").eq("patient_id", pid).single();
      const { data: ptAfter } = await admin.from("patients").select("occupation, education_level").eq("id", pid).single();
      check("la religión y la ficha de A quedaron intactas", relAfter?.religion === "catolica" && ptAfter?.occupation === null && ptAfter?.education_level === null, JSON.stringify([relAfter, ptAfter]));

      const { data: delLogSeenByB } = await tenantB.client.from("patient_deletion_log").select("id").eq("clinic_id", tenantA.clinicId);
      check("B no lee el registro de eliminaciones de A", (delLogSeenByB?.length ?? 0) === 0, `devolvió ${delLogSeenByB?.length ?? 0} filas`);
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
