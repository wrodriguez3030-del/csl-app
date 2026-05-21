var CSL_VERSION = 'CSL_UI_PRO_PULSE_2026_05_08';

var SHEETS = {
  sucursales: {
    name: 'Sucursales',
    key: 'Codigo',
    headers: ['Codigo', 'Nombre', 'Ciudad', 'Direccion', 'Estado', 'Notas', 'Correo', 'FechaRegistro']
  },
  equipos: {
    name: 'Equipos',
    key: 'EquipoID',
    headers: ['EquipoID', 'Sucursal', 'Empresa', 'Domicilio', 'Modelo', 'Serie', 'Numero', 'P_Cabeza', 'P_Totales', 'Max_Cabeza', 'Estado', 'Observaciones']
  },
  tecnicos: {
    name: 'Tecnicos',
    key: 'Codigo',
    headers: ['Codigo', 'Nombre', 'Telefono', 'Correo', 'Estado', 'Notas', 'FechaRegistro']
  },
  reportes: {
    name: 'Reportes',
    key: 'ID',
    headers: ['ID', 'Fecha', 'EquipoID', 'Sucursal', 'Empresa', 'Cliente', 'Domicilio', 'Ciudad', 'Modelo', 'Serie', 'Numero', 'Tipo', 'EstadoEquipo', 'Prioridad', 'Problema', 'Correccion', 'Observaciones', 'Checklist', 'P_Cabeza', 'P_Totales', 'Atendio', 'PiezasJSON', 'PartesTexto', 'FirmaCliente', 'FirmaTecnico', 'Fotos']
  },
  piezas: {
    name: 'CatalogoPiezas',
    key: 'Pieza',
    headers: ['Pieza', 'Categoria', 'Prioridad', 'Tipo', 'Funcion', 'FallasComunes', 'Activa']
  },
  pulseEquipos: {
    name: 'PulseEquipos',
    key: 'EquipoID',
    headers: ['EquipoID', 'Nombre', 'Sucursal', 'Cabina', 'Modelo', 'Serie', 'Estado', 'PulsosReferencia', 'Notas']
  },
  pulseOperadoras: {
    name: 'PulseOperadoras',
    key: 'OperadoraID',
    headers: ['OperadoraID', 'Nombre', 'Sucursal', 'Estado', 'Notas', 'FechaRegistro']
  },
  pulseLecturas: {
    name: 'PulseLecturas',
    key: 'LecturaID',
    headers: ['LecturaID', 'FechaSemana', 'EquipoID', 'Sucursal', 'Cabina', 'OperadoraID', 'LecturaInicial', 'LecturaFinal', 'DiferenciaReal', 'Observaciones']
  },
  pulseServicios: {
    name: 'PulseServicios',
    key: 'ServicioID',
    headers: ['ServicioID', 'Fecha', 'Sucursal', 'Cabina', 'OperadoraID', 'Cliente', 'AreaTrabajada', 'DisparosReportados', 'Duracion', 'EquipoID', 'Observaciones']
  },
  pulseMantenimientos: {
    name: 'PulseMantenimientos',
    key: 'MantenimientoID',
    headers: ['MantenimientoID', 'Fecha', 'EquipoID', 'Sucursal', 'Tipo', 'Descripcion', 'Tecnico', 'Estado', 'Costo', 'Observaciones']
  },
  consentMasajes: {
    name: 'ConsentMasajes',
    key: 'ConsentID',
    headers: ['ConsentID', 'Fecha', 'Sucursal', 'NombreCliente', 'Documento', 'Telefono', 'Correo', 'Direccion', 'FechaNacimiento', 'Edad', 'TipoMasaje', 'ZonaTratar', 'Observaciones', 'Contraindicaciones', 'Alergias', 'EnfermedadesAntecedentes', 'Embarazo', 'TextoConsentimiento', 'FirmaCliente', 'FirmaEspecialista', 'NombreEspecialista', 'Estado', 'FechaRegistro']
  },
  consentTatuajesCejas: {
    name: 'ConsentTatuajesCejas',
    key: 'ConsentID',
    headers: ['ConsentID', 'Fecha', 'Sucursal', 'NombreCliente', 'Documento', 'Telefono', 'Correo', 'Direccion', 'FechaNacimiento', 'Edad', 'ZonaTratar', 'TipoProcedimiento', 'ColorPigmento', 'TiempoAproximado', 'SesionesExplicadas', 'RiesgosExplicados', 'CuidadosAntes', 'CuidadosDespues', 'Observaciones', 'TextoConsentimiento', 'FirmaCliente', 'FirmaEspecialista', 'NombreEspecialista', 'Estado', 'FechaRegistro']
  },
  configuracion: {
    name: 'Configuracion',
    key: 'Clave',
    headers: ['Clave', 'Valor']
  }
};

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function setupInicial() {
  var ss = getSpreadsheet();
  Object.keys(SHEETS).forEach(function(entity) {
    ensureSheet_(ss, SHEETS[entity]);
  });
  seedBaseData_();
  return ok_({ message: 'Sistema inicializado correctamente', version: CSL_VERSION });
}

function doGet(e) {
  return route_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  var params = {};
  try {
    params = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
  } catch (err) {
    params = e && e.parameter ? e.parameter : {};
  }
  return route_(params);
}

function route_(params) {
  var callback = String(params.callback || '');
  try {
    var action = String(params.action || 'health');
    var result;
    setupSheetsOnly_();
    switch (action) {
      case 'health':
      case 'test':
        result = ok_({ message: 'Conexion exitosa', version: CSL_VERSION, timestamp: new Date().toISOString() });
        break;
      case 'setupInicial':
      case 'setup':
      case 'init':
        result = setupInicial();
        break;
      case 'getAllData':
        result = getAllData();
        break;
      case 'getAllPulsosData':
      case 'getPulseControlData':
        result = getAllPulsosData();
        break;
      case 'saveSucursal':
      case 'addSucursal':
      case 'updateSucursal':
        result = saveRecord_('sucursales', normalizeSucursal_(recordFrom_(params)));
        break;
      case 'deleteSucursal':
        result = deleteRecord_('sucursales', params.codigo || params.Codigo || params.id || params.rowNum);
        break;
      case 'setSucursalEstado':
        result = setRecordEstado_('sucursales', params.codigo || params.Codigo || params.id || params.rowNum, 'Estado', params.estado || params.Estado);
        break;
      case 'saveEquipo':
      case 'addEquipo':
      case 'updateEquipo':
        result = saveRecord_('equipos', normalizeEquipo_(recordFrom_(params)));
        break;
      case 'deleteEquipo':
        result = deleteRecord_('equipos', params.equipoId || params.EquipoID || params.id || params.rowNum);
        break;
      case 'setEquipoEstado':
        result = setRecordEstado_('equipos', params.equipoId || params.EquipoID || params.id || params.rowNum, 'Estado', params.estado || params.Estado);
        break;
      case 'saveTecnico':
      case 'addTecnico':
      case 'updateTecnico':
        result = saveRecord_('tecnicos', normalizeTecnico_(recordFrom_(params)));
        break;
      case 'deleteTecnico':
        result = deleteRecord_('tecnicos', params.codigo || params.Codigo || params.id || params.rowNum);
        break;
      case 'setTecnicoEstado':
        result = setRecordEstado_('tecnicos', params.codigo || params.Codigo || params.id || params.rowNum, 'Estado', params.estado || params.Estado);
        break;
      case 'saveReporte':
      case 'addReporte':
      case 'updateReporte':
        result = saveRecord_('reportes', normalizeReporte_(recordFrom_(params)));
        break;
      case 'deleteReporte':
        result = deleteRecord_('reportes', params.reportId || params.ID || params.id || params.rowNum);
        break;
      case 'savePieza':
      case 'addPieza':
      case 'updatePieza':
        result = saveRecord_('piezas', normalizePieza_(recordFrom_(params)));
        break;
      case 'deletePieza':
        result = deleteRecord_('piezas', params.pieza || params.Pieza || params.id || params.rowNum);
        break;
      case 'savePulseEquipo':
      case 'addPulseEquipo':
      case 'updatePulseEquipo':
        result = saveRecord_('pulseEquipos', normalizePulseEquipo_(recordFrom_(params)));
        break;
      case 'deletePulseEquipo':
        result = deleteRecord_('pulseEquipos', params.equipoId || params.EquipoID || params.id || params.rowNum);
        break;
      case 'savePulseOperadora':
      case 'saveOperadora':
      case 'addOperadora':
      case 'updateOperadora':
        result = saveRecord_('pulseOperadoras', normalizePulseOperadora_(recordFrom_(params)));
        break;
      case 'deletePulseOperadora':
      case 'deleteOperadora':
        result = deleteRecord_('pulseOperadoras', params.operadoraId || params.OperadoraID || params.id || params.rowNum);
        break;
      case 'savePulseLectura':
      case 'saveLectura':
      case 'addLectura':
      case 'updateLectura':
        result = saveRecord_('pulseLecturas', normalizePulseLectura_(recordFrom_(params)));
        break;
      case 'deletePulseLectura':
      case 'deleteLectura':
        result = deleteRecord_('pulseLecturas', params.lecturaId || params.LecturaID || params.id || params.rowNum);
        break;
      case 'savePulseServicio':
      case 'saveServicio':
      case 'saveSesion':
      case 'addSesion':
      case 'updateSesion':
        result = saveRecord_('pulseServicios', normalizePulseServicio_(recordFrom_(params)));
        break;
      case 'deletePulseServicio':
      case 'deleteServicio':
      case 'deleteSesion':
        result = deleteRecord_('pulseServicios', params.servicioId || params.ServicioID || params.sesionId || params.SesionID || params.id || params.rowNum);
        break;
      case 'savePulseMantenimiento':
      case 'saveMantenimiento':
      case 'addMantenimiento':
      case 'updateMantenimiento':
        result = saveRecord_('pulseMantenimientos', normalizePulseMantenimiento_(recordFrom_(params)));
        break;
      case 'deletePulseMantenimiento':
      case 'deleteMantenimiento':
        result = deleteRecord_('pulseMantenimientos', params.mantenimientoId || params.MantenimientoID || params.id || params.rowNum);
        break;
      case 'getConsentMasajes':
        result = ok_({ records: readRecords_('consentMasajes') });
        break;
      case 'saveConsentMasaje':
        result = saveRecord_('consentMasajes', normalizeConsentMasaje_(recordFrom_(params)));
        break;
      case 'deleteConsentMasaje':
        result = deleteRecord_('consentMasajes', params.consentId || params.ConsentID || params.id || params.rowNum);
        break;
      case 'getConsentTatuajesCejas':
        result = ok_({ records: readRecords_('consentTatuajesCejas') });
        break;
      case 'saveConsentTatuajeCeja':
        result = saveRecord_('consentTatuajesCejas', normalizeConsentTatuajeCeja_(recordFrom_(params)));
        break;
      case 'deleteConsentTatuajeCeja':
        result = deleteRecord_('consentTatuajesCejas', params.consentId || params.ConsentID || params.id || params.rowNum);
        break;
      default:
        result = fail_('Accion no soportada: ' + action);
    }
    return respond_(result, callback);
  } catch (err) {
    return respond_(fail_(err && err.message ? err.message : String(err)), callback);
  }
}

function getAllData() {
  setupInicial();
  var pulse = getPulseBundle_();
  return ok_({
    data: {
      sucursales: readRecords_('sucursales'),
      equipos: readRecords_('equipos'),
      tecnicos: readRecords_('tecnicos'),
      reportes: readRecords_('reportes'),
      piezas: readRecords_('piezas'),
      pulseEquipos: pulse.equipos,
      pulseOperadoras: pulse.operadoras,
      pulseLecturas: pulse.lecturas,
      pulseServicios: pulse.servicios,
      pulseMantenimientos: pulse.mantenimientos,
      consentMasajes: readRecords_('consentMasajes'),
      consentTatuajesCejas: readRecords_('consentTatuajesCejas'),
      pulseControl: pulse
    }
  });
}

function getAllPulsosData() {
  setupInicial();
  var pulse = getPulseBundle_();
  return ok_({
    data: pulse,
    equipos: pulse.equipos,
    operadoras: pulse.operadoras,
    lecturasSemanales: pulse.lecturas,
    sesionesCliente: pulse.servicios,
    servicios: pulse.servicios,
    mantenimientos: pulse.mantenimientos,
    auditoriasSemanales: calculateAuditorias_(pulse.lecturas, pulse.servicios)
  });
}

function getPulseBundle_() {
  return {
    equipos: readRecords_('pulseEquipos'),
    operadoras: readRecords_('pulseOperadoras'),
    lecturas: readRecords_('pulseLecturas'),
    servicios: readRecords_('pulseServicios'),
    mantenimientos: readRecords_('pulseMantenimientos')
  };
}

function setupSheetsOnly_() {
  var ss = getSpreadsheet();
  Object.keys(SHEETS).forEach(function(entity) {
    ensureSheet_(ss, SHEETS[entity]);
  });
}

function ensureSheet_(ss, config) {
  var sheet = ss.getSheetByName(config.name);
  if (!sheet) {
    sheet = ss.insertSheet(config.name);
  }
  var headers = config.headers;
  var existing = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0] : [];
  var changed = false;
  if (sheet.getLastRow() === 0 || String(existing[0] || '').trim() === '') {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    changed = true;
  } else {
    headers.forEach(function(header) {
      if (existing.indexOf(header) === -1) {
        existing.push(header);
        changed = true;
      }
    });
    if (changed) sheet.getRange(1, 1, 1, existing.length).setValues([existing]);
  }
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold').setBackground('#eef7fb');
  sheet.setFrozenRows(1);
  return sheet;
}

function readRecords_(entity) {
  var config = SHEETS[entity];
  var sheet = getSpreadsheet().getSheetByName(config.name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var range = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn());
  var values = range.getValues();
  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var empty = true;
    var obj = { _rowNum: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      var header = headers[c];
      if (!header) continue;
      var value = values[r][c];
      if (value instanceof Date) value = Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (value !== '' && value !== null) empty = false;
      obj[header] = value;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

function saveRecord_(entity, record) {
  var config = SHEETS[entity];
  var sheet = ensureSheet_(getSpreadsheet(), config);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var key = config.key;
  if (!record[key]) record[key] = makeId_(key);
  var rowNum = findRow_(sheet, headers, key, record[key], record._rowNum || record.rowNum);
  var row = headers.map(function(header) {
    var value = record[header];
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  });
  if (rowNum > 1) {
    sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    rowNum = sheet.getLastRow();
  }
  var saved = Object.assign({}, record, { _rowNum: rowNum });
  return ok_({ record: saved, data: saved });
}

function deleteRecord_(entity, idOrRow) {
  var config = SHEETS[entity];
  var sheet = ensureSheet_(getSpreadsheet(), config);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var rowNum = findRow_(sheet, headers, config.key, idOrRow, idOrRow);
  if (rowNum <= 1) return fail_('Registro no encontrado en ' + config.name);
  sheet.deleteRow(rowNum);
  return ok_({ deleted: true, rowNum: rowNum });
}

function setRecordEstado_(entity, idOrRow, field, estado) {
  var config = SHEETS[entity];
  var records = readRecords_(entity);
  var record = null;
  records.some(function(row) {
    if (String(row[config.key]) === String(idOrRow) || String(row._rowNum) === String(idOrRow)) {
      record = row;
      return true;
    }
    return false;
  });
  if (!record) return fail_('Registro no encontrado en ' + config.name);
  record[field] = estado;
  return saveRecord_(entity, record);
}

function findRow_(sheet, headers, key, keyValue, rowNum) {
  var numericRow = Number(rowNum || 0);
  if (numericRow > 1 && numericRow <= sheet.getLastRow()) return numericRow;
  var idx = headers.indexOf(key);
  if (idx < 0 || keyValue === undefined || keyValue === null || keyValue === '') return -1;
  if (sheet.getLastRow() < 2) return -1;
  var values = sheet.getRange(2, idx + 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(keyValue)) return i + 2;
  }
  return -1;
}

function recordFrom_(params) {
  if (params.payload) return parseJson_(params.payload);
  if (params.data) return parseJson_(params.data);
  if (params.record) return parseJson_(params.record);
  return params;
}

function parseJson_(value) {
  if (typeof value === 'object') return value || {};
  try {
    return JSON.parse(String(value || '{}'));
  } catch (err) {
    return {};
  }
}

function normalizeSucursal_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    Codigo: p.Codigo || p.codigo || p.id || '',
    Nombre: p.Nombre || p.nombre || '',
    Ciudad: p.Ciudad || p.ciudad || '',
    Direccion: p.Direccion || p.direccion || '',
    Estado: p.Estado || p.estado || (p.activa === false ? 'Inactiva' : 'Activa'),
    Notas: p.Notas || p.notas || '',
    Correo: p.Correo || p.correo || p.email || '',
    FechaRegistro: p.FechaRegistro || p.fechaRegistro || todayIso_()
  };
}

function normalizeEquipo_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    EquipoID: p.EquipoID || p.equipoId || p.id || '',
    Sucursal: p.Sucursal || p.sucursal || '',
    Empresa: p.Empresa || p.empresa || 'CIBAO SPA LASER, CSL, S.R.L.',
    Domicilio: p.Domicilio || p.domicilio || '',
    Modelo: p.Modelo || p.modelo || '',
    Serie: p.Serie || p.serie || '',
    Numero: p.Numero || p.numero || '',
    P_Cabeza: number_(p.P_Cabeza || p.pcabeza || p.pCabeza),
    P_Totales: number_(p.P_Totales || p.ptotales || p.pTotales),
    Max_Cabeza: number_(p.Max_Cabeza || p.maxCabeza || 6000000),
    Estado: p.Estado || p.estado || 'Activo',
    Observaciones: p.Observaciones || p.observaciones || ''
  };
}

function normalizeTecnico_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    Codigo: p.Codigo || p.codigo || p.id || '',
    Nombre: p.Nombre || p.nombre || '',
    Telefono: p.Telefono || p.telefono || '',
    Correo: p.Correo || p.correo || p.email || '',
    Estado: p.Estado || p.estado || (p.activo === false ? 'Inactivo' : 'Activo'),
    Notas: p.Notas || p.notas || '',
    FechaRegistro: p.FechaRegistro || p.fechaRegistro || todayIso_()
  };
}

function normalizeReporte_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    ID: p.ID || p.reportId || p.id || makeId_('RPT'),
    Fecha: date_(p.Fecha || p.fecha || todayIso_()),
    EquipoID: p.EquipoID || p.equipoId || '',
    Sucursal: p.Sucursal || p.sucursal || '',
    Empresa: p.Empresa || p.empresa || 'CIBAO SPA LASER, CSL, S.R.L.',
    Cliente: p.Cliente || p.cliente || '',
    Domicilio: p.Domicilio || p.domicilio || '',
    Ciudad: p.Ciudad || p.ciudad || 'Santiago',
    Modelo: p.Modelo || p.modelo || '',
    Serie: p.Serie || p.serie || '',
    Numero: p.Numero || p.numero || '',
    Tipo: p.Tipo || p.tipo || 'Preventivo',
    EstadoEquipo: p.EstadoEquipo || p.estadoEquipo || 'Operativo',
    Prioridad: p.Prioridad || p.prioridad || 'Baja',
    Problema: p.Problema || p.problema || '',
    Correccion: p.Correccion || p.correccion || '',
    Observaciones: p.Observaciones || p.observaciones || '',
    Checklist: p.Checklist || p.checklist || '',
    P_Cabeza: number_(p.P_Cabeza || p.pcabeza),
    P_Totales: number_(p.P_Totales || p.ptotales),
    Atendio: p.Atendio || p.atendio || '',
    PiezasJSON: p.PiezasJSON || p.piezasJson || '[]',
    PartesTexto: p.PartesTexto || p.partesTexto || '',
    FirmaCliente: p.FirmaCliente || p.firmaCliente || '',
    FirmaTecnico: p.FirmaTecnico || p.firmaTecnico || '',
    Fotos: p.Fotos || p.fotos || '[]'
  };
}

function normalizePieza_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    Pieza: p.Pieza || p.pieza || p.nombre || '',
    Categoria: p.Categoria || p.categoria || '',
    Prioridad: p.Prioridad || p.prioridad || 'Media',
    Tipo: p.Tipo || p.tipo || 'Consumible',
    Funcion: p.Funcion || p.funcion || '',
    FallasComunes: p.FallasComunes || p.fallasComunes || '',
    Activa: p.Activa || p.activa || 'Si'
  };
}

function normalizePulseEquipo_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    EquipoID: p.EquipoID || p.equipoId || p.id || '',
    Nombre: p.Nombre || p.nombre || 'GentleYAG',
    Sucursal: p.Sucursal || p.sucursal || '',
    Cabina: p.Cabina || p.cabina || '',
    Modelo: p.Modelo || p.modelo || 'Candela GentleYAG',
    Serie: p.Serie || p.serie || '',
    Estado: p.Estado || p.estado || 'Activo',
    PulsosReferencia: number_(p.PulsosReferencia || p.pulsosReferencia),
    Notas: p.Notas || p.notas || ''
  };
}

function normalizePulseOperadora_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    OperadoraID: p.OperadoraID || p.operadoraId || p.id || p.Nombre || p.nombre || '',
    Nombre: p.Nombre || p.nombre || '',
    Sucursal: p.Sucursal || p.sucursal || '',
    Estado: p.Estado || p.estado || 'Activa',
    Notas: p.Notas || p.notas || '',
    FechaRegistro: p.FechaRegistro || p.fechaRegistro || todayIso_()
  };
}

function normalizePulseLectura_(p) {
  var inicial = number_(p.LecturaInicial || p.lecturaInicial);
  var final = number_(p.LecturaFinal || p.lecturaFinal);
  return {
    _rowNum: p._rowNum || p.rowNum,
    LecturaID: p.LecturaID || p.lecturaId || p.id || makeId_('LEC'),
    FechaSemana: date_(p.FechaSemana || p.fechaSemana || p.fecha || todayIso_()),
    EquipoID: p.EquipoID || p.equipoId || '',
    Sucursal: p.Sucursal || p.sucursal || '',
    Cabina: p.Cabina || p.cabina || '',
    OperadoraID: p.OperadoraID || p.operadoraId || '',
    LecturaInicial: inicial,
    LecturaFinal: final,
    DiferenciaReal: number_(p.DiferenciaReal || p.diferenciaReal || (final - inicial)),
    Observaciones: p.Observaciones || p.observaciones || ''
  };
}

function normalizePulseServicio_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    ServicioID: p.ServicioID || p.SesionID || p.servicioId || p.sesionId || p.id || makeId_('SRV'),
    Fecha: date_(p.Fecha || p.fecha || todayIso_()),
    Sucursal: p.Sucursal || p.sucursal || '',
    Cabina: p.Cabina || p.cabina || '',
    OperadoraID: p.OperadoraID || p.operadoraId || '',
    Cliente: p.Cliente || p.cliente || '',
    AreaTrabajada: p.AreaTrabajada || p.areaTrabajada || '',
    DisparosReportados: number_(p.DisparosReportados || p.disparosReportados),
    Duracion: number_(p.Duracion || p.duracion),
    EquipoID: p.EquipoID || p.equipoId || '',
    Observaciones: p.Observaciones || p.observaciones || ''
  };
}

function normalizePulseMantenimiento_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    MantenimientoID: p.MantenimientoID || p.mantenimientoId || p.id || makeId_('PMT'),
    Fecha: date_(p.Fecha || p.fecha || todayIso_()),
    EquipoID: p.EquipoID || p.equipoId || '',
    Sucursal: p.Sucursal || p.sucursal || '',
    Tipo: p.Tipo || p.tipo || 'Preventivo',
    Descripcion: p.Descripcion || p.descripcion || '',
    Tecnico: p.Tecnico || p.tecnico || '',
    Estado: p.Estado || p.estado || 'Completado',
    Costo: number_(p.Costo || p.costo),
    Observaciones: p.Observaciones || p.observaciones || ''
  };
}

function normalizeConsentMasaje_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    ConsentID: p.ConsentID || p.id || p.consentId || makeId_('CM'),
    Fecha: date_(p.Fecha || p.fecha || todayIso_()),
    Sucursal: p.Sucursal || p.sucursal || '',
    NombreCliente: p.NombreCliente || p.nombreCliente || p.nombre || '',
    Documento: p.Documento || p.documento || p.cedula || '',
    Telefono: p.Telefono || p.telefono || '',
    Correo: p.Correo || p.correo || p.email || '',
    Direccion: p.Direccion || p.direccion || '',
    FechaNacimiento: date_(p.FechaNacimiento || p.fechaNacimiento || ''),
    Edad: p.Edad || p.edad || '',
    TipoMasaje: p.TipoMasaje || p.tipoMasaje || '',
    ZonaTratar: p.ZonaTratar || p.zonaTratar || '',
    Observaciones: p.Observaciones || p.observaciones || '',
    Contraindicaciones: p.Contraindicaciones || p.contraindicaciones || '',
    Alergias: p.Alergias || p.alergias || '',
    EnfermedadesAntecedentes: p.EnfermedadesAntecedentes || p.enfermedadesAntecedentes || '',
    Embarazo: p.Embarazo || p.embarazo || '',
    TextoConsentimiento: p.TextoConsentimiento || p.textoConsentimiento || '',
    FirmaCliente: p.FirmaCliente || p.firmaCliente || '',
    FirmaEspecialista: p.FirmaEspecialista || p.firmaEspecialista || '',
    NombreEspecialista: p.NombreEspecialista || p.nombreEspecialista || '',
    Estado: p.Estado || p.estado || 'Pendiente',
    FechaRegistro: p.FechaRegistro || p.fechaRegistro || new Date().toISOString()
  };
}

function normalizeConsentTatuajeCeja_(p) {
  return {
    _rowNum: p._rowNum || p.rowNum,
    ConsentID: p.ConsentID || p.id || p.consentId || makeId_('CTC'),
    Fecha: date_(p.Fecha || p.fecha || todayIso_()),
    Sucursal: p.Sucursal || p.sucursal || '',
    NombreCliente: p.NombreCliente || p.nombreCliente || p.nombre || '',
    Documento: p.Documento || p.documento || p.cedula || '',
    Telefono: p.Telefono || p.telefono || '',
    Correo: p.Correo || p.correo || p.email || '',
    Direccion: p.Direccion || p.direccion || '',
    FechaNacimiento: date_(p.FechaNacimiento || p.fechaNacimiento || ''),
    Edad: p.Edad || p.edad || '',
    ZonaTratar: p.ZonaTratar || p.zonaTratar || '',
    TipoProcedimiento: p.TipoProcedimiento || p.tipoProcedimiento || '',
    ColorPigmento: p.ColorPigmento || p.colorPigmento || '',
    TiempoAproximado: p.TiempoAproximado || p.tiempoAproximado || '',
    SesionesExplicadas: p.SesionesExplicadas || p.sesionesExplicadas || '',
    RiesgosExplicados: p.RiesgosExplicados || p.riesgosExplicados || '',
    CuidadosAntes: p.CuidadosAntes || p.cuidadosAntes || '',
    CuidadosDespues: p.CuidadosDespues || p.cuidadosDespues || '',
    Observaciones: p.Observaciones || p.observaciones || '',
    TextoConsentimiento: p.TextoConsentimiento || p.textoConsentimiento || '',
    FirmaCliente: p.FirmaCliente || p.firmaCliente || '',
    FirmaEspecialista: p.FirmaEspecialista || p.firmaEspecialista || '',
    NombreEspecialista: p.NombreEspecialista || p.nombreEspecialista || '',
    Estado: p.Estado || p.estado || 'Pendiente',
    FechaRegistro: p.FechaRegistro || p.fechaRegistro || new Date().toISOString()
  };
}

function seedBaseData_() {
  seedIfEmpty_('sucursales', [
    { Codigo: 'RV', Nombre: 'Rafael Vidal', Ciudad: 'Santiago', Direccion: 'Av. Rafael Vidal, Santiago', Estado: 'Activa', Correo: '' },
    { Codigo: 'LJ', Nombre: 'Los Jardines', Ciudad: 'Santiago', Direccion: 'Los Jardines Metropolitanos', Estado: 'Activa', Correo: '' },
    { Codigo: 'VO', Nombre: 'Villa Olga', Ciudad: 'Santiago', Direccion: 'Villa Olga', Estado: 'Activa', Correo: '' },
    { Codigo: 'LV', Nombre: 'La Vega', Ciudad: 'La Vega', Direccion: 'La Vega', Estado: 'Activa', Correo: '' }
  ]);
  seedIfEmpty_('piezas', [
    { Pieza: 'Lámparas', Categoria: 'Consumibles principales', Prioridad: 'Alta', Tipo: 'Consumible técnico', Funcion: 'Fuente de disparo del sistema láser', FallasComunes: 'Error 14.0, baja energía', Activa: 'Si' },
    { Pieza: 'Fibra óptica', Categoria: 'Óptica', Prioridad: 'Alta', Tipo: 'No consumible crítico', Funcion: 'Transmisión de energía', FallasComunes: 'Error 15.1, pérdida de potencia', Activa: 'Si' },
    { Pieza: 'Filtro de agua', Categoria: 'Hidráulico', Prioridad: 'Media-Alta', Tipo: 'Consumible', Funcion: 'Filtrado del circuito de enfriamiento', FallasComunes: 'Bajo flujo, temperatura alta', Activa: 'Si' },
    { Pieza: 'Handpiece', Categoria: 'Aplicadores', Prioridad: 'Alta', Tipo: 'No consumible crítico', Funcion: 'Aplicación del tratamiento', FallasComunes: 'No detectado, slider defectuoso', Activa: 'Si' },
    { Pieza: 'Pedal', Categoria: 'Control', Prioridad: 'Media', Tipo: 'No consumible', Funcion: 'Activación del disparo', FallasComunes: 'Error footswitch', Activa: 'Si' }
  ]);
  seedIfEmpty_('pulseEquipos', [
    { EquipoID: '4', Nombre: 'GentleYAG 4', Sucursal: 'Rafael Vidal', Cabina: 'Cabina 5', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'Rosa' },
    { EquipoID: '6', Nombre: 'GentleYAG 6', Sucursal: 'Rafael Vidal', Cabina: 'Cabina 4', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'Madelin' },
    { EquipoID: '7', Nombre: 'GentleYAG 7', Sucursal: 'Rafael Vidal', Cabina: 'Cabina 1', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'Diana' },
    { EquipoID: '8', Nombre: 'GentleYAG 8', Sucursal: 'Rafael Vidal', Cabina: 'Cabina 2', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'Emely' },
    { EquipoID: '9', Nombre: 'GentleYAG 9', Sucursal: 'Los Jardines', Cabina: 'Cabina 4', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'YAMILKA' },
    { EquipoID: '10', Nombre: 'GentleYAG 10', Sucursal: 'Los Jardines', Cabina: 'Cabina 1', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'Katherine' },
    { EquipoID: '11', Nombre: 'GentleYAG 11', Sucursal: 'Los Jardines', Cabina: 'Cabina 3', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'NAYELI' },
    { EquipoID: '13', Nombre: 'GentleYAG 13', Sucursal: 'Los Jardines', Cabina: 'Cabina 2', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'Lilian' },
    { EquipoID: '17', Nombre: 'GentleYAG 17', Sucursal: 'Villa Olga', Cabina: 'Cabina 1', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'Yessica' },
    { EquipoID: '19', Nombre: 'GentleYAG 19', Sucursal: 'Villa Olga', Cabina: 'Cabina 2', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'Eidylee' },
    { EquipoID: 'LV-01', Nombre: 'GentleYAG La Vega', Sucursal: 'La Vega', Cabina: 'Cabina 1', Modelo: 'Candela GentleYAG', Serie: '', Estado: 'Activo', PulsosReferencia: 0, Notas: 'Equipo La Vega' }
  ]);
  seedIfEmpty_('pulseOperadoras', [
    { OperadoraID: 'Rosa', Nombre: 'Rosa', Sucursal: 'Rafael Vidal', Estado: 'Activa' },
    { OperadoraID: 'Madelin', Nombre: 'Madelin', Sucursal: 'Rafael Vidal', Estado: 'Activa' },
    { OperadoraID: 'Diana', Nombre: 'Diana', Sucursal: 'Rafael Vidal', Estado: 'Activa' },
    { OperadoraID: 'Emely', Nombre: 'Emely', Sucursal: 'Rafael Vidal', Estado: 'Activa' },
    { OperadoraID: 'YAMILKA', Nombre: 'YAMILKA', Sucursal: 'Los Jardines', Estado: 'Activa' },
    { OperadoraID: 'Katherine', Nombre: 'Katherine', Sucursal: 'Los Jardines', Estado: 'Activa' },
    { OperadoraID: 'NAYELI', Nombre: 'NAYELI', Sucursal: 'Los Jardines', Estado: 'Activa' },
    { OperadoraID: 'Lilian', Nombre: 'Lilian', Sucursal: 'Los Jardines', Estado: 'Activa' },
    { OperadoraID: 'Yessica', Nombre: 'Yessica', Sucursal: 'Villa Olga', Estado: 'Activa' },
    { OperadoraID: 'Eidylee', Nombre: 'Eidylee', Sucursal: 'Villa Olga', Estado: 'Activa' }
  ]);
}

function seedIfEmpty_(entity, rows) {
  if (readRecords_(entity).length > 0) return;
  rows.forEach(function(row) {
    saveRecord_(entity, row);
  });
}

function calculateAuditorias_(lecturas, servicios) {
  var out = [];
  lecturas.forEach(function(lec) {
    var start = date_(lec.FechaSemana);
    var end = addDays_(start, 6);
    var reportados = servicios.filter(function(s) {
      var f = date_(s.Fecha);
      return f >= start && f <= end &&
        String(s.EquipoID) === String(lec.EquipoID) &&
        normalizeText_(s.Sucursal) === normalizeText_(lec.Sucursal) &&
        normalizeText_(s.Cabina) === normalizeText_(lec.Cabina);
    }).reduce(function(sum, s) {
      return sum + number_(s.DisparosReportados);
    }, 0);
    var reales = number_(lec.DiferenciaReal);
    var diff = reales - reportados;
    var pct = reales ? Math.round((diff / reales) * 10000) / 100 : 0;
    out.push({
      AuditoriaID: 'AUD-' + lec.LecturaID,
      FechaSemana: lec.FechaSemana,
      EquipoID: lec.EquipoID,
      Sucursal: lec.Sucursal,
      PulsosReales: reales,
      PulsosReportados: reportados,
      Diferencia: diff,
      PorcentajeDesviacion: pct,
      Alerta: Math.abs(pct) <= 5 ? 'OK' : Math.abs(pct) <= 15 ? 'Advertencia' : 'Critico',
      Observaciones: ''
    });
  });
  return out;
}

function respond_(result, callback) {
  var json = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function ok_(extra) {
  var result = { ok: true, success: true };
  Object.keys(extra || {}).forEach(function(key) { result[key] = extra[key]; });
  return result;
}

function fail_(message) {
  return { ok: false, success: false, error: message };
}

function makeId_(prefix) {
  return String(prefix || 'ID') + '-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function todayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function date_(value) {
  var text = String(value || '').trim();
  if (!text) return todayIso_();
  var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var local = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (local) return local[3] + '-' + ('0' + local[2]).slice(-2) + '-' + ('0' + local[1]).slice(-2);
  return text;
}

function addDays_(iso, days) {
  var d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function number_(value) {
  var n = Number(String(value || 0).replace(/[^\d.-]/g, ''));
  return isFinite(n) ? n : 0;
}

function normalizeText_(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
