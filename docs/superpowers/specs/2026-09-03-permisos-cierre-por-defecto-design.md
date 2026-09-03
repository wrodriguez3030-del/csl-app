# Permisos con cierre por defecto — diseño

**Fecha:** 2026-09-03 · **Versión:** v0.119.0 · **Estado:** implementado, en modo sombra

## El problema

Los menús decidían lo que cada persona **veía**. La API no comprobaba nada.

Las 360 acciones del despachador `/api/csl` corrían con solo estar autenticado. Los 21
usuarios activos podían invocar cualquiera de las 53 acciones de escritura de RR.HH.
—nómina, cuentas bancarias de empleados, archivos TXT del banco, préstamos, prestaciones,
PIN de ponche— tuvieran o no el menú correspondiente. Solo seis módulos (Compras,
Incentivos, BI, Gastos, Credenciales, Certificados) llamaban a `requirePermission`: 72
sitios sobre 217 acciones de escritura.

Y no había forma de arreglarlo concediendo permisos, porque **conceder no funcionaba**: la
pantalla de Usuarios enviaba `permissions` al servidor, `saveUser` los recibía y los tiraba
en silencio. El usuario veía «guardado» y no se guardaba nada. Los 12 permisos que existían
en producción se habían insertado a mano por SQL. Ese es el origen del «Wanda no puede
importar ventas» de agosto.

## Decisiones tomadas

| # | Decisión | Elegido |
|---|---|---|
| 1 | Alcance | Cierre por defecto en todo el sistema, con prueba que rompe la construcción |
| 2 | Día uno | Heredar del menú, salvo la caja fuerte |
| 3 | Granularidad | `ver`/`gestionar` por módulo + permisos con nombre para lo delicado |
| 4 | Caja fuerte | Deudas y salidas · Identidad y asistencia · Borrar registros |
| 5 | Cuenta «Cibao» | Es de una persona: conserva nómina y TXT bancario |
| 6 | Cuentas que son máquinas | Los tres kioskos con cero permisos |
| 7 | `1@willian.com` | No se toca; el registro de sombra dirá si la comparten |
| 8 | Configuración sensible | Cuarto grupo de caja fuerte: llaves y configuración |
| 9 | Encendido | Un solo interruptor: todo en sombra 7 días, luego estricto |
| 10 | Un solo superadministrador | Se mantiene; aviso cuando alguien choca con la caja fuerte |
| 11 | Alcance de la entrega | Permisos solos; las fugas de tenant D3–D9 van aparte |

## Arquitectura

Un solo mapa, un solo punto de aplicación. No 217 guardias repartidas: así es exactamente
como se llegó aquí.

```
lib/permissions/catalog.ts      93 permisos, 4 grupos de caja fuerte
lib/permissions/action-map.ts   361 acciones → permiso; 22 entidades; 16 rutas
lib/permissions/inherit.ts      menú → permisos, solo para el arranque
lib/server/permission-gate.ts   la puerta: sombra o estricto, y el registro
```

**Punto de aplicación:** `dispatchAction` en `app/api/csl/_handlers.ts`, junto a la guardia
de Credenciales que ya existía. Una línea.

**Una acción que no esté en el mapa se rechaza.** Es el cierre por defecto: lo nuevo nace
cerrado, no abierto.

### Tres casos que un mapa plano no cubre

1. **`getRowsPaged`** recibe la entidad como parámetro, así que un permiso único no la
   protege. Se resuelve por entidad (`ENTITY_PERMISSIONS`). De paso cierra el agujero por
   el que `credenciales` se leía saltándose el TOTP.
2. **`getAllData`** la carga la portada, o sea todo el mundo. Negarla entera dejaría a media
   empresa sin pantalla de inicio, así que el handler **recorta** lo que va dentro: quien no
   puede ver mantenimiento o consentimientos los recibe vacíos.
3. **Las rutas fuera del despachador.** Hay 20; once escriben con sesión válida y ninguna
   comprobación: documentos de RR.HH., documentos de mantenimiento, facturas de compras,
   importador de clientes de AgendaPro, credenciales de AgendaPro, lecturas del láser, OCR,
   correo del sistema, clave de OpenAI. `enforceRoutePermission` las cubre con un contexto
   explícito (no todas corren dentro de `runWithBusinessContext`).
   `/api/admin/users*` queda fuera a propósito: ya exige `requireSuperadmin`, más estricto
   que cualquier permiso.

### Quién se salta qué

| | Permisos corrientes | Caja fuerte |
|---|---|---|
| Superadministrador | se los salta | se los salta |
| `is_admin` corriente | se los salta | **no** |
| Usuario normal | por su lista | por su lista |

Hay tres administradores que no son el dueño (`wanda@depicenter.com`,
`admindepicenter@gmail.com`, `1@willian.com`). Si `is_admin` abriera la caja fuerte, no
sería una caja fuerte. `hasPermission` (servidor) y `canPerm` (UI) aplican la misma regla.

## La caja fuerte

Nace cerrada, no se hereda del menú, y solo el superadministrador la concede.

| Grupo | Permisos |
|---|---|
| Deudas y salidas | `rrhh.prestamos` · `rrhh.prestaciones` · `rrhh.doble_sueldo` |
| Identidad y asistencia | `rrhh.ponche.pin` · `rrhh.ponche.dispositivos` · `rrhh.ponche.anular` |
| Borrar registros | `rrhh.borrar` · `clientes.borrar` · `clientes.fusionar` |
| Llaves y configuración | `config.llaves` · `usuarios.gestionar` |

**Se heredan** (decisión del dueño): `rrhh.nomina`, `rrhh.banco_txt`,
`rrhh.cuentas_bancarias`. La cuenta `cibaospalaser@gmail.com` los conserva.

**Consecuencias asumidas:** las tres encargadas de sucursal dejan de poder corregir un
ponche mal marcado, y la cuenta «Cibao» pierde los préstamos aunque conserve la nómina.
Ambas cosas se piden al dueño.

## Encendido en dos tiempos

Con 361 acciones y 17 personas, la probabilidad de que el mapa esté perfecto a la primera es
baja. Por eso no se enciende de golpe.

`PERMISOS_ESTRICTOS` sin definir → **modo sombra**: comprueba, no bloquea, y anota en
`csl_permission_denials` con IP y navegador. Siete días con gente trabajando de verdad.
`PERMISOS_ESTRICTOS=on` → **estricto**: rechaza con 403 y anota igual. Volver atrás es
quitar la variable; no hace falta desplegar.

La pantalla **Administración › Permisos y rechazos** (solo superadministrador) muestra, por
persona y permiso, qué se está negando. Es literalmente la tarea pendiente antes de cerrar.

## Errores

Antes, la falta de permiso salía como **HTTP 500**: indistinguible de que la app se hubiera
caído. Ahora es **403**, y el mensaje nombra el permiso que falta —«No tienes permiso para
correr y aprobar la nómina (`rrhh.nomina`). Pídeselo al administrador.»— para que el dueño
sepa qué conceder sin llamar a nadie.

## Conceder permisos

`saveUser` ahora persiste `permissions`. Dos guardias:

- Un `is_admin` que no sea superadministrador **conserva intactos** los permisos de caja
  fuerte que el usuario ya tuviera: ni los concede ni los quita sin querer.
- Todo cambio se registra en `csl_permission_changes` (antes, después, quién, cuándo). Es
  también el respaldo para deshacer.

La pantalla de Usuarios muestra la caja fuerte deshabilitada y explicada para quien no puede
concederla.

## El arranque

`scripts/migrar-permisos-desde-menus.mjs` deriva los permisos de los menús. Por defecto
**solo imprime**; escribe con `--aplicar`. Aborta si la herencia intenta conceder caja
fuerte.

Dos exclusiones:

1. La caja fuerte nunca se hereda.
2. **Los permisos que ya existían tampoco.** Compras, Incentivos, BI, Credenciales,
   Certificados e Integraciones ya estaban cerrados con `requirePermission`: derivarlos del
   menú regalaría accesos que hoy nadie tiene. Cada usuario conserva los suyos.

Resultado aplicado el 03/09/2026: **134 permisos a 14 usuarios**. Los tres kioskos se quedan
en cero —marcan por `/api/public/punch` con `device_token`, no necesitan permiso de nadie— y
los cuatro administradores no se tocan.

## Pruebas

`pnpm test:permisos` (12 comprobaciones) rompe la construcción si:

- una acción del despachador no declara permiso, o el mapa declara una que ya no existe;
- se cita un permiso que no está en el catálogo, o hay ids duplicados;
- una entidad de `getRowsPaged` se queda sin permiso;
- una ruta declarada no llama a `enforceRoutePermission` (declarar sin aplicar es mentir);
- una ruta autenticada fuera del despachador no está declarada ni exenta;
- una acción delicada cambia de permiso (nómina, préstamos, anular ponche, fusionar
  clientes…);
- `getRowsPaged` deja de resolverse por entidad;
- se marcan más de 8 acciones como públicas.

## Lo que este trabajo NO hace

- No toca las fugas de tenant pendientes (D3–D9). Van en su propia entrega.
- No crea perfiles predefinidos ni permisos por sucursal: `user_branch_permissions` ya
  existe y es otra cosa.
- No reescribe las 72 llamadas a `requirePermission` de los seis módulos ya cerrados. El
  mapa es la autoridad; las de dentro se quedan como segunda cerradura.
- No enciende el modo estricto. Eso es una decisión con fecha, tras leer la pantalla.

## Deuda que este trabajo destapó

- **La auditoría de RR.HH. tiene 5 filas en total**, de junio, y nunca ha guardado IP ni
  navegador. «La auditoría dirá quién fue» es hoy falso. El registro nuevo sí las guarda.
- **`1@willian.com` («WILLIAN ADM CIBAO»)** es administradora y no se sabe si la comparten.
  Los siete días de sombra lo responden con IP y navegador.
