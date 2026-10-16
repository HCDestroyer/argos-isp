# billing · Facturación (A3)

Plantillas de facturación, facturas, pagos, promesas, `evaluarEstadoServicio` y crons. Todo lo que mueve dinero termina en el libro (`app/ledger`).

## Plantillas de facturación

| Acción              | Archivo                       | Permiso                                            |
| ------------------- | ----------------------------- | -------------------------------------------------- |
| `plantillas.crear`  | `actions/crear_plantilla.ts`  | `plantillas.crear`                                 |
| `plantillas.editar` | `actions/editar_plantilla.ts` | `plantillas.editar` (con `version`, 409 si cambió) |

Campos: `ciclo` (`dia_fijo` con `dia` 1–28, o `aniversario` = día de instalación), `prorrateo`, `dias_gracia`, `facturas_para_limitar` (0 = nunca limitar), `facturas_para_cortar`, `mora_tipo`/`mora_valor`/`mora_recurrente`, `hora_corte` (HH:MM Guatemala), `certificar_al`, `reglas_promesa`.

Coherencia (`plantillas.ts`, 422 con el campo exacto): `dia_fijo` exige `dia`; `facturas_para_limitar ≤ facturas_para_cortar`; mora `ninguna` ⇒ 0, `fija`/`porcentaje` ⇒ > 0, porcentaje ≤ 100; máximo de promesas con buen historial ≥ máximo base.

Las facturas ya emitidas no cambian al editar la plantilla: cada una guarda `reglas_snapshot`. Cada cambio queda en `audit.cambios` (`entidad_tipo = plantilla_facturacion`).

### Reglas de promesa (`reglas_promesa.ts`)

Se guardan normalizadas (todas las claves). Ver el comentario del archivo y el schema `ReglasPromesa` del OpenAPI: máximo por periodo (y con buen historial), plazo máximo, no exceder la siguiente facturación, deuda máxima, abono inicial, antigüedad mínima, cumplimiento mínimo, bloqueo tras incumplida, y límites por canal (`portal`, `ia`, `operador`, `supervisor`: `permitido`, `requiere_aprobacion`, y overrides de plazo, máximo y deuda).

### Excepciones por servicio (`excepciones.ts`)

`core.servicios_excepciones (servicio_id, campo, valor jsonb)` es de A1; A3 define los campos:

| `campo`                 | `valor`                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `dia`                   | entero 1–28 (solo aplica en `dia_fijo`)                                         |
| `prorrateo`             | boolean                                                                         |
| `dias_gracia`           | entero 0–90                                                                     |
| `facturas_para_limitar` | entero 0–24                                                                     |
| `facturas_para_cortar`  | entero 1–24                                                                     |
| `mora_tipo`             | `ninguna` \| `fija` \| `porcentaje`                                             |
| `mora_valor`            | string decimal `"15.00"`                                                        |
| `mora_recurrente`       | boolean                                                                         |
| `hora_corte`            | `"HH:MM"`                                                                       |
| `certificar_al`         | `emitir` \| `pagar` \| `nunca`                                                  |
| `reglas_promesa`        | objeto parcial; se combina clave a clave (y por canal) sobre el de la plantilla |

No exceptuables: `nombre`, `ciclo`. `validarExcepcion(campo, valor)` valida (422) y `aplicarExcepciones(plantilla, filas)` devuelve la `ConfiguracionFacturacion` efectiva con la lista `excepciones` aplicadas.

## Facturas (tarea 4)

| Acción             | Archivo                       | Qué hace                                                                                                                                                                                                            |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facturas.generar` | `actions/generar_facturas.ts` | Cron y `POST /facturas/generar`. Todo lo pendiente hasta `hasta` (hoy por defecto), servicios `activo`/`limitado`/`suspendido` con plantilla, por lotes de 500. Repetirla no duplica.                               |
| `facturas.emitir`  | `actions/emitir_factura.ts`   | Una factura de un periodo, en su transacción: `clave_unica = servicio_id-YYYY-MM-DD` con `ON CONFLICT DO NOTHING`, líneas, `reglas_snapshot`, asiento y `factura.emitida`. Aplica el anticipo del cliente si tiene. |

- Periodos (`periodos.ts`): `dia_fijo` empieza el `dia` de cada mes; `aniversario`, el día de instalación (29–31 → 28). El primer periodo va de la instalación (o del alta si no hay `fecha_instalacion`) al siguiente ciclo; con `prorrateo` se cobra `días / días del ciclo`, sin prorrateo el precio completo.
- Líneas: plan al precio efectivo (`costo_override` o `planes.precio`) y conceptos recurrentes activos (> 0), ambos por el factor de prorrateo. IVA 12 % incluido, desglosado por línea (`lineaConIva`: `iva = total − total/1.12`, redondeo al final); `subtotal = total − Σ iva`.
- `vence_en = periodo + dias_gracia`. Asiento: `CxC (cliente) / Ingresos por internet + Otros ingresos + IVA débito`.
- `facturas.tipo`: `servicio` (periodo) o `mora` (recargo, ver tarea 5). Solo `servicio` cuenta para limitar/cortar.
- Estado según lo pagado (`estadoSegunPago`): `pagada` si `pagado = total`; si ya pasó por `vencerFacturas` (`vencida_en`), `vencida`; si no, `parcial` o `emitida`.

## Anular factura

`actions/anular_factura.ts` (`facturas.anular`, `POST /facturas/:id/anular` con `motivo`): 409 `factura_con_pagos` si ella o sus moras tienen pagos aplicados (anular el pago primero) y `factura_anulada` si ya lo estaba. Pasa a `anulada` (`anulada_en`, `anulada_por`, `motivo_anulacion`) junto con sus recargos de mora pendientes, revierte cada asiento (`factura`/`mora`) con `RevertirAsiento`, emite `factura.anulada` por cada una y re-evalúa el servicio (sube de inmediato). La `clave_unica` queda ocupada: el periodo no se vuelve a emitir. La anulación FEL llega en la semana 5.

## Importación (para A6, sin endpoint)

| Acción                             | Archivo                                 | Qué hace                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facturas.importar_pendiente`      | `actions/importar_factura_pendiente.ts` | `{ clave_externa, servicio_id, periodo, total, vence_en?, concepto?, aplicar_mora? }` → factura pendiente del periodo (ocupa `clave_unica`), IVA desglosado, mora `ninguna` salvo `aplicar_mora`, `vencida` si `vence_en` ya pasó. Asiento `CxC / 2.9.01 Saldos de apertura`                |
| `facturas.registrar_saldo_inicial` | `actions/registrar_saldo_inicial.ts`    | `{ clave_externa, cliente_id, monto (con signo), fecha?, descripcion? }`: > 0 → factura de apertura sin servicio (`apertura-<clave>`, vencida, no cuenta para el corte) con `CxC / 2.9.01`; < 0 → `2.9.01 / Anticipos` y se aplica a sus facturas (`billing.saldos_iniciales_aplicaciones`) |

Ambas idempotentes por `clave_externa` (repetir → `creada/creado: false`; con otros datos → 409 `clave_externa_conflicto`), auditadas y sin eventos (carga histórica, no notifica). El ingreso y el IVA de lo importado ya están en el sistema de origen: la contrapartida es la cuenta transitoria `2.9.01`.

## Vencimiento y mora (tarea 5)

| Acción                       | Archivo                      | Qué hace                                                                                                                                                  |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facturas.vencer_pendientes` | `actions/vencer_facturas.ts` | Cron y `POST /facturas/vencer`. Todo lo pendiente hasta `hasta` (hoy por defecto), por lotes de 500.                                                      |
| `facturas.vencer`            | `actions/vencer_factura.ts`  | Una factura de servicio `emitida`/`parcial` con `vence_en < hoy` → `vencida` (`vencida_en`), evento `factura.vencida`, y los recargos de mora pendientes. |

- Mora (`mora.ts`) según el `reglas_snapshot` de la factura: `fija` (`mora_valor` Q) o `porcentaje` (del total). Es una factura `tipo = 'mora'` con `factura_origen_id`, sin IVA, asiento `CxC / Recargos por mora` (`origen_tipo = 'mora'`). Nace `vencida` (se debe ya) pero no cuenta para el corte.
- `mora_recurrente`: un recargo más por cada mes cumplido después del vencimiento. Clave `mora-<factura>-<n>`: repetir no duplica.
- Vencer no cambia el estado del servicio: lo hace el cron de corte a la `hora_corte`.

## evaluarEstadoServicio (tarea 6)

`actions/evaluar_estado_servicio.ts` (`servicios.evaluar_estado`) es la **única** que decide el estado del servicio. Entrada `{ servicio_id, ahora?, ignorarHoraCorte? }`; salida `{ estado, motivo, de, cambiado, deseado, vencidas, promesa_activa }`. Se llama anidada (`{ trx }`) desde el cron de corte, `registrarPago`, `anularPago` y (tarea 10) promesas.

1. Retirado o sin plantilla: no se toca.
2. Promesa `activa` → `activo`.
3. Facturas de servicio vencidas ≥ `facturas_para_cortar` → `suspendido`.
4. Vencidas ≥ `facturas_para_limitar` (> 0) → `limitado` si el plan tiene velocidad limitada > 0 (bajada y subida); si no, `activo`.
5. Si no → `activo`.

Con la configuración efectiva (plantilla + excepciones). Bajar de estado espera a la `hora_corte` del día (Guatemala); subir es inmediato. Si cambia, llama `CambiarEstadoServicio` de A1 (evento `servicio.estado_cambiado`).

## Cron de corte y worker (tarea 7)

`node ace billing:worker` (`commands/billing_worker.ts`, lógica en `jobs.ts`): cola BullMQ `billing-cron` con job schedulers `generar` (cada hora), `vencer` (cada hora), `corte` (cada minuto) y `promesas` (cada minuto, `incumplirPromesas`). También consume el grupo `billing` del bus (`--sin-eventos` lo apaga). Concurrencia 1 y advisory lock de Postgres por cron (`conLock`): si otra instancia lo tiene, el disparo se omite. `--una-vez generar|vencer|corte|promesas` corre un cron y termina.

`actions/ejecutar_corte.ts` (`servicios.corte`): procesa cada hora de corte del día que ya llegó (de la plantilla, o la excepción `hora_corte` del servicio) y no está en `billing.cortes_ejecutados`; primero vence lo pendiente y luego evalúa cada servicio con `evaluarEstadoServicio`. `POST /facturas/corte { servicio_id?, ignorar_hora? }` es el corte manual del laboratorio (no registra `cortes_ejecutados`).

## Pagos (tarea 8, versión de cobro rápido)

| Acción            | Archivo                     | Permiso                               |
| ----------------- | --------------------------- | ------------------------------------- |
| `pagos.registrar` | `actions/registrar_pago.ts` | `POST /pagos` con `Idempotency-Key`   |
| `pagos.anular`    | `actions/anular_pago.ts`    | `POST /pagos/:id/anular` con `motivo` |

- Métodos: `caja`, `pasarela`, `deposito`, `transferencia`, `ach`, `remesa`, `agente`, `debito` (`METODOS_PAGO` en `app/shared/eventos.ts`). Datos obligatorios (`DATOS_POR_METODO`, 422 con un error por campo; `no_aplica` si se mandan donde no corresponden):

    | Método                 | Obligatorios                                                                  |
    | ---------------------- | ----------------------------------------------------------------------------- |
    | `transferencia`, `ach` | `banco_origen_id`, `cuenta_bancaria_id`, `referencia`                         |
    | `remesa`               | `cuenta_bancaria_id` (banco al que llegó), `referencia` (código de la remesa) |
    | `deposito`             | `cuenta_bancaria_id`, `referencia` (boleta)                                   |

- `referencia` única por (`metodo`, `cuenta_bancaria_id`, `referencia`) (409 `referencia_duplicada`; índice `pagos_metodo_referencia` con NULLS NOT DISTINCT). Misma `Idempotency-Key` → misma respuesta (middleware).
- Aplicación: primero las `facturas` pedidas, luego la más antigua (vencimiento, periodo, id). Lo que sobra va a **Anticipos** (auxiliar por cliente) y se aplica a las facturas que se emitan después (`aplicarAnticipos` en `cobros.ts`, asiento `Anticipos / CxC` con origen en el pago).
- Asiento: `Caja | subcuenta bancaria | Banco principal / CxC + Anticipos`. `caja` sin `caja_id` usa la caja del turno abierto del cajero o la principal; `deposito`, `transferencia`, `ach` y `remesa` van a la subcuenta de `1.1.02` de la cuenta bancaria de destino; `pasarela`, `agente`, `debito` al banco principal (comisión de pasarela: semana 2).
- `pago.registrado` y, en la misma transacción, `evaluarEstadoServicio` de cada servicio afectado: la reactivación (`servicio.estado_cambiado`) sale con el pago. La respuesta trae `servicios[]` con cómo quedó cada uno.
- Anular: estado `anulado` con quién/cuándo/motivo, `RevertirAsiento` de cada asiento del pago (cobro y aplicaciones de su anticipo), descuenta lo aplicado (las facturas que ya habían vencido vuelven a `vencida`), `pago.anulado` y re-evaluación.
- **Pago de terceros** (decisión del PM): `cliente_id` es el pagador y `facturas[]` puede traer facturas pendientes de cualquier cliente (422 `facturas.<i>` si no existe o no tiene saldo). Se aplican en ese orden y lo que sobra, a las del pagador de la más antigua a la más nueva; el excedente, a Anticipos del pagador. Un solo asiento: débito por el total y crédito en el auxiliar CxC de **cada dueño** por lo aplicado a sus facturas. Se re-evalúan los servicios de todos (`servicios[]`); `aplicaciones[]` trae `cliente_id`/`cliente_nombre` del dueño; `pago.registrado`/`pago.anulado` traen `clientes` (pagador + dueños). En el estado de cuenta del dueño el movimiento dice "pagado por <pagador>". Anular revierte todos los auxiliares y re-evalúa todos los servicios. La referencia sigue siendo única por (método, cuenta, referencia).
- Concurrencia: advisory lock por cliente (`bloquearCliente`/`bloquearClientes`, en orden ascendente: pagador y dueños) en toda acción que aplica dinero.

## Cuentas bancarias y bancos (`cuentas_bancarias.ts`)

- `billing.bancos`: catálogo de bancos de Guatemala (sembrado en su migración). `GET /bancos` (cualquier usuario con sesión).
- `billing.cuentas_bancarias`: cuentas propias (banco, número, alias, moneda `GTQ`/`USD`, activa). **Fuente única** de las cuentas para depósito del panel y del portal. `cuentas_bancarias.crear` (`POST /cuentas-bancarias`) crea además su subcuenta `1.1.02.NN` en el libro; `cuentas_bancarias.editar` (`PUT /cuentas-bancarias/:id`, con `version`) renombra la subcuenta y nunca la desactiva. Ambas con permiso `cuentas_bancarias.editar`; `GET /cuentas-bancarias[?activa]` y `/:id` con `cuentas_bancarias.ver`. Cambios en `audit.cambios` (`cuenta_bancaria`).
- Una cuenta inactiva o en USD no recibe pagos (422).

## Promesas de pago (tarea 10)

| Acción                        | Archivo                               | Quién la llama                                         |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `promesas.crear`              | `actions/crear_promesa_pago.ts`       | `POST /promesas`; el portal (A5) directo, canal portal |
| `promesas.aprobar`            | `actions/aprobar_promesa.ts`          | `POST /promesas/:id/aprobar` (supervisor)              |
| `promesas.cumplir`            | `actions/cumplir_promesa.ts`          | `promesas.revisar_cliente` (evento `pago.registrado`)  |
| `promesas.revisar_cliente`    | `actions/revisar_promesas_cliente.ts` | `ConsumidorBilling` (grupo `billing`, `consumidor.ts`) |
| `promesas.incumplir`          | `actions/incumplir_promesa.ts`        | `promesas.incumplir_vencidas`                          |
| `promesas.incumplir_vencidas` | `actions/incumplir_promesas.ts`       | cron `promesas` (cada minuto, con lock)                |

- `crearPromesaPago` evalúa las `reglas_promesa` efectivas (plantilla + excepción `reglas_promesa` del servicio) con `evaluarReglas` (`promesas.ts`, pura) en este orden y se detiene en la primera que falla: `habilitadas`, `canal_permitido`, `sin_deuda`, `plazo_max_dias`, `no_exceder_siguiente_facturacion`, `deuda_maxima` (deuda vencida), `abono_inicial_pct` (lo pagado de las facturas pendientes), `antiguedad_minima_dias`, `cumplimiento_minimo_pct` (últimas `historial_ventana` promesas resueltas), `bloqueo_tras_incumplida_dias`, `max_por_periodo` (promesas creadas en el periodo de facturación actual; con cumplimiento ≥ `buen_historial_pct`, `max_por_periodo_buen_historial`). Los límites no nulos del canal reemplazan al general; `requiere_aprobacion` deja la promesa `pendiente_aprobacion`.
- Siempre guarda la promesa (también la rechazada) con `reglas_snapshot` y `resultado_evaluacion` = `{ resultado, regla, motivo, canal, evaluada_en, reglas[] (regla, ok, valor, limite, origen, detalle), deuda, historial, siguiente_facturacion }`. Al aprobar se agrega `aprobacion`; al cerrar, `cierre`.
- Aprobada → `activa`, `promesa.creada` y `evaluarEstadoServicio` anidada (reactiva en la misma transacción). La respuesta trae `servicio` (opcional). Una suspensión manual se respeta: la promesa queda activa y el servicio sigue suspendido.
- 409 `promesa_abierta` si el servicio ya tiene una promesa activa o pendiente; 422 si `vence_en` no es futura, el monto no es > 0 o supera la deuda pendiente del servicio, o el servicio está retirado o sin plantilla.
- Canal en `POST /promesas`: el del cuerpo, o `portal`/`ia` según `X-Canal`, o `operador`. `supervisor` exige el permiso `promesas.aprobar` (403).
- Cumplida: lo pagado a las facturas del servicio desde la creación de la promesa llega a su monto, o el servicio ya no tiene deuda vencida. Se revisa con cada `pago.registrado` y otra vez al vencer. Al cumplirse: `promesa.cumplida` y re-evaluación (una promesa parcial puede volver a limitar o cortar).
- Vencida sin cumplir → `incumplida`, `promesa.incumplida` y re-evaluación (corta con la hora de corte). Pendiente de aprobación vencida → `cancelada`.

## Estado de cuenta (tarea 11)

`estado_cuenta.ts`: `GET /clientes/:id/estado-cuenta` (permiso `clientes.estado_cuenta`, alcance por zona/router del cliente). Es el **auxiliar CxC** del libro:

- `saldo`: suma de los movimientos del cliente en CxC (debe − haber); positivo = debe.
- `saldo_a_favor` (aditivo): anticipos sin aplicar.
- `facturas_pendientes`: `emitida`/`parcial`/`vencida` (servicio y mora), la más antigua primero.
- `movimientos`: un renglón por asiento que toca su CxC (fecha, asiento) con `cargo`, `abono` y saldo acumulado; el último es igual a `saldo`. `referencia_id` = id de la factura, pago o mora de origen.

## Pruebas (tarea 12)

Japa contra Postgres real; después de cada paso, el SELECT de control del libro (`afirmarLibroCuadrado`: ningún asiento descuadrado y total debe = total haber).

| Archivo                                                                            | Qué cubre                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/billing/ciclo.spec.ts`                                                      | Emitir (dos veces sin duplicar) → vencer → limitar → cortar → pagar una (limitado) → pagar todo (activo); y promesa incumplida → corte, pago parcial y total en un turno de caja, anular pago, anular factura, cerrar caja con diferencia (motivo obligatorio y asiento) |
| `tests/billing/pagos.spec.ts`, `pagos_bancarios.spec.ts`, `pagos_terceros.spec.ts` | Pago parcial, excedente a Anticipos, anulación con reverso, concurrencia; métodos bancarios con su subcuenta, 422 por campo y 409 por referencia; pago de terceros (un asiento, dos auxiliares, anulación)                                                               |
| `tests/billing/promesas.spec.ts`                                                   | Aprobada (reactiva), rechazada con la regla exacta, límites por canal, suspensión manual, cumplida por evento, incumplida por cron, aprobación y cancelación, endpoints                                                                                                  |
| `tests/billing/anular_factura.spec.ts`, `importacion.spec.ts`                      | Anular factura (y su mora), 409 con pagos; acciones del importador idempotentes                                                                                                                                                                                          |
| `tests/ledger/cajas.spec.ts`                                                       | Alcance por caja, turnos, cierre exacto, faltante y sobrante                                                                                                                                                                                                             |

Correr solo las del módulo: `DB_DATABASE=argosisp_test_a3 PORT=3433 node ace test --files tests/billing --files tests/ledger`.

## Endpoints

| Método   | Ruta                                            | Permiso                    |
| -------- | ----------------------------------------------- | -------------------------- |
| GET      | `/api/v1/plantillas-facturacion`                | `plantillas.ver`           |
| POST     | `/api/v1/plantillas-facturacion`                | `plantillas.crear`         |
| GET      | `/api/v1/plantillas-facturacion/:id`            | `plantillas.ver`           |
| PUT      | `/api/v1/plantillas-facturacion/:id`            | `plantillas.editar`        |
| GET      | `/api/v1/facturas`, `/api/v1/facturas/:id`      | `facturas.ver`             |
| POST     | `/api/v1/facturas/generar`, `/vencer`, `/corte` | `facturas.generar`         |
| POST     | `/api/v1/facturas/:id/anular`                   | `facturas.anular`          |
| GET      | `/api/v1/pagos`, `/api/v1/pagos/:id`            | `pagos.ver`                |
| POST     | `/api/v1/pagos`                                 | `pagos.registrar`          |
| POST     | `/api/v1/pagos/:id/anular`                      | `pagos.anular`             |
| GET      | `/api/v1/promesas`                              | `promesas.ver`             |
| POST     | `/api/v1/promesas`                              | `promesas.crear`           |
| POST     | `/api/v1/promesas/:id/aprobar`                  | `promesas.aprobar`         |
| GET      | `/api/v1/bancos`                                | sesión (sin permiso)       |
| GET      | `/api/v1/cuentas-bancarias`, `/:id`             | `cuentas_bancarias.ver`    |
| POST/PUT | `/api/v1/cuentas-bancarias[/:id]`               | `cuentas_bancarias.editar` |
| GET      | `/api/v1/clientes/:id/estado-cuenta`            | `clientes.estado_cuenta`   |

## Eventos

Emite: `factura.emitida`, `factura.vencida`, `pago.registrado`, `pago.anulado`, `promesa.creada`, `promesa.cumplida`, `promesa.incumplida`, `factura.anulada`.

Consume (grupo `billing`, `node ace billing:worker`): `pago.registrado` (cumplir promesas). Lee de A1 en solo lectura `core.servicios`, `core.servicios_excepciones` y `network.planes`.
