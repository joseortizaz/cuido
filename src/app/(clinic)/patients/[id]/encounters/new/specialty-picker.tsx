"use client";

import Link from "next/link";
import { useState } from "react";

type Template = { id: string; name: string };

/**
 * Si el médico tiene 1+ especialidades habituales marcadas (dentro de
 * las ya habilitadas por su admin -- ver page.tsx), se muestran SOLO
 * esas por defecto, con un enlace siempre visible para expandir el
 * resto. Nunca oculta por completo el acceso a otra especialidad no
 * marcada (mecanismo 1, no restrictivo) -- solo cambia qué se ve
 * primero. Si no tiene ninguna preferida todavía, se muestra la lista
 * completa de una vez, sin sección vacía artificial.
 */
export function SpecialtyPicker({
  patientId,
  templates,
  preferredTemplates,
  hasPreferred,
}: {
  patientId: string;
  templates: Template[];
  preferredTemplates: Template[];
  hasPreferred: boolean;
}) {
  const [showAll, setShowAll] = useState(!hasPreferred);
  const visibleTemplates = showAll ? templates : preferredTemplates;
  const hiddenCount = templates.length - preferredTemplates.length;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {visibleTemplates.map((template) => (
          <li key={template.id}>
            <Link
              href={`/patients/${patientId}/encounters/new/${template.id}`}
              className="flex items-center justify-between py-3 text-sm hover:underline"
            >
              {template.name}
            </Link>
          </li>
        ))}
      </ul>
      {hasPreferred && !showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start text-sm text-brand-blue hover:underline"
        >
          Ver todas las especialidades ({hiddenCount} más)
        </button>
      )}
    </div>
  );
}
