/**
 * Prueba del Meta Pixel (src/lib/meta-pixel.ts, lógica pura): qué ID se acepta y en qué rutas se
 * permite medir. La regla importante: el píxel NUNCA entra al área con datos de pacientes ni a las
 * pantallas con formularios de acceso -- la lista es permitida, no prohibida.
 */

import { isMetaPixelPath, parseMetaPixelId } from "../src/lib/meta-pixel";

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push(name);
  }
}

console.log("\nID del píxel:");
check("acepta el ID numérico", parseMetaPixelId("2329581537813852") === "2329581537813852");
check("recorta espacios", parseMetaPixelId("  2329581537813852\n") === "2329581537813852");
check("sin variable, vacío o solo espacios: nada", parseMetaPixelId(undefined) === null && parseMetaPixelId("") === null && parseMetaPixelId("   ") === null && parseMetaPixelId(null) === null);
check("rechaza lo que no es un ID numérico (se escribe dentro de un script)", ["abc", "123", "2329581537813852');alert(1);//", "2329581537813852 ", "23295815378138a2", "1".repeat(21)].filter((v) => v.trim() !== "2329581537813852").every((v) => parseMetaPixelId(v) === null));

console.log("\nRutas donde se mide:");
const publicPaths = ["/", "/privacidad", "/terminos", "/eliminacion-datos", "/normativa", "/blog", "/blog/un-articulo", "/privacidad/"];
check("landing y páginas públicas informativas", publicPaths.every(isMetaPixelPath), publicPaths.filter((p) => !isMetaPixelPath(p)).join(", "));

const privatePaths = [
  "/dashboard", "/patients", "/patients/abc", "/patients/new", "/patients/abc/whatsapp", "/appointments", "/agenda", "/encounters/1",
  "/settings", "/settings/whatsapp", "/team", "/billing", "/operator", "/operator/whatsapp-templates", "/security", "/onboarding",
  "/login", "/login/mfa", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/api/whatsapp/webhook", "/api/cron/whatsapp-reminders",
];
check("NO en el área autenticada, el acceso ni las APIs", privatePaths.every((p) => !isMetaPixelPath(p)), privatePaths.filter(isMetaPixelPath).join(", "));
check("una ruta nueva o desconocida queda fuera por defecto", !isMetaPixelPath("/lo-que-sea") && !isMetaPixelPath("/privacidad-clinica") && !isMetaPixelPath("/blogs") && !isMetaPixelPath(""), "");
check("sin ruta: no", !isMetaPixelPath(null) && !isMetaPixelPath(undefined));

if (failures.length > 0) {
  console.error(`\nFALLÓ: ${failures.length} verificación(es) no pasaron.`);
  process.exit(1);
}
console.log("\nOK: Meta Pixel (ID y rutas permitidas) verificado.");
