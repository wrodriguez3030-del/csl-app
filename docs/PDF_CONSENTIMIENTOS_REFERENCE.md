# Generación de PDF de consentimientos — Referencia (para otro sistema)

Cómo se generan los **PDF formales de consentimiento** (con datos del cliente,
texto legal fijo y **firma embebida**), en el servidor y **sin navegador headless**.
Verificado contra `consent-depilacion-pdf.ts` (motor genérico reusado por los 4 tipos).

---

## 1. Idea general
- Librería: **`pdf-lib`** (JS puro; no requiere Chromium/Puppeteer).
- El **cuerpo legal es FIJO** por tipo de consentimiento; solo cambian los **datos
  del cliente** y la **firma**.
- El mismo documento se **adjunta al correo** y/o se descarga.
- Multi-marca: el texto dice "Cibao Spa Laser" y se **reemplaza** por el nombre del
  negocio (Cibao/Depicenter) al generar.

---

## 2. Formato de página
| Parámetro | Valor |
|---|---|
| Tamaño | **US Letter** 612 × 792 pt |
| Margen | 42 pt |
| Fuentes | Helvetica + Helvetica-Bold (estándar PDF) |
| Color marca (teal) | `rgb(0, 0.537, 0.482)` (#00897B) |
| Texto | `rgb(0.07, 0.09, 0.11)` · Apagado `rgb(0.4,0.45,0.5)` |

---

## 3. Estructura del documento (de arriba a abajo)
1. **Encabezado:** nombre del negocio (centrado, teal, 16pt) · título (`CONSENTIMIENTO
   INFORMADO`) · subtítulo teal opcional · `Fecha de firma: … · Ref: {consent_id}` · línea teal.
2. **Datos del cliente** (banner teal "DATOS DEL CLIENTE" + tabla a **2 columnas**):
   Nombre · Teléfono · Cédula/Doc · Correo · Dirección (fila completa) · Sucursal · Especialista.
3. **Secciones legales** (cada una: banner teal en mayúsculas + párrafos con
   *word-wrap* + listas con viñeta `-` o numeradas). El contenido es fijo (ver §5).
4. **Caja de aceptación** opcional (ej. `[X] ACEPTO LAS POLÍTICAS DE LA EMPRESA`).
5. **Firma del cliente:** recuadro con la **imagen de la firma embebida** + leyenda
   `Firma del cliente - {nombre}`.
6. **Pie de página** en cada hoja: `{Negocio} - {etiqueta} - Ref {consent_id}`.

Salto de página automático cuando el contenido no cabe.

---

## 4. Motor genérico (reusable por los 4 consentimientos)

```
buildConsentPdf(row, businessName, cfg) -> Buffer(PDF)

cfg = {
  title:            "CONSENTIMIENTO INFORMADO",
  subtitle:         "PROCEDIMIENTO: ELIMINACIÓN DEL VELLO NO DESEADO",  // opcional
  especialistaLabel:"Especialista",                                     // opcional
  footerLabel:      "Consentimiento Depilación Láser",
  acceptBox:        "[X] ACEPTO LAS POLÍTICAS DE LA EMPRESA",           // opcional
  sections: [ { title, blocks: [ {kind:"p", runs}, {kind:"list", ordered?, items} ] } ]
}
```

- `runs` = arreglo de trozos de texto con **negrita opcional**: `[{s:"CONFIRMO", b:true}, {s:" que..."}]`.
  Helpers: `lead(bold, rest)` (item con intro en negrita) · `plain(text)` · `bullets(items)`.
- Cada tipo (Masajes/Peeling/Tatuajes/Depilación) llama a `buildConsentPdf` con su `cfg`.

---

## 5. Contenido legal (fijo, por tipo)

El texto legal va **hardcodeado** en un arreglo de secciones. Para **Depilación Láser**
son (ejemplo real):
Descripción del procedimiento · Confirmación del cliente · Instrucciones antes ·
Cuidados después · Consideraciones generales · Beneficios · Probabilidad de éxito ·
Riesgos y posibles complicaciones · Contraindicaciones · Declaraciones finales ·
Políticas y procedimientos · Protección de datos · Autorización.

> Cada consentimiento (Masajes, Peeling, Tatuajes/Cejas) tiene su propio juego de
> secciones legales, con el mismo motor. La **validez legal** se apoya en la firma
> electrónica del cliente (en RD, Ley 126-02 de Comercio Electrónico, Documentos y
> Firmas Digitales; y Ley 172-13 de protección de datos personales).

---

## 6. Firma embebida

```js
// row.firma_cliente = "data:image/png;base64,...."  (o image/jpeg)
const [, base64] = dataUrl.split(",", 2)
const bytes = Uint8Array.from(Buffer.from(base64, "base64"))
const img = dataUrl.includes("image/jpeg")
  ? await pdfDoc.embedJpg(bytes)
  : await pdfDoc.embedPng(bytes)
// escalar para caber en el recuadro de firma y dibujar centrada
```
Si la firma falla o no existe, el recuadro sale vacío (el PDF se genera igual).

---

## 7. Seguridad de codificación (importante con pdf-lib + Helvetica)
Las fuentes estándar solo codifican **WinAnsi/Latin-1**. Antes de dibujar, sanea:
- Conserva ASCII + Latin-1 (acentos `á é í ó ú ñ ü`); descarta lo no codificable.
- Reemplaza comillas tipográficas `“ ” ‘ ’` → `" '`, guiones `– —` → `-`,
  viñetas `• ·` → `-`, elipsis `…` → `...`, checks `☑ ✓ ✔` → `[X]`.
- Reemplaza el nombre de marca del texto por el negocio actual.

```js
function keepEncodable(s){ let o=""; for(const ch of s){ const c=ch.charCodeAt(0);
  if((c>=0x20&&c<=0x7e)||(c>=0xa0&&c<=0xff)) o+=ch; else if(/\s/.test(ch)) o+=" "; } return o }
```

---

## 8. Salida y uso
- `buildConsentPdf(...)` devuelve un **`Buffer`**.
- **Adjuntar al correo:** Gmail → `content: Buffer`; Resend → `content: buffer.toString("base64")`.
- **Descargar:** responder con `Content-Type: application/pdf`.
- Nombre sugerido: `consentimiento-{tipo}-{slug-del-cliente}.pdf`.

---

## 9. Datos que consume (de la fila del consentimiento)
`consent_id` · `fecha_registro`/`fecha` · `cliente_nombre` · `telefono` · `documento` ·
`correo` · `direccion` · `sucursal` · `especialista_nombre` · **`firma_cliente`**
(data-URL) · + los campos específicos del tipo (tipo, zona, fototipo, etc.).

---

*Referencia basada en la implementación real de CSL (`pdf-lib`, motor genérico
`buildConsentPdf` reusado por los 4 consentimientos, con firma embebida y texto legal
fijo). Sin datos reales.*
