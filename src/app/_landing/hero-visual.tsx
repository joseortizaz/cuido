import Image from "next/image";
import { CUIDO_LOGO_SRC } from "./constants";
import { FEATURES } from "./features-data";

/**
 * Visual del Hero -- mockup de laptop en CSS/React, NO una imagen estática.
 *
 * Referencia de estilo: public/hero_cuido.png (subida por el usuario) --
 * mismo tipo de composición (laptop con la interfaz, degradado de marca
 * detrás) pero su CONTENIDO no era utilizable tal cual: mostraba secciones
 * de menú que no existen (Agenda, Reportes, Inventario), un dashboard con
 * métricas inventadas (28 citas, RD$1,250,000, gráfica de consultas) y
 * nombres de pacientes de ejemplo (María González, Juan Pérez, Ana
 * Martínez, Carlos Sánchez) -- exactamente lo que la regla de "cero
 * contenido aspiracional" de este proyecto prohíbe.
 *
 * Aquí la pantalla del laptop muestra ÚNICAMENTE las 6 funcionalidades
 * reales ya listadas en la sección Funcionalidades (features-data.ts es la
 * fuente única para ambas, así que nunca pueden desincronizarse) -- mismos
 * títulos exactos, sin gráficas, sin cifras, sin nombres de pacientes.
 *
 * Imagen estática vs. composición CSS/React -- se eligió CSS/React:
 * 1. Mantenible sin regenerar nada: si mañana cambia una de las 6
 *    funcionalidades (o se agrega una séptima), este componente se
 *    actualiza solo con FEATURES -- una imagen PNG requeriría regenerarse
 *    a mano cada vez.
 * 2. Cero riesgo de contenido inventado colándose por accidente: un
 *    generador de imágenes (IA o diseño manual) tiende a rellenar un
 *    "dashboard" con métricas/gráficas de relleno para que se vea
 *    completo, que es justo el problema del archivo de referencia.
 * 3. Sin la persona en bata médica del boceto de referencia: esa foto es
 *    un asset de stock específico que no se puede reproducir sin
 *    licencia, y sustituirla por otra foto de stock o un retrato
 *    generado por IA abre el mismo problema de derechos de imagen (o de
 *    una persona sintética que podría parecer una persona real). Se
 *    prescinde de ella por completo -- el mockup del laptop solo ya
 *    comunica "esto es un producto de software" sin ese riesgo.
 *
 * Estetoscopio decorativo (public/hero-estetoscopio.png, 640x1064, PNG
 * con alfa real): descansa en la esquina INFERIOR izquierda del marco --
 * la campana sobre el borde izquierdo (mitad bisel, mitad padding de la
 * pantalla, sin tapar títulos de tarjetas), el arco de las olivas fuera
 * del laptop a la izquierda y el lazo azul colgando por debajo del marco.
 * Fuente: generada con IA por José Ortiz con Gemini (Google), octubre de
 * 2026 -- Google no reclama la propiedad del contenido generado. Es solo
 * el objeto, sin personas, así que no reabre el problema de derechos de
 * imagen del punto 3. Proceso: recortado por José de fondo blanco y
 * rotado 90° a la izquierda;
 * aquí solo se recortó al contorno, se erosionó 1px el alfa (quita un halo
 * claro visible sobre el bisel oscuro) y se redujo a 640px de ancho.
 *
 * Medidas, en % del marco (maqueta aprobada: marco 580x440): top 48%,
 * voladizo izquierdo 22% (27% en mobile, donde las tarjetas quedan más
 * cerca del borde y con 22% la campana tapaba un título). Ancho 35% en
 * mobile (pantalla 4/3, misma proporción que la maqueta: el lazo cuelga
 * ~25% bajo el marco); en sm+ la pantalla es 16/10 -- más baja --, así
 * que se usa 29% para mantener ese mismo voladizo inferior en vez de ~40%. El contenedor reserva a la
 * izquierda el voladizo (pl-[76px] / sm:pl-[104px] >= voladizo, sin
 * desbordar el gutter de 16px ni invadir la columna de texto) y abajo el
 * lazo (pb-8 / sm:pb-10).
 *
 * Sin librerías nuevas ni animaciones -- todo Tailwind estático, mismas
 * clases de marca (brand-blue/brand-teal) ya usadas en el resto de la
 * landing.
 */
export function LandingHeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-xl pb-8 pl-[76px] sm:pb-10 sm:pl-[104px]">
      <div className="absolute -inset-6 rounded-[3rem] bg-linear-to-br from-brand-blue/20 to-brand-teal/20 blur-2xl" />

      <div className="relative rounded-2xl border-[10px] border-zinc-800 bg-zinc-800 shadow-2xl shadow-brand-blue/20">
        <Image
          src="/hero-estetoscopio.png"
          alt=""
          aria-hidden="true"
          width={640}
          height={1064}
          priority
          sizes="(min-width: 640px) 140px, 100px"
          className="pointer-events-none absolute left-[-27%] top-[48%] z-10 h-auto w-[35%] drop-shadow-[0_8px_12px_rgba(30,58,138,0.25)] sm:left-[-22%] sm:w-[29%]"
        />
        <div className="aspect-4/3 overflow-hidden rounded-lg bg-white p-3 sm:aspect-16/10 sm:p-5">
          <div className="mb-3 flex items-center gap-2 border-b border-zinc-100 pb-2.5 sm:mb-4 sm:pb-3">
            <Image src={CUIDO_LOGO_SRC} alt="" width={1254} height={1254} className="h-4 w-4 rounded sm:h-5 sm:w-5" />
            <span className="text-xs font-semibold text-brand-navy sm:text-sm">Cuido</span>
            <span className="ml-auto flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-200" />
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-200" />
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-200" />
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 sm:gap-3">
            {FEATURES.map(({ icon: Icon, title }) => (
              <div key={title} className="flex flex-col items-start gap-1 rounded-lg bg-brand-bg p-2 sm:gap-1.5 sm:p-3">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-linear-to-br from-brand-blue/15 to-brand-teal/15 text-brand-blue sm:h-6 sm:w-6">
                  <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                </span>
                <p className="text-[9px] font-medium leading-tight text-brand-navy sm:text-xs">{title}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mx-auto h-3 w-[88%] rounded-b-xl bg-linear-to-b from-zinc-600 to-zinc-700 sm:h-4" />
      <div className="mx-auto h-1.5 w-full rounded-b-md bg-zinc-800/90" />
    </div>
  );
}
