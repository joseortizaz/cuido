/**
 * Prueba de la codificación CIE-11 SIN red real ni base de datos
 * (src/lib/domain/encounter-diagnoses.ts, src/lib/cie11/who-client.ts, src/lib/cie11/rate-limit.ts).
 *
 * Qué verifica:
 *   1. Lógica pura: formato de códigos MMS (con postcoordinación), URI de la OMS, limpieza de títulos,
 *      lectura y validación de la lista que llega del formulario (un solo principal por tipo, sin repetidos).
 *   2. Cliente de la OMS contra un SERVIDOR SIMULADO (nunca la API real): token OAuth 2 (Basic, client
 *      credentials, scope icdapi_access) guardado en memoria y reutilizado; búsqueda con español, API v2,
 *      flexisearch y sin resaltado; solo viaja el texto buscado (ni cookies ni datos del paciente);
 *      respuesta reducida a código/título/URI/hoja (capítulos sin código fuera, sin etiquetas, sin
 *      repetidos, máximo 10); 401 renueva el token UNA vez; 401 doble, token rechazado, 500, JSON roto y
 *      tiempo agotado = «no disponible» con su motivo; respuesta vacía; sin credenciales = desactivado.
 *   3. Límite de uso por usuario y por clínica.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  CIE11_CODE_RE,
  cleanWhoTitle,
  isValidCie11Code,
  joinCodes,
  normalizeEntityUri,
  orderDiagnoses,
  parseDiagnosesJson,
} from "../src/lib/domain/encounter-diagnoses";
import { getIcdRelease, isCie11Configured, mapWhoSearchResponse, resetCie11TokenCache, searchCie11 } from "../src/lib/cie11/who-client";
import { CIE11_LIMIT_PER_CLINIC, CIE11_LIMIT_PER_USER, allowCie11Search, resetCie11RateLimit } from "../src/lib/cie11/rate-limit";

const failures: string[] = [];
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name} — ${detail}`);
    failures.push(name);
  }
}

type Seen = { url: string; headers: http.IncomingHttpHeaders; body: string };
const seen: Seen[] = [];
let mode: "ok" | "search401once" | "search401always" | "token401" | "search500" | "badjson" | "slow" | "empty" = "ok";
let tokenCounter = 0;

const URI = (n: number) => `http://id.who.int/icd/release/11/2026-01/mms/${n}`;
const SEARCH_BODY = {
  destinationEntities: [
    { id: URI(1), title: "<em class='found'>Diabetes</em> mellitus tipo 2", theCode: "5A11", isLeaf: false },
    { id: URI(2), title: "Diabetes mellitus tipo 2 con &amp; complicaciones", theCode: "5A11.0", isLeaf: true },
    { id: URI(3), title: "Capítulo 5: Enfermedades endocrinas", theCode: "", isLeaf: false },
    { id: URI(1), title: "Duplicado", theCode: "5A11", isLeaf: false },
    { id: "https://evil.example.com/x", title: "URI ajena", theCode: "ZZ99", isLeaf: true },
    ...Array.from({ length: 14 }, (_, i) => ({ id: URI(100 + i), title: `Resultado ${i}`, theCode: `1A0${String.fromCharCode(65 + i)}`, isLeaf: true })),
  ],
};

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ url: req.url ?? "", headers: req.headers, body });
    if (req.url?.startsWith("/connect/token")) {
      if (mode === "token401") {
        res.writeHead(401).end("{}");
        return;
      }
      tokenCounter++;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ access_token: `tok-${tokenCounter}`, expires_in: 3600, token_type: "Bearer" }));
      return;
    }
    if (req.url?.includes("/mms/search")) {
      const auth = req.headers.authorization ?? "";
      if (mode === "search401always" || (mode === "search401once" && auth === "Bearer tok-1")) {
        res.writeHead(401).end("{}");
        return;
      }
      if (mode === "search500") {
        res.writeHead(500).end("boom");
        return;
      }
      if (mode === "badjson") {
        res.writeHead(200, { "Content-Type": "application/json" }).end("{no es json");
        return;
      }
      if (mode === "slow") {
        setTimeout(() => res.writeHead(200).end("{}"), 1500);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(mode === "empty" ? { destinationEntities: [] } : SEARCH_BODY));
      return;
    }
    res.writeHead(404).end();
  });
});

async function main() {
  console.log("Lógica pura:");
  check("acepta códigos MMS comunes y con subdivisión", ["5A11", "1A00.1", "NE81", "6A70.1", "2C25.Z", "BA00"].every(isValidCie11Code), "");
  check("acepta postcoordinación con & y /", isValidCie11Code("2C25.Z&XA2UD3") && isValidCie11Code("2C25.Z/XA2UD3") && isValidCie11Code("5a11"), "");
  check("rechaza lo que no es un código CIE-11 (CIE-10, vacío, espacios, inyección)", ["", "J00", "E11.9", "5A1", "5A11 ", "5A11;DROP", "5A11.", "x".repeat(90), "5A11.ABC"].filter((c) => c !== "5A11 ").every((c) => !isValidCie11Code(c)), "");
  check("la expresión coincide con la de la base (anclada)", CIE11_CODE_RE.source.startsWith("^") && CIE11_CODE_RE.source.endsWith("$"), CIE11_CODE_RE.source);
  check("solo se aceptan URI de la OMS (http o https) y se normalizan a http", normalizeEntityUri("https://id.who.int/icd/release/11/2026-01/mms/1") === URI(1) && normalizeEntityUri("http://evil.com/x") === null && normalizeEntityUri(42) === null, "");
  check("los títulos se limpian de etiquetas y entidades", cleanWhoTitle("<em class='found'>Diabetes</em> &amp; más   <b>x</b>") === "Diabetes & más x", cleanWhoTitle("<em class='found'>Diabetes</em> &amp; más   <b>x</b>"));
  const good = JSON.stringify([
    { kind: "definitivo", code: "5a11", title: "Diabetes mellitus tipo 2", entityUri: URI(1), isPrimary: true, doctorNote: " Hace 5 años " },
    { kind: "presuntivo", code: "BA00", title: "Hipertensión esencial", entityUri: null, isPrimary: false, doctorNote: "" },
  ]);
  const p = parseDiagnosesJson(good);
  check("lee la lista del formulario, normaliza el código y recorta la nota", !p.error && p.items.length === 2 && p.items[0].code === "5A11" && p.items[0].doctor_note === "Hace 5 años" && p.items[1].entity_uri === null, JSON.stringify(p));
  const bad = (items: unknown) => parseDiagnosesJson(JSON.stringify(items)).error !== undefined;
  check("rechaza: JSON roto, no-lista, tipo inválido, código inválido, título vacío, nota larga, URI ajena", parseDiagnosesJson("{x").error !== undefined && bad({}) && bad([{ kind: "x", code: "5A11", title: "t" }]) && bad([{ kind: "definitivo", code: "J00", title: "t" }]) && bad([{ kind: "definitivo", code: "5A11", title: " " }]) && bad([{ kind: "definitivo", code: "5A11", title: "t", doctorNote: "x".repeat(501) }]) && bad([{ kind: "definitivo", code: "5A11", title: "t", entityUri: "http://evil.com" }]), "");
  check("rechaza repetidos y dos principales del mismo tipo (pero sí uno por tipo)", bad([{ kind: "definitivo", code: "5A11", title: "a" }, { kind: "definitivo", code: "5A11", title: "b" }]) && bad([{ kind: "definitivo", code: "5A11", title: "a", isPrimary: true }, { kind: "definitivo", code: "BA00", title: "b", isPrimary: true }]) && !bad([{ kind: "definitivo", code: "5A11", title: "a", isPrimary: true }, { kind: "presuntivo", code: "BA00", title: "b", isPrimary: true }]), "");
  check("rechaza más de 20 diagnósticos; lista vacía o ausente = ninguno", bad(Array.from({ length: 21 }, (_, i) => ({ kind: "presuntivo", code: `1A0${String.fromCharCode(65 + (i % 26))}`, title: "t" }))) && parseDiagnosesJson("").items.length === 0 && parseDiagnosesJson(undefined).items.length === 0, "");
  const rows = [
    { kind: "presuntivo", is_primary: true, code: "B", created_at: "1" },
    { kind: "definitivo", is_primary: false, code: "C", created_at: "2" },
    { kind: "definitivo", is_primary: true, code: "A", created_at: "3" },
  ];
  check("el orden es: definitivo antes que presuntivo y el principal primero; exporta los códigos con «;»", orderDiagnoses(rows).map((r) => r.code).join("") === "ACB" && joinCodes(rows) === "A;C;B", joinCodes(rows));
  check("la respuesta de la OMS se reduce a código, título, URI y hoja", (() => {
    const out = mapWhoSearchResponse(SEARCH_BODY);
    return out.length === 10 && out[0].code === "5A11" && out[0].title === "Diabetes mellitus tipo 2" && out[1].title.includes("& complicaciones") && !out.some((r) => r.code === "" || r.code === "ZZ99") && out.filter((r) => r.code === "5A11").length === 1 && Object.keys(out[0]).sort().join() === "code,entityUri,isLeaf,title";
  })(), "");
  check("una respuesta rara no rompe (null, sin lista)", mapWhoSearchResponse(null).length === 0 && mapWhoSearchResponse({}).length === 0 && mapWhoSearchResponse({ destinationEntities: "x" }).length === 0, "");

  console.log("\nCliente de la OMS (servidor simulado):");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  process.env.ICD_API_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ICD_TOKEN_URL = `http://127.0.0.1:${port}/connect/token`;
  process.env.ICD_TIMEOUT_MS = "400";
  delete process.env.ICD_CLIENT_ID;
  delete process.env.ICD_CLIENT_SECRET;
  delete process.env.ICD_RELEASE;

  check("sin credenciales la búsqueda está desactivada (no llama a la red)", !isCie11Configured() && (await searchCie11("diabetes")).status === "unavailable" && seen.length === 0, "");
  process.env.ICD_CLIENT_ID = "id-de-prueba";
  process.env.ICD_CLIENT_SECRET = "secreto-de-prueba";
  check("la versión por defecto es 2026-01 y se puede fijar con ICD_RELEASE (solo con formato AAAA-MM)", getIcdRelease() === "2026-01" && ((process.env.ICD_RELEASE = "2025-01"), getIcdRelease() === "2025-01") && ((process.env.ICD_RELEASE = "latest"), getIcdRelease() === "2026-01"), "");
  process.env.ICD_RELEASE = "2026-01";

  resetCie11TokenCache();
  const r1 = await searchCie11("diabetes");
  check("busca y devuelve resultados limpios", r1.status === "ok" && r1.results.length === 10 && r1.results[0].code === "5A11", JSON.stringify(r1).slice(0, 200));
  const tokenReq = seen.find((s) => s.url.startsWith("/connect/token"))!;
  const expectedBasic = "Basic " + Buffer.from("id-de-prueba:secreto-de-prueba").toString("base64");
  check("el token se pide con Basic, client_credentials y scope icdapi_access", tokenReq.headers.authorization === expectedBasic && tokenReq.body.includes("grant_type=client_credentials") && tokenReq.body.includes("scope=icdapi_access"), `${tokenReq.headers.authorization} ${tokenReq.body}`);
  const searchReq = seen.find((s) => s.url.includes("/mms/search"))!;
  const u = new URL(searchReq.url, "http://x");
  check("la búsqueda va a la linearización MMS de la versión fijada, con Bearer, español y API v2", u.pathname === "/icd/release/11/2026-01/mms/search" && searchReq.headers.authorization === "Bearer tok-1" && searchReq.headers["accept-language"] === "es" && searchReq.headers["api-version"] === "v2", `${u.pathname} ${JSON.stringify(searchReq.headers)}`);
  check("usa flexisearch, sin resaltado y en modo de codificación médica", u.searchParams.get("useFlexisearch") === "true" && u.searchParams.get("highlightingEnabled") === "false" && u.searchParams.get("medicalCodingMode") === "true" && u.searchParams.get("q") === "diabetes", searchReq.url);
  check("a la OMS solo viaja el texto buscado: ni cookies ni otros datos", !searchReq.headers.cookie && !searchReq.headers.referer && [...u.searchParams.keys()].sort().join() === "flatResults,highlightingEnabled,medicalCodingMode,q,useFlexisearch", [...u.searchParams.keys()].join());
  await searchCie11("hipertensión");
  check("el token se guarda en memoria y se reutiliza (una sola petición de token)", seen.filter((s) => s.url.startsWith("/connect/token")).length === 1, `${seen.filter((s) => s.url.startsWith("/connect/token")).length}`);

  mode = "search401once";
  resetCie11TokenCache();
  tokenCounter = 0;
  seen.length = 0;
  const r401 = await searchCie11("asma");
  check("un 401 renueva el token UNA vez y reintenta con éxito", r401.status === "ok" && seen.filter((s) => s.url.startsWith("/connect/token")).length === 2 && seen.filter((s) => s.url.includes("/mms/search")).length === 2, `${r401.status} tokens=${seen.filter((s) => s.url.startsWith("/connect/token")).length}`);

  mode = "search401always";
  resetCie11TokenCache();
  seen.length = 0;
  const r401b = await searchCie11("asma");
  check("dos 401 seguidos = no disponible (auth), sin ciclos", r401b.status === "unavailable" && r401b.reason === "auth" && seen.filter((s) => s.url.includes("/mms/search")).length === 2, JSON.stringify(r401b));

  mode = "token401";
  resetCie11TokenCache();
  const rTok = await searchCie11("asma");
  check("credenciales rechazadas = no disponible (auth)", rTok.status === "unavailable" && rTok.reason === "auth", JSON.stringify(rTok));

  mode = "search500";
  resetCie11TokenCache();
  const r500 = await searchCie11("asma");
  check("error 500 de la OMS = no disponible (upstream)", r500.status === "unavailable" && r500.reason === "upstream", JSON.stringify(r500));

  mode = "badjson";
  const rBad = await searchCie11("asma");
  check("una respuesta que no es JSON no rompe (upstream)", rBad.status === "unavailable" && rBad.reason === "upstream", JSON.stringify(rBad));

  mode = "slow";
  const rSlow = await searchCie11("asma");
  check("si la OMS tarda demasiado, tiempo agotado (timeout)", rSlow.status === "unavailable" && rSlow.reason === "timeout", JSON.stringify(rSlow));

  mode = "empty";
  const rEmpty = await searchCie11("zzzz");
  check("una respuesta vacía es «sin resultados», no un error", rEmpty.status === "ok" && rEmpty.results.length === 0, JSON.stringify(rEmpty));

  process.env.ICD_API_BASE_URL = "http://127.0.0.1:1";
  mode = "ok";
  resetCie11TokenCache();
  const rDown = await searchCie11("asma");
  check("si la OMS no responde (conexión rechazada) = no disponible, sin lanzar", rDown.status === "unavailable", JSON.stringify(rDown));

  console.log("\nLímite de uso:");
  resetCie11RateLimit();
  let allowed = 0;
  for (let i = 0; i < CIE11_LIMIT_PER_USER + 5; i++) if (allowCie11Search("u1", "c1", 1000)) allowed++;
  check(`un usuario puede hacer ${CIE11_LIMIT_PER_USER} búsquedas por minuto y no más`, allowed === CIE11_LIMIT_PER_USER, `${allowed}`);
  check("otro usuario de la misma clínica no se ve afectado", allowCie11Search("u2", "c1", 1000), "");
  check("pasado el minuto vuelve a permitir", allowCie11Search("u1", "c1", 1000 + 61_000), "");
  resetCie11RateLimit();
  let clinicAllowed = 0;
  for (let i = 0; i < CIE11_LIMIT_PER_CLINIC + 20; i++) if (allowCie11Search(`user-${i}`, "c9", 5000)) clinicAllowed++;
  check(`una clínica entera tiene tope de ${CIE11_LIMIT_PER_CLINIC} por minuto`, clinicAllowed === CIE11_LIMIT_PER_CLINIC, `${clinicAllowed}`);
  check("otra clínica no se ve afectada", allowCie11Search("x", "c10", 5000), "");
}

main()
  .catch((e) => {
    console.error("Error inesperado:", e);
    failures.push("error inesperado");
  })
  .finally(() => {
    server.close();
    if (failures.length > 0) {
      console.error(`\nFALLÓ: ${failures.length} verificación(es) no pasaron.`);
      process.exit(1);
    }
    console.log("\nOK: lógica CIE-11, cliente de la OMS (simulado) y límite de uso verificados.");
  });
