/**
 * Prueba de qué aviso muestra la barra de la clínica (período de prueba y
 * suscripciones, Fase 4) -- src/lib/domain/clinic-access.ts, función pura:
 * no necesita base de datos ni variables de entorno.
 *
 * Verifica los días límite: el último día de la prueba, los últimos 3 días
 * (más enfático), el primer y el último día de los 30 de gracia, los últimos
 * 7 de gracia (más enfático), el recordatorio de renovación solo para el admin,
 * y que activa/exenta/sin_plan no muestren nada.
 */

import {
  CONTACT_NARNIA,
  describeAccessBanner,
  type AccessBanner,
  type ClinicAccessState,
} from "../src/lib/domain/clinic-access";

const failures: string[] = [];
function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push(name);
  }
}

function banner(
  state: ClinicAccessState,
  daysToExpiry: number | null,
  daysToReadonly: number | null,
  isAdmin = true,
  daysToBlock: number | null = null
): AccessBanner | null {
  return describeAccessBanner({ state, daysToExpiry, daysToReadonly, daysToBlock }, isAdmin);
}

function expect(name: string, b: AccessBanner | null, tone: string, titleHas: string) {
  check(
    name,
    b !== null && b.tone === tone && b.title.includes(titleHas),
    JSON.stringify(b)
  );
}

console.log("\nPrueba (el día de vencimiento todavía es válido: daysToExpiry 0 = último día):");
expect("14 días para vencer => 'Te quedan 15 días', informativo", banner("prueba", 14, 45), "info", "Te quedan 15 días de prueba");
expect("3 días para vencer => 'Te quedan 4 días', aún informativo", banner("prueba", 3, 34), "info", "Te quedan 4 días de prueba");
expect("2 días para vencer => 'Te quedan 3 días', ENFÁTICO", banner("prueba", 2, 33), "danger", "Te quedan 3 días de prueba");
expect("1 día para vencer => 'Mañana es el último día', enfático", banner("prueba", 1, 32), "danger", "Mañana es el último día");
expect("0 => 'Hoy es el último día', enfático", banner("prueba", 0, 31), "danger", "Hoy es el último día");
check("prueba sin fechas => sin aviso", banner("prueba", null, null) === null, "mostró aviso");

console.log("\nRecordatorio de renovación (solo admin):");
expect("admin: vence en 5 días => advertencia", banner("por_renovar", 5, 36), "warning", "Tu plan vence en 5 días");
expect("admin: vence mañana", banner("por_renovar", 1, 32), "warning", "Tu plan vence mañana");
expect("admin: vence hoy", banner("por_renovar", 0, 31), "warning", "Tu plan vence hoy");
check("el resto del equipo NO ve el recordatorio", banner("por_renovar", 5, 36, false) === null, "lo mostró a no admin");

console.log("\nGracia (30 días; daysToReadonly 30 el primer día, 1 el último):");
expect("día 1 de gracia => 'venció hace 1 día', advertencia", banner("vencida_en_gracia", -1, 30), "warning", "venció hace 1 día");
expect("quedan 8 días => aún advertencia", banner("vencida_en_gracia", -23, 8), "warning", "venció hace 23 días");
expect("quedan 7 días => ENFÁTICO", banner("vencida_en_gracia", -24, 7), "danger", "venció hace 24 días");
expect("último día de gracia (quedan 1) => enfático", banner("vencida_en_gracia", -30, 1), "danger", "venció hace 30 días");
check(
  "el último día avisa 'en 1 día' (singular)",
  (banner("vencida_en_gracia", -30, 1)?.detail ?? "").includes("en 1 día tu clínica"),
  JSON.stringify(banner("vencida_en_gracia", -30, 1))
);
check(
  "el primer día avisa 'en 30 días'",
  (banner("vencida_en_gracia", -1, 30)?.detail ?? "").includes("en 30 días tu clínica"),
  JSON.stringify(banner("vencida_en_gracia", -1, 30))
);

console.log("\nSolo lectura y suspendida:");
expect("solo lectura => enfático", banner("solo_lectura", -31, 0), "danger", "modo solo lectura");
check(
  "solo lectura aclara qué sigue disponible: consulta y exportar pacientes y consultas (sin prometer más)",
  /consultando toda tu información/.test(banner("solo_lectura", -31, 0)?.detail ?? "") &&
    /exportar toda la información de la clínica/.test(banner("solo_lectura", -31, 0)?.detail ?? "") &&
    !/descarg/.test(banner("solo_lectura", -31, 0)?.detail ?? ""),
  JSON.stringify(banner("solo_lectura", -31, 0))
);
check(
  "solo lectura con días para el bloqueo: avisa cuántos quedan y que se cancela",
  /en 90 días tu clínica se bloqueará por completo/.test(banner("solo_lectura", -31, 0, true, 90)?.detail ?? "") &&
    /suscripción se cancelará/.test(banner("solo_lectura", -31, 0, true, 90)?.detail ?? ""),
  JSON.stringify(banner("solo_lectura", -31, 0, true, 90))
);
check(
  "el último día de solo lectura avisa 'en 1 día' (singular)",
  /en 1 día tu clínica se bloqueará/.test(banner("solo_lectura", -120, -89, true, 1)?.detail ?? ""),
  JSON.stringify(banner("solo_lectura", -120, -89, true, 1))
);
check(
  "el aviso de bloqueo llega a todo el equipo, no solo al admin",
  /se bloqueará por completo/.test(banner("solo_lectura", -31, 0, false, 90)?.detail ?? ""),
  JSON.stringify(banner("solo_lectura", -31, 0, false, 90))
);
check(
  "solo lectura sin días para el bloqueo (dato ausente) no inventa una cuenta regresiva",
  !/se bloqueará/.test(banner("solo_lectura", -31, 0)?.detail ?? ""),
  JSON.stringify(banner("solo_lectura", -31, 0))
);
expect("bloqueada => enfático, acceso bloqueado", banner("bloqueada", -121, -90, true, 0), "danger", "bloqueado");
check(
  "bloqueada explica que la suscripción fue cancelada",
  /cancelada/.test(banner("bloqueada", -121, -90, true, 0)?.detail ?? ""),
  JSON.stringify(banner("bloqueada", -121, -90, true, 0))
);
expect("suspendida => enfático", banner("suspendida", null, null), "danger", "suspendida");

console.log("\nSin aviso:");
for (const state of ["activa", "exenta", "sin_plan"] as const) {
  check(`${state} => sin aviso`, banner(state, 100, 131) === null, "mostró aviso");
}

console.log("\nContacto de Narnia en todo aviso:");
const all: (AccessBanner | null)[] = [
  banner("prueba", 14, 45),
  banner("por_renovar", 5, 36),
  banner("vencida_en_gracia", -1, 30),
  banner("solo_lectura", -31, 0),
  banner("suspendida", null, null),
  banner("bloqueada", -121, -90, true, 0),
];
check(
  "todo aviso trae el correo y el WhatsApp de Narnia",
  all.every((b) => b !== null && b.detail.includes(CONTACT_NARNIA)),
  JSON.stringify(all.map((b) => b?.detail.slice(-60)))
);

if (failures.length > 0) {
  console.error(`\nFALLÓ: ${failures.length} verificación(es) no pasaron.`);
  process.exit(1);
}
console.log("\nOK: avisos de acceso verificados.");
