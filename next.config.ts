import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
