import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Manual del Usuario (src/lib/manual.ts): el .md y el PDF se leen del sistema de archivos en
  // tiempo de ejecución, así que hay que declararlos para que viajen con la función en Vercel.
  outputFileTracingIncludes: {
    "/manual": ["./content/manual/**/*"],
    "/manual/pdf": ["./content/manual/**/*"],
  },
  experimental: {
    serverActions: {
      // Default de Next.js es 1MB -- insuficiente para un .xlsx real de
      // varios cientos de filas (importación/exportación masiva de
      // expedientes, src/lib/bulk-import/). 5MB da margen amplio sin
      // abrir la puerta a archivos desproporcionados (el límite de 500
      // filas por lote ya acota el tamaño esperado mucho antes de esto).
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
