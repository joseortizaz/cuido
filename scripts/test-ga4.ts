/**
 * Prueba de Google Analytics 4 (src/lib/ga4.ts, lógica pura): qué ID se acepta y en qué rutas se
 * permite medir. La regla importante: GA4 NUNCA entra al área con datos de pacientes ni a las
 * pantallas con formularios de acceso -- la lista es permitida, no prohibida.
 */

import { isGaPath, parseGaId } from "../src/lib/ga4";

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push(name);
  }
}

console.log("\nID de medición:");
check("acepta un ID G-…", parseGaId("G-ABC123XYZ9") === "G-ABC123XYZ9");
check("recorta espacios", parseGaId("  G-ABC123XYZ9\n") === "G-ABC123XYZ9");
check("sin variable, vacío o solo espacios: nada", parseGaId(undefined) === null && parseGaId("") === null && parseGaId("   ") === null && parseGaId(null) === null);
check(
  "rechaza lo que no es un ID G-… (se escribe dentro de un script y de una URL)",
  ["UA-12345-1", "g-abc123xyz9", "G-", "G-AB", "G-ABC123XYZ9');alert(1);//", "G-ABC123XYZ9&x=1", "G-ABC 123", "GTM-ABC1234", "G-" + "A".repeat(21)].every((v) => parseGaId(v) === null),
);

console.log("\nRutas donde se mide:");
const publicPaths = ["/", "/privacidad", "/terminos", "/eliminacion-datos", "/normativa", "/blog", "/blog/un-articulo", "/normativa/ley-172-13", "/privacidad/"];
check("landing y páginas públicas informativas", publicPaths.every(isGaPath), publicPaths.filter((p) => !isGaPath(p)).join(", "));

const privatePaths = [
  "/dashboard", "/patients", "/patients/abc", "/patients/new", "/patients/abc/whatsapp", "/appointments", "/agenda", "/encounters/1",
  "/settings", "/settings/whatsapp", "/team", "/billing", "/operator", "/operator/whatsapp-templates", "/security", "/onboarding", "/manual", "/manual/pdf",
  "/login", "/login/mfa", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/api/whatsapp/webhook", "/api/cron/whatsapp-reminders",
];
check("NO en el área autenticada, el acceso ni las APIs", privatePaths.every((p) => !isGaPath(p)), privatePaths.filter(isGaPath).join(", "));
check("una ruta nueva o desconocida queda fuera por defecto", !isGaPath("/lo-que-sea") && !isGaPath("/privacidad-clinica") && !isGaPath("/blogs") && !isGaPath(""), "");
check("sin ruta: no", !isGaPath(null) && !isGaPath(undefined));

if (failures.length > 0) {
  console.error(`\nFALLÓ: ${failures.length} verificación(es) no pasaron.`);
  process.exit(1);
}
console.log("\nOK: GA4 (ID y rutas permitidas) verificado.");
