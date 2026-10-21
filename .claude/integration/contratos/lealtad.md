# Contrato: programa de lealtad

Decisión del PM, 17 de octubre. Cada empresa (NIT) puede tener un programa de lealtad: sus clientes ganan puntos o premios por pagar a tiempo, por antigüedad, por referir clientes y por pagar por adelantado, y los cambian por descuentos, mejoras de plan temporales, premios del catálogo o boletos de sorteos.

- Dueños: A3 (módulo nuevo `apps/api/app/lealtad`, schema `lealtad`, asientos en `ledger`, descuentos en `billing`) y A1 (mejora temporal de plan en `core`). A4, A5 y A6 consumen.
- Fuente de lo legal y contable: la investigación del líder, sección F (**inv. F.n**). Lo NO VERIFICADO entra como parámetro con la marca **confirmar con contador** o **confirmar con abogado**, nunca como un hecho.
- Depende de `contratos/localizacion-fiscal.md` (cuentas `2.1.10`, `4.1.05`, `4.1.06`, `5.1.03`, `1.1.09`, retenciones de ISR y NCRE).
- Cambia en la misma PR que el código que lo cumple.

## 1. Objetivos

1. Premiar el comportamiento que le sirve al ISP (pagar a tiempo, quedarse, traer clientes, adelantar pagos) con reglas que el ISP configura sin programar.
2. Que cada premio tenga su tratamiento fiscal correcto: un descuento reduce la base del IVA (inv. F.1); los puntos son un pasivo según NIIF 15 cuando dan un derecho material (inv. F.3).
3. Sorteos que un notario o un delegado de Gobernación pueda dar por buenos: bases selladas, lista de participantes con hash, semilla con compromiso previo, algoritmo publicado y acta (inv. F.6).
4. El sistema avisa los requisitos legales (DIACO, Gobernación, ISR del premio) y no deja ejecutar un sorteo sin marcarlos, pero nunca hace trámites por su cuenta.
5. Todo por empresa; con una empresa y el programa apagado, nada cambia.

## 2. Decisiones de diseño

| Tema              | Decisión                                                                                                                                                         | Por qué                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Alcance           | Un programa por empresa; los puntos de un cliente son por empresa (un cliente con servicios en dos NIT tiene dos saldos)                                         | Regla 13 y inv. F (alcance por NIT)                                                           |
| Saldo de puntos   | Suma de `lealtad.movimientos` (solo inserción); no hay columna `saldo`                                                                                           | Igual que el saldo del cliente en el libro (regla 4)                                          |
| Puntos en enteros | `integer`; el valor en quetzales sale de `valor_punto`                                                                                                           | Evita redondeos en el saldo                                                                   |
| Descuento         | **Línea de descuento en la factura** del periodo siguiente (base neta del IVA); si la factura ya existe, NCRE dentro de 2 meses                                  | inv. F.1 (arts. 12, 17 y 29 d); igual que Odoo `loyalty`                                      |
| Mejora de plan    | Plan temporal con fecha de fin en `core` (A1), con `servicio.config_cambiada`; la factura cobra el plan superior con descuento hasta el precio del plan original | inv. F.1 ("mejora de plan como premio")                                                       |
| Contabilidad      | Pasivo del contrato (`2.1.10`) al acumular, ingreso al canjear o vencer, cuando el programa tiene `diferimiento = true`                                          | inv. F.3 (NIIF 15, B39-B43)                                                                   |
| Vencimiento       | **12 meses** desde la acumulación, por lote, el más antiguo primero; editable por programa                                                                       | No hay norma (inv. F, parámetro 75); 12 meses es corto para el pasivo y largo para el cliente |
| Sorteos           | La ruleta solo muestra; el backend calcula con un algoritmo versionado y reproducible                                                                            | inv. F.6                                                                                      |
| Checklist legal   | Requisitos que el usuario marca con evidencia; ejecutar exige todos marcados (cumplido o no aplica con justificación)                                            | Decisión del PM: avisos, no automatismos                                                      |

## 3. Modelo de datos (schema `lealtad`, A3)

Todas las tablas llevan `empresa_id NOT NULL`. Dinero `numeric(14,2)`; tasas `numeric(9,6)`.

| Tabla                      | Columnas clave                                                                                                                                                                                                                                                                                                                                                                               | Restricciones                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `lealtad.programas`        | `id`, `empresa_id`, `nombre`, `activo`, `valor_punto` (Q por punto), `diferimiento` bool, `canje_esperado_pct`, `vencimiento_meses` (12), `aviso_vencimiento_dias` (30), `minimo_canje`, `terminos` (texto), `terminos_hash`, `vigente_desde`, `vigente_hasta`, `version`                                                                                                                    | Uno activo por empresa (índice parcial). `vigente_hasta` obligatorio en promociones con fin (inv. F.4, art. 24)                              |
| `lealtad.reglas`           | `id`, `programa_id`, `tipo` (`pago_a_tiempo`, `antiguedad`, `referido`, `pago_adelantado`), `condiciones` jsonb (§4), `recompensa` (`puntos`, `premio`, `boletos`), `puntos`, `premio_id`, `sorteo_id`, `tope_por_cliente`, `periodo_tope` (`mes`, `anio`), `activa`, `vigente_desde`, `vigente_hasta`, `version`                                                                            | Cambios con `version` y `audit.cambios`; una regla con movimientos no se borra, se desactiva                                                 |
| `lealtad.premios`          | `id`, `programa_id`, `tipo` (`descuento_factura`, `mes_gratis`, `mejora_plan`, `bien`, `boletos`), `nombre`, `costo_puntos`, `descuento_tipo` (`monto`, `porcentaje`), `descuento_valor`, `tope`, `plan_destino_id`, `dias`, `costo_unitario`, `existencias`, `en_portal`, `activo`, `version`                                                                                               | `mes_gratis` = descuento del 100 % de la línea del plan                                                                                      |
| `lealtad.movimientos`      | `id`, `empresa_id`, `programa_id`, `cliente_id`, `servicio_id`, `tipo` (`acumulacion`, `canje`, `vencimiento`, `reverso`, `ajuste`), `puntos` (con signo), `regla_id`, `origen_tipo` (`factura`, `pago`, `servicio`, `referido`, `canje`, `sorteo`, `ajuste`, `nota_credito`, `lote`), `origen_id`, `clave_unica`, `vence_en`, `valor` (Q diferidos o liberados), `asiento_id`, `reversa_de` (el lote que revierte), `motivo`, `creado_por`, `created_at` | **Solo inserción** (trigger y `REVOKE`). `clave_unica` única por empresa: la idempotencia de cada otorgamiento (`pago_a_tiempo:factura:123`) |
| `lealtad.consumos`         | `movimiento_id` (la salida: canje, vencimiento, reverso, ajuste), `lote_id` (la acumulación), `puntos`, `valor` (Q del lote que sale)                                                                                                                                                                                                                                                                                                           | Solo inserción. Reparte cada salida entre lotes, el más antiguo primero; de aquí sale qué vence y cuándo                                     |
| `lealtad.canjes`           | `id`, `empresa_id`, `cliente_id`, `servicio_id`, `premio_id`, `puntos`, `estado` (`reservado`, `aplicado`, `revertido`, `rechazado`), `factura_id`, `nota_credito_id`, `plan_temporal_id`, `canal` (`panel`, `portal`), `aplicado_en`, `motivo`, `version`                                                                                                                                   | El cambio de estado es por acción; los puntos salen con un movimiento `canje` al reservar y vuelven con `reverso`                            |
| `lealtad.referidos`        | `id`, `empresa_id`, `referidor_id`, `referido_id` (cliente), `codigo`, `estado` (`pendiente`, `calificado`, `rechazado`), `calificado_en`, `motivo`                                                                                                                                                                                                                                          | Único `referido_id` por empresa: un cliente es referido una vez                                                                              |
| `lealtad.sorteos` y anexos | §7                                                                                                                                                                                                                                                                                                                                                                                           |                                                                                                                                              |

En `core` (A1):

| Tabla                              | Columnas clave                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.servicios_planes_temporales` | `id`, `empresa_id`, `servicio_id`, `plan_id` (el temporal), `plan_original_id`, `inicio`, `fin`, `origen` (`lealtad`, `manual`), `origen_id` (el canje), `estado` (`programado`, `activo`, `terminado`, `cancelado`), `motivo`, `iniciado_en`, `terminado_en`, `creado_por`, `version`. Uno `programado` o `activo` por servicio; `origen` + `origen_id` único (el canje no programa dos) |
| `core.codigos_referido` | `empresa_id`, `cliente_id`, `codigo` (8 caracteres de `23456789ABCDEFGHJKMNPQRSTUVWXYZ`). Único `codigo` en la instalación; uno por cliente y empresa. Lo crea un trigger con el primer servicio del cliente en la empresa (alta o `servicios.cambiar_empresa`); la migración lo creó para los existentes. (Antes `lealtad.codigos_referido` de A3: pasó a `core` porque se resuelve en el alta del cliente) |
| `core.clientes` | `referido_por_id` (cliente referidor) y `referido_empresa_id` (empresa del código, donde cuenta el referido), del `codigo_referido` del alta |

Mientras haya uno `activo`, el plan efectivo del servicio para RADIUS, RouterOS y la facturación es el temporal: **`core.servicios.plan_id` es el plan temporal** y `plan_original_id` el plan base al que vuelve. Así `aaa:user:*`, el dispatcher de RouterOS y `facturas.emitir` lo leen sin código propio. El temporal debe ser compatible con el servicio (mismo `dual_stack` y tamaño de prefijo delegado): solo cambia velocidad y precio, nunca IPs ni prefijos. Con uno activo, `PUT /servicios/:id` con otro `plan_id` responde 409 `plan_temporal_activo`; retirar el servicio lo cancela (`motivo: retiro`) y lo deja en el plan base.

Interfaz de A1 para A3: `ProgramarPlanTemporal` (`servicios.programar_plan_temporal`, entrada `{ servicio_id, plan_id, dias | fin, inicio?, origen: 'lealtad', origen_id: canje_id }`, anidada con `{ trx }`; si `inicio` ya llegó lo inicia en la misma transacción), `CancelarPlanTemporal` (`{ id, version, motivo }`), `planTemporalActivo(servicio_id, trx)` (para el descuento de la factura hasta el precio de `plan_original_id`) en `#core/planes_temporales`, y `referidoDeCliente(cliente_id)` / `codigoReferidoDe(cliente_id, empresa_id)` en `#core/referidos`.

## 4. Reglas para ganar

Cada regla se evalúa en una acción de dominio, nunca en el consumidor (regla 1). El consumidor `lealtad` (grupo de Redis, en `node ace billing:worker`) llama a `lealtad.evaluar_evento`.

| Tipo              | Disparador                                                     | Condiciones (`condiciones` jsonb)                                                                                                                      | Clave única                    |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `pago_a_tiempo`   | `pago.registrado`                                              | `dias_antes_vencimiento` (≥ 0), `solo_servicio` (facturas `servicio`, no mora), `sin_promesa`, `racha` (n periodos seguidos; opcional), `monto_minimo` | `pago_a_tiempo:factura:<id>`   |
| `antiguedad`      | cron diario `lealtad:antiguedad` (todo lo pendiente hasta hoy) | `cada_meses` (12), `sin_vencidas_mas_de_dias`, `estados_validos` (`activo`)                                                                            | `antiguedad:servicio:<id>:<n>` |
| `referido`        | `pago.registrado` del referido                                 | `facturas_pagadas_minimas` (2), `dias_maximos` desde el alta, `tope_por_referidor`, `puntos_referido` (bono al nuevo cliente)                          | `referido:<referido_id>`       |
| `pago_adelantado` | `pago.registrado`                                              | `periodos_minimos` (el excedente en Anticipos cubre ≥ N mensualidades del plan efectivo), `puntos_por_periodo`                                         | `adelantado:pago:<id>`         |

- **Pago a tiempo**: una factura de servicio cuenta si quedó `pagada` con todos sus pagos antes de `vence_en − dias_antes_vencimiento`. Una nota de crédito no cuenta como pago.
- **Antigüedad**: meses desde `fecha_instalacion` sin pasar por `suspendido` en el último ciclo, según `audit` de `servicio.estado_cambiado`.
- **Referido**: el código se captura al crear el cliente (`POST /clientes` con `codigo_referido`, A1): A1 lo resuelve en `core.codigos_referido` y guarda `referido_por_id` y `referido_empresa_id` en el cliente; A3 registra el referido en `lealtad.referidos` al consumir `servicio.creado` del cliente en esa empresa (`referidoDeCliente`). El otorgamiento espera las facturas pagadas mínimas para evitar altas falsas. Un cliente no se refiere a sí mismo ni a otro con el mismo NIT o CUI (422 `referido_invalido`).
- **Pago adelantado**: se mide contra el anticipo que dejó ese pago; si el pago se anula, se revierte.
- **Reversos**: `pago.anulado`, `factura.anulada` o una nota de crédito que deja la factura sin pagar revierten lo otorgado con esa clave (`reverso`, con la misma regla). Si el cliente ya canjeó, el saldo puede quedar negativo y bloquea el canje hasta volver a positivo (no se le quita un premio entregado).
- **Topes** por cliente y periodo (`tope_por_cliente`, `periodo_tope`).
- **Ajuste manual** (`lealtad.ajustar`): motivo obligatorio, auditado; no tiene valor contable si el programa no difiere.

Ejemplo de reglas (lo que guarda `condiciones`; el validador VineJS tiene un esquema por `tipo`, y el OpenAPI lo publica como unión discriminada):

```json
[
    {
        "tipo": "pago_a_tiempo",
        "recompensa": "puntos",
        "puntos": 10,
        "condiciones": {
            "dias_antes_vencimiento": 0,
            "solo_servicio": true,
            "sin_promesa": true,
            "racha": { "periodos": 6, "puntos_extra": 50 }
        }
    },
    {
        "tipo": "antiguedad",
        "recompensa": "puntos",
        "puntos": 100,
        "condiciones": { "cada_meses": 12, "sin_vencidas_mas_de_dias": 15, "estados_validos": ["activo"] }
    },
    {
        "tipo": "referido",
        "recompensa": "puntos",
        "puntos": 150,
        "tope_por_cliente": 10,
        "periodo_tope": "anio",
        "condiciones": { "facturas_pagadas_minimas": 2, "dias_maximos": 120, "puntos_referido": 50 }
    },
    {
        "tipo": "pago_adelantado",
        "recompensa": "puntos",
        "puntos": 0,
        "condiciones": { "periodos_minimos": 3, "puntos_por_periodo": 15 }
    }
]
```

Los números del ejemplo son ilustrativos: cada ISP pone los suyos. `recompensa: premio` entrega un premio del catálogo sin pasar por puntos (por ejemplo, una mejora de plan de 30 días al cumplir un año) y `boletos` inscribe en el sorteo que indique `sorteo_id`.

## 5. Premios y canje

| Premio                                           | Cómo se aplica                                                                                                                                                                                                                                                                                                                                                      | Fiscal                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `descuento_factura`                              | Canje `reservado`; `facturas.emitir` del siguiente periodo del servicio llama a `lealtad.descuentos_pendientes(servicio_id, trx)` y agrega una línea `descuento` ligada a la línea del plan; el canje pasa a `aplicado` en la misma transacción                                                                                                                     | Base neta del IVA (inv. F.1, art. 12); en FEL, descuento de línea en la FACT                                                                      |
| `descuento_factura` sobre una factura ya emitida | `lealtad.canjear` con `factura_id`: emite una nota de crédito (`facturas.nota_credito`, NCRE en FEL) por el descuento, solo dentro de `nota_ventana_meses`                                                                                                                                                                                                          | inv. F.1 (arts. 17 y 29 d)                                                                                                                        |
| `mes_gratis`                                     | Igual que el descuento, por el 100 % de la línea del plan                                                                                                                                                                                                                                                                                                           | Criterio de la SAT sobre base cero: contador (inv. F.1; NO VERIFICADO 12)                                                                         |
| `mejora_plan`                                    | `lealtad.canjear` llama a `servicios.programar_plan_temporal` (A1) con `plan_destino_id` y `dias`; A1 emite `servicio.config_cambiada` con `campos: ['plan']` al iniciar y al terminar; A2 aplica RADIUS y RouterOS como con cualquier cambio de plan. Mientras dure, la factura cobra el plan superior con una línea `descuento` hasta el precio del plan original | inv. F.1 (interpretación media): contador. Parámetro `mejora_facturacion` (`descuento_linea` o `sin_cambio`)                                      |
| `bien` (equipo)                                  | Canje `reservado` hasta la entrega física (`lealtad.entregar`, con constancia); al entregar, el costo va a `5.1.03` y sale de existencias                                                                                                                                                                                                                           | IVA del premio en especie (donación, art. 3.9, o descuento en especie): contador; sin decisión, 422 `parametro_sin_confirmar` (`premio_bien_iva`) |
| `boletos`                                        | Inscribe boletos en un sorteo abierto (§7)                                                                                                                                                                                                                                                                                                                          | Ver ISR del premio en §7                                                                                                                          |

- **Validaciones del canje**: programa activo; saldo ≥ `costo_puntos` y ≥ `minimo_canje` (422 `saldo_insuficiente`); servicio de la empresa del programa y no `retirado` (422 `servicio_no_valido`); existencias (409 `sin_existencias`); un canje reservado de descuento por servicio y periodo (409 `canje_pendiente`).
- El descuento nunca deja la línea del plan bajo cero ni cubre mora ni otros conceptos.
- **Revertir** (`lealtad.revertir_canje`): solo `reservado`, o `aplicado` si la factura se anula; devuelve los puntos con su fecha de vencimiento original.
- Un canje con `Idempotency-Key` no se duplica.

Ejemplo: plan de Q200.00 con un canje de Q50.00 de descuento, IVA del 12 % incluido.

| Línea                            | Tipo        | Total      | IVA       |
| -------------------------------- | ----------- | ---------- | --------- |
| Internet 20 Mbps (octubre)       | `servicio`  | 200.00     | 21.43     |
| Descuento por puntos (canje 381) | `descuento` | −50.00     | −5.36     |
| **Factura**                      |             | **150.00** | **16.07** |

El IVA se calcula sobre el neto (`150.00 − 150.00 / 1.12 = 16.07`) y se reparte por línea con la diferencia de redondeo en la mayor. El asiento de la factura queda `CxC 150.00 + 5.1.01 Descuentos 44.64 / 4.1.01 Ingresos 178.57 + 2.1.02 IVA débito 16.07`, así los reportes muestran cuánto costó el programa sin tocar la base del IVA (inv. F.1). Una empresa de pequeño contribuyente no desglosa IVA: la línea de descuento baja el total y con él la base del 5 %.

## 6. Contabilidad

Decisión del PM (2026-10-17): los puntos son, por defecto, **solo un indicador** (`programas.diferimiento = false`): no generan asientos al acumular ni al vencer. Cada empresa decide si trabaja el programa y si lo contabiliza como pasivo NIIF 15 (`diferimiento = true`, recomendado cuando el contador concluya que los puntos dan un **derecho material**; inv. F.3, B41). `canje_esperado_pct` empieza en 100 % hasta que el contador estime otro. El valor de un punto para el pasivo es `valor_punto × canje_esperado_pct`. Cuentas del contrato de localización fiscal.

| Momento                    | Asiento (origen `lealtad`)                                                                           | Nota                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Acumulación                | `4.1.05 Ingresos diferidos por lealtad / 2.1.10 Pasivo del programa de lealtad` por `puntos × valor` | Fecha del otorgamiento. Asignación simplificada de NIIF 15 (precio independiente × probabilidad de canje; inv. tabla #74) |
| Canje (descuento o mejora) | `2.1.10 / 4.1.06 Ingresos por puntos canjeados o vencidos` por el valor de los lotes consumidos      | La factura con la línea de descuento registra su ingreso neto como siempre                                                |
| Canje (bien)               | El anterior y además `5.1.03 Premios y promociones / inventario o 2.1.03` por el costo               |                                                                                                                           |
| Vencimiento                | `2.1.10 / 4.1.06` por el valor de los lotes vencidos                                                 | inv. F.3: pasa a ingreso al caducar                                                                                       |
| Reverso de acumulación     | Espejo de la acumulación, con fecha de hoy                                                           | Nunca se edita un asiento                                                                                                 |
| Reestimación anual         | En el cierre anual: ajuste de `2.1.10` si cambió `canje_esperado_pct`                                | Opcional; la decide el contador                                                                                           |

- Sin diferimiento: no hay asientos al acumular ni al vencer; el descuento solo baja el ingreso de la factura, y el bien va a `5.1.03`.
- El valor de cada lote se fija al acumular (`movimientos.valor`) y no cambia si después se edita `valor_punto`.
- **Fiscal y contable no coinciden**: el IVA y el ISR se causan con la factura (inv. A.1, art. 4.5); el diferimiento es solo NIIF. El cierre anual genera un `fiscal.ajustes_fiscales` (`diferencia_temporal`) por el movimiento neto de `2.1.10` del año (inv. F.3).
- Deducibilidad del costo de premios y regalos (art. 21.29, gastos de venta): contador (inv. F.2; NO VERIFICADO 13). Mientras tanto, `5.1.03` no tiene `categoria_fiscal`.
- Tratamiento en la NIIF para las PYMES 2015 (vigente hasta 2026): contador (inv. F.3; NO VERIFICADO 16). La 3.ª edición alinea con NIIF 15 desde 2027.

Ejemplo con `valor_punto = 0.10` y `canje_esperado_pct = 80 %` (valor diferido por punto: Q0.08):

| Hecho                                         | Puntos | Asiento                                                                                          |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Paga a tiempo 6 facturas (10 puntos cada una) | +60    | `4.1.05 / 2.1.10` por 4.80                                                                       |
| Antigüedad de un año                          | +100   | `4.1.05 / 2.1.10` por 8.00                                                                       |
| Canjea 150 puntos por Q15.00 de descuento     | −150   | `2.1.10 / 4.1.06` por 12.00 (valor de los lotes consumidos); la factura lleva su línea de −15.00 |
| Vencen los 10 puntos que quedaban             | −10    | `2.1.10 / 4.1.06` por 0.80                                                                       |

Al final `2.1.10` queda en cero, igual que el saldo de puntos. El reporte `lealtad` comprueba en cada corrida que el saldo de `2.1.10` es igual a la suma de `valor` de los lotes vivos.

### 6.1 Regla de vencimiento

- Cada acumulación es un lote con `vence_en = fecha + vencimiento_meses`. Cada empresa lo estipula en su programa (por defecto 12; `null` = los puntos no vencen). Decisión del PM.
- Los canjes consumen primero el lote que vence antes (`lealtad.consumos`).
- El cron diario `lealtad:vencer` procesa todo lo vencido hasta hoy (no "lo de hoy"), con clave `vencimiento:lote:<id>` y lock (regla 6).
- `aviso_vencimiento_dias` antes, emite `lealtad.puntos_por_vencer` una vez por lote (A6 avisa al cliente); `lealtad.avisos_vencimiento` (solo inserción, una fila por lote) lo garantiza.
- Servicio retirado: sus puntos siguen hasta su vencimiento, pero no se pueden canjear sin otro servicio activo de la empresa.
- Cambiar `vencimiento_meses` aplica a los lotes nuevos; los existentes conservan su fecha.
- Los términos del programa publicados en el portal deben decir el vencimiento (inv. F.4, art. 24: plazo y condiciones).

## 7. Sorteos

### 7.1 Datos

| Tabla                           | Columnas clave                                                                                                                                                                                                                                                                                                                                                                                                                    | Restricciones                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `lealtad.sorteos`               | `id`, `empresa_id`, `programa_id`, `nombre`, `estado`, `bases` jsonb (§7.2), `bases_version`, `bases_hash`, `departamento`, `criterios` jsonb, `corte_en`, `fecha_sorteo`, `lugar`, `ganadores`, `suplentes`, `algoritmo` (`argos-sorteo-v1`), `compromiso` (SHA-256 de la semilla), `semilla_cifrada`, `semilla` (solo tras revelar), `valor_publico`, `lista_hash`, `resultado` jsonb, `acta` (archivo), `acta_hash`, `version` | El estado avanza solo por acción. Desde `bases_publicadas`, `bases` y `criterios` no cambian (trigger) |
| `lealtad.sorteos_premios`       | `sorteo_id`, `posicion`, `descripcion`, `valor` (valor de libre competencia), `premio_id`                                                                                                                                                                                                                                                                                                                                         | Fijos desde `bases_publicadas`                                                                         |
| `lealtad.sorteos_participantes` | `sorteo_id`, `orden`, `cliente_id`, `servicio_id`, `codigo_publico` (seudónimo), `boletos`                                                                                                                                                                                                                                                                                                                                        | Solo inserción, al cerrar el corte. Único (`sorteo_id`, `cliente_id`)                                  |
| `lealtad.sorteos_boletos`       | `sorteo_id`, `cliente_id`, `boletos`, `origen` (`criterio`, `canje`, `regla`), `canje_id`                                                                                                                                                                                                                                                                                                                                         | Solo inserción, antes del corte                                                                        |
| `lealtad.sorteos_ganadores`     | `sorteo_id`, `posicion`, `tipo` (`titular`, `suplente`), `participante_id`, `premio_posicion`, `estado` (`por_notificar`, `notificado`, `entregado`, `no_reclamado`, `sustituido`), `retencion_isr`, `constancia_entrega`, `entregado_en`                                                                                                                                                                                         | Estados por acción                                                                                     |
| `lealtad.sorteos_requisitos`    | `sorteo_id`, `clave`, `estado` (`cumplido`, `no_aplica`, `pendiente`), `valor` (número de resolución, monto de la fianza…), `evidencia` (archivo), `nota`, `marcado_por`, `marcado_en`                                                                                                                                                                                                                                            | Solo inserción; el estado vigente es la última fila por clave                                          |

Estados: `borrador → bases_publicadas → participacion_abierta → corte_cerrado → ejecutado → acta_cerrada → premios_entregados`, y `cancelado` desde cualquiera antes de `ejecutado` (con motivo y publicación).

### 7.2 Bases

Campos obligatorios para publicar (422 `bases_incompletas` con el campo; inv. F.4, art. 24 y AG 777-2003, art. 22; tabla #78):

- mecánica y forma del sorteo;
- criterios de elegibilidad (puntos mínimos, pagos a tiempo, servicio activo) y cómo se ganan boletos;
- periodo de participación con **fecha de fin explícita** (sin plazo, una promoción dura al menos un mes; tabla #77);
- número de premios, en qué consisten y su valor;
- fecha, hora y lugar del sorteo;
- plazo para reclamar y qué pasa con los premios no reclamados (suplentes);
- forma y medio de publicar los resultados (inmediatamente después; tabla #79);
- número de resolución de la Gobernación cuando exista.

`bases_hash` = SHA-256 del JSON canónico (claves ordenadas, UTF-8) de las bases y los premios. Se publica junto con el compromiso de la semilla.

### 7.3 Registro auditable (inv. F.6)

1. **Publicar bases** (`sorteos.publicar_bases`): congela bases y criterios, calcula `bases_hash`, genera la semilla `s` (32 bytes de `crypto.randomBytes`), guarda `semilla_cifrada` (clave de la instalación) y publica `compromiso = SHA-256(s)`. Desde aquí nadie puede cambiar `s`.
2. **Participación**: los boletos se suman por criterios y por canjes de `boletos`.
3. **Cerrar corte** (`sorteos.cerrar_corte`, en `corte_en` o después): inserta los participantes en orden ascendente de `codigo_publico` y calcula `lista_hash` = SHA-256 de las líneas `codigo_publico|boletos\n`. Exporta CSV y XLSX con el hash al pie. Los hashes quedan en `audit.acciones` antes del sorteo.
4. **Ejecutar** (`sorteos.ejecutar`, en el acto): exige el checklist completo (§8) y `valor_publico`, un dato que nadie controla y que se conoce en el acto (por ejemplo, el número que lee el notario o el delegado, o un resultado público posterior al corte). Revela `s`, verifica `SHA-256(s) = compromiso` y calcula:
    - `semilla_final = HMAC-SHA256(clave = s, mensaje = lista_hash ‖ bases_hash ‖ valor_publico)`;
    - para `i = 0, 1, 2…`: `r_i = HMAC-SHA256(semilla_final, "argos-sorteo-v1:" ‖ i)` leído como entero de 256 bits; con `T` = boletos restantes, se descarta `r_i ≥ ⌊2²⁵⁶ / T⌋ · T` (sin sesgo de módulo) y el boleto elegido es `r_i mod T`, que se ubica en la lista por boletos acumulados;
    - el participante elegido sale con todos sus boletos; primero titulares, luego suplentes.
5. **Ruleta**: la pantalla anima hasta el resultado que ya calculó el backend (inv. F.6, punto 4). Nunca elige ella.
6. **Acta** (`sorteos.cerrar_acta`): PDF con resolución, fianza e impuestos pagados, `bases_hash`, `lista_hash`, `compromiso`, semilla revelada, `valor_publico`, algoritmo y su versión, titulares y suplentes (con seudónimo y, para la autoridad, nombre), asistentes (delegado o notario), firma o constancia y medio de publicación. Se guarda con `acta_hash`.
7. **Verificación**: `GET /lealtad/sorteos/:id/verificacion` (público después de ejecutar) devuelve todo lo necesario para recalcular. El repositorio publica `scripts/verificar-sorteo.mjs` (sin dependencias) que hace el mismo cálculo.

Referencia del cálculo (`apps/api/app/lealtad/sorteo_v1.ts`; el script de verificación es una copia sin dependencias):

```ts
function sortear(
    s: Buffer,
    listaHash: string,
    basesHash: string,
    valorPublico: string,
    lista: Array<{ codigo: string; boletos: number }>,
    cuantos: number,
) {
    const semillaFinal = hmac(s, `${listaHash}${basesHash}${valorPublico}`)
    const restantes = [...lista] // en el orden canónico (codigo_publico)
    const elegidos: string[] = []
    for (let i = 0; elegidos.length < cuantos && restantes.length > 0; i++) {
        const T = BigInt(restantes.reduce((n, p) => n + p.boletos, 0))
        const r = BigInt('0x' + hmac(semillaFinal, `argos-sorteo-v1:${i}`).toString('hex'))
        const limite = (2n ** 256n / T) * T
        if (r >= limite) continue // rechazo: sin sesgo de módulo
        let boleto = r % T
        const k = restantes.findIndex((p) => (boleto -= BigInt(p.boletos)) < 0n)
        elegidos.push(restantes[k].codigo)
        restantes.splice(k, 1) // sale con todos sus boletos
    }
    return elegidos // titulares primero, luego suplentes
}
```

Una versión nueva del algoritmo (`argos-sorteo-v2`) nunca cambia la v1: los sorteos viejos se verifican con la versión que registraron.

¿Por qué el `valor_publico`? Con el compromiso solo, quien genera la semilla podría generar muchas y quedarse con la que le conviene. La semilla queda fija antes de conocer la lista, y la lista antes de conocer el valor público, así nadie puede ajustar el resultado.

### 7.4 Entrega y premios no reclamados

- `sorteos.notificar_ganadores` emite `sorteo.ejecutado`; A6 avisa a los titulares. Los resultados se publican en el portal de inmediato.
- `sorteos.entregar`: constancia firmada (archivo), fecha y retención del ISR (§8). Asiento: `5.1.03 / existencias, Banco o 2.1.03` por el valor del premio y, si se retuvo o se pagó antes, `1.1.09` o `2.1.05` con el 10 %.
- Vencido el plazo de reclamo, `sorteos.marcar_no_reclamado` pasa al siguiente suplente según las bases.

## 8. Checklist legal (avisos que el usuario marca)

| Clave                      | Requisito                                                                                                                                                                                                           | Fuente                          | Para                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------- |
| `bases_diaco`              | Bases con los campos de §7.2 publicadas en un medio idóneo                                                                                                                                                          | inv. F.4                        | Abrir la participación |
| `autorizacion_gobernacion` | Resolución de la Gobernación Departamental del departamento del sorteo (número y fecha). Si es un sorteo gratuito entre clientes, puede marcarse `no_aplica` solo con un criterio escrito de la Gobernación adjunto | inv. F.5; NO VERIFICADO 15      | Ejecutar               |
| `fianza`                   | Fianza fijada en la resolución (Escuintla: 10 % de la emisión; varía)                                                                                                                                               | inv. F.5                        | Ejecutar               |
| `isr_premios`              | ISR del 10 % sobre el valor de los premios, retenido o pagado antes (Gobernación); en especie, sobre el valor de libre competencia                                                                                  | inv. F.2 (arts. 84.4 y 92), F.5 | Ejecutar               |
| `timbre_fiscal`            | Timbre del 3 % que pide la Gobernación                                                                                                                                                                              | inv. F.5; tasa NO VERIFICADO 1  | Ejecutar               |
| `delegado_o_notario`       | Delegado del Ministerio de Gobernación o notario presente, con nombre                                                                                                                                               | inv. F.5                        | Ejecutar               |
| `publicacion_resultados`   | Resultados publicados inmediatamente después, por medios idóneos                                                                                                                                                    | inv. F.4                        | Cerrar el acta         |
| `lista_a_gobernacion`      | Lista de ganadores y constancias de entrega entregadas a la Gobernación                                                                                                                                             | inv. F.5                        | Cerrar el sorteo       |

- Cada marca pide evidencia (archivo o número) y queda en `lealtad.sorteos_requisitos` y `audit.acciones`. 422 `requisito_pendiente` con la clave si falta alguno.
- El panel muestra, junto a cada requisito, su fuente y el aviso "Referencia; valídelo con su contador o abogado".
- El sistema no presenta memoriales ni paga impuestos: solo registra lo que el usuario hizo. El pago del ISR y el timbre se registra como egreso o compra y, en `retenciones_isr`, entra a la declaración del mes (contrato de localización fiscal).

## 9. Multiempresa, idempotencia y migración

- El programa, las reglas, los premios, los puntos, los canjes, los referidos y los sorteos son de una empresa. La empresa de un otorgamiento es la del documento que lo origina (la factura, el pago, el servicio); un pago repartido entre empresas (`cobro_id`) otorga en cada empresa por lo suyo.
- Un referido cuenta en la empresa del servicio nuevo del referido; el referidor necesita un servicio en esa empresa para recibir puntos.
- Un sorteo solo admite participantes con servicio en su empresa. Un sorteo de grupo (varias empresas) no existe en esta fase.
- `servicios.cambiar_empresa` (A1) no mueve puntos: quedan en la empresa anterior hasta que venzan, y el panel lo avisa antes de confirmar.
- Idempotencia: cada otorgamiento por `clave_unica`; cada canje, reverso y acción de sorteo por `Idempotency-Key`; cada cron por la clave del lote o del servicio. Un evento repetido no da puntos dos veces.
- Concurrencia: advisory lock por cliente y empresa (como `bloquearCliente`) en toda acción que mueve puntos; el canje y la emisión de la factura toman el mismo lock.
- Migración: no hay datos previos. El schema nace vacío y cada empresa empieza sin programa: con el programa apagado, `facturas.emitir` no consulta nada de lealtad. La línea `descuento` y el tipo de cuenta nuevos llegan con el contrato de localización fiscal.

## 10. Pruebas mínimas (Japa, contra Postgres)

| Caso                                   | Qué se comprueba                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pago a tiempo dos veces (mismo evento) | Un solo movimiento; saldo correcto                                                                                                                                                       |
| Pago anulado después del canje         | Reverso, saldo negativo, canje bloqueado (422 `saldo_insuficiente`)                                                                                                                      |
| Canje de descuento y emisión           | La factura trae la línea, el IVA es el del neto, el canje queda `aplicado`, el libro cuadra                                                                                              |
| Canje sobre factura emitida            | Nota de crédito por el descuento; 422 fuera de los 2 meses                                                                                                                               |
| Mejora de plan                         | `servicios_planes_temporales` activo, `servicio.config_cambiada` al inicio y al fin, factura con el plan superior y su descuento                                                         |
| Vencimiento                            | Lote más antiguo primero; asiento `2.1.10 / 4.1.06`; repetir el cron no duplica                                                                                                          |
| Pasivo                                 | Saldo de `2.1.10` = Σ valor de lotes vivos tras cada paso                                                                                                                                |
| Sorteo                                 | Bases congeladas tras publicar; `lista_hash` estable; con la misma semilla y el mismo valor público, el script y la acción dan los mismos ganadores; ejecutar sin checklist responde 422 |
| Multiempresa                           | Puntos de la empresa A no se canjean en la B; consolidado solo con alcance global                                                                                                        |

## 11. Endpoints (`/api/v1`)

| Método       | Ruta                                                                                                | Permiso                                       |
| ------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| GET          | `/lealtad/programa` (el de la empresa activa)                                                       | `lealtad.ver`                                 |
| POST         | `/lealtad/programas` · PUT `/lealtad/programas/:id` (con `version`)                                 | `lealtad.configurar`                          |
| POST         | `/lealtad/programas/:id/activar`, `/desactivar` `{ motivo }`                                        | `lealtad.configurar`                          |
| GET/POST/PUT | `/lealtad/reglas[/:id]`, `/lealtad/premios[/:id]`                                                   | `lealtad.ver` / `lealtad.configurar`          |
| GET          | `/clientes/:id/puntos` (saldo, lotes con vencimiento, movimientos con cursor)                       | `lealtad.ver`                                 |
| POST         | `/lealtad/ajustes` `{ cliente_id, puntos, motivo }`                                                 | `lealtad.ajustar`                             |
| GET          | `/lealtad/canjes`                                                                                   | `lealtad.ver`                                 |
| POST         | `/lealtad/canjes` `{ cliente_id, servicio_id, premio_id, factura_id? }`                             | `lealtad.canjear`                             |
| POST         | `/lealtad/canjes/:id/revertir`, `/lealtad/canjes/:id/entregar`                                      | `lealtad.revertir_canje` / `lealtad.entregar` |
| GET          | `/lealtad/referidos`                                                                                | `lealtad.ver`                                 |
| POST         | `/lealtad/referidos/:id/rechazar` `{ motivo }`                                                      | `lealtad.ajustar`                             |
| GET          | `/lealtad/sorteos`, `/lealtad/sorteos/:id`                                                          | `sorteos.ver`                                 |
| POST         | `/lealtad/sorteos` · PUT `/lealtad/sorteos/:id` (solo `borrador`)                                   | `sorteos.gestionar`                           |
| POST         | `/lealtad/sorteos/:id/publicar-bases`, `/abrir`, `/cerrar-corte`, `/cancelar`                       | `sorteos.publicar`                            |
| POST         | `/lealtad/sorteos/:id/requisitos/:clave` `{ estado, valor, nota }` + archivo                        | `sorteos.marcar_requisito`                    |
| GET          | `/lealtad/sorteos/:id/participantes?formato=csv\|xlsx`                                              | `sorteos.exportar`                            |
| POST         | `/lealtad/sorteos/:id/ejecutar` `{ valor_publico, asistentes[] }`                                   | `sorteos.ejecutar`                            |
| POST         | `/lealtad/sorteos/:id/ganadores/:g/entregar`, `/no-reclamado`                                       | `sorteos.entregar`                            |
| POST         | `/lealtad/sorteos/:id/cerrar-acta`                                                                  | `sorteos.ejecutar`                            |
| GET          | `/lealtad/sorteos/:id/acta.pdf`                                                                     | `sorteos.ver`                                 |
| GET          | `/lealtad/sorteos/:id/verificacion`, `/lealtad/sorteos/:id/bases`                                   | público (solo después de publicar o ejecutar) |
| GET          | `/reportes/lealtad?desde&hasta` (puntos emitidos, canjeados, vencidos, pasivo; cuadra con `2.1.10`) | `reportes.ver`                                |

Todo lo que mueve puntos o estado acepta `Idempotency-Key`. Listas con cursor y `?empresas=todas` (solo alcance global; el consolidado es informativo).

## 12. Portal (A5, `apps/api/app/portal`)

| Ruta                    | Qué muestra o hace                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /portal/puntos`    | Saldo por empresa (una sección con la marca de cada empresa), lotes que vencen pronto, últimos movimientos y los términos del programa                                   |
| `GET /portal/premios`   | Premios con `en_portal`, su costo y si alcanza el saldo                                                                                                                  |
| `POST /portal/canjes`   | Canje con canal `portal` (descuento en la próxima factura, mejora de plan, boletos); llama a `lealtad.canjear` directo, actor sistema, como las promesas del portal      |
| `GET /portal/canjes`    | Canjes del cliente y su estado                                                                                                                                           |
| `GET /portal/referidos` | Código y enlace para compartir, referidos y su estado                                                                                                                    |
| `GET /portal/sorteos`   | Sorteos abiertos de sus empresas con bases, en los que participa con sus boletos, su seudónimo, el `compromiso` y, al terminar, el resultado y el enlace de verificación |

Errores visibles con "Reintentar"; si el saldo no se puede leer, no se muestra "0 puntos" (regla 12). Bases y resultados públicos en `/sorteos/:id` sin sesión.

## 13. Eventos

| Evento                                               | Emite     | Payload                                                                                                               |
| ---------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `lealtad.programa_cambiado`                          | A3        | programa_id, empresa_id, campos[]                                                                                     |
| `lealtad.puntos_acumulados`                          | A3        | movimiento_id, empresa_id, cliente_id, servicio_id, regla_id, puntos, vence_en                                        |
| `lealtad.puntos_revertidos`                          | A3        | movimiento_id, empresa_id, cliente_id, puntos, origen_tipo, origen_id                                                 |
| `lealtad.puntos_por_vencer`                          | A3 (cron) | empresa_id, cliente_id, puntos, vence_en, lote_id (aditivo)                                                           |
| `lealtad.puntos_vencidos`                            | A3 (cron) | movimiento_id, empresa_id, cliente_id, puntos                                                                         |
| `lealtad.canje_aplicado` / `lealtad.canje_revertido` | A3        | canje_id, empresa_id, cliente_id, servicio_id, premio_id, tipo, puntos, factura_id                                    |
| `lealtad.referido_calificado`                        | A3        | referido_id, empresa_id, referidor_id, cliente_id                                                                     |
| `sorteo.bases_publicadas`                            | A3        | sorteo_id, empresa_id, bases_hash, compromiso, fecha_sorteo                                                           |
| `sorteo.corte_cerrado`                               | A3        | sorteo_id, empresa_id, participantes, boletos, lista_hash                                                             |
| `sorteo.ejecutado`                                   | A3        | sorteo_id, empresa_id, ganadores[] (cliente_id, tipo, posicion)                                                       |
| `sorteo.premio_entregado`                            | A3        | sorteo_id, empresa_id, cliente_id, posicion                                                                           |
| `sorteo.cancelado`                                   | A3        | sorteo_id, empresa_id, motivo                                                                                         |
| `servicio.config_cambiada`                           | A1        | Ya existe; `campos: ['plan']` al iniciar y terminar el plan temporal. Campo nuevo `motivo: 'plan_temporal'` (aditivo) |

Consumidor `lealtad` (A3): `pago.registrado`, `pago.anulado`, `factura.emitida` (factura que nace pagada con un anticipo), `factura.anulada`, `nota_credito.emitida`, `nota_credito.anulada` (reglas y reversos), `servicio.creado` (referidos), `servicio.estado_cambiado` (`retirado`). Idempotente por `clave_unica`. A6 (`notify`) consume los de puntos, canjes y sorteos. Se agregan a `contratos/eventos.md` y a la tabla de `CLAUDE.md` en la PR que los implemente.

Caché (regla 5): las reglas y premios que lee el consumidor se invalidan con `lealtad.programa_cambiado`, sin TTL.

## 14. Permisos

`lealtad.ver`, `lealtad.configurar`, `lealtad.ajustar`, `lealtad.canjear`, `lealtad.revertir_canje`, `lealtad.entregar`, `sorteos.ver`, `sorteos.gestionar`, `sorteos.publicar`, `sorteos.marcar_requisito`, `sorteos.exportar`, `sorteos.ejecutar`, `sorteos.entregar`.

| Rol            | Agrega                                           |
| -------------- | ------------------------------------------------ |
| `admin`        | todos                                            |
| `contabilidad` | todos menos `sorteos.ejecutar`                   |
| `cajero`       | `lealtad.ver`, `lealtad.canjear` (canje en caja) |
| `soporte`      | `lealtad.ver`, `lealtad.canjear`, `sorteos.ver`  |
| `lectura`      | los `.ver` (automático)                          |

A1 (dueño de `permisos.ts`) agrega además `servicios.programar_plan_temporal` y `servicios.cancelar_plan_temporal` (el canje los llama anidados con actor sistema; el panel los usa para ver o cancelar): `admin` y `soporte`. Ver los planes temporales de un servicio pide `servicios.ver`.

## 15. Errores (RFC 9457)

| `type` (sufijo)             | Estado | Cuándo                                                                                   |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `programa_inactivo`         | 422    | Ganar o canjear sin programa activo                                                      |
| `programa_activo_existente` | 409    | Segundo programa activo en la empresa                                                    |
| `saldo_insuficiente`        | 422    | Saldo menor al costo o al mínimo, o negativo                                             |
| `servicio_no_valido`        | 422    | Servicio de otra empresa o retirado                                                      |
| `sin_existencias`           | 409    | Premio agotado                                                                           |
| `canje_pendiente`           | 409    | Ya hay un descuento reservado para el periodo                                            |
| `canje_no_revertible`       | 409    | Canje entregado o aplicado a una factura vigente                                         |
| `nota_fuera_de_plazo`       | 422    | Descuento sobre una factura de hace más de 2 meses                                       |
| `parametro_sin_confirmar`   | 422    | Falta una decisión del contador (`premio_bien_iva`, `mejora_facturacion`)                |
| `referido_invalido`         | 422    | Autorreferido, mismo NIT o CUI, código inexistente o con formato inválido (A1, alta)     |
| `plan_temporal_existente`   | 409    | El servicio ya tiene un plan temporal programado o activo (A1)                           |
| `plan_temporal_incompatible`| 422    | El plan temporal cambia IPv4/IPv6 o el tamaño del prefijo delegado (A1)                  |
| `plan_temporal_igual`       | 422    | El plan temporal es el plan actual del servicio (A1)                                     |
| `plan_temporal_activo`      | 409    | Cambiar el plan del servicio con un plan temporal activo (A1)                            |
| `plan_temporal_cerrado`     | 409    | Cancelar un plan temporal terminado o cancelado (A1)                                     |
| `bases_incompletas`         | 422    | Falta un campo obligatorio de las bases                                                  |
| `sorteo_estado_invalido`    | 409    | Acción fuera de su estado                                                                |
| `bases_congeladas`          | 409    | Editar bases o criterios después de publicar                                             |
| `requisito_pendiente`       | 422    | Checklist incompleto                                                                     |
| `compromiso_invalido`       | 500    | La semilla revelada no coincide con el compromiso (no debe pasar; se audita y se alerta) |
| `sin_participantes`         | 422    | Corte vacío o con menos participantes que premios                                        |

## 15.1 Fase 1: lo que quedó implementado (A3, rama `a3/lealtad-1`)

- **Tablas**: `programas`, `reglas`, `movimientos`, `consumos`, `avisos_vencimiento` y `referidos` (migración `create_lealtad_programas_table`). `movimientos`, `consumos` y `avisos_vencimiento` son de solo inserción (trigger y `REVOKE`); un trigger impide que un lote entregue más puntos o valor de los que tiene. `premio_id` y `sorteo_id` de `reglas` reciben su FK en las fases 2 y 3.
- **Lotes**: valor vivo de un lote = `valor − Σ consumos.valor`; el último consumo se lleva el resto exacto (sin residuos de redondeo). Con diferimiento: saldo de `2.1.10` = Σ valor vivo de los lotes vivos de la empresa (lo revisa `GET /reportes/lealtad`, `cuadra`).
- **Asientos** (origen `lealtad`, `origen_id` = el movimiento, diario `VAR`): acumulación y ajuste positivo `4.1.05 / 2.1.10`; vencimiento `2.1.10 / 4.1.06`; reverso y ajuste negativo `2.1.10 / 4.1.05` (corrección, no ingreso). Sin diferimiento, `valor = 0.00` y ningún asiento. Con diferimiento, crear, editar o activar exige las cuentas (422 `cuentas_lealtad_faltantes`).
- **Idempotencia**: claves `pago_a_tiempo:factura:<id>`, `pago_a_tiempo:racha:factura:<id>`, `adelantado:pago:<id>`, `antiguedad:servicio:<id>:<k>`, `referido:<id>`, `referido:bono:<id>`, `vencimiento:lote:<id>`, `reverso:<clave del lote>`. Lo que se revierte y se vuelve a ganar usa `<clave>#2`, `#3`… El consumidor decide desde el estado de la base, no desde el payload.
- **Reglas**: una regla por tipo cuenta (si hay varias activas, la de menor id). `tope_por_cliente` = número de otorgamientos de la regla al cliente en el mes o año. Nada es retroactivo: el pago (o el aniversario) debe caer en la vigencia del programa y de la regla. Fase 1: `recompensa = puntos` (422 `recompensa_no_disponible`).
- **Reversos**: devuelven solo lo que le queda vivo al lote (lo vencido ya salió). Se aplican aunque el programa esté desactivado.
- **Referidos**: `servicio.creado` del cliente con `referido_por_id` en la empresa del código registra el referido `pendiente` (aunque la empresa aún no tenga programa); califica con las facturas pagadas mínimas dentro de `dias_maximos` (si no, `rechazado`); un pago anulado que lo deja sin el mínimo revierte lo otorgado y lo vuelve a `pendiente`; un retiro que lo deja sin servicio en la empresa lo rechaza.
- **Endpoints**: los de §11 de programa, reglas, puntos, ajustes, referidos y `/reportes/lealtad`, más `GET /lealtad/programas` (lista consolidable). `GET /lealtad/programa` responde `{ empresa_id, programa }` (`programa: null` sin programa). Errores además de §15: 409 `programa_ya_activo`, 409 `programa_inactivo_ya`, 409 `referido_rechazado`, 422 `cuentas_lealtad_faltantes`, 422 `recompensa_no_disponible`.
- **Crons** (en `billing:worker`, con lock): `lealtad:antiguedad` (03:05) y `lealtad:vencer` (03:20, Guatemala), todo lo pendiente hasta hoy por lotes de 500. Se procesan por empresa: si una falla (p. ej. su asiento cae en un mes cerrado, 422 `periodo_cerrado`) queda en `fallidas` de la corrida (`audit.acciones`, acción con el nombre del cron) y se sigue con las demás; se reintenta en el siguiente disparo. Un trigger bloquea el lote (advisory lock por lote) para que dos salidas concurrentes no lo sobreconsuman (H15).

## 15.2 Fase 2: canjes (A3, rama `a3/lealtad-2`)

- **Tablas**: `lealtad.premios` (catálogo por programa, `version`; se desactiva, no se borra; `existencias` en cualquier tipo, null = sin límite) y `lealtad.canjes` (estado por acción, `version`, `movimiento_id` = la salida, `descuento` en Q).
- **`lealtad.canjear`** (`POST /lealtad/canjes`, `Idempotency-Key`): la empresa es la del premio. Los puntos salen al crear el canje con un movimiento `canje` (clave `canje:<id>`) que consume los lotes que vencen antes; con diferimiento, asiento `2.1.10 / 4.1.06` por el valor consumido. Errores además de §15: 422 `premio_inactivo`, 422 `descuento_sin_base`, 422 `recompensa_no_disponible` (boletos, fase 3).
  - `mejora_plan`: `ProgramarPlanTemporal` (A1) anidada con `origen: 'lealtad'` (el enumerado de A1; no hay `canje`) y `origen_id` = el canje; cualquier error de A1 (`plan_temporal_incompatible`, `plan_temporal_existente`…) deshace el canje entero. Queda `aplicado`.
  - `descuento_factura` / `mes_gratis` con `factura_id`: nota de crédito **por línea** sobre la línea del plan (`EmitirNotaCredito` anidada; NCRE si la factura tiene DTE), dentro de `nota_ventana_meses` desde la emisión (2 por defecto; 422 `nota_fuera_de_plazo`). Queda `aplicado`. Decisión del PM (2026-10-19): sobre una factura ya pagada también se emite la nota y lo que exceda el saldo queda como crédito del cliente en Anticipos (se aplica a la próxima factura por el mecanismo de anticipos). Implementado: `EmitirNotaCredito` con `excedente_a_anticipos` (la usa el canje) acredita hasta lo que a la factura le queda acreditable; lo que pasa su saldo va a `billing.notas_credito.a_favor` con asiento `ingresos + IVA / CxC (saldo) + 2.1.01 Anticipos (excedente)`, y `aplicarAnticipos` lo aplica a las facturas pendientes, después de pagos y saldos iniciales (`billing.notas_credito_aplicaciones`, solo inserción; asiento `Anticipos / CxC` con origen en la nota). Una nota con saldo a favor no se anula con `facturas.anular_nota_credito` (409 `nota_con_saldo_a_favor`). **Pendiente del auditor**: sus invariantes 3 y 5 aún no cuentan esta fuente (prueba `.fails` `H-lealtad-nota-a-favor`).
  - `descuento_factura` / `mes_gratis` sin factura: `reservado` para la próxima factura (uno por servicio, 409 `canje_pendiente`). `facturas.emitir` (`#lealtad/emision`) agrega su línea `descuento` sobre la línea del plan (IVA del neto, `5.1.01` en el asiento; localización §3.5) y deja el canje `aplicado` con `factura_id` y `descuento` en la misma transacción. Uno que ya no tenga base (línea del plan en cero) sigue reservado para la siguiente.
  - **Mejora de plan en la factura** (decisión del PM, `mejora_facturacion = descuento_linea`): con un plan temporal `activo` de origen `lealtad`, la factura cobra el plan superior y una línea `descuento` hasta el precio del plan original, prorrateado igual. Con `costo_override` el precio del servicio no cambia y no hay descuento.
  - Orden de locks: el canje toma el lock de cobros del cliente (`bloquearCliente`) y luego el de lealtad, igual que la emisión.
  - `bien`: 422 `parametro_sin_confirmar` (`premio_bien_iva`).
- **`lealtad.revertir_canje`** (`POST /lealtad/canjes/:id/revertir`): un canje `reservado`, o `aplicado` a una factura que se anuló (409 `canje_no_revertible` en lo demás). Los puntos vuelven en un lote nuevo por cada lote que pagó el canje, con su vencimiento y su valor originales. Devuelve la existencia.
  - **Desvío del contrato, provisional** (decisión del líder, 2026-10-19): el contrato dice `reverso` con asiento espejo `4.1.06 / 2.1.10`; como el invariante 14 del auditor no admite un `reverso` que sea lote, hoy la devolución es un `ajuste` positivo con origen `canje` y asiento `4.1.05 / 2.1.10` (el ingreso total es el mismo, pero `4.1.06` queda con lo canjeado de más). Al auditar lealtad 2 el auditor decide si su invariante 14 acepta el reverso positivo de un canje con `4.1.06 / 2.1.10`; si lo acepta, se cambia a lo del contrato.
- **Portal** (decisión del PM, 2026-10-19): `lealtad.programas.visible_portal` (el cliente ve sus puntos) y `canje_portal` (canjea; solo con `visible_portal`, 422 en `canje_portal`), ambos `false` por defecto, en `PUT /lealtad/programas/:id` (con `version` y `audit.cambios`) y en `GET /lealtad/programa`. `lealtad.canjear` con actor `cliente` o canal `portal` exige los dos (403 `canje_portal_inactivo`) y que el cliente sea el del canje (403); el canje queda con canal `portal` y auditado como el cliente. A5 la llama con `contextoCliente(cliente_id)`.
- **Eventos**: `lealtad.canje_reservado` (aditivo), `lealtad.canje_aplicado`, `lealtad.canje_revertido`.
- **Endpoints**: `GET/POST /lealtad/premios`, `GET/PUT /lealtad/premios/:id`, `GET/POST /lealtad/canjes`, `GET /lealtad/canjes/:id`, `POST /lealtad/canjes/:id/revertir`.

## 15.3 Fase 3: sorteos (A3, rama `a3/sorteos`, primera PR)

Alcance acordado con el líder (2026-10-19): el núcleo de §7 más el checklist que bloquea la ejecución. Llegan con la **segunda PR**: subida de archivos de evidencia, acta en PDF (`acta_cerrada`, `sorteos.cerrar_acta`), notificación de ganadores, suplentes y no reclamados (`sorteos.marcar_no_reclamado`), exportación CSV/XLSX de participantes.

- **Estados de esta PR**: `borrador → bases_publicadas → participacion_abierta → corte_cerrado → ejecutado → premios_entregados`, y `cancelado` antes de `ejecutado`. `acta_cerrada` llega con la segunda PR (irá entre `ejecutado` y `premios_entregados`).
- **Tablas**: `lealtad.sorteos`, `sorteos_premios` (nombre, cantidad, `imagen_url`, valor, `tipo` `efectivo` | `bien` | `servicio`, `premio_id` del catálogo para `servicio`, `retiene_isr` e `isr_pct`), `sorteos_boletos` (`criterio` al corte, `canje`), `sorteos_participantes`, `sorteos_ganadores`, `sorteos_requisitos`. Triggers: bases, criterios, premios, semilla, `lista_hash` y resultado no cambian después de su paso; boletos solo en `participacion_abierta`; boletos, participantes y requisitos solo inserción.
- **Bases** (§7.2) en `bases` jsonb: `mecanica`, `regla_participacion` (el texto que ve el cliente en el portal), `plazo_reclamo_dias`, `no_reclamados`, `publicacion_resultados`, `resolucion_gobernacion`; y en columnas `inscripcion_desde`, `corte_en`, `fecha_sorteo`, `lugar`, `suplentes`. `bases_hash` = SHA-256 del JSON canónico del documento de bases (incluye premios y criterios).
- **Participación** (decisión del líder): foto en el corte, sin inscripción: `criterios.boletos_por_servicio` boletos por cada servicio `activo` sin facturas `vencida` en la empresa, más los boletos canjeados con puntos si `criterios.admite_canje` (premio `boletos` del catálogo con `sorteo_id` y `boletos`; pasivo `2.1.10 / 4.1.06` como cualquier canje).
- **Algoritmo** `argos-sorteo-v1` exactamente como §7.3 (`app/lealtad/sorteo_v1.ts`; `scripts/verificar-sorteo.mjs` sin dependencias). Al ejecutar se guardan semilla, `valor_publico`, `semilla_final` y los elegidos en `resultado` (y en `audit.cambios`).
- **Checklist**: `POST /lealtad/sorteos/:id/requisitos/:clave` con `evidencia` como referencia o texto; abrir exige `bases_diaco`; ejecutar exige además `isr_premios`, `timbre_fiscal` y `delegado_o_notario` (422 `requisito_pendiente`). **Decisión del PM (19 oct, §17 fila 23)**: `autorizacion_gobernacion` y `fianza` siguen en el checklist pero ya no son obligatorias.
- **Entrega** (`sorteos.entregar`, decisión del líder): gasto `5.1.03 Premios y promociones`. `efectivo`: egreso (categoría `premios`) de Caja o Bancos por `valor − ISR`; `bien`: **decisión del PM (19 oct, §17 fila 20)** contrapartida `compra` (`compra_linea_id`: la línea de bien de una compra registrada con factura de la empresa; gasto `5.1.03` por la base sin IVA contra la cuenta de la línea, o solo se liga si la línea ya fue a `5.1.03`; anular esa compra con el premio entregado → 409 `compra_de_premio_sorteo`; **observaciones del auditor**: una línea con `cantidad` > 1 se reparte por unidad (`unidades`, 1 por defecto; cada entrega guarda `compra_unidades` y `compra_base` = su parte de la base, base × unidades / cantidad, la última con el resto; más unidades que las de la línea → 422 `compra_ya_entregada`), y una línea que fue a propiedad, planta y equipo no se entrega (422 `linea_activo_fijo`; la compra ya no acepta una línea que no sea `activo_fijo` en `1.2.01`/`1.2.02`: 422 `cuenta_activo_fijo`)) o `cuenta` (lista blanca H25); `proveedor` responde 422 `contrapartida_proveedor` (decisión del líder: `2.1.03` solo se mueve con una compra, fase 5); `servicio`: canje sin puntos (`sorteo_ganador_id`) del premio del catálogo, reservado para la próxima factura (línea `descuento`, `5.1.01`). ISR del premio (`isr_pct`, 10 %) a `2.1.05`: retenido del efectivo; en especie lo asume la empresa (§17 fila 17).
- **Origen de asiento nuevo** `sorteo` (`origen_id` = el ganador): la entrega en especie y el ISR.
- **Correcciones del auditor** (H22–H25 y observaciones, rama `a3/sorteos`):
  - **Anular una entrega** (`sorteos.anular_entrega`, `POST /lealtad/sorteos/:id/ganadores/:ganadorId/anular-entrega`, permiso `sorteos.entregar`, con motivo; H22): deshace todo junto en una transacción (anula el egreso del efectivo, revierte el canje sin puntos del servicio sin devolver existencias, revierte el asiento `sorteo` del bien y el del ISR); el ganador vuelve a `por_notificar` y un sorteo `premios_entregados` vuelve a `ejecutado`. Por separado responden 422: `AnularEgreso` (`egreso_de_premio_sorteo`), `RevertirCanje` (`canje_de_premio_sorteo`) y `RevertirAsiento` (`reverso_por_documento`, H23: `sorteo` en `POR_DOCUMENTO`). Evento `sorteo.entrega_anulada`.
  - H24: trigger que congela en `sorteos_ganadores` `sorteo_id`, `posicion`, `tipo`, `participante_id` y `premio_posicion` y rechaza DELETE y TRUNCATE.
  - H25: la contrapartida `cuenta` de un bien es una lista blanca: activo imputable de la empresa (o global), sin contracuenta ni auxiliar de clientes, fuera de `1.1.01`–`1.1.13` y de `1.2` (cajas, bancos, CxC, impuestos, cobros por liquidar, tránsito, estimación, anticipados; un activo fijo sale con su baja).
  - **Valor público**: las bases declaran `fuente_valor_publico` (obligatoria al publicar; congelada con `bases_hash`) y al ejecutar se registra `valor_publico_evidencia` (obligatoria). La verificación pública muestra la fuente y la evidencia.
  - El estado nunca retrocede (trigger `sorteo_estado_avanza`); la única vuelta, `premios_entregados → ejecutado`, la hace la anulación de una entrega (`SET LOCAL lealtad.reabrir_entrega`).
  - `scripts/verificar-sorteo.mjs` comprueba además que cada titular tenga el premio de su puesto (premio 1 × cantidad, premio 2…) y los suplentes ninguno.
- **Endpoints**: `GET/POST /lealtad/sorteos`, `GET/PUT /lealtad/sorteos/:id`, `POST /lealtad/sorteos/:id/publicar-bases`, `/abrir`, `/cerrar-corte`, `/cancelar`, `/requisitos/:clave`, `/ejecutar`, `/ganadores/:ganadorId/entregar`, `/ganadores/:ganadorId/anular-entrega`; públicos `GET /lealtad/sorteos/:id/bases` y `/verificacion`; portal `GET /portal/sorteos` (publicados y vigentes de las empresas del cliente, con sus boletos, su seudónimo y, al terminar, el resultado).
- **Eventos**: `sorteo.bases_publicadas`, `sorteo.corte_cerrado`, `sorteo.ejecutado` (al ejecutar), `sorteo.premio_entregado`, `sorteo.cancelado` (§13) y `sorteo.entrega_anulada` (`sorteo_id`, `empresa_id`, `cliente_id`, `posicion`, `motivo`).

## 15.4 Fase 3: sorteos, segunda PR (A3, rama `a3/sorteos-2`)

- **Estados**: `borrador → bases_publicadas → participacion_abierta → corte_cerrado → ejecutado → acta_cerrada → premios_entregados`, y `cancelado` antes de `ejecutado`. El trigger impide retroceder; anular una entrega reabre `premios_entregados` a `acta_cerrada` (o a `ejecutado` sin acta).
- **Archivos** (`lealtad.sorteos_archivos`, solo inserción; disco `COMPROBANTES_DIR/sorteos/`, como comprobantes, logos y anuncios): `POST /lealtad/sorteos/:id/archivos` (multipart `archivo` + `uso` `evidencia` | `constancia`; PDF, JPEG, PNG o WebP por firma, hasta 5 MB; `sorteos.marcar_requisito`) y `GET /lealtad/sorteos/:id/archivos/:archivoId` (`sorteos.ver`, ETag = SHA-256; 404 si el archivo en disco no coincide con su huella). La evidencia se cita en `POST .../requisitos/:clave` con `archivo_id` (si no hay texto, la evidencia dice el archivo y su SHA-256) y la constancia firmada en la entrega (`constancia_archivo_id`).
- **Imágenes de premios** (pedido de A5): `POST /lealtad/sorteos/:id/premios/:posicion/imagen` (multipart `imagen`, solo en borrador, `sorteos.gestionar`; PNG, JPEG o WebP por firma, hasta 1 MB y de 64 a 4096 px, como los anuncios). `imagen_url` ya no admite URLs (422 `imagen_externa`): es la ruta interna de la imagen subida (entra en `bases_hash`). Se sirve en `GET /lealtad/sorteos/:id/premios/:posicion/imagen` (panel) y `GET /portal/sorteos/:id/premios/:posicion/imagen` (sesión del portal; solo sorteos anunciados de una empresa del cliente); en `PortalSorteo`, `imagen_url` es la ruta del portal.
- **`aviso_portal`** (pedido del PM vía A5): `false` por defecto; en crear y editar y en `PUT /lealtad/sorteos/:id/aviso-portal` (`sorteos.gestionar`, con `version`, `audit.cambios`) hasta antes de ejecutar (después 409 y trigger). `GET /portal/sorteos` solo lista los anunciados.
- **Notificación** (§7.4): `POST /lealtad/sorteos/:id/notificar-ganadores` (`sorteos.entregar`): cada ganador con premio `por_notificar` pasa a `notificado` con `reclamar_antes` = ahora + `bases.plazo_reclamo_dias`; un evento **`sorteo.ganador_notificado`** por ganador, que consume notify (A6). Idempotente. **Desvío del §7.4**: allí decía que la notificación emitía `sorteo.ejecutado`; ese evento sale al ejecutar (con todos los elegidos) y el aviso a cada ganador, con su plazo, es este evento nuevo.
- **Suplentes y no reclamados**: `POST /lealtad/sorteos/:id/ganadores/:ganadorId/no-reclamado` (`sorteos.entregar`, motivo): con el plazo vencido (antes 422 `plazo_reclamo_vigente`), el premio pasa al siguiente suplente en espera (`premio_sustitucion`, `sustituye_a`), que se notifica en el mismo paso; el ganador queda `sustituido` (o `no_reclamado` si no hay suplentes). El resultado no cambia (puesto, tipo y `premio_posicion` congelados). `premio` en el ganador = el que le toca. Evento **`sorteo.premio_no_reclamado`**.
- **Acta** (§7.3 punto 6): `POST /lealtad/sorteos/:id/cerrar-acta` (`sorteos.ejecutar`, `constancia`): `ejecutado → acta_cerrada`, exige `publicacion_resultados`; genera el PDF una sola vez (resolución, checklist, hashes, semilla, valor público con su fuente y evidencia, algoritmo, ganadores con seudónimo y nombre, asistentes, constancia y publicación), lo guarda como archivo `acta` y su SHA-256 en `acta_hash` (congelado). `GET /lealtad/sorteos/:id/acta` (PDF, ETag = `acta_hash`). La verificación pública trae `acta_hash`. Evento **`sorteo.acta_cerrada`**.
- **Entrega**: también al suplente que tomó un premio (`premio`); en `ejecutado` o `acta_cerrada`. El sorteo pasa a `premios_entregados` cuando, con el acta cerrada, ningún premio queda `por_notificar` ni `notificado` (al entregar, al dar uno por no reclamado o al cerrar el acta).
- **Participantes** (§7.3 punto 3): `GET /lealtad/sorteos/:id/participantes?formato=json|csv|xlsx` (`sorteos.exportar`, desde el corte): orden canónico por `codigo_publico`, boletos y cliente, con `lista_hash` al pie (columna del código).
- `lista_a_gobernacion` sigue en el checklist sin bloquear (se entrega después de las constancias).

## 16. Qué hace cada agente

| Agente | Trabajo                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Hecho (2026-10-18, rama `a1/lealtad`): `core.servicios_planes_temporales` con `servicios.programar_plan_temporal` y `servicios.cancelar_plan_temporal` (`GET/POST /servicios/:id/planes-temporales`, `POST /servicios/:id/planes-temporales/:planTemporalId/cancelar`) y las acciones de sistema `servicios.iniciar_plan_temporal` / `servicios.terminar_plan_temporal`; cron `planes_temporales` (cola `core-cron` en `node ace eventos:relay`, advisory lock, cada minuto) que termina y luego inicia lo pendiente hasta ahora y emite `servicio.config_cambiada` (`motivo: plan_temporal`); plan efectivo del servicio (`plan_id`) y de `aaa:user:*` con el temporal; `codigo_referido` en el alta y `core.codigos_referido`; permisos de §14 en `permisos.ts` y roles |
| **A2** | Nada nuevo: aplica el plan temporal como cualquier cambio de plan (`servicio.config_cambiada`). Verifica en el laboratorio que el inicio y el fin cambian la velocidad sin cortar la sesión                                                                                                                                                                                                  |
| **A3** | Schema y módulo `lealtad` (programa, reglas, premios, movimientos, lotes, canjes, referidos, sorteos, algoritmo, acta PDF, exportación); consumidor `lealtad`; crons `lealtad:antiguedad` y `lealtad:vencer`; línea `descuento` en `facturas.emitir` y NCRE por canje; asientos de §6; reporte `lealtad`; `scripts/verificar-sorteo.mjs`; README del módulo                                  |
| **A4** | Lealtad → Programa (reglas y premios con vista previa de cuánto cuesta un punto), clientes con saldo y movimientos, canje desde la ficha del cliente y desde caja, referidos; Sorteos → asistente por estados con el checklist, exportación, pantalla del acto con ruleta (solo muestra el resultado del backend), acta y entregas                                                           |
| **A5** | Portal: puntos, premios, canje, referidos y sorteos (§12); página pública de bases, resultados y verificación por sorteo                                                                                                                                                                                                                                                                     |
| **A6** | Plantillas y avisos: puntos acumulados (opcional), por vencer, canje aplicado, referido calificado, ganador de sorteo, resultados publicados; alerta al equipo si un sorteo tiene requisitos pendientes a 3 días de su fecha                                                                                                                                                                 |

Fases sugeridas en `PLAN.md` § "Programa de lealtad".

## 17. Confirmar con contador o abogado

| #   | Tema                                 | Quién             | Qué decidir                                                                                            | Provisional                                                                           | Fuente                         |
| --- | ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | "Mes gratis"                         | Contador          | Factura con descuento del 100 % (base cero) o valor normal                                             | Descuento del 100 %                                                                   | inv. F.1; NO VERIFICADO 12     |
| 2   | Premios en bienes                    | Contador          | Donación con IVA sobre el costo (art. 3.9) o descuento en especie                                      | Sin valor: bloquea la entrega                                                         | inv. F.1; NO VERIFICADO 12     |
| 3   | Mejora de plan                       | Contador          | Facturar el plan superior con descuento o dejar la factura igual                                       | `descuento_linea`                                                                     | inv. F.1 (interpretación)      |
| 4   | Deducibilidad de premios y regalos   | Contador          | Si es gasto de venta deducible (art. 21.29)                                                            | Sin categoría fiscal                                                                  | inv. F.2; NO VERIFICADO 13     |
| 5   | Derecho material y tasa de canje     | Contador          | Si los puntos dan derecho material (si no, se apaga el diferimiento) y qué tasa de canje esperada usar | `diferimiento` encendido, `canje_esperado_pct` = 100 % (pasivo completo, lo prudente) | inv. F.3 (B41)                 |
| 6   | NIIF para las PYMES 2015             | Contador          | Tratamiento de los puntos hasta 2026                                                                   | Como NIIF 15                                                                          | inv. F.3; NO VERIFICADO 16     |
| 7   | Provisión de premios comprometidos   | Contador          | Si el premio del sorteo se provisiona al publicar las bases                                            | Gasto al entregar                                                                     | inv. F.3 (NO VERIFICADO)       |
| 8   | Conciliación fiscal del diferimiento | Contador          | Si el movimiento de `2.1.10` es diferencia temporal en el ISR                                          | Sí, ajuste automático                                                                 | inv. F.3 (inferencia)          |
| 9   | Autorización de sorteos gratuitos    | Abogado           | Si un sorteo sin boletos entre clientes requiere autorización de la Gobernación                        | Se trata como si la requiriera                                                        | inv. F.5; NO VERIFICADO 15     |
| 10  | ISR del premio en especie            | Contador          | Mecanismo, formulario y constancia del 10 %                                                            | Pago previo, registrado como egreso                                                   | inv. F.2; NO VERIFICADO 15     |
| 11  | Timbre fiscal del 3 %                | Contador          | Base legal y tasa                                                                                      | Requisito del checklist                                                               | inv. A.5, F.5; NO VERIFICADO 1 |
| 12  | Fianza                               | Abogado           | Monto por departamento                                                                                 | Lo fija la resolución                                                                 | inv. F.5                       |
| 13  | Valor público del sorteo             | Abogado o notario | Qué fuente acepta la autoridad (número leído en el acto, resultado público)                            | Lo escribe el notario o delegado en el acto                                           | inv. F.6 (diseño propio)       |
| 14  | Vencimiento de puntos                | Abogado           | Si 12 meses es aceptable para la DIACO y cómo se informa                                               | 12 meses en los términos                                                              | inv. F.4 (art. 24); tabla #75  |
| 15  | Datos personales en la lista         | Abogado           | Seudónimo en la publicación y nombre solo para la autoridad                                            | Seudónimo                                                                             | inv. F.6                       |
| 16  | Descuento sobre factura ya pagada    | Contador          | Si el descuento por puntos sobre una factura cobrada va como NCRE con el excedente en Anticipos (crédito a la próxima factura) o de otra forma | NCRE por el descuento; excedente en `2.1.01 Anticipos` y se aplica a la próxima factura (decisión del PM, 2026-10-19) | Decisión del PM |
| 17  | ISR de premios de sorteo              | Contador          | En efectivo se retiene el 10 % (`2.1.05`); en especie (bien o servicio) ¿lo asume la empresa como gasto (`5.1.03 / 2.1.05`) o lo paga el ganador antes de recibir? ¿Qué constancia se emite? | Efectivo: retenido; especie: lo asume la empresa | Decisión del líder (fase 3) |
| 18  | Premio en bien sin cuenta de existencias | Contador     | El plan no tiene cuenta de inventario; el bien se acredita a `2.1.03 Proveedores` o a una cuenta de activo que se indique al entregar | `2.1.03` o la cuenta indicada | Fase 3 (A3) |
| 19  | Factura de valor 0 (mes gratis, descuento del 100 %, cargo único sin costo, canje) | PM | Si se emite una factura en Q0 | **Decisión del PM (19 oct)**: nunca se genera. Es una **bonificación** interna (`billing.bonificaciones`): servicio o cliente, periodo, concepto, bruto, motivo obligatorio del catálogo de la empresa (los canjes usan «Canje de lealtad»), origen (`mes_gratis`, `descuento_100`, `cargo_sin_costo`, `canje`); solo el asiento `5.1.01 / 4.1.01` por la base sin IVA (origen `bonificacion`), sin CxC, IVA, DTE, folio ni documento; ocupa la clave `servicio_id-periodo`. El canje queda `aplicado` con `bonificacion_id`. Reemplaza el Q0 «pagada sin DTE» (H21) y la fila 1 | Decisión del PM |
| 20  | Premios en bienes con compra | PM | Cómo se lleva el premio en especie comprado con factura | **Decisión del PM (19 oct)**: si el bien se compró con factura (compra registrada), su IVA es crédito fiscal y el premio es gasto deducible `5.1.03` por el valor sin IVA; al entregar se liga a su compra. Sin compra, como hoy (rama `a3/sorteos`) | Decisión del PM |
| 21  | Deducibilidad de premios y regalos | PM | Categoría fiscal de `5.1.03` | **Decisión del PM (19 oct)**: `5.1.03 Premios y promociones` lleva `categoria_fiscal = deducible` (valor nuevo del catálogo). Reemplaza la fila 4 | Decisión del PM |
| 22  | Valor del punto y catálogo por empresa | PM | Si cada empresa fija el valor del punto y qué se canjea | **Decisión del PM (19 oct)**: sí. Ya lo cumple: programa por empresa (`lealtad.programas.empresa_id`), reglas y premios por programa, `valor_punto` y `canje_esperado_pct` editables por empresa (`PUT /lealtad/programas/:id`) | Decisión del PM |
| 23  | Autorización de la Gobernación y fianza en sorteos | PM | Si son obligatorias para ejecutar | **Decisión del PM (19 oct)**: no hace falta; `autorizacion_gobernacion` y `fianza` dejan de ser obligatorias (los demás requisitos se quedan). Reemplaza la fila 9 | Decisión del PM |
| 24  | ISR sobre premios de sorteo | Contador | Si el ISR del 10 % de los premios va en una subcuenta propia (p. ej. `2.1.05.01 ISR sobre premios por pagar`) por su declaración ante la SAT | En `2.1.05` con las retenciones de compras (decisión del líder, opción a; el auditor lo suma a su invariante) | Decisión del líder (19 oct) |
