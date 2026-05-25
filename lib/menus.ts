import type { TabId } from "@/lib/types"

/**
 * Fuente única de la lista canónica de menús del sistema CSL.
 *
 * Se usa tanto en el cliente (lib/security.ts, components/*) como
 * en el servidor (app/api/csl/route.ts) para evitar la deriva entre
 * frontend y backend al renombrar/agregar tabs.
 *
 * No agregar lógica de UI ni dependencias de runtime aquí.
 */

export type MenuPermission = TabId

export interface MenuOption {
  id: MenuPermission
  label: string
  section: string
}

export const MENU_OPTIONS: MenuOption[] = [
  { id: "sucursales", label: "Sucursales", section: "Gestión" },
  { id: "credenciales", label: "Sistema de Credenciales", section: "Gestión" },
  { id: "panel", label: "Dashboard Ejecutivo", section: "Mantenimiento" },
  { id: "reporte", label: "Nuevo Reporte", section: "Mantenimiento" },
  { id: "reportes", label: "Lista de Reportes", section: "Mantenimiento" },
  { id: "historial-equipos", label: "Historial por equipo", section: "Mantenimiento" },
  { id: "inventario", label: "Inventario", section: "Mantenimiento" },
  { id: "piezas-poliza", label: "Lista piezas póliza", section: "Mantenimiento" },
  { id: "equipos", label: "Equipos", section: "Mantenimiento" },
  { id: "tecnicos", label: "Técnicos", section: "Mantenimiento" },
  { id: "errores", label: "Errores y Piezas", section: "Mantenimiento" },
  { id: "pulse-dashboard", label: "Dashboard", section: "PulseControl CSL" },
  { id: "pulse-equipos", label: "Equipos", section: "PulseControl CSL" },
  { id: "pulsos-operadoras", label: "Operadoras", section: "Pulsos" },
  { id: "pulsos-lecturas", label: "Lecturas pantalla equipos", section: "Pulsos" },
  { id: "pulsos-sesiones", label: "Disparos operadoras", section: "Pulsos" },
  { id: "pulsos-auditoria", label: "Auditoría PULSE", section: "Pulsos" },
  { id: "pulsos-cuadre", label: "Cuadre semanal", section: "Pulsos" },
  { id: "pulse-mantenimiento", label: "Mantenimiento", section: "PulseControl CSL" },
  { id: "rrhh-solicitudes", label: "Solicitudes de empleo", section: "Recursos Humanos" },
  { id: "rrhh-empleados", label: "Empleados", section: "Recursos Humanos" },
  { id: "cosmiatria-clientes", label: "Clientes", section: "Clientes y Consentimientos" },
  { id: "cosmiatria-ficha", label: "Ficha Dermatología", section: "Clientes y Consentimientos" },
  { id: "consent-masajes", label: "Consentimiento Masajes", section: "Clientes y Consentimientos" },
  { id: "consent-tatuajes-cejas", label: "Consentimiento Eliminación de Tatuajes y Cejas", section: "Clientes y Consentimientos" },
  { id: "reportes-firmados", label: "Reportes de Consentimientos y Fichas", section: "Clientes y Consentimientos" },
  { id: "cliente-certificados", label: "CF Regalo Digital", section: "Atención a cliente" },
  { id: "cliente-certificados-depicenter", label: "Certificado Digital Depicenter", section: "Atención a cliente" },
  { id: "cliente-certificados-imprimir", label: "CF de Regalo para imprimir", section: "Atención a cliente" },
  { id: "cliente-certificados-talonario", label: "CF Regalos Talonario Pre-impreso", section: "Atención a cliente" },
  { id: "cliente-certificados-validez", label: "Validar Certificados", section: "Atención a cliente" },
  { id: "config", label: "Configuración", section: "Sistema" },
  { id: "admin-users", label: "Usuarios", section: "Administración" },
]

/** Lista plana de IDs — útil para resolver permisos de admin (todos los menús). */
export const ALL_MENU_IDS: MenuPermission[] = MENU_OPTIONS.map((menu) => menu.id)

/** Set para chequeos O(1). */
export const MENU_ID_SET: ReadonlySet<MenuPermission> = new Set(ALL_MENU_IDS)
