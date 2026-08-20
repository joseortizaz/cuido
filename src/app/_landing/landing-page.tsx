import { poppins } from "./fonts";
import { LandingHeader } from "./header";
import { LandingHero } from "./hero";
import { LandingDifferentiators } from "./differentiators";
import { LandingSpecialties } from "./specialties";
import { LandingFinalCta } from "./final-cta";
import { LandingFooter } from "./footer";

/**
 * Landing pública en "/" — solo la ve un visitante SIN sesión activa
 * (src/app/page.tsx mantiene el redirect de siempre para usuarios
 * logueados). Fuente Poppins cargada solo aquí, vía fonts.ts — no toca el
 * layout raíz ni el resto de la app.
 */
export function LandingPage() {
  return (
    <div className={`${poppins.variable} flex min-h-full flex-col bg-brand-bg font-[family-name:var(--font-poppins)]`}>
      <LandingHeader />
      <main className="flex-1">
        <LandingHero />
        <LandingDifferentiators />
        <LandingSpecialties />
        <LandingFinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
