import Link from "next/link";
import { ENCOUNTER_TYPES, ENCOUNTER_TYPE_HINTS, ENCOUNTER_TYPE_LABELS } from "@/lib/domain/encounter-types";

/** Segundo paso del flujo (especialidad → tipo → formulario): qué tipo de consulta es. */
export function EncounterTypeChooser({
  patientId,
  templateId,
  appointmentId,
}: {
  patientId: string;
  templateId: string;
  appointmentId: string | null;
}) {
  return (
    <ul className="flex w-full max-w-lg flex-col divide-y divide-panel-border">
      {ENCOUNTER_TYPES.map((type) => {
        const href = `/patients/${patientId}/encounters/new/${templateId}?tipo=${type}${
          appointmentId ? `&appointmentId=${appointmentId}` : ""
        }`;
        return (
          <li key={type}>
            <Link href={href} className="flex flex-col gap-0.5 py-3 hover:underline">
              <span className="text-sm font-medium">{ENCOUNTER_TYPE_LABELS[type]}</span>
              <span className="text-xs text-zinc-500">{ENCOUNTER_TYPE_HINTS[type]}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
