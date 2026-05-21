// =====================================================
// SISTEMA DE MANTENIMIENTOS - GOOGLE APPS SCRIPT
// Cibao Spa Laser
// =====================================================
// INSTRUCCIONES DE INSTALACION:
// 1. Ve a Google Drive y crea una nueva Hoja de Calculo (Google Sheets)
// 2. Nombra el archivo: "Sistema Mantenimientos Cibao Spa"
// 3. Ve a Extensiones > Apps Script
// 4. Borra todo el codigo que aparece y pega este script completo
// 5. Guarda el proyecto (Ctrl+S) con el nombre "API Mantenimientos"
// 6. Haz clic en "Implementar" > "Nueva implementacion"
// 7. Selecciona tipo: "Aplicacion web"
// 8. Configura:
//    - Ejecutar como: "Yo"
//    - Quien tiene acceso: "Cualquier persona"
// 9. Haz clic en "Implementar" y copia la URL que te genera
// 10. Pega esa URL en la configuracion de tu sistema
// =====================================================

// ID de la hoja de calculo (se obtiene automaticamente)
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// Crear todas las hojas necesarias si no existen
function inicializarHojas() {
  const ss = getSpreadsheet();
  const hojas = [
    { nombre: 'Sucursales', encabezados: ['id', 'nombre', 'direccion', 'telefono', 'encargado', 'email', 'activa', 'fechaCreacion'] },
    { nombre: 'Equipos', encabezados: ['id', 'nombre', 'modelo', 'serie', 'sucursalId', 'fechaInstalacion', 'pulsosIniciales', 'pulsosActuales', 'pulsosMaximos', 'estado', 'ultimoMantenimiento', 'proximoMantenimiento', 'notas'] },
    { nombre: 'Tecnicos', encabezados: ['id', 'nombre', 'especialidad', 'telefono', 'email', 'activo', 'certificaciones', 'fechaIngreso'] },
    { nombre: 'Reportes', encabezados: ['id', 'numero', 'fecha', 'equipoId', 'tecnicoId', 'tipo', 'estado', 'descripcion', 'diagnostico', 'trabajoRealizado', 'recomendaciones', 'pulsosAntes', 'pulsosDespues', 'horaInicio', 'horaFin', 'piezasUtilizadas', 'firmaCliente', 'firmaTecnico', 'observaciones', 'costo', 'garantia', 'fechaCreacion'] },
    { nombre: 'Catalogo', encabezados: ['id', 'codigo', 'nombre', 'categoria', 'descripcion', 'precio', 'stock', 'stockMinimo', 'proveedor', 'tiempoEntrega', 'compatibilidad', 'imagen', 'activo'] },
    { nombre: 'Configuracion', encabezados: ['clave', 'valor'] }
  ];

  hojas.forEach(hoja => {
    let sheet = ss.getSheetByName(hoja.nombre);
    if (!sheet) {
      sheet = ss.insertSheet(hoja.nombre);
      sheet.getRange(1, 1, 1, hoja.encabezados.length).setValues([hoja.encabezados]);
      sheet.getRange(1, 1, 1, hoja.encabezados.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });

  return { success: true, message: 'Hojas inicializadas correctamente' };
}

// Helper para crear respuesta JSONP o JSON
function createResponse(result, callback) {
  const json = JSON.stringify(result);
  if (callback) {
    // JSONP response
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  // Regular JSON response
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// Funcion principal que maneja las peticiones GET
function doGet(e) {
  try {
    const action = e.parameter.action;
    const callback = e.parameter.callback; // JSONP callback
    let result;

    switch (action) {
      case 'init':
        result = inicializarHojas();
        break;
      case 'getSucursales':
        result = getSucursales();
        break;
      case 'getEquipos':
        result = getEquipos();
        break;
      case 'getTecnicos':
        result = getTecnicos();
        break;
      case 'getReportes':
        result = getReportes();
        break;
      case 'getCatalogo':
        result = getCatalogo();
        break;
      case 'getConfiguracion':
        result = getConfiguracion();
        break;
      case 'getEstadisticas':
        result = getEstadisticas();
        break;
      case 'getAllData':
        result = getAllData();
        break;
      case 'getAllPulsosData':
        result = getAllPulsosData();
        break;
      case 'getOperadoras':
        result = getOperadoras();
        break;
      case 'getLecturasSemanales':
        result = getLecturasSemanales();
        break;
      case 'getSesionesCliente':
        result = getSesionesCliente();
        break;
      case 'initPulsos':
        result = inicializarHojasPulsos();
        break;
      case 'health':
      case 'test':
        result = { ok: true, success: true, message: 'Conexion exitosa', version: '2.0', timestamp: new Date().toISOString() };
        break;
      default:
        result = { ok: false, success: false, error: 'Accion no reconocida: ' + action };
    }

    return createResponse(result, callback);
  } catch (error) {
    const errorResult = { ok: false, success: false, error: error.message };
    const callback = e.parameter ? e.parameter.callback : null;
    return createResponse(errorResult, callback);
  }
}

// Obtener todos los datos del sistema
function getAllData() {
  try {
    inicializarHojas(); // Asegura que las hojas existen
    return {
      ok: true,
      success: true,
      data: {
        sucursales: getSucursales().data || [],
        equipos: getEquipos().data || [],
        tecnicos: getTecnicos().data || [],
        reportes: getReportes().data || [],
        piezas: getCatalogo().data || []
      }
    };
  } catch (error) {
    return { ok: false, success: false, error: error.message };
  }
}

// Funcion principal que maneja las peticiones POST
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    switch (action) {
      // Sucursales
      case 'addSucursal':
        result = addSucursal(data.sucursal);
        break;
      case 'updateSucursal':
        result = updateSucursal(data.sucursal);
        break;
      case 'deleteSucursal':
        result = deleteSucursal(data.id);
        break;

      // Equipos
      case 'addEquipo':
        result = addEquipo(data.equipo);
        break;
      case 'updateEquipo':
        result = updateEquipo(data.equipo);
        break;
      case 'deleteEquipo':
        result = deleteEquipo(data.id);
        break;

      // Tecnicos
      case 'addTecnico':
        result = addTecnico(data.tecnico);
        break;
      case 'updateTecnico':
        result = updateTecnico(data.tecnico);
        break;
      case 'deleteTecnico':
        result = deleteTecnico(data.id);
        break;

      // Reportes
      case 'addReporte':
        result = addReporte(data.reporte);
        break;
      case 'updateReporte':
        result = updateReporte(data.reporte);
        break;
      case 'deleteReporte':
        result = deleteReporte(data.id);
        break;

      // Catalogo
      case 'addPieza':
        result = addPieza(data.pieza);
        break;
      case 'updatePieza':
        result = updatePieza(data.pieza);
        break;
      case 'deletePieza':
        result = deletePieza(data.id);
        break;


      // Módulo Control de Pulsos — Operadoras
      case 'addOperadora':
        result = addOperadora(JSON.parse(data.data));
        break;
      case 'updateOperadora':
        result = updateOperadora(JSON.parse(data.data));
        break;
      case 'deleteOperadora':
        result = deleteOperadora(data.id);
        break;

      // Módulo Control de Pulsos — Lecturas Semanales
      case 'addLectura':
        result = addLectura(JSON.parse(data.data));
        break;
      case 'updateLectura':
        result = updateLectura(JSON.parse(data.data));
        break;
      case 'deleteLectura':
        result = deleteLectura(data.id);
        break;

      // Módulo Control de Pulsos — Sesiones Cliente
      case 'addSesion':
        result = addSesion(JSON.parse(data.data));
        break;
      case 'updateSesion':
        result = updateSesion(JSON.parse(data.data));
        break;
      case 'deleteSesion':
        result = deleteSesion(data.id);
        break;

      // Carga completa módulo pulsos
      case 'getAllPulsosData':
        result = getAllPulsosData();
        break;

      // Configuracion
      case 'saveConfiguracion':
        result = saveConfiguracion(data.config);
        break;

      // Sync completo
      case 'syncAll':
        result = syncAll(data);
        break;

      // También soportar health check en POST
      case 'getAllPulsosData':
        result = getAllPulsosData();
        break;
      case 'getOperadoras':
        result = getOperadoras();
        break;
      case 'getLecturasSemanales':
        result = getLecturasSemanales();
        break;
      case 'getSesionesCliente':
        result = getSesionesCliente();
        break;
      case 'initPulsos':
        result = inicializarHojasPulsos();
        break;
      case 'health':
      case 'test':
        result = { ok: true, success: true, message: 'Conexion exitosa', version: '2.0', timestamp: new Date().toISOString() };
        break;

      case 'getAllData':
        result = getAllData();
        break;

      default:
        result = { ok: false, success: false, error: 'Accion no reconocida: ' + action };
    }

    // Si result no tiene ok, agregarlo
    if (result && result.success !== undefined && result.ok === undefined) {
      result.ok = result.success;
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =====================================================
// FUNCIONES DE LECTURA (GET)
// =====================================================

function getSucursales() {
  const sheet = getSpreadsheet().getSheetByName('Sucursales');
  if (!sheet) return { success: true, data: [] };
  
  const data = sheetToArray(sheet);
  return { success: true, data: data };
}

function getEquipos() {
  const sheet = getSpreadsheet().getSheetByName('Equipos');
  if (!sheet) return { success: true, data: [] };
  
  const data = sheetToArray(sheet);
  return { success: true, data: data };
}

function getTecnicos() {
  const sheet = getSpreadsheet().getSheetByName('Tecnicos');
  if (!sheet) return { success: true, data: [] };
  
  const data = sheetToArray(sheet);
  return { success: true, data: data };
}

function getReportes() {
  const sheet = getSpreadsheet().getSheetByName('Reportes');
  if (!sheet) return { success: true, data: [] };
  
  const data = sheetToArray(sheet);
  // Parsear piezasUtilizadas como JSON
  data.forEach(row => {
    if (row.piezasUtilizadas && typeof row.piezasUtilizadas === 'string') {
      try {
        row.piezasUtilizadas = JSON.parse(row.piezasUtilizadas);
      } catch (e) {
        row.piezasUtilizadas = [];
      }
    }
  });
  return { success: true, data: data };
}

function getCatalogo() {
  const sheet = getSpreadsheet().getSheetByName('Catalogo');
  if (!sheet) return { success: true, data: [] };
  
  const data = sheetToArray(sheet);
  return { success: true, data: data };
}

function getConfiguracion() {
  const sheet = getSpreadsheet().getSheetByName('Configuracion');
  if (!sheet) return { success: true, data: {} };
  
  const values = sheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < values.length; i++) {
    config[values[i][0]] = values[i][1];
  }
  return { success: true, data: config };
}

function getEstadisticas() {
  const sucursales = getSucursales().data || [];
  const equipos = getEquipos().data || [];
  const tecnicos = getTecnicos().data || [];
  const reportes = getReportes().data || [];

  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const reportesMes = reportes.filter(r => new Date(r.fecha) >= inicioMes);
  const equiposActivos = equipos.filter(e => e.estado === 'operativo' || e.estado === 'mantenimiento');
  const equiposCriticos = equipos.filter(e => {
    const porcentaje = (e.pulsosActuales / e.pulsosMaximos) * 100;
    return porcentaje >= 80;
  });

  return {
    success: true,
    data: {
      totalSucursales: sucursales.length,
      totalEquipos: equipos.length,
      totalTecnicos: tecnicos.length,
      totalReportes: reportes.length,
      reportesMes: reportesMes.length,
      equiposActivos: equiposActivos.length,
      equiposCriticos: equiposCriticos.length,
      mantenimientosPendientes: reportes.filter(r => r.estado === 'pendiente').length,
      mantenimientosCompletados: reportes.filter(r => r.estado === 'completado').length
    }
  };
}

// =====================================================
// FUNCIONES DE ESCRITURA - SUCURSALES
// =====================================================

function addSucursal(sucursal) {
  const sheet = getSpreadsheet().getSheetByName('Sucursales');
  if (!sheet) {
    inicializarHojas();
  }
  
  sucursal.id = sucursal.id || generateId();
  sucursal.fechaCreacion = sucursal.fechaCreacion || new Date().toISOString();
  
  const row = [
    sucursal.id,
    sucursal.nombre,
    sucursal.direccion,
    sucursal.telefono,
    sucursal.encargado,
    sucursal.email,
    sucursal.activa !== false,
    sucursal.fechaCreacion
  ];
  
  getSpreadsheet().getSheetByName('Sucursales').appendRow(row);
  return { success: true, data: sucursal };
}

function updateSucursal(sucursal) {
  const sheet = getSpreadsheet().getSheetByName('Sucursales');
  const rowIndex = findRowById(sheet, sucursal.id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Sucursal no encontrada' };
  }
  
  const row = [
    sucursal.id,
    sucursal.nombre,
    sucursal.direccion,
    sucursal.telefono,
    sucursal.encargado,
    sucursal.email,
    sucursal.activa,
    sucursal.fechaCreacion
  ];
  
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  return { success: true, data: sucursal };
}

function deleteSucursal(id) {
  const sheet = getSpreadsheet().getSheetByName('Sucursales');
  const rowIndex = findRowById(sheet, id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Sucursal no encontrada' };
  }
  
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// =====================================================
// FUNCIONES DE ESCRITURA - EQUIPOS
// =====================================================

function addEquipo(equipo) {
  const sheet = getSpreadsheet().getSheetByName('Equipos');
  if (!sheet) {
    inicializarHojas();
  }
  
  equipo.id = equipo.id || generateId();
  
  const row = [
    equipo.id,
    equipo.nombre,
    equipo.modelo,
    equipo.serie,
    equipo.sucursalId,
    equipo.fechaInstalacion,
    equipo.pulsosIniciales || 0,
    equipo.pulsosActuales || 0,
    equipo.pulsosMaximos || 500000,
    equipo.estado || 'operativo',
    equipo.ultimoMantenimiento,
    equipo.proximoMantenimiento,
    equipo.notas
  ];
  
  getSpreadsheet().getSheetByName('Equipos').appendRow(row);
  return { success: true, data: equipo };
}

function updateEquipo(equipo) {
  const sheet = getSpreadsheet().getSheetByName('Equipos');
  const rowIndex = findRowById(sheet, equipo.id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Equipo no encontrado' };
  }
  
  const row = [
    equipo.id,
    equipo.nombre,
    equipo.modelo,
    equipo.serie,
    equipo.sucursalId,
    equipo.fechaInstalacion,
    equipo.pulsosIniciales,
    equipo.pulsosActuales,
    equipo.pulsosMaximos,
    equipo.estado,
    equipo.ultimoMantenimiento,
    equipo.proximoMantenimiento,
    equipo.notas
  ];
  
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  return { success: true, data: equipo };
}

function deleteEquipo(id) {
  const sheet = getSpreadsheet().getSheetByName('Equipos');
  const rowIndex = findRowById(sheet, id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Equipo no encontrado' };
  }
  
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// =====================================================
// FUNCIONES DE ESCRITURA - TECNICOS
// =====================================================

function addTecnico(tecnico) {
  const sheet = getSpreadsheet().getSheetByName('Tecnicos');
  if (!sheet) {
    inicializarHojas();
  }
  
  tecnico.id = tecnico.id || generateId();
  tecnico.fechaIngreso = tecnico.fechaIngreso || new Date().toISOString().split('T')[0];
  
  const row = [
    tecnico.id,
    tecnico.nombre,
    tecnico.especialidad,
    tecnico.telefono,
    tecnico.email,
    tecnico.activo !== false,
    tecnico.certificaciones || '',
    tecnico.fechaIngreso
  ];
  
  getSpreadsheet().getSheetByName('Tecnicos').appendRow(row);
  return { success: true, data: tecnico };
}

function updateTecnico(tecnico) {
  const sheet = getSpreadsheet().getSheetByName('Tecnicos');
  const rowIndex = findRowById(sheet, tecnico.id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Tecnico no encontrado' };
  }
  
  const row = [
    tecnico.id,
    tecnico.nombre,
    tecnico.especialidad,
    tecnico.telefono,
    tecnico.email,
    tecnico.activo,
    tecnico.certificaciones,
    tecnico.fechaIngreso
  ];
  
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  return { success: true, data: tecnico };
}

function deleteTecnico(id) {
  const sheet = getSpreadsheet().getSheetByName('Tecnicos');
  const rowIndex = findRowById(sheet, id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Tecnico no encontrado' };
  }
  
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// =====================================================
// FUNCIONES DE ESCRITURA - REPORTES
// =====================================================

function addReporte(reporte) {
  const sheet = getSpreadsheet().getSheetByName('Reportes');
  if (!sheet) {
    inicializarHojas();
  }
  
  reporte.id = reporte.id || generateId();
  reporte.fechaCreacion = reporte.fechaCreacion || new Date().toISOString();
  
  // Generar numero de reporte
  if (!reporte.numero) {
    const reportes = getReportes().data || [];
    const ultimoNumero = reportes.length > 0 
      ? Math.max(...reportes.map(r => parseInt(r.numero?.replace('RPT-', '') || '0')))
      : 0;
    reporte.numero = 'RPT-' + String(ultimoNumero + 1).padStart(5, '0');
  }
  
  const row = [
    reporte.id,
    reporte.numero,
    reporte.fecha,
    reporte.equipoId,
    reporte.tecnicoId,
    reporte.tipo,
    reporte.estado || 'pendiente',
    reporte.descripcion,
    reporte.diagnostico,
    reporte.trabajoRealizado,
    reporte.recomendaciones,
    reporte.pulsosAntes,
    reporte.pulsosDespues,
    reporte.horaInicio,
    reporte.horaFin,
    JSON.stringify(reporte.piezasUtilizadas || []),
    reporte.firmaCliente,
    reporte.firmaTecnico,
    reporte.observaciones,
    reporte.costo || 0,
    reporte.garantia || '',
    reporte.fechaCreacion
  ];
  
  getSpreadsheet().getSheetByName('Reportes').appendRow(row);
  
  // Actualizar pulsos del equipo si es necesario
  if (reporte.pulsosDespues && reporte.equipoId) {
    const equiposSheet = getSpreadsheet().getSheetByName('Equipos');
    const equipoRow = findRowById(equiposSheet, reporte.equipoId);
    if (equipoRow !== -1) {
      equiposSheet.getRange(equipoRow, 8).setValue(reporte.pulsosDespues); // pulsosActuales
      equiposSheet.getRange(equipoRow, 11).setValue(reporte.fecha); // ultimoMantenimiento
    }
  }
  
  return { success: true, data: reporte };
}

function updateReporte(reporte) {
  const sheet = getSpreadsheet().getSheetByName('Reportes');
  const rowIndex = findRowById(sheet, reporte.id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Reporte no encontrado' };
  }
  
  const row = [
    reporte.id,
    reporte.numero,
    reporte.fecha,
    reporte.equipoId,
    reporte.tecnicoId,
    reporte.tipo,
    reporte.estado,
    reporte.descripcion,
    reporte.diagnostico,
    reporte.trabajoRealizado,
    reporte.recomendaciones,
    reporte.pulsosAntes,
    reporte.pulsosDespues,
    reporte.horaInicio,
    reporte.horaFin,
    JSON.stringify(reporte.piezasUtilizadas || []),
    reporte.firmaCliente,
    reporte.firmaTecnico,
    reporte.observaciones,
    reporte.costo,
    reporte.garantia,
    reporte.fechaCreacion
  ];
  
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  return { success: true, data: reporte };
}

function deleteReporte(id) {
  const sheet = getSpreadsheet().getSheetByName('Reportes');
  const rowIndex = findRowById(sheet, id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Reporte no encontrado' };
  }
  
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// =====================================================
// FUNCIONES DE ESCRITURA - CATALOGO
// =====================================================

function addPieza(pieza) {
  const sheet = getSpreadsheet().getSheetByName('Catalogo');
  if (!sheet) {
    inicializarHojas();
  }
  
  pieza.id = pieza.id || generateId();
  
  const row = [
    pieza.id,
    pieza.codigo,
    pieza.nombre,
    pieza.categoria,
    pieza.descripcion,
    pieza.precio || 0,
    pieza.stock || 0,
    pieza.stockMinimo || 5,
    pieza.proveedor,
    pieza.tiempoEntrega,
    pieza.compatibilidad,
    pieza.imagen,
    pieza.activo !== false
  ];
  
  getSpreadsheet().getSheetByName('Catalogo').appendRow(row);
  return { success: true, data: pieza };
}

function updatePieza(pieza) {
  const sheet = getSpreadsheet().getSheetByName('Catalogo');
  const rowIndex = findRowById(sheet, pieza.id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Pieza no encontrada' };
  }
  
  const row = [
    pieza.id,
    pieza.codigo,
    pieza.nombre,
    pieza.categoria,
    pieza.descripcion,
    pieza.precio,
    pieza.stock,
    pieza.stockMinimo,
    pieza.proveedor,
    pieza.tiempoEntrega,
    pieza.compatibilidad,
    pieza.imagen,
    pieza.activo
  ];
  
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  return { success: true, data: pieza };
}

function deletePieza(id) {
  const sheet = getSpreadsheet().getSheetByName('Catalogo');
  const rowIndex = findRowById(sheet, id);
  
  if (rowIndex === -1) {
    return { success: false, error: 'Pieza no encontrada' };
  }
  
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// =====================================================
// SINCRONIZACION COMPLETA
// =====================================================

function syncAll(data) {
  try {
    inicializarHojas();
    
    // Sincronizar sucursales
    if (data.sucursales && Array.isArray(data.sucursales)) {
      clearAndReplace('Sucursales', data.sucursales, [
        'id', 'nombre', 'direccion', 'telefono', 'encargado', 'email', 'activa', 'fechaCreacion'
      ]);
    }
    
    // Sincronizar equipos
    if (data.equipos && Array.isArray(data.equipos)) {
      clearAndReplace('Equipos', data.equipos, [
        'id', 'nombre', 'modelo', 'serie', 'sucursalId', 'fechaInstalacion', 
        'pulsosIniciales', 'pulsosActuales', 'pulsosMaximos', 'estado', 
        'ultimoMantenimiento', 'proximoMantenimiento', 'notas'
      ]);
    }
    
    // Sincronizar tecnicos
    if (data.tecnicos && Array.isArray(data.tecnicos)) {
      clearAndReplace('Tecnicos', data.tecnicos, [
        'id', 'nombre', 'especialidad', 'telefono', 'email', 'activo', 'certificaciones', 'fechaIngreso'
      ]);
    }
    
    // Sincronizar reportes
    if (data.reportes && Array.isArray(data.reportes)) {
      const reportesFormateados = data.reportes.map(r => ({
        ...r,
        piezasUtilizadas: JSON.stringify(r.piezasUtilizadas || [])
      }));
      clearAndReplace('Reportes', reportesFormateados, [
        'id', 'numero', 'fecha', 'equipoId', 'tecnicoId', 'tipo', 'estado',
        'descripcion', 'diagnostico', 'trabajoRealizado', 'recomendaciones',
        'pulsosAntes', 'pulsosDespues', 'horaInicio', 'horaFin', 'piezasUtilizadas',
        'firmaCliente', 'firmaTecnico', 'observaciones', 'costo', 'garantia', 'fechaCreacion'
      ]);
    }
    
    // Sincronizar catalogo
    if (data.catalogo && Array.isArray(data.catalogo)) {
      clearAndReplace('Catalogo', data.catalogo, [
        'id', 'codigo', 'nombre', 'categoria', 'descripcion', 'precio', 
        'stock', 'stockMinimo', 'proveedor', 'tiempoEntrega', 'compatibilidad', 'imagen', 'activo'
      ]);
    }
    
    return { success: true, message: 'Sincronizacion completa exitosa' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function clearAndReplace(sheetName, data, fields) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return;
  
  // Mantener encabezados, borrar datos
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  
  // Agregar nuevos datos
  if (data.length > 0) {
    const rows = data.map(item => fields.map(field => item[field] ?? ''));
    sheet.getRange(2, 1, rows.length, fields.length).setValues(rows);
  }
}

// =====================================================
// FUNCIONES AUXILIARES
// =====================================================

function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function findRowById(sheet, id) {
  if (!sheet) return -1;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      return i + 1; // +1 porque las filas empiezan en 1
    }
  }
  return -1;
}

function sheetToArray(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  const headers = data[0];
  const result = [];
  
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      let value = data[i][j];
      // Convertir fechas a string ISO
      if (value instanceof Date) {
        value = value.toISOString();
      }
      // Convertir booleanos
      if (value === 'TRUE' || value === true) value = true;
      if (value === 'FALSE' || value === false) value = false;
      obj[headers[j]] = value;
    }
    result.push(obj);
  }
  
  return result;
}

function saveConfiguracion(config) {
  const sheet = getSpreadsheet().getSheetByName('Configuracion');
  if (!sheet) {
    inicializarHojas();
  }
  
  // Limpiar configuracion existente
  const configSheet = getSpreadsheet().getSheetByName('Configuracion');
  const lastRow = configSheet.getLastRow();
  if (lastRow > 1) {
    configSheet.deleteRows(2, lastRow - 1);
  }
  
  // Guardar nueva configuracion
  const rows = Object.entries(config).map(([key, value]) => [key, value]);
  if (rows.length > 0) {
    configSheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  
  return { success: true };
}

// =====================================================
// FUNCION DE PRUEBA - Ejecutar manualmente para verificar
// =====================================================
function testScript() {
  const result = inicializarHojas();
  Logger.log(result);
  
  const stats = getEstadisticas();
  Logger.log(stats);
}

// =====================================================
// MÓDULO CONTROL DE PULSOS — OPERADORAS
// =====================================================

function getOperadoras() {
  const sheet = getSpreadsheet().getSheetByName('Operadoras');
  if (!sheet) return { success: true, data: [] };
  return { success: true, data: sheetToArray(sheet) };
}

function addOperadora(op) {
  inicializarHojasPulsos();
  const sheet = getSpreadsheet().getSheetByName('Operadoras');
  const row = [op.OperadoraID, op.Nombre, op.Sucursal, op.Estado, op.Notas || ''];
  sheet.appendRow(row);
  return { success: true, data: op };
}

function updateOperadora(op) {
  const sheet = getSpreadsheet().getSheetByName('Operadoras');
  const rowIndex = findRowById(sheet, op.OperadoraID);
  if (rowIndex === -1) return { success: false, error: 'Operadora no encontrada' };
  sheet.getRange(rowIndex, 1, 1, 5).setValues([[op.OperadoraID, op.Nombre, op.Sucursal, op.Estado, op.Notas || '']]);
  return { success: true, data: op };
}

function deleteOperadora(id) {
  const sheet = getSpreadsheet().getSheetByName('Operadoras');
  const rowIndex = findRowById(sheet, id);
  if (rowIndex === -1) return { success: false, error: 'No encontrada' };
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// =====================================================
// MÓDULO CONTROL DE PULSOS — LECTURAS SEMANALES
// =====================================================

function getLecturasSemanales() {
  const sheet = getSpreadsheet().getSheetByName('LecturasSemanales');
  if (!sheet) return { success: true, data: [] };
  return { success: true, data: sheetToArray(sheet) };
}

function addLectura(lec) {
  inicializarHojasPulsos();
  const sheet = getSpreadsheet().getSheetByName('LecturasSemanales');
  const row = [
    lec.LecturaID, lec.FechaSemana, lec.EquipoID, lec.Sucursal,
    lec.Cabina, lec.OperadoraID, lec.LecturaInicial, lec.LecturaFinal,
    lec.DiferenciaReal, lec.Observaciones || ''
  ];
  sheet.appendRow(row);
  return { success: true, data: lec };
}

function updateLectura(lec) {
  const sheet = getSpreadsheet().getSheetByName('LecturasSemanales');
  const rowIndex = findRowById(sheet, lec.LecturaID);
  if (rowIndex === -1) return { success: false, error: 'Lectura no encontrada' };
  sheet.getRange(rowIndex, 1, 1, 10).setValues([[
    lec.LecturaID, lec.FechaSemana, lec.EquipoID, lec.Sucursal,
    lec.Cabina, lec.OperadoraID, lec.LecturaInicial, lec.LecturaFinal,
    lec.DiferenciaReal, lec.Observaciones || ''
  ]]);
  return { success: true, data: lec };
}

function deleteLectura(id) {
  const sheet = getSpreadsheet().getSheetByName('LecturasSemanales');
  const rowIndex = findRowById(sheet, id);
  if (rowIndex === -1) return { success: false, error: 'No encontrada' };
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// =====================================================
// MÓDULO CONTROL DE PULSOS — SESIONES CLIENTE
// =====================================================

function getSesionesCliente() {
  const sheet = getSpreadsheet().getSheetByName('SesionesCliente');
  if (!sheet) return { success: true, data: [] };
  return { success: true, data: sheetToArray(sheet) };
}

function addSesion(ses) {
  inicializarHojasPulsos();
  const sheet = getSpreadsheet().getSheetByName('SesionesCliente');
  const row = [
    ses.SesionID, ses.Fecha, ses.Sucursal, ses.Cabina,
    ses.OperadoraID, ses.Cliente, ses.AreaTrabajada,
    ses.DisparosReportados, ses.Duracion || '', ses.EquipoID, ses.Observaciones || ''
  ];
  sheet.appendRow(row);
  return { success: true, data: ses };
}

function updateSesion(ses) {
  const sheet = getSpreadsheet().getSheetByName('SesionesCliente');
  const rowIndex = findRowById(sheet, ses.SesionID);
  if (rowIndex === -1) return { success: false, error: 'Sesión no encontrada' };
  sheet.getRange(rowIndex, 1, 1, 11).setValues([[
    ses.SesionID, ses.Fecha, ses.Sucursal, ses.Cabina,
    ses.OperadoraID, ses.Cliente, ses.AreaTrabajada,
    ses.DisparosReportados, ses.Duracion || '', ses.EquipoID, ses.Observaciones || ''
  ]]);
  return { success: true, data: ses };
}

function deleteSesion(id) {
  const sheet = getSpreadsheet().getSheetByName('SesionesCliente');
  const rowIndex = findRowById(sheet, id);
  if (rowIndex === -1) return { success: false, error: 'No encontrada' };
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// =====================================================
// INICIALIZAR HOJAS DEL MÓDULO PULSOS
// =====================================================

function inicializarHojasPulsos() {
  const ss = getSpreadsheet();
  const hojas = [
    {
      nombre: 'Operadoras',
      encabezados: ['OperadoraID', 'Nombre', 'Sucursal', 'Estado', 'Notas']
    },
    {
      nombre: 'LecturasSemanales',
      encabezados: ['LecturaID', 'FechaSemana', 'EquipoID', 'Sucursal', 'Cabina',
                    'OperadoraID', 'LecturaInicial', 'LecturaFinal', 'DiferenciaReal', 'Observaciones']
    },
    {
      nombre: 'SesionesCliente',
      encabezados: ['SesionID', 'Fecha', 'Sucursal', 'Cabina', 'OperadoraID',
                    'Cliente', 'AreaTrabajada', 'DisparosReportados', 'Duracion', 'EquipoID', 'Observaciones']
    },
  ];

  hojas.forEach(hoja => {
    let sheet = ss.getSheetByName(hoja.nombre);
    if (!sheet) {
      sheet = ss.insertSheet(hoja.nombre);
      sheet.getRange(1, 1, 1, hoja.encabezados.length).setValues([hoja.encabezados]);
      sheet.getRange(1, 1, 1, hoja.encabezados.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });

  return { success: true, message: 'Hojas de pulsos inicializadas' };
}

// =====================================================
// CARGA COMPLETA MÓDULO PULSOS
// =====================================================

function getAllPulsosData() {
  inicializarHojasPulsos();
  return {
    ok: true,
    data: {
      operadoras: getOperadoras().data,
      lecturasSemanales: getLecturasSemanales().data,
      sesionesCliente: getSesionesCliente().data,
      auditoriasSemanales: [],  // se calculan en el frontend
    }
  };
}
