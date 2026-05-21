/** @type {import('next').NextConfig} */
const nextConfig = {
  // ignoreBuildErrors removido: el build estricto detecta regresiones de tipos
  // antes de llegar a producción. El proyecto pasa `tsc --noEmit` con 0 errores.
  images: {
    unoptimized: true,
  },
}

export default nextConfig
