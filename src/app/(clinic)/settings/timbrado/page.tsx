import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { PrescriptionSheet, type SheetData } from "@/app/(clinic)/patients/[id]/prescriptions/prescription-sheet";
import { LetterheadForm } from "./letterhead-form";

/**
 * Timbrado de la clínica (solo admin): nombre, dirección, teléfonos, correo, RNC opcional y logo que salen en el
 * encabezado de las recetas. Si el médico trabaja de forma independiente, el timbrado es el suyo. Las recetas ya
 * emitidas conservan el timbrado con que se emitieron; esto solo afecta a las nuevas.
 */
export default async function LetterheadSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/dashboard");
  const readOnly = await isClinicReadOnly();

  const [{ data: letterhead }, { data: clinic }] = await Promise.all([
    supabase.from("clinic_letterhead").select("*").eq("clinic_id", membership.clinicId).maybeSingle(),
    supabase.from("clinics").select("name").eq("id", membership.clinicId).maybeSingle(),
  ]);

  let logoUrl: string | null = null;
  if (letterhead?.logo_path) {
    const { data } = await supabase.storage.from("clinic-letterhead").createSignedUrl(letterhead.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }

  const preview: SheetData | null = letterhead
    ? {
        number: 1,
        issuedAt: new Date().toISOString(),
        providerName: "Dr. Nombre Apellido",
        providerTitle: "Especialidad",
        providerExequatur: "000-00",
        letterhead: {
          name: letterhead.name,
          address: letterhead.address,
          phones: letterhead.phones,
          email: letterhead.email,
          rnc: letterhead.rnc,
          logo_path: letterhead.logo_path,
        },
        logoUrl,
        patient: { name: "Paciente de Ejemplo", date_of_birth: "1980-01-01", record_number: "EJEMPLO" },
        items: [{ medication: "Medicamento de ejemplo 500 mg", dose: "1 tableta", route: "oral", frequency: "cada 8 horas", duration: "5 días", quantity: null, instructions: null }],
        notes: null,
        isCopy: false,
      }
    : null;

  return (
    <>
      <PageHeader
        title="Timbrado de recetas"
        subtitle="Encabezado que se imprime en cada receta. Las recetas ya emitidas no cambian."
        back={{ href: "/dashboard", label: "Dashboard" }}
      />
      <PageBody>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <LetterheadForm
            disabled={readOnly}
            hasLetterhead={Boolean(letterhead)}
            hasLogo={Boolean(letterhead?.logo_path)}
            initial={{
              name: letterhead?.name ?? clinic?.name ?? "",
              address: letterhead?.address ?? "",
              phones: letterhead?.phones ?? "",
              email: letterhead?.email ?? "",
              rnc: letterhead?.rnc ?? "",
            }}
          />
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Vista previa (A6)</h2>
            {preview ? (
              <div className="rx-root" style={{ borderRadius: 8, padding: 12 }}>
                <PrescriptionSheet data={preview} format="a6" embedded />
              </div>
            ) : (
              <p className="max-w-xs text-sm text-zinc-500">Guarda los datos para ver cómo quedará el encabezado.</p>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}
