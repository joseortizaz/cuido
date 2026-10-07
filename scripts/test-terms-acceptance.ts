/**
 * Prueba de la aceptación de los términos en el registro
 * (src/lib/domain/terms.ts). Lógica pura: no necesita base de datos.
 */

import {
  TERMS_EFFECTIVE_LABEL,
  TERMS_PATH,
  TERMS_VERSION,
  hasAcceptedTerms,
  termsAcceptanceMetadata,
} from "../src/lib/domain/terms";

const failures: string[] = [];
function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push(name);
  }
}

console.log("\nCasilla de aceptación:");
check("marcada ('on') => acepta", hasAcceptedTerms("on") === true, "no aceptó");
check("sin enviar (null) => no acepta", hasAcceptedTerms(null) === false, "aceptó");
check("vacía => no acepta", hasAcceptedTerms("") === false, "aceptó");
check("cualquier otro valor => no acepta (no se confía en 'true' ni '1')", !hasAcceptedTerms("true") && !hasAcceptedTerms("1"), "aceptó");

console.log("\nLo que se guarda con la cuenta:");
const meta = termsAcceptanceMetadata(new Date("2026-10-07T15:30:00Z"));
check("guarda la versión vigente", meta.terms_version === TERMS_VERSION && TERMS_VERSION === "4", JSON.stringify(meta));
check("guarda la fecha de aceptación en ISO (UTC)", meta.terms_accepted_at === "2026-10-07T15:30:00.000Z", JSON.stringify(meta));
check("por defecto usa la hora actual", Math.abs(Date.now() - Date.parse(termsAcceptanceMetadata().terms_accepted_at)) < 5000, "fecha lejana");
check("la página de los términos es /terminos", TERMS_PATH === "/terminos", TERMS_PATH);
check("la fecha de vigencia está definida", TERMS_EFFECTIVE_LABEL.length > 0, "vacía");

if (failures.length > 0) {
  console.error(`\nFALLÓ: ${failures.length} verificación(es) no pasaron.`);
  process.exit(1);
}
console.log("\nOK: aceptación de términos verificada.");
