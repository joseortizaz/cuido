import { ClipboardIcon, ReceiptIcon, SignatureIcon, ShieldCheckIcon } from "./icons";

/**
 * Visual del Hero -- composición gráfica abstracta, NO una captura de
 * pantalla real de la app. Decisión explícita (opción b de las dos
 * planteadas al pedir esta mejora):
 *
 * El dashboard real hoy (src/app/(clinic)/dashboard/page.tsx) es una
 * pantalla de bienvenida mínima -- un título, la clínica/rol del usuario y
 * dos botones. Ninguna vista de la app tiene hoy el tipo de panel con
 * gráficas/tarjetas de métricas que sugiere el boceto. Una captura real
 * de esa pantalla se vería pobre en una landing (y como es tan simple,
 * cualquier intento de "vestirla" para la captura empezaría a acercarse a
 * simular una interfaz que no es la real). Una composición abstracta con
 * las mismas 4 funcionalidades ya descritas en la sección de
 * funcionalidades más abajo evita ambos problemas: no hay datos de
 * pacientes (ni siquiera de mentira) que puedan confundirse con reales, y
 * no se le atribuye a la app una UI que no tiene.
 *
 * Reutiliza los mismos íconos de la sección de funcionalidades (icons.tsx)
 * para que la composición se sienta parte del mismo sistema visual, no un
 * elemento aparte. Sin animaciones ni librerías nuevas -- todo es CSS
 * (Tailwind) estático, con leves rotaciones para dar sensación de
 * "tarjetas flotantes" tal como pedía el boceto.
 */
export function LandingHeroVisual() {
  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-md items-center justify-center sm:aspect-4/3 sm:max-w-lg">
      <div className="absolute inset-4 rounded-[2rem] bg-linear-to-br from-brand-blue to-brand-teal opacity-90 shadow-xl shadow-brand-blue/20 sm:inset-6" />

      <div className="absolute inset-4 rounded-[2rem] bg-white/10 sm:inset-6" />

      <div className="absolute left-[8%] top-[12%] flex w-40 -rotate-6 flex-col gap-2 rounded-2xl bg-white p-4 shadow-lg sm:w-44">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
          <ClipboardIcon className="h-4.5 w-4.5" />
        </span>
        <p className="text-xs font-semibold text-brand-navy">Historias Clínicas</p>
        <p className="text-[11px] text-zinc-500">Por especialidad</p>
      </div>

      <div className="absolute right-[6%] top-[28%] flex w-36 rotate-3 flex-col gap-2 rounded-2xl bg-white p-4 shadow-lg sm:w-40">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-teal/10 text-brand-teal">
          <ReceiptIcon className="h-4.5 w-4.5" />
        </span>
        <p className="text-xs font-semibold text-brand-navy">e-CF</p>
        <p className="text-[11px] text-zinc-500">Listo para DGII</p>
      </div>

      <div className="absolute bottom-[10%] left-[14%] flex w-36 rotate-2 flex-col gap-2 rounded-2xl bg-white p-4 shadow-lg sm:w-40">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
          <SignatureIcon className="h-4.5 w-4.5" />
        </span>
        <p className="text-xs font-semibold text-brand-navy">Consentimiento</p>
        <p className="text-[11px] text-zinc-500">Firma con trazabilidad</p>
      </div>

      <div className="absolute bottom-[18%] right-[10%] flex w-32 -rotate-3 flex-col gap-2 rounded-2xl bg-white p-3.5 shadow-lg sm:w-36">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-teal/10 text-brand-teal">
          <ShieldCheckIcon className="h-4 w-4" />
        </span>
        <p className="text-xs font-semibold text-brand-navy">Normativa MSP</p>
      </div>
    </div>
  );
}
