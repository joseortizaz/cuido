"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { isGaPath } from "@/lib/ga4";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    // Interruptor oficial de GA para desactivar toda medición de una propiedad: `ga-disable-<ID>`.
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

/** Define `gtag` y encola `js` + `config` (una sola vez). gtag.js los consume cuando termina de cargar. */
function initGtag(gaId: string) {
  if (window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js exige el objeto `arguments` (no un arreglo) en el dataLayer.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  // send_page_view: false -- el page_view se manda a mano, solo desde rutas públicas (ver abajo).
  window.gtag("config", gaId, { send_page_view: false });
}

/**
 * Google Analytics 4 -- SOLO page_view, solo en el sitio público (lista en src/lib/ga4.ts).
 *
 * - gtag.js se descarga únicamente cuando la ruta actual está permitida, así que una visita directa al
 *   área autenticada (o a /login) nunca contacta a Google.
 * - Si alguien entra por la landing y navega (sin recargar) al área autenticada, gtag.js ya está
 *   cargado: mientras la ruta no sea pública se activa `window['ga-disable-<ID>']`, el interruptor
 *   oficial de GA que descarta TODO envío (page_view, scroll, clics salientes, descargas, etc.).
 * - GA4 por defecto manda un page_view en `config` y otro en cada cambio del historial (medición
 *   mejorada), también hacia rutas privadas y sin pasar por estas reglas. Aquí `send_page_view: false`
 *   quita el primero y el page_view se manda a mano, una vez por cada ruta pública visitada (App Router
 *   no recarga la página). Si la propiedad de GA tiene activada la medición mejorada «Cambios de página
 *   según eventos del historial del navegador», conviene desactivarla en GA para no duplicar.
 * - El referrer nunca es una ruta interna privada (p. ej. /patients/<id>): solo se informa si la página
 *   anterior era pública o externa.
 *
 * El layout raíz solo lo monta si NEXT_PUBLIC_GA_ID existe y es un ID de medición válido (G-…).
 */
export function Ga4({ gaId }: { gaId: string }) {
  const pathname = usePathname();
  const allowed = isGaPath(pathname);
  const lastSentPath = useRef<string | null>(null);
  // undefined = primera ejecución; null = la página anterior no era pública (no se informa como referrer).
  const prevPublicUrl = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const disableKey = `ga-disable-${gaId}` as const;
    const href = window.location.href;
    const prev = prevPublicUrl.current;
    prevPublicUrl.current = allowed ? href : null;

    if (!allowed) {
      window[disableKey] = true;
      lastSentPath.current = null;
      return;
    }

    initGtag(gaId);
    window[disableKey] = false;
    if (lastSentPath.current === pathname) return;
    lastSentPath.current = pathname;

    let referrer = "";
    if (prev === undefined) {
      // Carga completa: el referrer del navegador solo vale si es externo (uno interno podría ser una
      // ruta privada).
      try {
        if (document.referrer && new URL(document.referrer).origin !== window.location.origin) {
          referrer = document.referrer;
        }
      } catch {
        // referrer inválido: se omite.
      }
    } else if (prev) {
      referrer = prev;
    }

    // Un instante después: tras un cambio de ruta, Next actualiza document.title un poco más tarde.
    // Si mientras tanto se pasó a una ruta privada, el interruptor `ga-disable` descarta el envío.
    window.setTimeout(() => {
      window.gtag?.("event", "page_view", {
        page_location: href,
        page_path: pathname,
        page_title: document.title,
        page_referrer: referrer,
      });
    }, 100);
  }, [pathname, allowed, gaId]);

  if (!allowed) return null;

  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />;
}
