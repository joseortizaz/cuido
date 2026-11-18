import Link from "next/link";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";

/**
 * Pantalla para quien intenta registrar una consulta de un paciente cuyo expediente aún no está abierto.
 * La barrera real es el trigger require_open_patient_record de la base de datos; esto solo explica y guía.
 */
export function RecordRequired({ patientId, patientName }: { patientId: string; patientName: string }) {
  return (
    <>
      <PageHeader title="Primero abre el expediente" back={{ href: `/patients/${patientId}`, label: patientName }} />
      <PageBody narrow>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {patientName} todavía no tiene el expediente abierto. Para registrar consultas, un médico debe abrirlo antes con
          la historia general del paciente.
        </p>
        <div>
          <Link
            href={`/patients/${patientId}/expediente/abrir`}
            className="inline-block rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Abrir Expediente
          </Link>
        </div>
      </PageBody>
    </>
  );
}
