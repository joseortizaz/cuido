/**
 * Signos vitales de una consulta (tabla vital_signs): columna -> etiqueta. El
 * orden del objeto es el orden de presentación (detalle de la consulta y
 * exportación de consultas).
 */
export const VITAL_LABELS: Record<string, string> = {
  systolic_bp: "PA sistólica",
  diastolic_bp: "PA diastólica",
  heart_rate: "FC (lpm)",
  respiratory_rate: "FR (rpm)",
  temperature_celsius: "Temp (°C)",
  oxygen_saturation: "SatO₂ (%)",
  weight_kg: "Peso (kg)",
  height_cm: "Talla (cm)",
};

export const VITAL_KEYS = Object.keys(VITAL_LABELS);
