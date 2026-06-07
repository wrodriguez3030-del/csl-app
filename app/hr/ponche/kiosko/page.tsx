"use client"

/**
 * Kiosko de ponche STANDALONE (sin login). Pensado para una tablet/celular fijo
 * en la sucursal: se autoriza una vez con el link de activación y queda listo.
 * Valida por device_token (localStorage) + GPS + QR contra el endpoint público.
 */
import { KioskView } from "@/components/hr/rrhh-ponche-page"

export default function KioskoStandalonePage() {
  return <KioskView onExit={() => { if (typeof window !== "undefined") window.location.href = "/" }} />
}
