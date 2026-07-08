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
  { id: "panel", label: "Dashboard reportes y piezas", section: "Mantenimiento" },
  { id: "pulse-mantenimiento", label: "Dashboard Mantenimiento", section: "Mantenimiento" },
  { id: "reporte", label: "Nuevo Reporte", section: "Mantenimiento" },
  { id: "reportes", label: "Lista de Reportes", section: "Mantenimiento" },
  { id: "historial-equipos", label: "Historial por equipo", section: "Mantenimiento" },
  { id: "inventario", label: "Inventario y piezas", section: "Mantenimiento" },
  { id: "piezas-poliza", label: "Lista piezas póliza", section: "Mantenimiento" },
  { id: "equipos", label: "Equipos", section: "Mantenimiento" },
  { id: "tecnicos", label: "Técnicos", section: "Mantenimiento" },
  { id: "errores", label: "Consulta código errores", section: "Mantenimiento" },
  // Requisición de materiales por sucursal (inventario interno).
  { id: "req-mat-nueva", label: "Nueva requisición", section: "Requisición de materiales" },
  { id: "req-mat-mis", label: "Mis requisiciones", section: "Requisición de materiales" },
  { id: "req-mat-consolidado", label: "Consolidado de compras", section: "Requisición de materiales" },
  { id: "req-mat-aprobaciones", label: "Aprobaciones", section: "Requisición de materiales" },
  { id: "req-mat-materiales", label: "Materiales", section: "Requisición de materiales" },
  { id: "req-mat-inventario", label: "Inventario de materiales", section: "Requisición de materiales" },
  { id: "req-mat-inventario-historico", label: "Histórico de inventarios", section: "Requisición de materiales" },
  { id: "req-mat-dashboard", label: "Dashboard materiales", section: "Requisición de materiales" },
  { id: "pulse-dashboard", label: "Dashboard", section: "PulseControl CSL" },
  { id: "pulse-equipos", label: "Equipos", section: "PulseControl CSL" },
  { id: "pulsos-operadoras", label: "Operadoras", section: "Pulsos" },
  { id: "pulsos-lecturas", label: "Lecturas pantalla equipos", section: "Pulsos" },
  { id: "pulsos-sesiones", label: "Disparos operadoras", section: "Pulsos" },
  { id: "pulsos-auditoria", label: "Auditoría PULSE", section: "Pulsos" },
  { id: "pulsos-cuadre", label: "Cuadre semanal", section: "Pulsos" },
  // RR.HH. — Personal. Orden: Dashboard → Solicitudes de empleo → Empleados →
  // Contratos → Documentos. Solicitudes es el módulo OPERATIVO histórico
  // (RecursosHumanosPage); vive en Personal, NO en Desarrollo.
  { id: "rrhh-dashboard", label: "Dashboard RR.HH.", section: "RR.HH. · Personal" },
  { id: "rrhh-solicitudes", label: "Solicitudes de empleo", section: "RR.HH. · Personal" },
  { id: "rrhh-empleados", label: "Empleados", section: "RR.HH. · Personal" },
  { id: "rrhh-contratos", label: "Contratos laborales", section: "RR.HH. · Personal" },
  { id: "rrhh-documentos", label: "Documentos empleados", section: "RR.HH. · Personal" },
  // RR.HH. — Asistencia
  { id: "rrhh-dashboard-ponche", label: "Dashboard Ponche", section: "RR.HH. · Asistencia" },
  { id: "rrhh-ponche", label: "Ponche / Reloj checador", section: "RR.HH. · Asistencia" },
  { id: "rrhh-kiosko-ponche", label: "Kiosko Ponche", section: "RR.HH. · Asistencia" },
  { id: "rrhh-config-modalidades", label: "Configuración de modalidades", section: "RR.HH. · Asistencia" },
  { id: "rrhh-asistencia", label: "Asistencia", section: "RR.HH. · Asistencia" },
  { id: "rrhh-horarios", label: "Horarios y turnos", section: "RR.HH. · Asistencia" },
  { id: "rrhh-permisos", label: "Permisos y licencias", section: "RR.HH. · Asistencia" },
  // RR.HH. — Pagos
  { id: "rrhh-nomina", label: "Nómina", section: "RR.HH. · Pagos" },
  { id: "rrhh-dias-laborados", label: "Días laborados", section: "RR.HH. · Pagos" },
  { id: "rrhh-incentivos", label: "Incentivos y comisiones", section: "RR.HH. · Pagos" },
  { id: "rrhh-vacaciones", label: "Vacaciones", section: "RR.HH. · Pagos" },
  { id: "rrhh-doble-sueldo", label: "Doble sueldo", section: "RR.HH. · Pagos" },
  { id: "rrhh-prestamos", label: "Préstamos y avances", section: "RR.HH. · Pagos" },
  { id: "rrhh-txt-bancarios", label: "Archivos TXT bancarios", section: "RR.HH. · Pagos" },
  // RR.HH. — Prestaciones
  { id: "rrhh-liquidaciones", label: "Liquidaciones y prestaciones RD", section: "RR.HH. · Prestaciones" },
  { id: "rrhh-pdf-prestaciones", label: "PDF de prestaciones", section: "RR.HH. · Prestaciones" },
  // RR.HH. — Desarrollo
  { id: "rrhh-reclutamiento", label: "Reclutamiento", section: "RR.HH. · Desarrollo" },
  { id: "rrhh-onboarding", label: "Onboarding", section: "RR.HH. · Desarrollo" },
  { id: "rrhh-evaluacion", label: "Evaluación de desempeño", section: "RR.HH. · Desarrollo" },
  { id: "rrhh-disciplina", label: "Disciplina", section: "RR.HH. · Desarrollo" },
  { id: "rrhh-capacitacion", label: "Capacitación", section: "RR.HH. · Desarrollo" },
  { id: "rrhh-comunicacion", label: "Comunicación interna", section: "RR.HH. · Desarrollo" },
  // RR.HH. — Reportes
  { id: "rrhh-reportes", label: "Reportes RR.HH.", section: "RR.HH. · Reportes" },
  { id: "rrhh-auditoria", label: "Auditoría RR.HH.", section: "RR.HH. · Reportes" },
  { id: "cosmiatria-clientes", label: "Clientes", section: "Clientes y Consentimientos" },
  { id: "cosmiatria-ficha", label: "Ficha Dermatología", section: "Clientes y Consentimientos" },
  { id: "consent-masajes", label: "Consentimiento Masajes", section: "Clientes y Consentimientos" },
  { id: "consent-peeling", label: "Consentimiento Peeling", section: "Clientes y Consentimientos" },
  { id: "consent-tatuajes-cejas", label: "Consentimiento Eliminación de Tatuajes y Cejas", section: "Clientes y Consentimientos" },
  { id: "consent-depilacion-laser", label: "Consentimiento Depilación Láser", section: "Clientes y Consentimientos" },
  { id: "reportes-firmados", label: "Historial Fichas y Consentimientos", section: "Clientes y Consentimientos" },
  // Permiso de acción (no navegable): muestra el botón "Sincronizar
  // directamente con la API" en la pantalla de Clientes.
  { id: "sincronizar-api", label: "Sincronizar API", section: "Clientes y Consentimientos" },
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
