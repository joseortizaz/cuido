import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Dominio real de producción, verificado en vivo (headers Server: Vercel +
// contenido real de Cuido) -- CLAUDE.md dice "cuido.com" pero ese dominio
// no tiene nada que ver con este proyecto (parking page ajena, servida por
// openresty). cuido.net es el dominio correcto para metadataBase/sitemap/
// robots -- ver conversación para la corrección pendiente de CLAUDE.md.
const SITE_URL = "https://cuido.net";

export const metadata: Metadata = {
  title: {
    default: "Cuido — Gestión clínica multiespecialidad",
    template: "%s",
  },
  description:
    "Plataforma de gestión clínica multiespecialidad para clínicas dominicanas: expediente único, agenda, facturación e-CF y más.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    siteName: "Cuido",
    locale: "es_DO",
    type: "website",
  },
  icons: {
    // src/app/favicon.ico (el default de create-next-app) se eliminó a
    // propósito -- esa convención de archivo especial le gana en
    // prioridad a cualquier ícono de public/ o a esta misma config,
    // así que competía con el logo real de Cuido en public/favicon.ico.
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// GA4 -- condicionado a que la env var exista, así dev/local (donde
// NEXT_PUBLIC_GA_ID no está definida) nunca manda pageviews falsos a la
// propiedad real. Configurar NEXT_PUBLIC_GA_ID en Vercel → Production
// (Preview es opcional, solo si se quiere medir tráfico de PRs).
const gaId = process.env.NEXT_PUBLIC_GA_ID;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {gaId && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaId}');
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
