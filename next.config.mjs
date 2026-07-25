/** @type {import('next').NextConfig} */
const nextConfig = {
  // ignoreBuildErrors removido: el build estricto detecta regresiones de tipos
  // antes de llegar a producción. El proyecto pasa `tsc --noEmit` con 0 errores.
  images: {
    unoptimized: true,
  },
  // Tree-shaking de imports por-símbolo en librerías grandes. lucide-react ya
  // lo optimiza Next 16 por defecto; recharts y date-fns no están en la lista
  // default. Solo afecta el build (cero cambio de runtime).
  experimental: {
    optimizePackageImports: ["recharts", "date-fns"],
  },
}

export default nextConfig
