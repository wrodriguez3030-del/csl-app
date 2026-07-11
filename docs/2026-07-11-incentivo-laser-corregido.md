# Incentivo de depilación láser — lógica corregida y completa · v0.35.0

Fecha: 2026-07-11 · Supabase: **solo local db-cls** (no Cloud)

Corrige y completa el cálculo del **incentivo de venta de depilación láser**
según spec del usuario. Reutiliza el motor de comisión (no crea módulo paralelo).

## Fórmula final aplicada (POR SUCURSAL, por mes)

```
venta_laser_bruta        = Σ ventas DEPILACIÓN LÁSER de la sucursal
descuento_tarjeta_laser  = venta_laser_tarjeta × %tarjeta   (default 27%, editable)
base_laser_neta          = venta_laser_bruta − descuento_tarjeta_laser
fondo_incentivo_laser    = base_laser_neta × % del MAYOR tramo alcanzado
                           (escala 260k→2% · 600k→3% · 800k→4% · 2M→5%, editable)

fondo_personas  = fondo × peso_personas   (default 50%)
fondo_pacientes = fondo × peso_pacientes  (default 50%)   [peso_personas+peso_pacientes = 100%]

monto_por_persona(i)   = reparto EXACTO de fondo_personas en partes iguales entre el personal que aplica
monto_por_pacientes(i) = reparto EXACTO de fondo_pacientes según pacientes_i / total_pacientes
total_incentivo(i)     = monto_por_persona(i) + monto_por_pacientes(i)
Σ total_incentivo      = fondo   (CUADRE EXACTO al centavo — método del mayor resto)
```

Regla configurable **"empleado con 0 pacientes recibe parte fija"**: si es *No*,
el empleado sin pacientes queda fuera del reparto por personas.

## Validado (Junio 2026, db-cls, `_smoke-calculo-mensual.mjs`)

| Sucursal | Base neta | Tramo | Fondo | Distribuido | Cuadre |
|---|---|---|---|---|---|
| RAFAEL VIDAL | 711,574.50 | 3% | 21,347.24 | 21,347.24 | **0.00** |
| LOS JARDINES | 460,976.00 | 2% | 9,219.52 | 9,219.52 | **0.00** |
| VILLA OLGA | 349,100.00 | 2% | 6,982.00 | 6,982.00 | **0.00** |

`test:commission` **117/117** · `tsc` 0 · `build` OK.

## Piezas

- **Motor** `run-engine.ts`: `allocateExact` (mayor resto → cuadre exacto);
  reparto solo entre personal ELEGIBLE del roster (pacientes de quien no aplica
  no diluyen ni reciben, spec §15); `zeroPatientsGetsFixed`.
- **Reglas** `rules.ts` + migración **`202607110003`** (aplicada a db-cls,
  aditiva): `laser_weight_personas`/`laser_weight_pacientes` (50/50),
  `laser_zero_patients_fixed` (Sí), `laser_card_discount_before_scale` (Sí).
- **Server** `commission.ts`: `getCommissionLaserDetail` (resumen + personal por
  sucursal + validaciones §11), roster CRUD (`saveCommissionCollaborator` /
  `setCommissionCollaboratorActive` / `deleteCommissionCollaborator` soft),
  `readRunRules` deriva la fracción de los pesos, `applyCommissionLaser` usa el
  reparto corregido por sucursal.
- **UI**: `LaserPersonnelEditor` (roster, sin hardcode) en Reglas y en la
  pantalla láser; Reglas con toggle Sí/No para banderas + validación de pesos;
  pantalla "Comisión depilación láser" rediseñada (resumen + personal + cuadre +
  Excel/PDF + Aplicar a liquidación) con `lib/commission/laser-export.ts`.

## Auditoría (`sales_commission_audit_logs`)

Se registran: regla modificada, colaborador alta/edición/activar/desactivar/baja,
láser aplicado a liquidación (fondo, por sucursal, before/after, usuario, motivo).

## Multi-tenant

Todo filtra por `business_id` (Cibao no ve otro negocio; superadmin respeta el
negocio activo). Migración solo siembra para negocios ya inicializados.

## Pendiente / a validar por el usuario (requiere login autenticado)

Recorrido visual §14 en prod (no tengo credenciales): abrir Reglas → confirmar
escala/pesos/personal → activar/desactivar → abrir Comisión láser → confirmar
resumen, tramo, fondo, reparto y cuadre → Excel/PDF → Aplicar a liquidación →
confirmar que Liquidación de incentivos refleja el nuevo láser.
