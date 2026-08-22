import { poppins } from "./fonts";
import { LandingHeader } from "./header";
import { LandingHero } from "./hero";
import { LandingMarketFocus } from "./market-focus";
import { LandingFeatures } from "./features";
import { LandingQuote } from "./quote";
import { LandingBenefits } from "./benefits";
import { LandingAbout } from "./about";
import { LandingFinalCta } from "./final-cta";
import { LandingContact } from "./contact";
import { LandingFooter } from "./footer";

/**
 * Landing pública en "/" — solo la ve un visitante SIN sesión activa
 * (src/app/page.tsx mantiene el redirect de siempre para usuarios
 * logueados). Fuente Poppins cargada solo aquí, vía fonts.ts — no toca el
 * layout raíz ni el resto de la app.
 *
 * Rediseño siguiendo public/boceto landing cuido.png, con una regla no
 * negociable: cero contenido aspiracional. Cada sección de esta página
 * documenta, en su propio archivo, por qué su contenido es verificable hoy
 * (o qué se dejó como placeholder explícito para revisión).
 */
export function LandingPage() {
  return (
    <div className={`${poppins.variable} flex min-h-full flex-col bg-brand-bg font-[family-name:var(--font-poppins)]`}>
      <LandingHeader />
      <main className="flex-1">
        <LandingHero />
        <LandingMarketFocus />
        <LandingFeatures />
        <LandingAbout />
        <LandingQuote />
        <LandingBenefits />
        <LandingFinalCta />
        <LandingContact />
      </main>
      <LandingFooter />
    </div>
  );
}
