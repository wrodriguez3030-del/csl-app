import type { MetadataRoute } from "next"

/**
 * Manifest PWA — hace la app instalable en el celular ("Agregar a pantalla de
 * inicio"), útil para el ponche móvil de asistencia. No fuerza modo standalone
 * sobre la app de escritorio: solo declara metadatos de instalación.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cibao Spa Láser · Ponche",
    short_name: "Ponche CSL",
    description: "Registro de asistencia y ponche de empleados.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0891b2",
    icons: [
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
  }
}
