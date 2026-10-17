"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { isMetaPixelPath } from "@/lib/meta-pixel";

type Fbq = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: Fbq;
  }
}

/**
 * Meta Pixel -- SOLO PageView, solo en el sitio público (lista en src/lib/meta-pixel.ts).
 *
 * - El script y el <noscript> se renderizan únicamente cuando la ruta actual está permitida, así que
 *   una visita directa al área autenticada nunca descarga fbevents.js.
 * - Si alguien entra por la landing y navega (sin recargar) al área autenticada, el script ya está
 *   cargado: por eso se desactiva la configuración automática de Meta (no recoge clics de botones,
 *   metadatos de la página ni coincidencia avanzada) y se revoca el consentimiento del píxel mientras
 *   la ruta no sea pública. Sin eventos personalizados ni parámetros extra.
 * - El PageView de la primera carga lo dispara el propio script. Meta, por defecto, también dispara un
 *   PageView solo en cada pushState (navegación interna), incluso hacia rutas privadas y sin pasar por
 *   estas reglas: se desactiva con `fbq.disablePushState = true` y aquí se dispara a mano, una vez por
 *   cambio de ruta y solo si la ruta es pública (App Router no recarga la página).
 *
 * El layout raíz solo lo monta si NEXT_PUBLIC_META_PIXEL_ID existe y es válido.
 */
export function MetaPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const allowed = isMetaPixelPath(pathname);
  const lastPath = useRef(pathname);

  useEffect(() => {
    const changed = lastPath.current !== pathname;
    lastPath.current = pathname;

    const fbq = window.fbq;
    // Aún sin cargar: el script, al cargar, hace su propio init + PageView.
    if (typeof fbq !== "function") return;

    if (!allowed) {
      fbq("consent", "revoke");
      return;
    }
    fbq("consent", "grant");
    // trackSingle (y no track): con disablePushState el píxel descarta los PageView repetidos de `track`.
    if (changed) fbq("trackSingle", pixelId, "PageView");
  }, [pathname, allowed, pixelId]);

  if (!allowed) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq.disablePushState = true;
          fbq('set', 'autoConfig', false, '${pixelId}');
          fbq('init', '${pixelId}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
