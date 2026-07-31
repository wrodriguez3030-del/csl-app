# Consentimientos enviados por correo — Referencia (para otro sistema)

Documenta los **correos de consentimiento** que envía CSL: cuándo se disparan, a
quién, con qué asunto/adjunto y la **estructura HTML** de cada uno. Verificado contra
`csl-email.ts` + `_handlers.ts`.

> Depende del mecanismo de envío descrito en `ENVIO_CORREO_REFERENCE.md`
> (Gmail del negocio por SMTP + respaldo Resend).

---

## 1. Tipos de consentimiento que se envían

| Consentimiento | Asunto del correo | PDF adjunto |
|---|---|---|
| **Masajes** | `Consentimiento Masajes · {cliente}` | `consentimiento-masajes-{cliente}.pdf` |
| **Eliminación Tatuajes / Cejas** | `Consentimiento Tatuajes/Cejas · {cliente}` | `consentimiento-tatuajes-cejas-{cliente}.pdf` |
| **Peeling** | `Consentimiento Peeling · {cliente}` | `consentimiento-peeling-{cliente}.pdf` |
| **Depilación Láser** | `Consentimiento Depilación Láser · {cliente}` | `consentimiento-depilacion-laser-{cliente}.pdf` |

*(La Ficha Dermatológica usa la misma infraestructura de envío.)*

---

## 2. Cuándo se envía (trigger)

Al **guardar/registrar** el consentimiento (acción de guardado en el backend):
1. Se hace `upsert` del consentimiento en su tabla (`csl_consent_masajes`, `_peeling`,
   `_tatuajes_cejas`, `_depilacion_laser`).
2. Se sincroniza la ficha del cliente.
3. Se **envía el correo** con el resumen + PDF.

> El envío **nunca rompe el guardado**: si el correo falla, se captura el error y se
> devuelve un `warning` al frontend (el consentimiento queda guardado igual).

---

## 3. Destinatarios (`to`)

Por tenant (Cibao ≠ Depicenter). Se combinan, sin duplicados:
1. **Buzón interno del negocio** = la cuenta Gmail configurada del negocio
   (`csl_email_settings.gmail_user`). Si no hay, el correo de contacto de marca del tenant.
2. **Correo del cliente** (`row.correo`), si es un email válido.

- **From:** el Gmail del negocio (`Nombre del Negocio <negocio@gmail.com>`).
- **Reply-To:** la misma cuenta (las respuestas del cliente llegan al negocio).

---

## 4. Estructura HTML (plantilla común)

Todos comparten el mismo diseño con la marca del negocio:

```html
<!doctype html><html><body style="font-family:Arial,sans-serif;color:#102A3A;background:#F7FAFC;padding:24px">
  <div style="max-width:760px;margin:0 auto;background:#FFF;border:1px solid #E1ECF2;border-radius:14px;overflow:hidden">
    <!-- Encabezado con degradado turquesa de marca -->
    <div style="background:linear-gradient(90deg,#14B7B0,#22C7C9);padding:18px 22px;color:#FFF">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.9">{NOMBRE DEL NEGOCIO}</div>
      <h1 style="margin:4px 0 0;font-size:22px">{TÍTULO DEL CONSENTIMIENTO}</h1>
    </div>
    <!-- Cuerpo: tabla de campos (label + valor) -->
    <div style="padding:18px 22px">
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="font-weight:700;color:#0B3442;padding:7px;width:200px">Campo</td>
            <td style="padding:7px;color:#102A3A">Valor</td></tr>
        <!-- ...un <tr> por cada campo (ver §5)... -->
      </table>
      <!-- Firma del cliente (imagen data-URL) -->
      <div><img src="{firma_cliente}" style="max-width:320px;border:1px solid #E1ECF2;padding:6px;border-radius:8px" /></div>
    </div>
    <!-- Pie -->
    <div style="padding:14px 22px;background:#F7FAFC;border-top:1px solid #E1ECF2;font-size:11px;color:#64748B">
      Notificación generada automáticamente por el Sistema Integral.
    </div>
  </div>
</body></html>
```

**Detalles:**
- **Escapar** todos los valores (HTML escape) para evitar inyección.
- Las **listas/checklists** (contraindicaciones, cuidados, riesgos, políticas) se
  renderizan como `<ul><li>` cuando el campo es un arreglo.
- Campos **Sí/No con nota** se muestran como `Sí · {nota}`.
- La **firma** del cliente es una imagen `data:image/png;base64,...` embebida.
- Colores de marca: turquesa `#14B7B0`/`#22C7C9`, texto `#102A3A`, títulos `#0B3442`.

---

## 5. Campos por consentimiento

**Comunes a todos:** ID · Fecha · Sucursal · Estado · Cliente · Documento · Teléfono ·
Correo · Especialista · **Firma del cliente**.

### 5.1 Masajes — *"Consentimiento de Masajes registrado"*
- Tipo de masaje · Zona a tratar · Presión preferida · Embarazo (Sí·nota) · Alergias (Sí·nota)
- Checklists: Instrucciones marcadas · Contraindicaciones marcadas · Políticas aceptadas
- Observaciones médicas · Observaciones especialista
- Declaración aceptada (Sí/No) · Autorización aceptada (Sí/No)

### 5.2 Eliminación Tatuajes / Cejas
- Tipo de procedimiento · Zona a tratar · Tipo de pigmento · Colores · Antigüedad aprox. · Tamaño aprox.
- Sesiones previas (Sí·cantidad) · Reacción previa al láser · Embarazo/Lactancia (Sí·nota) ·
  Alergias (Sí·nota) · Medicamentos (Sí·nota) · Exposición solar reciente (Sí·nota) ·
  Antecedentes de queloides (Sí·nota)
- Observaciones del pigmento · Observaciones del especialista
- Checklists: Instrucciones · Cuidados después · Riesgos aceptados · Políticas aceptadas
- Declaración sobre resultados · Autorización fotográfica · Autorización del procedimiento

### 5.3 Peeling — *"Consentimiento Informado para Peeling"*
- Tipo de peeling · Zona a tratar · Observaciones médicas · Observaciones especialista
- Checklists: Contraindicaciones declaradas · Cuidados antes · Cuidados después · Riesgos aceptados · Políticas aceptadas
- Acepta procedimiento (Sí/No) · Acepta riesgos · Acepta políticas · Acepta protección de datos

### 5.4 Depilación Láser — *"Consentimiento Informado para Depilación Láser"*
- Tipo de depilación · Zona a tratar · Fototipo · Tipo de vello · Observaciones médicas · Observaciones especialista
- Checklists: Contraindicaciones declaradas · Cuidados antes · Cuidados después · Riesgos aceptados · Políticas aceptadas
- Acepta procedimiento (Sí/No) · Acepta riesgos · Acepta políticas · Acepta protección de datos

---

## 6. Adjunto (PDF formal)

- Se genera el **PDF formal del consentimiento** (el mismo que descarga el navegador)
  y se adjunta.
- Nombre: `consentimiento-{tipo}-{slug-del-cliente}.pdf`.
- Si la generación del PDF falla, **el correo se envía igual** (sin adjunto).
- Formato del adjunto: binario (`Buffer`) por Gmail; base64 por Resend.

---

## 7. Origen de los datos

Cada campo se lee de **dos fuentes**, en este orden:
1. **Columnas dedicadas** de la tabla del consentimiento (`tipo_masaje`, `zona_tratar`,
   `firma_cliente`, `estado`, `correo`, etc.).
2. **`payload_json`** — donde viajan los campos nuevos: listas (`contraindicacionesList`,
   `instruccionesAntes`, `cuidadosDespuesList`, `riesgosAceptadosList`, `politicasAceptadas`),
   Sí/No con notas, y aceptaciones (`aceptaProcedimiento`, `autorizacionFotograficaAceptada`…).

---

## 8. Pseudocódigo del envío (por tipo)

```
guardarConsentimiento(tipo, row, businessId):
  upsert(tabla_del_tipo, row)
  sincronizarFichaCliente(row.cliente)
  try:
    to      = [buzonInternoDelNegocio(businessId), row.correo válido]  (dedup)
    subject = "Consentimiento {tipo} · {row.cliente_nombre}"
    html    = plantilla(row)                     // §4 + campos §5
    pdf     = generarPdfConsentimiento(row)       // opcional; si falla, sin adjunto
    enviarCorreoDelNegocio(businessId, { to, subject, html, adjunto: pdf },
                           respaldoResend)         // Gmail → si falla, Resend
  catch (e):
    // nunca romper el guardado; devolver warning
    return { guardado: true, correo: { enviado:false, warning: e.message } }
```

---

*Referencia basada en la implementación real de CSL (4 consentimientos: Masajes,
Tatuajes/Cejas, Peeling, Depilación Láser). Emails HTML con marca del negocio, tabla
de campos, firma del cliente y PDF adjunto; enviados al guardar, al buzón del negocio +
correo del cliente. Sin datos reales.*
