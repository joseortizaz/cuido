import { Poppins } from "next/font/google";

/**
 * Sans-serif redondeada para la landing pública únicamente — el resto de
 * la app (pantallas autenticadas) sigue con Geist Sans de src/app/layout.tsx.
 * Cargada aquí (no en el layout raíz) para no afectar nada fuera de
 * src/app/_landing/.
 */
export const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
});
