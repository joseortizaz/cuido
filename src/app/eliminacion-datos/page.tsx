import { poppins } from "@/app/_landing/fonts";
import { LandingHeader } from "@/app/_landing/header";
import { LandingFooter } from "@/app/_landing/footer";
import { CONTACT_EMAIL } from "@/app/_landing/constants";
import {
  DELETION_WAIT_DAYS,
  DELETION_WARNING_TEXT,
  FISCAL_ARCHIVE_YEARS,
  RETENTION_YEARS,
} from "@/lib/domain/data-deletion";

/**
 * Política de Eliminación de Datos -- requisito estándar de Meta for
 * Developers para apps que se conectan a su plataforma (WhatsApp
 * Business API), además de la regla de la propia plataforma.
 *
 * Describe el proceso REAL: la solicitud dentro de la aplicación (o por
 * correo para clínicas bloqueadas), las dos condiciones y la espera de 30
 * días, la advertencia de irreversibilidad, el archivo fiscal de 5 años y la
 * conservación de 2 años por inactividad. Los plazos y el texto de la
 * advertencia salen de src/lib/domain/data-deletion.ts, la misma fuente que
 * usa la aplicación: si cambian allí, cambian aquí.
 */
export default function EliminacionDatosPage() {
  return (
    <div className={`${poppins.variable} flex min-h-full flex-col bg-brand-bg font-[family-name:var(--font-poppins)]`}>
      <LandingHeader />
      <main className="flex-1 px-4 pb-20 pt-32 sm:pt-40">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold text-brand-navy sm:text-4xl">Política de Eliminación de Datos</h1>
          <p className="mt-3 text-sm text-zinc-500">Última actualización: 7 de octubre de 2026.</p>

          <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed text-zinc-700 sm:text-base">
            <section>
              <h2 className="text-lg font-semibold text-brand-navy">1. Quién puede solicitar la eliminación</h2>
              <p className="mt-2">
                Es importante distinguir tres casos, porque legalmente no son lo mismo:
              </p>
              <ul className="mt-2 flex flex-col gap-3">
                <li>
                  <strong className="text-brand-navy">Los datos de una clínica</strong>: los solicita el{" "}
                  <strong>administrador de la clínica</strong> (o su representante legal). Narnia Tech Solution,
                  SRL es el proveedor de la plataforma técnica; la clínica es la responsable del tratamiento de los
                  datos de sus pacientes, conforme a la Ley 172-13 y a la normativa del expediente clínico.
                </li>
                <li>
                  <strong className="text-brand-navy">Tu propia cuenta de usuario</strong> (personal de una
                  clínica que usa Cuido): puedes solicitar la eliminación de tu cuenta y datos de acceso
                  directamente a Narnia Tech Solution.
                </li>
                <li>
                  <strong className="text-brand-navy">Datos de un paciente dentro de una clínica</strong>: NO se
                  solicitan a Narnia Tech Solution. Si eres paciente y quieres que se eliminen tus datos, la
                  solicitud debe dirigirse a la clínica donde recibiste atención, que decide sobre ellos.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">2. Cómo solicitarla (clínicas)</h2>
              <p className="mt-2">El administrador de la clínica lo hace dentro de la aplicación, en tres pasos:</p>
              <ol className="mt-2 list-decimal pl-5">
                <li>Lee y acepta la advertencia de la sección 4 y registra la solicitud.</li>
                <li>
                  Descarga el <strong>libro completo</strong> de su clínica (pacientes, consultas, citas,
                  consentimientos, comprobantes fiscales, reclamaciones y seguros) y confirma que lo verificó. El
                  sistema registra la descarga.
                </li>
                <li>
                  Cumplidas esas dos condiciones, comienza el plazo de la sección 3. Mientras tanto la clínica
                  sigue trabajando con normalidad y puede <strong>desistir</strong> en cualquier momento antes de
                  que la eliminación se ejecute.
                </li>
              </ol>
              <p className="mt-3">
                Si la clínica ya no puede entrar a la aplicación (por ejemplo, porque su acceso está bloqueado),
                puede pedirlo por correo a{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-brand-blue hover:underline">
                  {CONTACT_EMAIL}
                </a>
                , indicando su nombre completo, el nombre de la clínica y su rol, para que podamos verificar que
                quien solicita tiene derecho a hacerlo antes de continuar. Le enviaremos la advertencia por escrito
                y le habilitaremos de forma temporal la descarga de su información.
              </p>
              <p className="mt-3">
                Para eliminar <strong>solo tu cuenta de usuario</strong>, escribe al mismo correo con tu nombre
                completo, el correo asociado a tu cuenta y, si aplica, tu rol dentro de la clínica. Atenderemos la
                solicitud en un plazo no mayor a {DELETION_WAIT_DAYS} días desde que verifiquemos tu identidad.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">3. Plazo</h2>
              <p className="mt-2">
                Los datos de la clínica se eliminan de nuestros registros{" "}
                <strong>{DELETION_WAIT_DAYS} días después</strong> de que se hayan cumplido las dos condiciones:
                que la solicitud haya sido realizada por la persona competente y que la información de la clínica
                haya sido descargada. La eliminación la ejecuta Narnia Tech Solution de forma expresa; nunca ocurre
                de manera automática.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">4. Advertencia: la eliminación es irreversible</h2>
              <p className="mt-2">
                Antes de registrar la solicitud, el administrador debe aceptar el siguiente texto, que se conserva
                como constancia junto con la fecha y el usuario que lo aceptó:
              </p>
              <blockquote className="mt-3 rounded-xl border-l-4 border-brand-blue bg-white px-4 py-3 text-zinc-700">
                {DELETION_WARNING_TEXT}
              </blockquote>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">5. Qué se elimina y qué se conserva</h2>
              <p className="mt-2">
                Se elimina todo lo que la clínica registró en Cuido: pacientes, expedientes y consultas, citas,
                consentimientos firmados, reclamaciones, seguros, mensajes y la cuenta de los usuarios que no
                pertenezcan a otra clínica.
              </p>
              <p className="mt-3">
                Hay una excepción por obligación legal: los{" "}
                <strong className="text-brand-navy">documentos fiscales electrónicos (e-CF)</strong> emitidos para
                cumplir con la DGII se conservan archivados durante <strong>{FISCAL_ARCHIVE_YEARS} años</strong>.
                Se archivan únicamente sus datos fiscales (número de comprobante, fechas, montos, ITBIS, líneas, el
                nombre y RNC o cédula del comprador, y el XML firmado) y{" "}
                <strong>se corta todo vínculo con el paciente, la consulta o el expediente clínico</strong>. Ese
                archivo no es accesible para ningún usuario de las clínicas.
              </p>
              <p className="mt-3">
                Narnia Tech Solution conserva además una constancia de cada eliminación (quién la solicitó, cuándo
                se ejecutó y cuántos registros se eliminaron, sin su contenido) y los registros contables de los
                pagos de la suscripción.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">
                6. Clínicas inactivas por falta de pago
              </h2>
              <p className="mt-2">
                Si la clínica no solicita la eliminación pero queda inactiva por falta de pago, sus datos{" "}
                <strong>no se borran</strong>. Tras el vencimiento hay 30 días de gracia y luego el modo solo lectura
                (se puede consultar y exportar, pero no modificar). Si la clínica permanece 90 días en solo lectura
                sin renovar (121 días después del vencimiento), su acceso se bloquea y, a la vez, su suscripción se
                cancela. Narnia Tech Solution y la clínica pueden pactar antes un acuerdo que difiera el bloqueo
                hasta una fecha determinada; mientras dure, la clínica sigue en solo lectura y puede exportar. Desde
                la cancelación, Narnia conserva los datos durante <strong>{RETENTION_YEARS} años</strong>, y la
                clínica puede reactivarse en ese tiempo regularizando su pago. Al terminar ese periodo, Narnia Tech
                Solution podrá eliminar los datos mediante una acción expresa: nunca ocurre de forma automática ni
                inmediata, y se aplican las mismas reglas de las secciones 4 y 5. La clínica puede pedir su
                eliminación anticipada en cualquier momento, como se explica arriba.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">7. Copias de seguridad</h2>
              <p className="mt-2">
                Una vez ejecutada la eliminación, los datos desaparecen también de las copias de seguridad de
                nuestro proveedor de infraestructura (Supabase) en un plazo de entre 0 y 24 horas. No restauramos
                copias para recuperar datos que fueron eliminados.
              </p>
            </section>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
