# Consentimientos: marca por tenant (Depicenter vs CSL) + logo + WhatsApp

Fecha: 2026-07-17

## Problema

Con el tenant **Depicenter** los consentimientos salían a nombre de **"Cibao Spa
Laser"**. La marca ya está dividida a nivel de datos (tabla `businesses`:
Depicenter `name="Depicenter Skin Laser"`, `logo_url="/brands/depicenter-logo.jpg"`,
`primary_color="#1FB5AE"`) y el encabezado del impreso interno ya era tenant-aware,
pero el **texto legal del cuerpo** y los **formularios públicos** tenían el nombre
"Cibao Spa Laser" escrito literal (~154 ocurrencias en 8 archivos). Además los
formularios públicos no mostraban el **logo** (solo el nombre en texto).

## Objetivo

1. Todo consentimiento (interno y público) usa el nombre del tenant activo.
2. Se agrega el **logo del tenant** (imagen) al encabezado, incluidos los públicos.
3. Los tenants quedan **separados**: Depicenter → Depicenter, CSL → CSL. Sin regresión.
4. Revisar el envío por WhatsApp de punta a punta.

## Fuente única de marca

`getBusinessBranding(slug)` en `lib/business.ts` → `{ name, logoUrl, primaryColor,
footerText }`. Ningún texto vuelve a hardcodear la marca.

## Enfoque

- **Impresos/PDF (strings HTML):** red de seguridad al final del builder —
  `html.replaceAll("Cibao Spa Laser", brand).replaceAll("Cibao Spa Láser", brand)` —
  para cubrir el cuerpo legal sin editar cada frase, más encabezado con logo
  (`<img>`), color del tenant y pie con el nombre del tenant.
- **Vista en pantalla (JSX):** los literales de marca pasan a `{businessName}` y las
  listas de constantes se envuelven con un helper `brand(text)`; se agrega `<img>`
  del logo en el encabezado del documento.
- **Guardado:** `textoConsentimiento` se normaliza al tenant en el `payload` de save
  (no se persiste "Cibao Spa Laser" bajo Depicenter).

## Archivos

- `components/consentimientos-page.tsx` — interno (masajes/peeling/tatuajes/depilación):
  `printConsent` + sub-componentes `*TemplateSections` reciben `brandName`; save normaliza.
- `components/public-depilacion-laser-consent-form.tsx` (referencia) + `public-masajes-`,
  `public-peeling-`, `public-tatuajes-`, `public-ficha-consent-form.tsx` — usan
  `getBusinessBranding(businessSlug)`, logo, color, red de seguridad.
- `components/cosmiatria-ficha-page.tsx` + `lib/dermo-server.ts` — ficha dermatológica
  (pantalla + PDF + correo) tenant-aware.
- `app/api/public-form-links/route.ts` — el nombre del mensaje de WhatsApp sale de la
  tabla `businesses` (se elimina el fallback duro a "Cibao Spa Laser").

## Verificación

- `pnpm build` compila.
- Generar/imprimir un consentimiento con tenant Depicenter → nombre y logo Depicenter
  en encabezado, cuerpo y pie; CSL sigue mostrando CSL.
- Flujo WhatsApp: mensaje con el nombre del tenant + el formulario público abierto por
  el cliente muestra la marca del tenant (nombre + logo).
