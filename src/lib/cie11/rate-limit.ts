/**
 * Límite de uso del buscador CIE-11 (ventana deslizante en memoria del servidor). Es una protección blanda: en
 * un despliegue sin servidor cada instancia lleva su propia cuenta, así que el tope real es "por instancia".
 * Sirve para frenar un ciclo descontrolado o un abuso, no como cuota contractual.
 */

type Window = { hits: number[] };

const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;

export const CIE11_LIMIT_PER_USER = 30;
export const CIE11_LIMIT_PER_CLINIC = 120;

function hit(key: string, limit: number, now: number): boolean {
  const w = windows.get(key) ?? { hits: [] };
  w.hits = w.hits.filter((t) => now - t < WINDOW_MS);
  if (w.hits.length >= limit) {
    windows.set(key, w);
    return false;
  }
  w.hits.push(now);
  windows.set(key, w);
  return true;
}

/** true = permitido (y contado). Se cuenta contra el usuario y contra su clínica. */
export function allowCie11Search(userId: string, clinicId: string, now: number = Date.now()): boolean {
  // Se comprueban los dos antes de contar, para no gastar el cupo de la clínica con un usuario ya limitado.
  const userWindow = (windows.get(`u:${userId}`)?.hits ?? []).filter((t) => now - t < WINDOW_MS).length;
  const clinicWindow = (windows.get(`c:${clinicId}`)?.hits ?? []).filter((t) => now - t < WINDOW_MS).length;
  if (userWindow >= CIE11_LIMIT_PER_USER || clinicWindow >= CIE11_LIMIT_PER_CLINIC) return false;
  hit(`u:${userId}`, CIE11_LIMIT_PER_USER, now);
  hit(`c:${clinicId}`, CIE11_LIMIT_PER_CLINIC, now);
  if (windows.size > 5000) {
    for (const [k, w] of windows) if (w.hits.every((t) => now - t >= WINDOW_MS)) windows.delete(k);
  }
  return true;
}

/** Solo para pruebas. */
export function resetCie11RateLimit(): void {
  windows.clear();
}
