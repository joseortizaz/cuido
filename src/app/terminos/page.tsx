import type { Metadata } from "next";
import { poppins } from "@/app/_landing/fonts";
import { LandingHeader } from "@/app/_landing/header";
import { LandingFooter } from "@/app/_landing/footer";
import { CONTACT_EMAIL } from "@/app/_landing/constants";
import { DELETION_WARNING_TEXT } from "@/lib/domain/data-deletion";

export const metadata: Metadata = {
  title: "Términos y Condiciones de Servicio — Cuido",
  description:
    "Términos y condiciones de servicio de Cuido: período de prueba, suscripción, solo lectura, bloqueo y cancelación, exportación y eliminación de datos.",
};

/**
 * Términos y Condiciones de Servicio -- versión 4, revisada y aprobada por
 * José (y su asesor legal) el 7 de octubre de 2026. El texto reproduce la
 * sección «Texto propuesto» del borrador v4 sin cambios de fondo.
 *
 * Los plazos de cada cláusula describen lo que el sistema hace de verdad
 * (supabase/migrations/20261009100000_*, 20261010100000_*, 20261011100000_*).
 * Si se cambia una regla del sistema, hay que cambiar también esta página
 * (y viceversa). El texto de la advertencia de 9.5 sale de la misma fuente que
 * la aplicación: src/lib/domain/data-deletion.ts.
 */
const H2 = "text-lg font-semibold text-brand-navy";

export default function TerminosPage() {
  return (
    <div className={`${poppins.variable} flex min-h-full flex-col bg-brand-bg font-[family-name:var(--font-poppins)]`}>
      <LandingHeader />
      <main className="flex-1 px-4 pb-20 pt-32 sm:pt-40">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold text-brand-navy sm:text-4xl">Términos y Condiciones de Servicio</h1>
          <p className="mt-3 text-sm text-zinc-500">
            Versión 4 · Vigente desde el 7 de octubre de 2026 · Narnia Tech Solution, SRL (RNC 1-33-74485-6)
          </p>

          <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed text-zinc-700 sm:text-base">
            <section>
              <h2 className={H2}>1. Definiciones</h2>
              <ul className="mt-2 flex list-disc flex-col gap-2 pl-5">
                <li>
                  <strong className="text-brand-navy">Cuido</strong>: la plataforma de gestión clínica operada por
                  Narnia Tech Solution, SRL (RNC 1-33-74485-6), en adelante «Narnia».
                </li>
                <li>
                  <strong className="text-brand-navy">Clínica</strong>: la entidad que contrata Cuido.{" "}
                  <strong className="text-brand-navy">Administrador</strong>: el usuario con rol de administrador de
                  la Clínica.
                </li>
                <li>
                  <strong className="text-brand-navy">Plan</strong>: la suscripción contratada por la Clínica, por un
                  periodo de 30, 90, 180 o 365 días.
                </li>
                <li>
                  <strong className="text-brand-navy">Vencimiento</strong>: el último día en que el Plan o el
                  Período de Prueba está vigente. El propio día de vencimiento todavía es válido.
                </li>
                <li>
                  <strong className="text-brand-navy">Período de Gracia</strong>,{" "}
                  <strong className="text-brand-navy">Modo Solo Lectura</strong>,{" "}
                  <strong className="text-brand-navy">Bloqueo Total</strong>,{" "}
                  <strong className="text-brand-navy">Cancelación</strong> y{" "}
                  <strong className="text-brand-navy">Período de Conservación</strong> se definen en las secciones
                  5, 6, 7 y 9.
                </li>
                <li>
                  Todas las fechas y plazos se cuentan por días calendario en hora de la República Dominicana
                  (America/Santo_Domingo).
                </li>
              </ul>
            </section>

            <section>
              <h2 className={H2}>2. Período de prueba</h2>
              <p className="mt-2">
                Toda Clínica nueva recibe un <strong>período de prueba gratuito de catorce (14) días</strong>,
                contado desde su fecha de registro e incluido el decimocuarto día, con acceso a todas las funciones
                de Cuido. La prueba aplica a todas las Clínicas por igual, cualquiera sea su modelo de contratación,
                y no requiere método de pago. Narnia puede extenderla por escrito para una Clínica determinada; una
                extensión no crea derecho a extensiones futuras.
              </p>
            </section>

            <section>
              <h2 className={H2}>3. Planes, precio, pagos y renovación</h2>
              <p className="mt-2">
                <strong>3.1</strong> El precio y las condiciones del Plan se acuerdan con Narnia.
              </p>
              <p className="mt-2">
                <strong>3.2</strong> Al registrarse un pago, la vigencia avanza así: el nuevo Vencimiento es el
                Vencimiento anterior más el periodo del Plan (pagar tarde no otorga días adicionales). Si al momento
                del pago la Clínica ya había pasado el Período de Gracia, el periodo se cuenta desde la fecha del
                pago.
              </p>
              <p className="mt-2">
                <strong>3.3</strong> Los pagos se acuerdan, reciben y confirman directamente con Narnia, que los
                registra en la plataforma. El Administrador puede consultar el historial de pagos de su Clínica en su
                panel.
              </p>
            </section>

            <section>
              <h2 className={H2}>4. Avisos de renovación</h2>
              <p className="mt-2">
                El Administrador verá en su panel un aviso de renovación durante los últimos 5 días de un Plan de 30
                días, 15 días de uno de 90 días, y 30 días de uno de 180 o 365 días. El resto del equipo ve
                únicamente el estado y los días restantes, nunca montos. Los avisos se muestran dentro de la
                aplicación; no se envían por correo ni por otro medio.
              </p>
            </section>

            <section>
              <h2 className={H2}>5. Período de gracia</h2>
              <p className="mt-2">
                Vencida la prueba o el Plan, la Clínica dispone de <strong>treinta (30) días calendario de gracia</strong>{" "}
                durante los cuales Cuido sigue funcionando con normalidad. Todo el equipo verá un aviso permanente con
                los días restantes y el contacto de Narnia.
              </p>
            </section>

            <section>
              <h2 className={H2}>6. Modo solo lectura</h2>
              <p className="mt-2">
                <strong>6.1</strong> <strong>Desde el día 31 posterior al Vencimiento</strong>, la Clínica pasa a Modo
                Solo Lectura. En ese modo <strong>se puede consultar</strong> toda la información de la Clínica y{" "}
                <strong>el Administrador puede exportarla</strong> (sección 9.2). Todo el equipo verá el aviso con los
                días que faltan para el Bloqueo Total.
              </p>
              <p className="mt-2">
                <strong>6.2</strong> En Modo Solo Lectura <strong>no se puede crear ni modificar nada</strong>. En
                particular, no se pueden: registrar pacientes, consultas, alergias o medicamentos; agendar o cambiar
                citas; firmar ni revocar consentimientos informados; invitar o modificar miembros del equipo; ni
                importar datos.
              </p>
              <p className="mt-2">
                <strong>6.3</strong> <strong>Comprobantes fiscales (e-CF).</strong> Mientras la Clínica esté en Modo
                Solo Lectura, <strong>Cuido no puede emitir ni anular comprobantes fiscales electrónicos</strong>. La
                obligación de emitirlos (Ley 32-23) es de la Clínica, que deberá cumplirla por otro medio hasta
                reactivar su Plan.
              </p>
              <p className="mt-2">
                <strong>6.4</strong> Mientras la Clínica esté en Modo Solo Lectura, Cuido no enviará mensajes a los
                pacientes (por ejemplo, recordatorios de citas por WhatsApp).
              </p>
            </section>

            <section>
              <h2 className={H2}>7. Bloqueo total y cancelación</h2>
              <p className="mt-2">
                <strong>7.1</strong> Si la Clínica permanece <strong>noventa (90) días en Modo Solo Lectura</strong>{" "}
                sin renovar, es decir, al cumplirse <strong>121 días desde el Vencimiento</strong>, ocurren a la vez
                dos cosas: <strong>(a)</strong> su acceso a Cuido se <strong>bloquea por completo</strong> (Bloqueo
                Total) y <strong>(b)</strong> su suscripción queda <strong>cancelada</strong> (Cancelación). Se aplica
                de forma automática por la plataforma. La Cancelación no genera cargo alguno.
              </p>
              <p className="mt-2">
                <strong>7.2</strong> <strong>Acuerdo.</strong> Antes de que ocurra, Narnia y la Clínica pueden pactar
                un acuerdo que <strong>difiera el Bloqueo Total hasta una fecha determinada</strong>. Mientras el
                acuerdo esté vigente, la Clínica permanece en Modo Solo Lectura y puede exportar su información. Al
                vencer la fecha pactada, el Bloqueo Total y la Cancelación se aplican sin más trámite. Un pago
                registrado da por cerrado el acuerdo.
              </p>
              <p className="mt-2">
                <strong>7.3</strong> <strong>Durante el Bloqueo Total</strong> no se puede consultar ni exportar
                información, salvo el acceso temporal de descarga que Narnia pueda habilitar conforme a la sección
                7.2 o a la sección 9.4.
              </p>
              <p className="mt-2">
                <strong>7.4</strong> <strong>Desde la Cancelación</strong> comienza el Período de Conservación de la
                sección 9.3.
              </p>
            </section>

            <section>
              <h2 className={H2}>8. Reactivación</h2>
              <p className="mt-2">
                La Clínica en Gracia, Modo Solo Lectura o Bloqueo Total se reactiva <strong>de inmediato</strong>{" "}
                cuando Narnia registra el pago de <strong>la última factura pendiente</strong>.{" "}
                <strong>No hay cargo adicional por reactivar.</strong> Si la Clínica ya había pasado el Período de
                Gracia, el nuevo periodo se cuenta desde la fecha del pago (sección 3.2). Una Clínica con la
                suscripción cancelada puede reactivarse mientras sus datos no hayan sido eliminados conforme a la
                sección 9.
              </p>
            </section>

            <section>
              <h2 className={H2}>9. Sus datos</h2>
              <p className="mt-2">
                <strong>9.1</strong> <strong>Responsabilidad.</strong> La Clínica es la responsable del tratamiento de
                los datos de sus pacientes conforme a la Ley No. 172-13; Narnia es el proveedor de la plataforma.
              </p>
              <p className="mt-2">
                <strong>9.2</strong> <strong>Exportación.</strong> El Administrador puede exportar en cualquier
                momento, <strong>incluso en Modo Solo Lectura</strong>, en hojas de cálculo (.xlsx) o archivos CSV:
                pacientes (con sus alergias y medicamentos), consultas de cada especialidad, citas, consentimientos
                firmados, comprobantes fiscales y sus líneas, reclamaciones a aseguradoras, seguros de los pacientes y
                verificaciones de elegibilidad; y un <strong>libro completo</strong> que reúne todo. Las consultas de
                Salud Mental solo se incluyen para quien tenga acceso a ellas según los controles de acceso de la
                plataforma. Se recomienda exportar la información antes del Bloqueo Total.
              </p>
              <p className="mt-2">
                <strong>9.3</strong> <strong>Conservación por inactividad.</strong> Si la Clínica{" "}
                <strong>no solicita la eliminación</strong> de sus datos pero queda inactiva por falta de pago, Narnia{" "}
                <strong>conservará sus datos durante dos (2) años</strong> contados desde la Cancelación (el{" "}
                <strong>Período de Conservación</strong>).{" "}
                <strong>La Clínica acepta expresamente este plazo desde su registro.</strong> Durante ese periodo la
                Clínica puede reactivarse conforme a la sección 8. Terminado el Período de Conservación,{" "}
                <strong>Narnia podrá eliminar los datos mediante una acción expresa</strong>; la eliminación nunca
                ocurre de forma automática ni se anuncia como inmediata. Se aplican las mismas reglas de las
                secciones 9.5 y 9.6. La falta de pago no causa por sí sola el borrado de los datos.
              </p>

              <p className="mt-2">
                <strong>9.4</strong> <strong>Eliminación a solicitud.</strong>
              </p>
              <ul className="mt-2 flex flex-col gap-2 pl-5">
                <li>
                  <strong>a) Quién puede solicitarla.</strong> El Administrador de la Clínica, o su representante
                  legal (la «persona competente»). Los pacientes dirigen su solicitud a la Clínica, que es la
                  responsable del tratamiento.
                </li>
                <li>
                  <strong>b) Cómo.</strong> Dentro de la aplicación, el Administrador acepta la advertencia de la
                  sección 9.5 y registra la solicitud. Si la Clínica no puede entrar a la aplicación (por ejemplo,
                  por Bloqueo Total), la solicita por correo a{" "}
                  <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-brand-blue hover:underline">
                    {CONTACT_EMAIL}
                  </a>
                  ; Narnia verifica la identidad de quien solicita, le envía la advertencia por escrito y puede
                  habilitar una descarga temporal de su información.
                </li>
                <li>
                  <strong>c) Condiciones y plazo.</strong> Los datos se eliminan{" "}
                  <strong>treinta (30) días después</strong> de que se hayan cumplido las dos condiciones:{" "}
                  <strong>(i)</strong> que la solicitud haya sido realizada por la persona competente y{" "}
                  <strong>(ii)</strong> que la información de la Clínica haya sido descargada. La descarga se acredita
                  porque la plataforma registra la descarga del libro completo, realizada{" "}
                  <strong>después de la solicitud</strong>, y el Administrador confirma haberla verificado; los 30
                  días cuentan desde esa confirmación.
                </li>
                <li>
                  <strong>d) Desistimiento.</strong> Hasta que la eliminación se ejecute, la Clínica mantiene su
                  acceso y puede desistir de la solicitud.
                </li>
                <li>
                  <strong>e) Ejecución.</strong> La ejecuta Narnia de forma expresa, nunca automática.
                </li>
              </ul>

              <p className="mt-3">
                <strong>9.5</strong> <strong>Advertencia de irreversibilidad y liberación.</strong> Antes de registrar
                la solicitud, el Administrador debe aceptar el siguiente texto, que queda guardado con la fecha y el
                usuario que lo aceptó:
              </p>
              <blockquote className="mt-3 rounded-xl border-l-4 border-brand-blue bg-white px-4 py-3 text-zinc-700">
                {DELETION_WARNING_TEXT}
              </blockquote>
              <p className="mt-3">
                <strong>Qué se elimina y qué se conserva.</strong> Se elimina todo lo que la Clínica registró
                (pacientes, expedientes y consultas, citas, consentimientos, reclamaciones, seguros, mensajes y el
                equipo) y las cuentas de los usuarios que no pertenezcan a otra Clínica. Los <strong>e-CF</strong> se
                conservan <strong>archivados durante cinco (5) años</strong>, únicamente con sus datos fiscales
                (número de comprobante, fechas, montos, ITBIS, líneas, nombre y RNC o cédula del comprador, y XML
                firmado), <strong>sin vínculo con el paciente, la consulta ni el expediente</strong>, y sin acceso para
                ningún usuario de las Clínicas. Narnia conserva además una <strong>constancia</strong> de la
                eliminación (quién la solicitó, cuándo se ejecutó y cuántos registros se eliminaron, sin su
                contenido) y los registros contables de los pagos.
              </p>

              <p className="mt-3">
                <strong>9.6</strong> <strong>Copias de seguridad.</strong> Ejecutada la eliminación, los datos
                desaparecen también de las copias de seguridad del proveedor de infraestructura en un plazo de entre 0
                y 24 horas. Narnia no restaura copias para recuperar datos eliminados.
              </p>
              <p className="mt-3">
                Más información, en la{" "}
                <a href="/eliminacion-datos" className="font-medium text-brand-blue hover:underline">
                  Política de Eliminación de Datos
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className={H2}>10. Cupos de médicos</h2>
              <p className="mt-2">
                <strong>10.1</strong> Algunos Planes incluyen un número determinado de médicos.{" "}
                <strong>
                  Cada usuario con rol de Médico, y cada Administrador que atienda pacientes, ocupa un cupo.
                </strong>{" "}
                El personal de recepción y los administradores que no atienden pacientes no ocupan cupo.
              </p>
              <p className="mt-2">
                <strong>10.2</strong>{" "}
                <strong>
                  Narnia determina, al contratar y al modificar el Plan, qué Administradores atienden pacientes
                </strong>{" "}
                y, por tanto, ocupan cupo. El Administrador no puede cambiar esta condición por sí mismo. Un médico
                independiente que sea su propio administrador atiende pacientes y ocupa un cupo.
              </p>
              <p className="mt-2">
                <strong>10.3</strong> Agregar un médico (o un administrador que atienda pacientes) por encima del
                cupo incluido requiere ampliar el Plan y pagar el médico adicional. Hasta que Narnia amplíe el cupo,
                Cuido no permitirá agregarlo ni cambiar el rol de un usuario a uno que ocupe cupo.
              </p>
            </section>

            <section>
              <h2 className={H2}>11. Exenciones</h2>
              <p className="mt-2">
                Narnia puede, por acuerdo especial (clínicas piloto, demostraciones u otros convenios), eximir a una
                Clínica de las reglas de prueba y vencimiento. La exención se registra y puede retirarse con aviso; no
                genera derechos adquiridos.
              </p>
            </section>

            <section>
              <h2 className={H2}>12. Suspensión</h2>
              <p className="mt-2">
                Aparte del Modo Solo Lectura y del Bloqueo Total por falta de renovación (sección 7), Narnia puede
                suspender el acceso de una Clínica por uso indebido de la plataforma o incumplimiento grave de estos
                términos, previo aviso. La suspensión bloquea también la consulta.
              </p>
            </section>

            <section>
              <h2 className={H2}>13. Contacto</h2>
              <p className="mt-2">
                Narnia Tech Solution, SRL —{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-brand-blue hover:underline">
                  {CONTACT_EMAIL}
                </a>{" "}
                — WhatsApp 829-374-8878.
              </p>
            </section>

            <section>
              <h2 className={H2}>14. Cambios a estos términos</h2>
              <p className="mt-2">
                Narnia puede actualizar estos términos; los cambios que afecten a una Clínica se le notificarán con
                anticipación razonable.
              </p>
            </section>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
