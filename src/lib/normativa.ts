/**
 * Directorio de Normas y Guías de Salud (/normativa) — contenido estático,
 * no una tabla de Supabase: son documentos oficiales del MSP/SNS, no datos
 * clínicos ni multi-tenant, y cambian con muy poca frecuencia.
 *
 * Fuente de cada entrada: los propios comentarios de las migraciones de
 * specialty_templates (supabase/migrations/), que ya documentan cada norma
 * con su cita exacta al construir la plantilla clínica correspondiente.
 * Los enlaces apuntan al repositorio institucional del MSP
 * (repositorio.msp.gob.do) -- NO se alojan los PDFs en este dominio, para
 * no asumir la responsabilidad de mantenerlos actualizados. Cada enlace de
 * abajo se verificó contra el título real de la página (no solo un
 * resultado de búsqueda) antes de publicarse aquí.
 *
 * Solo se listan especialidades con normativa dominicana ESPECÍFICA
 * verificada -- Anestesiología, por ejemplo, no está aquí porque su
 * plantilla se basa en buenas prácticas generales, no en un documento
 * oficial (ver 20260820175823_anestesiologia_buenas_practicas.sql).
 */
export type NormativaEntry = {
  title: string;
  issuer: string;
  year: string;
  specialties: string[];
  url: string | null;
  note?: string;
};

export const NORMATIVA: NormativaEntry[] = [
  {
    title: "Reglamento Técnico para la Gestión del Expediente Clínico",
    issuer: "Ministerio de Salud Pública y Asistencia Social (MISPAS)",
    year: "2023 (2ª edición)",
    specialties: ["Medicina Interna", "Cirugía General", "Ginecología y Obstetricia", "Gastroenterología", "Neumología (consulta general)"],
    url: "https://repositorio.msp.gob.do/handle/123456789/2310",
  },
  {
    title: "Protocolo de Evaluación, Detección y Atención Temprana de las Alteraciones en el Crecimiento y Desarrollo en los Niños y Niñas de 0 a 5 Años",
    issuer: "Ministerio de Salud Pública y Asistencia Social (MISPAS)",
    year: "2023",
    specialties: ["Pediatría"],
    url: "https://repositorio.msp.gob.do/handle/123456789/2326",
  },
  {
    title: "Protocolo de atención para el manejo de hipertensión arterial del adulto en condiciones de no emergencia",
    issuer: "Ministerio de Salud Pública (MSP), elaborado con la Sociedad Dominicana de Cardiología (SODOCARDIO)",
    year: "2019",
    specialties: ["Cardiología"],
    url: "https://repositorio.msp.gob.do/handle/123456789/1525",
  },
  {
    title: "Guía de Manejo de Enfermedad Renal Crónica (ERC) Estadios 1 al 3A para la Atención de la Población Mayor de 18 Años en el Primer Nivel de Atención",
    issuer: "Ministerio de Salud Pública (MSP), Resolución 0013-2023",
    year: "2023",
    specialties: ["Nefrología"],
    url: "https://repositorio.msp.gob.do/handle/123456789/2291",
  },
  {
    title: "Protocolo de Diagnóstico y Tratamiento de las Enfermedades Pulmonares Intersticiales (EPI) y Fibrosis Pulmonar Progresiva (FPP)",
    issuer: "Ministerio de Salud Pública y Asistencia Social (MISPAS)",
    year: "2025",
    specialties: ["Neumología (Enfermedad Pulmonar Intersticial)"],
    url: "https://repositorio.msp.gob.do/handle/123456789/2370",
  },
  {
    title: "Protocolo para la Detección y Atención de la Hipoacusia Neurosensorial",
    issuer: "Ministerio de Salud Pública y Asistencia Social (MISPAS)",
    year: "2023",
    specialties: ["Otorrinolaringología"],
    url: "https://repositorio.msp.gob.do/handle/123456789/2329",
  },
  {
    title: "Protocolo de Manejo de la Otitis Media Aguda",
    issuer: "Ministerio de Salud Pública y Asistencia Social (MISPAS)",
    year: "2024",
    specialties: ["Otorrinolaringología"],
    url: "https://repositorio.msp.gob.do/handle/123456789/2347",
  },
  {
    title: "Guía Nacional para la Atención de las Personas con Diabetes Mellitus",
    issuer: "Ministerio de Salud Pública (MSP), Programa Nacional de Prevención y Control de las Enfermedades Crónicas No Transmisibles",
    year: "2018",
    specialties: ["Endocrinología"],
    url: "https://repositorio.msp.gob.do/bitstream/handle/123456789/2266/9789945621501.pdf?sequence=1&isAllowed=y",
    // Nota de verificación (a diferencia de las demás entradas de este
    // archivo, esta NO se pudo re-verificar de forma independiente): el
    // usuario confirmó este enlace leyendo la bibliografía del propio PDF,
    // que se autocita con este título y año exactos. Al intentar
    // re-verificarlo (mismo método que el resto de esta lista -- ver
    // comentario de arriba), tanto curl como WebFetch fallaron con
    // ECONNRESET contra repositorio.msp.gob.do en el momento de esta
    // sesión -- incluyendo un handle que sí se había verificado
    // exitosamente antes (2310), lo que indica una caída/bloqueo temporal
    // del lado del servidor, no un problema del enlace en sí. Si el enlace
    // no resuelve al revisar esto, vale la pena reintentar más tarde antes
    // de sospechar del contenido.
  },
  {
    title: "Ley sobre Salud Mental No. 12-06",
    issuer: "Congreso Nacional de la República Dominicana",
    year: "2006",
    specialties: ["Salud Mental / Psicología"],
    url: "https://repositorio.msp.gob.do/handle/123456789/820",
    note: "El contenido clínico de esta especialidad se apoya en DSM-5-TR (estándar internacional); la Ley 12-06 aporta las obligaciones de registro (Art. 50, 57 y 58) que la plantilla incorpora.",
  },
];
