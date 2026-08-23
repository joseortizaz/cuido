import { poppins } from "@/app/_landing/fonts";
import { LandingHeader } from "@/app/_landing/header";
import { LandingFooter } from "@/app/_landing/footer";
import { LegalNotice } from "@/app/_landing/legal-notice";
import { CONTACT_EMAIL } from "@/app/_landing/constants";

/**
 * Política de Eliminación de Datos -- requisito estándar de Meta for
 * Developers para apps que se conectan a su plataforma (WhatsApp
 * Business API), no solo buena práctica. Primera versión real: describe
 * el proceso MANUAL que existe hoy (no hay flujo de autoservicio
 * automatizado todavía) y es honesta sobre que el plazo de respuesta es
 * un compromiso nuevo, no uno ya probado.
 */
export default function EliminacionDatosPage() {
  return (
    <div className={`${poppins.variable} flex min-h-full flex-col bg-brand-bg font-[family-name:var(--font-poppins)]`}>
      <LandingHeader />
      <main className="flex-1 px-4 pb-20 pt-32 sm:pt-40">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold text-brand-navy sm:text-4xl">Política de Eliminación de Datos</h1>
          <LegalNotice lastUpdated="23 de agosto de 2026" />

          <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed text-zinc-700 sm:text-base">
            <section>
              <h2 className="text-lg font-semibold text-brand-navy">1. Quién puede solicitar la eliminación</h2>
              <p className="mt-2">
                Es importante distinguir dos casos, porque legalmente no son lo mismo:
              </p>
              <ul className="mt-2 flex flex-col gap-3">
                <li>
                  <strong className="text-brand-navy">Tu propia cuenta de usuario</strong> (personal
                  de una clínica que usa Cuido): puedes solicitar la eliminación de tu cuenta y datos
                  de acceso directamente a Narnia Tech Solution.
                </li>
                <li>
                  <strong className="text-brand-navy">Datos de pacientes dentro de una clínica</strong>
                  : estos NO pueden solicitarse directamente por el paciente a Narnia Tech Solution.
                  Narnia Tech es el proveedor de la plataforma técnica; la <strong>clínica</strong>{" "}
                  es el responsable del tratamiento de los datos de sus propios pacientes (el
                  expediente clínico, los consentimientos firmados, etc.) y quien decide sobre esos
                  datos, conforme a la Ley 172-13 y a la normativa del expediente clínico. Si eres
                  paciente y quieres que se eliminen tus datos, la solicitud debe dirigirse a la
                  clínica donde recibiste atención. Si eres la clínica, puedes solicitarlo a Narnia
                  Tech siguiendo el proceso de la sección 2.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">2. Cómo solicitarlo</h2>
              <p className="mt-2">
                Hoy no existe un flujo automatizado de autoservicio para eliminar datos -- el
                proceso es manual. Escribe a{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-brand-blue hover:underline">
                  {CONTACT_EMAIL}
                </a>{" "}
                solicitando la eliminación, incluyendo:
              </p>
              <ul className="mt-2 list-disc pl-5">
                <li>Tu nombre completo.</li>
                <li>
                  El correo asociado a tu cuenta, o el nombre de la clínica (si la solicitud es de
                  una clínica).
                </li>
                <li>
                  Si aplica, tu rol dentro de la clínica -- necesario para verificar que quien
                  solicita tiene derecho a hacerlo antes de eliminar cualquier dato.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">3. Plazo de respuesta</h2>
              <p className="mt-2">
                Todavía no tenemos un compromiso formal de plazo probado en producción -- lo
                establecemos aquí como un compromiso nuevo: procesaremos las solicitudes en un
                plazo razonable, no mayor a 30 días desde que verificamos la identidad de quien
                solicita.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">4. Excepciones</h2>
              <p className="mt-2">
                Algunos datos deben conservarse aunque se solicite su eliminación, cuando existe una
                obligación legal de conservarlos. El ejemplo principal hoy son los{" "}
                <strong className="text-brand-navy">documentos fiscales electrónicos (e-CF)</strong>{" "}
                generados para cumplir con la DGII: tienen requisitos de conservación bajo la
                normativa tributaria dominicana y no se eliminan aunque se elimine el resto de la
                cuenta o clínica.
              </p>
            </section>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
