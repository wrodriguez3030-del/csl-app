/**
 * MAPA DE ACCIONES → PERMISO. El corazón del cierre por defecto.
 *
 * Cada acción del despachador (`app/api/csl/_handlers.ts`) declara aquí el
 * permiso que exige. Una acción que NO esté en este mapa se RECHAZA: es
 * imposible añadir una acción nueva y olvidarse de protegerla, porque
 * `scripts/test-permisos.mjs` compara este mapa contra los `case` del
 * despachador y rompe la construcción si falta alguna.
 *
 * `PUBLICO` = cualquier usuario autenticado. Se usa con cuentagotas y cada uso
 * lleva escrito POR QUÉ.
 */
import { PERMISSION_ID_SET } from "./catalog"

/** Acción disponible para cualquier usuario con sesión válida. */
export const PUBLICO = "__publico__" as const

/** El permiso no sale de la acción sino de su parámetro (ver `ENTITY_PERMISSIONS`). */
export const POR_ENTIDAD = "__por_entidad__" as const

export const ACTION_PERMISSIONS: Readonly<Record<string, string>> = {
  // ── Sin permiso: las necesita cualquiera para que la app arranque ─────────
  health: PUBLICO,
  getCurrentUserProfile: PUBLICO,
  // Nombres de sucursal: los pinta casi toda pantalla como filtro.
  getBranchOptions: PUBLICO,
  // El propio empleado marcando su entrada/salida no es un privilegio. Las
  // tabletas ni siquiera pasan por aquí (usan /api/public/punch con
  // device_token + GPS + QR); esto es la marca desde dentro de la app.
  punchByPin: PUBLICO,
  punchByQr: PUBLICO,
  // El permiso lo decide la entidad que pida, no la acción.
  getRowsPaged: POR_ENTIDAD,
  // Carga inicial de la portada. Devuelve varios módulos a la vez, así que el
  // handler RECORTA por permiso lo que va dentro en vez de negar el todo.
  getAllData: PUBLICO,

  // ── Compras y gastos ─────────────────────────────────────────────────────
  getExpenses: "compras.ver",
  getInvoicePayments: "compras.ver",
  getPettyExpenses: "compras.ver",
  getPurchaseAttachmentUrl: "compras.ver",
  getPurchaseBranches: "compras.ver",
  getPurchaseDashboard: "compras.ver",
  getPurchaseInvoice: "compras.ver",
  getPurchaseInvoices: "compras.ver",
  getPurchaseSuppliers: "compras.ver",
  getRecurringHistory: "compras.ver",
  getRecurringPayments: "compras.ver",
  saveExpense: "compras.crear",
  savePettyExpense: "compras.crear",
  savePurchaseInvoice: "compras.crear",
  saveRecurringPayment: "compras.crear",
  setRecurringActive: "compras.editar",
  registerInvoicePayment: "compras.pagar",
  registerRecurringPayment: "compras.pagar",
  setPettyStatus: "compras.aprobar",
  deleteInvoicePayment: "compras.anular",
  voidExpense: "compras.anular",
  voidPurchaseInvoice: "compras.anular",
  deleteExpense: "compras.eliminar",
  deletePettyExpense: "compras.eliminar",
  deletePurchaseInvoice: "compras.eliminar",
  deleteRecurringPayment: "compras.eliminar",

  // ── Requisición de materiales ────────────────────────────────────────────
  getMaterialConsolidado: "material_requisitions.ver",
  getMaterialDashboard: "material_requisitions.ver",
  getMyRequisitions: "material_requisitions.ver",
  getRequisition: "material_requisitions.ver",
  approveAllRequisition: "material_requisitions.gestionar",
  createInvoiceFromConsolidado: "material_requisitions.gestionar",
  approveMaterialItem: "material_requisitions.gestionar",
  purchaseMaterialItem: "material_requisitions.gestionar",
  receiveMaterialItem: "material_requisitions.gestionar",
  rejectMaterialItem: "material_requisitions.gestionar",
  rejectRequisition: "material_requisitions.gestionar",
  restoreRequisition: "material_requisitions.gestionar",
  returnRequisition: "material_requisitions.gestionar",
  saveRequisition: "material_requisitions.gestionar",
  setRequisitionStatus: "material_requisitions.gestionar",
  submitRequisition: "material_requisitions.gestionar",
  deleteRequisition: "material_requisitions.delete",
  getMaterialBranches: "materials.ver",
  getMaterialCatalog: "materials.ver",
  duplicateInventory: "materials.gestionar",
  getInventoryDraft: "materials.gestionar",
  restoreInventory: "materials.gestionar",
  saveInventory: "materials.gestionar",
  saveMaterial: "materials.gestionar",
  setMaterialActive: "materials.gestionar",
  getInventories: "materials.inventory.view",
  getInventory: "materials.inventory.view",
  getInventoryAuditLogs: "materials.inventory.view",
  correctInventoryItem: "materials.inventory.correct",
  deleteInventory: "materials.inventory.delete",

  // ── Inventario de Productos ──────────────────────────────────────────────
  getProductBranches: "productos.ver",
  getProductCount: "productos.ver",
  getProductCounts: "productos.ver",
  getProductImports: "productos.ver",
  getProductStockReport: "productos.ver",
  getProductos: "productos.ver",
  deleteProductCount: "productos.gestionar",
  getProductCountDraft: "productos.gestionar",
  importProducts: "productos.gestionar",
  saveProductCount: "productos.gestionar",
  approveProductCount: "productos.aprobar_conteo",
  rejectProductCount: "productos.aprobar_conteo",

  // ── Incentivos de Ventas ─────────────────────────────────────────────────
  getCommissionAssignedServices: "sales_commission.view",
  getCommissionByBranch: "sales_commission.view",
  getCommissionCalculations: "sales_commission.view",
  getCommissionCollaborators: "sales_commission.view",
  getCommissionDashboard: "sales_commission.view",
  getCommissionExecutiveDashboard: "sales_commission.view",
  getCommissionImports: "sales_commission.view",
  getCommissionLaser: "sales_commission.view",
  getCommissionLaserAnnual: "sales_commission.view",
  getCommissionLaserDetail: "sales_commission.view",
  getCommissionPatientCapture: "sales_commission.view",
  getCommissionPatients: "sales_commission.view",
  getCommissionProductSellers: "sales_commission.view",
  getCommissionReceptionSplit: "sales_commission.view",
  getCommissionRules: "sales_commission.view",
  getCommissionRun: "sales_commission.view",
  getCommissionRunPreview: "sales_commission.view",
  getCommissionRuns: "sales_commission.view",
  getCommissionServiceDetail: "sales_commission.view",
  getCommissionUnassignedServices: "sales_commission.view",
  getCommissionYears: "sales_commission.view",
  checkCommissionImport: "sales_commission.import",
  voidCommissionImport: "sales_commission.import",
  commitCommissionImport: "sales_commission.import.sales",
  appendReservationsRows: "sales_commission.import.reservations",
  finalizeReservationsImport: "sales_commission.import.reservations",
  startReservationsImport: "sales_commission.import.reservations",
  checkExpenseImport: "sales_commission.import.expenses",
  commitExpenseImport: "sales_commission.import.expenses",
  getExpenseImports: "sales_commission.import.expenses",
  voidExpenseImport: "sales_commission.import.expenses",
  applyCommissionLaser: "sales_commission.calculate",
  autoRunCommissionPeriod: "sales_commission.calculate",
  saveCommissionRun: "sales_commission.calculate",
  voidCommissionRun: "sales_commission.calculate",
  deleteCommissionCollaborator: "sales_commission.rules.manage",
  saveCommissionCollaborator: "sales_commission.rules.manage",
  saveCommissionRule: "sales_commission.rules.manage",
  setCommissionCollaboratorActive: "sales_commission.rules.manage",
  setCommissionRuleActive: "sales_commission.rules.manage",
  assignCommissionSaleProvider: "sales_commission.adjust",
  deleteCommissionPatientCount: "sales_commission.adjust",
  reassignCommissionSaleProvider: "sales_commission.adjust",
  saveCommissionPatientCount: "sales_commission.adjust",
  unassignCommissionSaleProvider: "sales_commission.adjust",
  updateCommissionCalculation: "sales_commission.adjust",
  setCommissionCalcStatus: "sales_commission.review",
  finalizeCommissionRun: "sales_commission.approve",
  deletePartnerWithdrawal: "sales_commission.finance.manage",
  getPartnerWithdrawals: "sales_commission.finance.manage",
  savePartnerWithdrawal: "sales_commission.finance.manage",

  // ── Certificados de Regalo ───────────────────────────────────────────────
  getCertificadosDepicenter: "gift_certificates.ver",
  getCertificadosRegalo: "gift_certificates.ver",
  giftCertAudit: "gift_certificates.ver",
  giftCertGet: "gift_certificates.ver",
  giftCertList: "gift_certificates.ver",
  giftCertLogExport: "gift_certificates.ver",
  giftCertDuplicate: "gift_certificates.gestionar",
  giftCertEmit: "gift_certificates.gestionar",
  giftCertSave: "gift_certificates.gestionar",
  giftCertTransition: "gift_certificates.gestionar",
  saveCertificadoDepicenter: "gift_certificates.gestionar",
  saveCertificadoRegalo: "gift_certificates.gestionar",
  deleteCertificadoDepicenter: "gift_certificates.void",
  deleteCertificadoRegalo: "gift_certificates.void",

  // ── Credenciales (además exige TOTP server-side) ─────────────────────────
  getCredenciales: "credenciales.view",
  deleteCredencial: "credenciales.manage",
  saveCredencial: "credenciales.manage",

  // ── BI Financiero IA ─────────────────────────────────────────────────────
  getBiFinanceHistory: "bi_finance.view",
  getBiFinanceData: "bi_finance.dashboard",
  getBiFinanceForecast: "bi_finance.forecasts",
  deleteBiFinanceInvestment: "bi_finance.investments",
  getBiFinanceInvestments: "bi_finance.investments",
  saveBiFinanceInvestment: "bi_finance.investments",
  generateBiFinanceAlerts: "bi_finance.alerts",
  getBiFinanceAlerts: "bi_finance.alerts",
  updateBiFinanceAlert: "bi_finance.alerts",
  getBiFinanceModels: "bi_finance.config",
  getBiFinancePricing: "bi_finance.config",
  getBiFinanceSettings: "bi_finance.config",
  getBiFinanceUsage: "bi_finance.config",
  refreshBiFinanceModels: "bi_finance.config",
  saveBiFinancePricing: "bi_finance.config",
  saveBiFinanceSettings: "bi_finance.config",

  // ── Integraciones · AgendaPro ────────────────────────────────────────────
  getAgendaProIntegracion: "integrations.agendapro.view",
  deleteAgendaProLocationMap: "integrations.agendapro.configure",
  deleteAgendaProServiceMap: "integrations.agendapro.configure",
  saveAgendaProLocationMap: "integrations.agendapro.configure",
  saveAgendaProServiceMap: "integrations.agendapro.configure",
  reprocessAgendaProEvent: "integrations.agendapro.sync",
  syncAgendaProPayments: "integrations.agendapro.sync",

  // ── RR.HH. · Personal ────────────────────────────────────────────────────
  getEmpleados: "rrhh_personal.ver",
  getHrContracts: "rrhh_personal.ver",
  getHrDocumentSignedUrl: "rrhh_personal.ver",
  getHrDocuments: "rrhh_personal.ver",
  getSolicitudCompleta: "rrhh_personal.ver",
  getSolicitudesEmpleo: "rrhh_personal.ver",
  getHrContractPrefill: "rrhh_personal.gestionar",
  saveHrContract: "rrhh_personal.gestionar",
  saveHrDocument: "rrhh_personal.gestionar",
  saveSolicitudEmpleo: "rrhh_personal.gestionar",
  syncApprovedEmpleados: "rrhh_personal.gestionar",

  // ── RR.HH. · Asistencia ──────────────────────────────────────────────────
  getHrAllEmployeeSchedules: "rrhh_asistencia.ver",
  getHrAttendance: "rrhh_asistencia.ver",
  getHrAttendanceHours: "rrhh_asistencia.ver",
  getHrBranchGeofences: "rrhh_asistencia.ver",
  getHrEmployeeSchedule: "rrhh_asistencia.ver",
  getHrLeaves: "rrhh_asistencia.ver",
  getHrModalityConfig: "rrhh_asistencia.ver",
  getHrPunches: "rrhh_asistencia.ver",
  getHrScheduleAssignments: "rrhh_asistencia.ver",
  getHrSchedules: "rrhh_asistencia.ver",
  deleteHrModalityConfig: "rrhh_asistencia.gestionar",
  resolveHrQr: "rrhh_asistencia.gestionar",
  saveHrBranchGeofence: "rrhh_asistencia.gestionar",
  saveHrEmployeeSchedule: "rrhh_asistencia.gestionar",
  saveHrLeave: "rrhh_asistencia.gestionar",
  saveHrModalityConfig: "rrhh_asistencia.gestionar",
  saveHrPunch: "rrhh_asistencia.gestionar",
  saveHrSchedule: "rrhh_asistencia.gestionar",
  saveHrScheduleAssignment: "rrhh_asistencia.gestionar",

  // ── RR.HH. · Pagos ───────────────────────────────────────────────────────
  getHrDiasLaborados: "rrhh_pagos.ver",
  getHrDiasSugeridos: "rrhh_pagos.ver",
  getHrIncentives: "rrhh_pagos.ver",
  getHrVacacionSugerida: "rrhh_pagos.ver",
  getHrVacacionesTxt: "rrhh_pagos.ver",
  getHrVacations: "rrhh_pagos.ver",
  saveHrDiaLaborado: "rrhh_pagos.gestionar",
  saveHrIncentive: "rrhh_pagos.gestionar",
  saveHrVacation: "rrhh_pagos.gestionar",
  createHrPayrollRun: "rrhh.nomina",
  deleteHrPayrollRun: "rrhh.nomina",
  getHrPayrollConfig: "rrhh.nomina",
  getHrPayrollRun: "rrhh.nomina",
  getHrPayrollRuns: "rrhh.nomina",
  saveHrPayrollConfig: "rrhh.nomina",
  setHrPayrollStatus: "rrhh.nomina",
  generateBankTxt: "rrhh.banco_txt",
  getHrBankTxtFile: "rrhh.banco_txt",
  getHrBankTxtFiles: "rrhh.banco_txt",
  deleteHrBankAccount: "rrhh.cuentas_bancarias",
  getHrBankAccounts: "rrhh.cuentas_bancarias",
  saveHrBankAccount: "rrhh.cuentas_bancarias",

  // ── RR.HH. · Desarrollo ──────────────────────────────────────────────────
  getHrCommunications: "rrhh_desarrollo.ver",
  getHrDisciplinary: "rrhh_desarrollo.ver",
  getHrEvaluations: "rrhh_desarrollo.ver",
  getHrOnboarding: "rrhh_desarrollo.ver",
  getHrRecruitment: "rrhh_desarrollo.ver",
  getHrTrainings: "rrhh_desarrollo.ver",
  saveHrCommunication: "rrhh_desarrollo.gestionar",
  saveHrDisciplinary: "rrhh_desarrollo.gestionar",
  saveHrEvaluation: "rrhh_desarrollo.gestionar",
  saveHrOnboarding: "rrhh_desarrollo.gestionar",
  saveHrRecruitment: "rrhh_desarrollo.gestionar",
  saveHrTraining: "rrhh_desarrollo.gestionar",

  // ── RR.HH. · Reportes ────────────────────────────────────────────────────
  getHrAuditLogs: "rrhh_reportes.ver",
  getHrReportSummary: "rrhh_reportes.ver",

  // ── Clientes, fichas y sesiones ──────────────────────────────────────────
  getClienteHistorial: "clientes.ver",
  getClientesCosmiatria: "clientes.ver",
  getClientesCosmiatriaKpis: "clientes.ver",
  getClientesCosmiatriaPaged: "clientes.ver",
  getControlTratamientos: "clientes.ver",
  getFichaCompleta: "clientes.ver",
  getFichasDermatologia: "clientes.ver",
  addSesion: "clientes.gestionar",
  deleteSesion: "clientes.gestionar",
  saveClienteCosmiatria: "clientes.gestionar",
  saveFichaDermatologia: "clientes.gestionar",
  saveSesion: "clientes.gestionar",
  saveSesionesBatch: "clientes.gestionar",
  updateSesion: "clientes.gestionar",

  // ── Consentimientos ──────────────────────────────────────────────────────
  checkConsentFirmado: "consentimientos.ver",
  getConsentDepilacionLaser: "consentimientos.ver",
  getConsentDepilacionLaserCompleto: "consentimientos.ver",
  getConsentMasajes: "consentimientos.ver",
  getConsentMasajesCompleto: "consentimientos.ver",
  getConsentPeeling: "consentimientos.ver",
  getConsentPeelingCompleto: "consentimientos.ver",
  getConsentTatuajesCejas: "consentimientos.ver",
  getConsentTatuajesCejasCompleto: "consentimientos.ver",
  saveConsentDepilacionLaser: "consentimientos.gestionar",
  saveConsentMasaje: "consentimientos.gestionar",
  saveConsentPeeling: "consentimientos.gestionar",
  saveConsentTatuajeCeja: "consentimientos.gestionar",
  deleteConsentDepilacionLaser: "consentimientos.borrar",
  deleteConsentMasaje: "consentimientos.borrar",
  deleteConsentPeeling: "consentimientos.borrar",
  deleteConsentTatuajeCeja: "consentimientos.borrar",

  // ── Mantenimiento (módulo AISLADO: aquí solo se DECLARA el permiso) ──────
  getAllPulsosData: "mantenimiento.ver",
  getMaintenanceCabins: "mantenimiento.ver",
  getOperatorShots: "mantenimiento.ver",
  getPiezaReceptionSignedUrl: "mantenimiento.ver",
  getPiezasPolizaLista: "mantenimiento.ver",
  getPulseReadings: "mantenimiento.ver",
  getReporte: "mantenimiento.ver",
  getReporteMensual: "mantenimiento.ver",
  getReportesEliminados: "mantenimiento.ver",
  addAuditoria: "mantenimiento.gestionar",
  addInventario: "mantenimiento.gestionar",
  addLectura: "mantenimiento.gestionar",
  addOperadora: "mantenimiento.gestionar",
  markPiezaPolizaPendiente: "mantenimiento.gestionar",
  markPiezaPolizaRecibida: "mantenimiento.gestionar",
  recalculateDispOperador: "mantenimiento.gestionar",
  recalculatePulseContinuity: "mantenimiento.gestionar",
  restoreReporte: "mantenimiento.gestionar",
  saveAuditoria: "mantenimiento.gestionar",
  saveEquipo: "mantenimiento.gestionar",
  saveInventario: "mantenimiento.gestionar",
  saveLectura: "mantenimiento.gestionar",
  saveMaintenanceCabin: "mantenimiento.gestionar",
  saveOperadora: "mantenimiento.gestionar",
  saveOperatorShots: "mantenimiento.gestionar",
  savePieza: "mantenimiento.gestionar",
  savePiezaPolizaLista: "mantenimiento.gestionar",
  savePiezaPolizaRecepcion: "mantenimiento.gestionar",
  savePulseReading: "mantenimiento.gestionar",
  saveReporte: "mantenimiento.gestionar",
  saveTecnico: "mantenimiento.gestionar",
  setEquipoEstado: "mantenimiento.gestionar",
  setTecnicoEstado: "mantenimiento.gestionar",
  updateAuditoria: "mantenimiento.gestionar",
  updateEquipoCampos: "mantenimiento.gestionar",
  updateInventario: "mantenimiento.gestionar",
  updateLectura: "mantenimiento.gestionar",
  updateOperadora: "mantenimiento.gestionar",
  updateReporteCampos: "mantenimiento.gestionar",
  deleteAuditoria: "mantenimiento.borrar",
  deleteEquipo: "mantenimiento.borrar",
  deleteInventario: "mantenimiento.borrar",
  deleteLectura: "mantenimiento.borrar",
  deleteOperadora: "mantenimiento.borrar",
  deleteOperatorShot: "mantenimiento.borrar",
  deleteOperatorShotsByPeriod: "mantenimiento.borrar",
  deletePieza: "mantenimiento.borrar",
  deletePiezaPolizaLista: "mantenimiento.borrar",
  deletePulseReading: "mantenimiento.borrar",
  deleteReporte: "mantenimiento.borrar",
  deleteTecnico: "mantenimiento.borrar",

  // ── Configuración ────────────────────────────────────────────────────────
  deleteSucursal: "config.gestionar",
  saveSucursal: "config.gestionar",
  setSucursalEstado: "config.gestionar",

  // ══ CAJA FUERTE ═════════════════════════════════════════════════════════
  // Deudas y salidas
  addHrLoanPayment: "rrhh.prestamos",
  deleteHrLoan: "rrhh.prestamos",
  getHrLoanPayments: "rrhh.prestamos",
  getHrLoans: "rrhh.prestamos",
  saveHrLoan: "rrhh.prestamos",
  deleteHrSeverance: "rrhh.prestaciones",
  getHrSeverance: "rrhh.prestaciones",
  getHrSeveranceSuggestion: "rrhh.prestaciones",
  saveHrSeverance: "rrhh.prestaciones",
  deleteHrChristmasBonus: "rrhh.doble_sueldo",
  getHrChristmasBonus: "rrhh.doble_sueldo",
  getHrDobleSugerido: "rrhh.doble_sueldo",
  saveHrChristmasBonus: "rrhh.doble_sueldo",

  // Identidad y asistencia
  getHrEmployeeQr: "rrhh.ponche.pin",
  setHrEmployeePin: "rrhh.ponche.pin",
  authorizeHrPunchDevice: "rrhh.ponche.dispositivos",
  deleteHrPunchDevice: "rrhh.ponche.dispositivos",
  getHrPunchDevices: "rrhh.ponche.dispositivos",
  regenerateHrPunchDeviceToken: "rrhh.ponche.dispositivos",
  setHrPunchDeviceActive: "rrhh.ponche.dispositivos",
  deleteHrPunch: "rrhh.ponche.anular",
  voidHrPunch: "rrhh.ponche.anular",

  // Borrar registros
  deleteHrCommunication: "rrhh.borrar",
  deleteHrContract: "rrhh.borrar",
  deleteHrDiaLaborado: "rrhh.borrar",
  deleteHrDisciplinary: "rrhh.borrar",
  deleteHrDocument: "rrhh.borrar",
  deleteHrEvaluation: "rrhh.borrar",
  deleteHrIncentive: "rrhh.borrar",
  deleteHrLeave: "rrhh.borrar",
  deleteHrOnboarding: "rrhh.borrar",
  deleteHrRecruitment: "rrhh.borrar",
  deleteHrSchedule: "rrhh.borrar",
  deleteHrScheduleAssignment: "rrhh.borrar",
  deleteHrTraining: "rrhh.borrar",
  deleteHrVacation: "rrhh.borrar",
  deleteSolicitudEmpleo: "rrhh.borrar",
  deleteClienteCosmiatria: "clientes.borrar",
  deleteFichaDermatologia: "clientes.borrar",
  mergeClientes: "clientes.fusionar",

  // Llaves y configuración
  deleteUser: "usuarios.gestionar",
  getPermissionDenials: "usuarios.gestionar",
  getUsers: "usuarios.gestionar",
  saveUser: "usuarios.gestionar",
}

/**
 * `getRowsPaged` acepta la entidad como parámetro, así que un solo permiso no
 * la protege: se resuelve POR ENTIDAD. Una entidad sin declarar se rechaza —
 * por eso `credenciales`, que antes se colaba por aquí saltándose el TOTP,
 * ahora exige el mismo permiso que la bóveda.
 * Las claves son las de `ENTITY_TABLES` en `lib/server/csl-crud.ts`.
 */
export const ENTITY_PERMISSIONS: Readonly<Record<string, string>> = {
  sucursales: "config.ver",
  equipos: "mantenimiento.ver",
  reportes: "mantenimiento.ver",
  piezas: "mantenimiento.ver",
  tecnicos: "mantenimiento.ver",
  inventario: "mantenimiento.ver",
  operadoras: "mantenimiento.ver",
  lecturas_semanales: "mantenimiento.ver",
  auditorias_semanales: "mantenimiento.ver",
  piezas_poliza_lista: "mantenimiento.ver",
  sesiones_cliente: "clientes.ver",
  cosmiatria_clientes: "clientes.ver",
  ficha_dermatologica: "clientes.ver",
  credenciales: "credenciales.view",
  solicitudes_empleo: "rrhh_personal.ver",
  empleados: "rrhh_personal.ver",
  csl_consent_masajes: "consentimientos.ver",
  csl_consent_peeling: "consentimientos.ver",
  csl_consent_tatuajes_cejas: "consentimientos.ver",
  csl_consent_depilacion_laser: "consentimientos.ver",
  certificados_regalo: "gift_certificates.ver",
  certificados_depicenter: "gift_certificates.ver",
}

/**
 * Rutas de escritura que NO pasan por el despachador. Sin esto el cierre por
 * defecto tendría once puertas de atrás abiertas: subir documentos de RR.HH.,
 * cambiar el correo del sistema, guardar la clave de OpenAI…
 * Clave: "<MÉTODO> <ruta>". Las rutas públicas o por token/cron no van aquí:
 * su guardia es el secreto, no el permiso.
 */
export const ROUTE_PERMISSIONS: Readonly<Record<string, string>> = {
  "POST /api/hr/documents/upload": "rrhh_personal.gestionar",
  "POST /api/maintenance/documents/upload": "mantenimiento.gestionar",
  "POST /api/purchases/documents/upload": "compras.crear",
  "POST /api/integrations/agendapro/import-clients": "integrations.agendapro.sync",
  "POST /api/integrations/agendapro/sync-clients": "integrations.agendapro.sync",
  "POST /api/integrations/agendapro/test": "integrations.agendapro.view",
  "GET /api/integrations/agendapro/status": "integrations.agendapro.view",
  "POST /api/integrations/mantenimiento/import-lecturas": "mantenimiento.gestionar",
  "POST /api/pulse/ocr": "mantenimiento.gestionar",
  "POST /api/public-form-links": "clientes.gestionar",
  "POST /api/bi-finance/assistant": "bi_finance.ai_chat",
  // Caja fuerte: secretos y configuración global.
  "POST /api/integrations/agendapro/credentials": "config.llaves",
  "GET /api/settings/email": "config.llaves",
  "PUT /api/settings/email": "config.llaves",
  "POST /api/settings/email/test": "config.llaves",
  "POST /api/bi-finance/openai-key": "config.llaves",
  // `/api/admin/users*` NO está aquí a propósito: ya exige `requireSuperadmin`,
  // que es más estricto que cualquier permiso del catálogo. Ver EXENTAS en
  // scripts/test-permisos.mjs.
}

/** Permiso que exige una acción, o `undefined` si no está declarada. */
export function permisoDeAccion(action: string): string | undefined {
  return ACTION_PERMISSIONS[action]
}

/**
 * Todos los permisos citados por los mapas. Lo usa la prueba para comprobar
 * que ninguno es un permiso inventado que no existe en el catálogo.
 */
export function permisosCitados(): string[] {
  const todos = [
    ...Object.values(ACTION_PERMISSIONS),
    ...Object.values(ENTITY_PERMISSIONS),
    ...Object.values(ROUTE_PERMISSIONS),
  ]
  return Array.from(new Set(todos.filter((p) => p !== PUBLICO && p !== POR_ENTIDAD)))
}

/** Permisos citados que NO existen en el catálogo (debe ser siempre vacío). */
export function permisosHuerfanos(): string[] {
  return permisosCitados().filter((p) => !PERMISSION_ID_SET.has(p))
}
