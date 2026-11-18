"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CIE11_ATTRIBUTION,
  CIE11_SEARCH_PRIVACY_NOTE,
  DIAGNOSIS_KIND_LABELS,
  DIAGNOSIS_KINDS,
  MAX_DIAGNOSES_PER_ENCOUNTER,
  isValidCie11Code,
  normalizeCie11Code,
  type DiagnosisDraft,
  type DiagnosisKind,
} from "@/lib/domain/encounter-diagnoses";

const inputClass =
  "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:focus:border-zinc-400";
const smallButton =
  "rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-white/[.08]";

type Result = { code: string; title: string; entityUri: string; isLeaf: boolean };
type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; results: Result[] }
  | { status: "unavailable" }
  | { status: "error"; message: string };

/**
 * Selector de diagnósticos CIE-11. Busca en el catálogo de la OMS a través de NUESTRO servidor (/api/cie11/search;
 * las credenciales nunca llegan al navegador) y deja la lista de diagnósticos en `value`. Si la búsqueda no está
 * disponible, el médico puede escribir el código y el título a mano (queda «no verificado»). Es opcional: nunca
 * bloquea el guardado. El título se guarda tal como lo devuelve la OMS, sin modificar.
 */
export function Cie11Picker({
  value,
  onChange,
  defaultKind = "presuntivo",
  max = MAX_DIAGNOSES_PER_ENCOUNTER,
  allowedKinds = DIAGNOSIS_KINDS,
  compact = false,
}: {
  value: DiagnosisDraft[];
  onChange: (next: DiagnosisDraft[]) => void;
  defaultKind?: DiagnosisKind;
  max?: number;
  allowedKinds?: readonly DiagnosisKind[];
  /** Sin la lista de elegidos (cuando el padre ya la muestra). */
  compact?: boolean;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [active, setActive] = useState(-1);
  const [manual, setManual] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [kind, setKind] = useState<DiagnosisKind>(allowedKinds.includes(defaultKind) ? defaultKind : allowedKinds[0]);
  const abortRef = useRef<AbortController | null>(null);

  // Búsqueda con retardo de ~300 ms; descarta respuestas viejas.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      // Con menos de 3 caracteres no hay búsqueda: el estado se deriva abajo (searchState), sin setState aquí.
      abortRef.current?.abort();
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearch({ status: "loading" });
      try {
        const res = await fetch(`/api/cie11/search?q=${encodeURIComponent(q)}`, { signal: controller.signal, cache: "no-store" });
        if (res.status === 429) {
          setSearch({ status: "error", message: "Demasiadas búsquedas seguidas. Espera un momento." });
          return;
        }
        if (!res.ok) {
          setSearch({ status: "unavailable" });
          setManual(true);
          return;
        }
        const data = (await res.json()) as { available?: boolean; results?: Result[] };
        if (!data.available) {
          setSearch({ status: "unavailable" });
          setManual(true);
          return;
        }
        setSearch({ status: "ok", results: data.results ?? [] });
        setActive(-1);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        setSearch({ status: "unavailable" });
          setManual(true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const full = value.length >= max;
  const searchState: SearchState = query.trim().length < 3 ? { status: "idle" } : search;
  const results = searchState.status === "ok" ? searchState.results : [];

  function add(d: Omit<DiagnosisDraft, "isPrimary" | "doctorNote" | "kind">, chosenKind: DiagnosisKind = kind): string | null {
    if (full) return `Máximo ${max} diagnósticos codificados.`;
    if (value.some((v) => v.code === d.code && v.kind === chosenKind)) return `El código ${d.code} ya está agregado como ${DIAGNOSIS_KIND_LABELS[chosenKind].toLowerCase()}.`;
    onChange([...value, { ...d, kind: chosenKind, isPrimary: false, doctorNote: "" }]);
    return null;
  }

  function pick(r: Result) {
    const err = add({ code: r.code, title: r.title, entityUri: r.entityUri });
    if (err) {
      setSearch({ status: "error", message: err });
      return;
    }
    setQuery("");
    setSearch({ status: "idle" });
    setActive(-1);
  }

  function addManual() {
    const code = normalizeCie11Code(manualCode);
    const title = manualTitle.trim();
    if (!isValidCie11Code(code)) {
      setManualError("El código no tiene un formato CIE-11 válido (por ejemplo 5A11 o 1A00.1).");
      return;
    }
    if (title.length < 1 || title.length > 400) {
      setManualError("Escribe el título del diagnóstico (hasta 400 caracteres).");
      return;
    }
    const err = add({ code, title, entityUri: null });
    if (err) {
      setManualError(err);
      return;
    }
    setManualCode("");
    setManualTitle("");
    setManualError(null);
  }

  function update(i: number, patch: Partial<DiagnosisDraft>) {
    onChange(
      value.map((d, idx) => {
        if (idx === i) return { ...d, ...patch };
        // Un solo principal por tipo.
        if (patch.isPrimary && d.kind === (patch.kind ?? value[i].kind)) return { ...d, isPrimary: false };
        return d;
      })
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length > 0) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      // Enter en el buscador elige el resultado marcado y NUNCA envía el formulario de la consulta.
      e.preventDefault();
      if (active >= 0 && results[active]) pick(results[active]);
    } else if (e.key === "Escape") {
      setSearch({ status: "idle" });
      setActive(-1);
    }
  }

  const unavailable = searchState.status === "unavailable";

  return (
    <div className="flex flex-col gap-3">
      {!compact && value.length > 0 && (
        <ul className="flex flex-col gap-2">
          {value.map((d, i) => (
            <li key={`${d.kind}-${d.code}`} className="flex flex-col gap-2 rounded-lg border border-panel-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm">
                  <span className="font-bold">{d.code}</span> · {d.title}
                  {d.entityUri === null && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      No verificado
                    </span>
                  )}
                </span>
                <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className={smallButton} aria-label={`Quitar ${d.code}`}>
                  Quitar
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1">
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">Tipo</span>
                  <select value={d.kind} onChange={(e) => update(i, { kind: e.target.value as DiagnosisKind, isPrimary: false })} className={`${inputClass} py-1 text-xs`}>
                    {allowedKinds.map((k) => (
                      <option key={k} value={k}>
                        {DIAGNOSIS_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={d.isPrimary} onChange={(e) => update(i, { isPrimary: e.target.checked })} />
                  <span>Principal</span>
                </label>
                <input
                  aria-label={`Nota sobre ${d.code} (opcional)`}
                  value={d.doctorNote}
                  maxLength={500}
                  onChange={(e) => update(i, { doctorNote: e.target.value })}
                  placeholder="Nota o matiz (opcional)"
                  className={`${inputClass} min-w-48 flex-1 py-1 text-xs`}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="relative flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${uid}-q`} className="sr-only">
            Buscar diagnóstico en CIE-11
          </label>
          <input
            id={`${uid}-q`}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
            autoComplete="off"
            maxLength={100}
            value={query}
            disabled={full}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={full ? `Máximo ${max} diagnósticos` : "Buscar diagnóstico (p. ej. diabetes tipo 2, hipertensión)"}
            className={`${inputClass} min-w-64 flex-1`}
          />
          {allowedKinds.length > 1 && (
            <label className="flex items-center gap-1 text-sm">
              <span className="text-xs text-zinc-600 dark:text-zinc-400">Agregar como</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as DiagnosisKind)} className={`${inputClass} py-1.5 text-sm`}>
                {allowedKinds.map((k) => (
                  <option key={k} value={k}>
                    {DIAGNOSIS_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div aria-live="polite" className="min-h-4 text-xs text-zinc-500">
          {searchState.status === "loading" && "Buscando…"}
          {searchState.status === "ok" && results.length === 0 && "Sin resultados. Prueba con otra palabra."}
          {searchState.status === "error" && <span className="text-red-600 dark:text-red-400">{searchState.message}</span>}
          {unavailable && <span className="text-amber-700 dark:text-amber-300">Búsqueda CIE-11 no disponible. Puedes escribir el código a mano.</span>}
        </div>

        {results.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Resultados de CIE-11"
            className="absolute top-11 z-10 max-h-72 w-full overflow-auto rounded-lg border border-panel-border bg-panel-surface shadow-lg"
          >
            {results.map((r, i) => (
              <li
                key={r.code}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-black/[.06] dark:bg-white/[.1]" : ""}`}
              >
                <span className="font-bold">{r.code}</span> · {r.title}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {!manual && !unavailable && (
          <button type="button" onClick={() => setManual(true)} className="self-start text-xs text-zinc-500 underline">
            Escribir el código a mano
          </button>
        )}
        {(manual || unavailable) && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-panel-border p-3">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Entrada manual: queda marcada como <strong>no verificada</strong> (no se comprobó contra el catálogo de la OMS).
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Código CIE-11"
                value={manualCode}
                maxLength={80}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Código (5A11)"
                className={`${inputClass} w-36`}
              />
              <input
                aria-label="Título del diagnóstico"
                value={manualTitle}
                maxLength={400}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="Título del diagnóstico"
                className={`${inputClass} min-w-48 flex-1`}
              />
              <button type="button" onClick={addManual} disabled={full} className={smallButton}>
                Agregar
              </button>
            </div>
            {manualError && <p className="text-xs text-red-600 dark:text-red-400">{manualError}</p>}
          </div>
        )}
      </div>

      <p className="text-xs text-zinc-500">{CIE11_SEARCH_PRIVACY_NOTE}</p>
      <p className="text-xs text-zinc-500">{CIE11_ATTRIBUTION}</p>
    </div>
  );
}
