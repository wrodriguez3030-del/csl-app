# RR.HH. Fase 3 — Pagos · Diseño e inventario

**Fecha:** 2026-06-02
**Módulo:** Recursos Humanos — csl-app
**Estado:** diseño para aprobación (no implementado)
**BD:** Supabase self-hosted `db-cls.cibao-cloude.com` (DDL vía `scripts/db-query.js`)

## 1. Contexto

Fase 1 (Personal) y Fase 2 (Asistencia: Horarios, Ponche, Asistencia, Permisos)
están cerradas y desplegadas. Fase 3 (Pagos) es la más grande y delicada:
involucra dinero, deducciones de ley (TSS/ISR), archivos bancarios y
liquidaciones. Por eso se decompone en sub-módulos con su propio plan de
implementación cada uno.

## 2. Inventario de tablas HR YA EXISTENTES en db-cls (todas vacías)

Creadas fuera de este flujo (NO estaban en el repo). Todas multi-tenant
(`business_id`) con 4 policies RLS (sin `service_all`, pero el backend usa
service_role que bypasea RLS). **Reutilizar, no duplicar.**

| Tabla | Uso en Fase 3 | Columnas clave |
|---|---|---|
| `hr_departments` | Estructura org | id, business_id, name, parent_id, active |
| `hr_positions` | Cargos + rango salarial | id, business_id, department_id, name, salary_min, salary_max, active |
| `hr_employee_bank_accounts` | **TXT bancario** | id, business_id, employee_id, bank_name, account_number, account_type, beneficiary, is_primary, active |
| `hr_employee_salary_history` | **Salario vigente** | id, business_id, employee_id, salary, effective_from, effective_to, reason |
| `hr_audit_logs` | **Auditoría** | id, business_id, user_id, user_email, module, action, entity_type, entity_id, old_values(jsonb), new_values(jsonb), ip_address |

`csl_empleados` (26 filas) tiene `salario:numeric`, `puesto_solicitado`, pero
**NO tiene `sucursal`** (la sucursal del ponche se deriva de la asignación de
horario). El salario "vigente" debe leerse de `hr_employee_salary_history`
(último `effective_from` con `effective_to` null), con fallback a
`csl_empleados.salario`.

## 3. Tablas NUEVAS propuestas para Fase 3

Todas con `business_id NOT NULL` + RLS por tenant + `service_all` (patrón Fase 1/2).

- **`hr_payroll_runs`** — corrida de nómina por período: id, business_id,
  period_start, period_end, sucursal (null=todas), tipo (quincenal|mensual),
  status (borrador|calculada|revision|aprobada|txt_generado|pagada),
  totals (jsonb), created_by, approved_by, approved_at.
- **`hr_payroll_items`** — un renglón por empleado en una corrida: id,
  business_id, run_id (FK), employee_id, dias_laborados, sueldo_base,
  conceptos (jsonb: horas_extra, incentivos, bonos, ausencias, tardanzas,
  prestamos, otros_descuentos), deducciones_ley (jsonb: afp, sfs, isr),
  neto, estado.
- **`hr_loans`** — préstamos/avances: id, business_id, employee_id, principal,
  cuotas, monto_cuota, balance, status (activo|pagado|cancelado), start_date.
- **`hr_loan_payments`** — pagos de préstamo (descuento por nómina o extra):
  id, business_id, loan_id, run_id (null si extra), monto, fecha.
- **`hr_incentives`** — incentivos/comisiones/bonos: id, business_id,
  employee_id, tipo (comision|bono_fijo|bono_meta|ajuste), monto, periodo,
  status (pendiente|aprobado|pagado), salida (nomina|txt_separado).
- **`hr_vacations`** — balance y solicitudes: id, business_id, employee_id,
  dias_acumulados, dias_usados, periodo, status, monto_pagado.
- **`hr_bank_txt_files`** — registro de TXT generados (idempotencia/auditoría):
  id, business_id, origen (nomina|incentivos|vacaciones|doble_sueldo|dias_laborados|liquidacion),
  run_id, filename, hash (único), total, status, created_by, created_at.

(El detalle fino de cada tabla se fija en el sub-spec de su módulo.)

## 4. Reglas de dominio (RD) — A CONFIRMAR antes de calcular dinero

> ⚠️ Los montos y tasas de ley son delicados. NO se hardcodean como verdad
> sin confirmación del usuario/contabilidad. Se harán **configurables** por
> tenant (tabla `hr_payroll_config` o JSON), con estos valores como punto de
> partida a validar:

- **Sueldo diario** = sueldo mensual / **23.83** (base estándar — confirmado en el skeleton).
- **TSS empleado** (a confirmar): AFP ≈ 2.87 %, SFS ≈ 3.04 % sobre salario cotizable (con topes).
- **ISR** (a confirmar): escala anual DGII / 12; exento bajo cierto umbral.
- **Doble sueldo (Salario de Navidad)**: total de salarios ordinarios del año / 12; proporcional por fecha de ingreso/salida; bloqueo de doble pago en el mismo año.
- **TXT bancario** (formato confirmado por el usuario): líneas
  `CUENTA_ORIGEN,CUENTA_DESTINO,MONTO,NOMBRE_EMPLEADO`, **sin encabezado**,
  montos con **2 decimales**, nombres en **MAYÚSCULAS**; solo si el pago está
  aprobado; hash único por archivo; nombre `TIPO_TENANT_SUCURSAL_YYYY-MM-DD.txt`.

## 5. Decomposición y orden de build recomendado

Cada sub-módulo = su propio spec + plan + entrega (build/deploy) independiente.

1. **Días laborados** (el más acotado; se apoya en Asistencia ya construida) —
   sueldo proporcional = sueldo_diario × días; ingresos/descuentos manuales;
   PDF + "agregar a nómina". Buen primer paso, sin deducciones de ley complejas.
2. **Préstamos y avances** — base para descuentos en nómina (sin esto, Nómina
   queda incompleta).
3. **Incentivos y comisiones** — importables, aprobables, salida a nómina o TXT.
4. **Nómina** — orquesta todo: días/asistencia + incentivos + préstamos +
   deducciones de ley → recibos PDF + estados. **El más complejo.**
5. **TXT bancarios** — transversal; consume nómina/incentivos/etc. aprobados.
6. **Vacaciones** y **Doble sueldo** — pagos especiales con su propia lógica.

## 6. Transversales (aplican a todos los sub-módulos)

- **Multi-tenant end-to-end**: handlers context-aware (`getBusinessContext` +
  `bypassTenantFilter`/`effectiveBusinessId`), igual que Fase 2.
- **Auditoría**: registrar en `hr_audit_logs` toda acción crítica (crear/aprobar
  nómina, generar TXT, cambio de salario/cuenta). Requisito explícito del usuario.
- **Doble confirmación** antes de cualquier borrado de datos (política del proyecto).
- **Salario vigente** se lee de `hr_employee_salary_history` (fallback `csl_empleados.salario`).
- Cuentas bancarias desde `hr_employee_bank_accounts` (la `is_primary` para el TXT).

## 7. Fuera de alcance de Fase 3

Liquidaciones/prestaciones (cesantía, preaviso) → **Fase 4**. Reclutamiento,
onboarding, evaluación → Fase 5. Reportes consolidados → Fase 6.

## 8. Criterios de aceptación del diseño

1. Reutiliza las tablas HR existentes (no duplica positions/bank/salary/audit).
2. Las reglas de dinero quedan configurables y marcadas "a confirmar".
3. Orden de build entrega valor incremental (Días laborados primero).
4. Cada sub-módulo respeta multi-tenant + auditoría + doble confirmación de borrado.
