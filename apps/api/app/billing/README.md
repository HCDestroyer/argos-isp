# billing · Facturación (A3)

Plantillas de facturación, facturas, pagos, promesas, `evaluarEstadoServicio` y crons. Todo lo que mueve dinero termina en el libro (`app/ledger`).

## Multiempresa (varios NIT)

Cada documento es de **una** empresa (`empresa_id`): la factura, la mora, la nota de crédito y la promesa toman la del servicio; el pago, la de sus facturas (o la de su cuenta bancaria); el comprobante, la de su cuenta bancaria; el cobro en línea, la de sus facturas. Contrato completo y tabla de orígenes en `.claude/integration/contratos/multiempresa.md` § «Implementación de billing y ledger».

- `empresa.ts`: `exigirAcceso(ctx, dimensiones)` (alcance + empresa de un documento en una ruta, 403 `empresa_no_permitida`), `empresaDeImportacion`, `resumenEmpresas`, `emisorDeFactura` (datos fiscales para FEL).
- **Cobro repartido** (`registrar_pago.ts`): un cobro en efectivo que cubre facturas de varias empresas se divide en un pago por empresa (mismo `cobro_id`, `billing.cobros`), cada uno con su caja abierta en esa empresa (422 `caja_no_abierta` con la empresa en `errors[0].rule`), su asiento y su `pago.registrado`. Métodos bancarios: 422 `cuenta_de_otra_empresa`; pasarela, agente y débito: 422 `pago_de_varias_empresas`. Recibo: `GET /cobros/:id` (`cobros_vista.ts`).
- Anticipos y saldo a favor por empresa (`aplicarAnticipos(t, cliente, empresaId)`).
- Listas con `empresasDeLaLista` + `filtrarPorEmpresa` y `?empresas=todas`; reportes y dashboard con columna de empresa en el consolidado (`EmpresasReporte`).
- `saldoPendienteServicio(servicioId)` en `facturas.ts` (para `servicios.cambiar_empresa` de A1).
- Pruebas: `tests/billing/multiempresa.spec.ts` (aislamiento, cobro repartido, `caja_no_abierta`, `cuenta_de_otra_empresa` y triggers, cierre por empresa, balance y consolidado, reportes, importación).

## Plantillas de facturación

| Acción              | Archivo                       | Permiso                                            |
| ------------------- | ----------------------------- | -------------------------------------------------- |
| `plantillas.crear`  | `actions/crear_plantilla.ts`  | `plantillas.crear`                                 |
| `plantillas.editar` | `actions/editar_plantilla.ts` | `plantillas.editar` (con `version`, 409 si cambió) |

Campos: `ciclo` (`dia_fijo` con `dia` 1–28, o `aniversario` = día de instalación), `prorrateo`, `dias_gracia`, `facturas_para_limitar` (0 = nunca limitar), `facturas_para_cortar`, `mora_tipo`/`mora_valor`/`mora_recurrente`, `hora_corte` (HH:MM Guatemala), `certificar_al`, `reglas_promesa`.

Coherencia (`plantillas.ts`, 422 con el campo exacto): `dia_fijo` exige `dia`; `facturas_para_limitar ≤ facturas_para_cortar`; mora `ninguna` ⇒ 0, `fija`/`porcentaje` ⇒ > 0, porcentaje ≤ 100; máximo de promesas con buen historial ≥ máximo base.

`por_defecto` (a lo sumo una, índice único parcial): la plantilla de los servicios creados sin `plantilla_facturacion_id`. Marcar otra (al crear o editar) desmarca la anterior, con su `version` y `audit.cambios`. `plantillaPorDefectoId()` la devuelve (la usa A1).

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
- FEL (`emision.ts`, contrato de localización fiscal §8.3; detalle en `app/fiscal/README.md`): con FEL desactivada todo queda como arriba. Con `certificar_al = pagar` (por defecto en plantillas nuevas) y FEL obligatoria u opcional, la factura es un **aviso de cobro** (`aviso_cobro`): su IVA va a `2.1.11 IVA por certificar` y, al certificarse, se reclasifica a `2.1.02` (`fel_facturas.ts`). Con FEL obligatoria y `emitir`, nace `por_certificar`: sin asiento, sin `factura.emitida` y sin contar para el corte, hasta que `facturas.confirmar_emision` la emite con la fecha de certificación.

## Anular factura

`actions/anular_factura.ts` (`facturas.anular`, `POST /facturas/:id/anular` con `motivo`): 409 `factura_con_pagos` si ella o sus moras tienen pagos aplicados (anular el pago primero) y `factura_anulada` si ya lo estaba. Pasa a `anulada` (`anulada_en`, `anulada_por`, `motivo_anulacion`) junto con sus recargos de mora pendientes, revierte cada asiento (`factura`/`mora`) con `RevertirAsiento`, emite `factura.anulada` por cada una y re-evalúa el servicio (sube de inmediato). La `clave_unica` queda ocupada: el periodo no se vuelve a emitir (para corregirla, `facturas.sustituir`). Con DTE certificado la anulación es en dos pasos (dentro de `dte_anulacion_plazo`; exige además `fel.anular`) y revierte también la reclasificación del IVA; fuera de plazo 422 `anulacion_fuera_de_plazo`. Una factura con notas de crédito no se anula (409 `factura_con_notas_credito`): se acredita el resto con otra nota.

## Notas de crédito

`actions/emitir_nota_credito.ts` (`facturas.nota_credito`, `POST /facturas/:id/notas-credito { monto, motivo, lineas? }` + `Idempotency-Key`, 201 `NotaCreditoEmitida`). Sobre una factura certificada es una **NCRE** (IVA de `2.1.02`, su DTE en cola, solo dentro de `nota_ventana_meses`); sobre un aviso sin DTE, una nota interna (IVA de `2.1.11`); sin FEL, interna como antes. `lineas[] { linea_id, monto }`: nota por línea con el IVA de cada línea (`billing.notas_credito_lineas`). Tabla `billing.notas_credito`, inmutable (trigger y `REVOKE`).

- `monto` parcial o total, nunca mayor al saldo (`total − pagado`) de la factura (422 `monto`); 409 `factura_anulada` o `factura_sin_saldo`.
- Asiento `nota_credito` (origen = la nota): Debe lo que a la factura **le queda** acreditado en cada cuenta (su asiento — Ingresos, IVA débito, Otros ingresos, Recargos por mora, Saldos de apertura — menos lo que ya debitaron sus notas anteriores) en proporción `monto / restante`, redondeado al final y con la diferencia en la línea con más holgura, sin pasar nunca su restante (`repartirProporcional` en `notas_credito.ts`); Haber CxC del cliente. **El último toma el resto**: la nota que agota lo acreditable lleva el restante exacto de cada cuenta, así una factura acreditada al 100 % con varias notas no deja IVA ni ingresos residuales por redondeo (hallazgo H1 del auditor). La nota guarda `subtotal` e `iva`.
- Suma `monto` a `facturas.pagado` (lo cubierto) y recalcula su estado (puede quedar `pagada`); `Factura.acreditado` es la parte de notas. Emite `nota_credito.emitida`, re-evalúa el servicio (sube de inmediato: `servicios[]`) y el consumidor `billing` revisa las promesas del cliente con ese evento.
- Estado de cuenta: abono con `tipo: nota_credito` y `referencia_id` = la nota. `GET /facturas/:id` trae `notas_credito[]`; `GET /notas-credito` (`cliente_id`, `factura_id`, `desde`, `hasta`) y `GET /notas-credito/:id` con `facturas.ver`.
- Su asiento no se revierte directo (`reverso_por_documento`).

## Anular una nota de crédito (NCRE rechazada)

`actions/anular_nota_credito.ts` (`facturas.anular_nota_credito`, `POST /notas-credito/:id/anular { motivo }`): solo una nota cuya NCRE la SAT rechazó en definitivo. Reverso espejo de su asiento, fila en `billing.notas_credito_anulaciones` (solo inserción, una por nota), el monto vuelve al saldo de la factura y se reevalúa el servicio; evento `nota_credito.anulada`. 409 `nota_anulada`, `ncre_certificada`, `dte_en_proceso`, `nota_sin_ncre_rechazada`. Las notas anuladas no cuentan en `acreditado`. El cierre del mes responde 409 `ncre_sin_certificar` mientras haya NCRE del mes o anteriores sin certificar.

## Sustituir factura

`actions/sustituir_factura.ts` (`facturas.sustituir`, `POST /facturas/:id/sustituir { motivo, cliente_fiscal? }`, contrato §10.9): para un dato mal emitido cuando el periodo ya está ocupado. Sin pagos (409 `sustitucion_no_permitida`). Sin DTE certificado anula la original; con DTE, la acredita con una NCRE por todo su saldo. Emite la nueva con las mismas líneas, periodo y vencimiento, `clave_unica = <clave>#s<n>` y el receptor corregido en su `reglas_snapshot`. `billing.sustituciones` (solo inserción) traza la relación; evento `factura.sustituida`.

## Importación (para A6, sin endpoint)

| Acción                             | Archivo                                 | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facturas.importar_pendiente`      | `actions/importar_factura_pendiente.ts` | `{ origen, id_externo, servicio_id?, cliente_id?, periodo?, cargo_unico?, emitida_en?, total, saldada_en_origen?, vence_en?, concepto?, aplicar_mora? }`. **De periodo** (servicio + periodo): ocupa `clave_unica = servicio_id-periodo`. **Cargo único** (`cargo_unico: true`, o sin servicio, o sin periodo): `clave_unica = importada-<origen>:<id>`, no ocupa periodo. IVA desglosado, mora `ninguna` salvo `aplicar_mora`, `vencida` si `vence_en` ya pasó. Asiento `CxC / 2.9.01` con fecha `emitida_en` (o hoy). `total` 0 o `saldada_en_origen` → `pagada`, sin asiento |
| `facturas.registrar_saldo_inicial` | `actions/registrar_saldo_inicial.ts`    | `{ clave_externa, cliente_id, monto (con signo), fecha?, descripcion? }`: > 0 → factura de apertura sin servicio (`apertura-<clave>`, vencida, no cuenta para el corte) con `CxC / 2.9.01`; < 0 → `2.9.01 / Anticipos` y se aplica a sus facturas (`billing.saldos_iniciales_aplicaciones`)                                                                                                                                                                                                                                                                                     |

| `facturas.anular_saldo_inicial` | `actions/anular_saldo_inicial.ts` | `{ id_externo \| saldo_inicial_id, motivo }`: reversos de la apertura (y de sus aplicaciones si era a favor), anula la factura de apertura; 409 `saldo_con_pagos` si ya tiene pagos |
| `pagos.registrar_historico` | `actions/registrar_pago_historico.ts` | `{ historico: true, id_externo, cliente_id, metodo, monto, fecha, referencia?, nota?, facturas? }`: pago con su fecha original, asiento `2.9.01 / CxC (+ Anticipos)` con esa fecha; sin caja, sin evento y sin reevaluar |
| `promesas.importar` | `actions/importar_promesa.ts` | `{ origen, id_externo, facturas? \| factura_id? \| servicio_id?, vence, monto?, creada_en, canal? }`: promesa vigente `activa` con `created_at = creada_en`, sin evaluar reglas, sin evento ni reevaluación (el siguiente corte la respeta). 422 `promesa_vencida` si ya venció, `sin_deuda`, factura sin servicio; 409 `promesa_abierta` |

Contrato completo (modos de importación, cuadre y errores) en `.claude/integration/contratos/importacion.md`. Saldo inicial y pago histórico aceptan `id_externo` (o `clave_externa`) y responden 422 `periodo_cerrado` con un detalle claro si la fecha cae en un mes cerrado.

**Neutral respecto al origen** (decisión del PM): todas reciben `origen` (texto libre `^[a-z0-9_]{1,40}$`: `mikrowisp`, `smartisp`, `csv`…) y el `id_externo` es único **por origen** (`claveImportacion` en `importacion.ts`; sin `origen`, el prefijo del id antes de `:` o `externo`). Ninguna acción conoce un sistema en particular: los adaptadores son de A6. `Factura` y `Pago` exponen `origen` e `id_externo`.

Todas idempotentes por (`origen`, `clave_externa`) (repetir → `creada/creado: false`; con otros datos → 409 `clave_externa_conflicto`), auditadas y sin eventos (carga histórica, no notifica). El ingreso y el IVA de lo importado ya están en el sistema de origen: la contrapartida es la cuenta transitoria `2.9.01`.

**Importación completa** (decisión del PM, 17 oct: «se debe traer todo»): cargos únicos (instalación, TV adicional), la segunda factura de un periodo (`cargo_unico: true`), la deuda de clientes retirados sin servicios (`cliente_id` sin `servicio_id`, una factura por factura del origen, con su fecha y concepto), facturas de total 0 (historial) y facturas saldadas sin pago en el origen (`saldada_en_origen`: `pagada` sin asiento ni pago, no inventa dinero). Todas suman al saldo del cliente; para el corte cuentan solo las que tienen servicio. Un pago histórico anterior a la `creada_en` de una promesa importada no la cumple (`avanceDePromesa`). Detalle en `contratos/importacion.md` § «Importación completa: casos especiales».

## Vencimiento y mora (tarea 5)

| Acción                       | Archivo                      | Qué hace                                                                                                                                                  |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `facturas.vencer_pendientes` | `actions/vencer_facturas.ts` | Cron y `POST /facturas/vencer`. Todo lo pendiente hasta `hasta` (hoy por defecto), por lotes de 500.                                                      |
| `facturas.vencer`            | `actions/vencer_factura.ts`  | Una factura de servicio `emitida`/`parcial` con `vence_en < hoy` → `vencida` (`vencida_en`), evento `factura.vencida`, y los recargos de mora pendientes. |

- Mora (`mora.ts`) según el `reglas_snapshot` de la factura: `fija` (`mora_valor` Q) o `porcentaje` (del total). Es una factura `tipo = 'mora'` con `factura_origen_id`, sin IVA, asiento `CxC / Recargos por mora` (`origen_tipo = 'mora'`); con `mora_con_iva` de la empresa (solo el contador lo activa) lleva IVA desglosado y, con FEL, es un aviso que se certifica como NDEB referida a su factura. Nace `vencida` (se debe ya) pero no cuenta para el corte.
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

Auditoría (decisión del PM, 2026-10-16): `servicios.evaluar_estado` solo escribe en `audit.acciones` cuando `cambiado = true` (`auditarExito`); los errores se auditan siempre. Las acciones que la llaman dejan su propia fila: `pagos.registrar`, `pagos.anular`, `promesas.*`, `facturas.anular` y, para el corte, cada corrida queda en `registrar_corrida` (`servicios.corte` con evaluados y cambiados).

## Cron de corte y worker (tarea 7)

`node ace billing:worker` (`commands/billing_worker.ts`, lógica en `jobs.ts`): cola BullMQ `billing-cron` con job schedulers `generar` (cada hora), `vencer` (cada hora), `corte` (cada minuto), `promesas` (cada minuto, `incumplirPromesas`) y `conciliar` (06:30 Guatemala, `ConciliarPasarela`). También consume el grupo `billing` del bus (`--sin-eventos` lo apaga). Concurrencia 1 y advisory lock de Postgres por cron (`conLock`): si otra instancia lo tiene, el disparo se omite. `--una-vez generar|vencer|corte|promesas` corre un cron y termina.

`cortes.ts`: `horasDeCorte(hasta, cliente?)` (pública, solo lectura) da las horas de corte distintas (HH:MM de Guatemala) de los servicios vigentes que ya llegaron; es la misma consulta que usa el corte y la que vigila A6 (`VigilarCrons`).

`actions/ejecutar_corte.ts` (`servicios.corte`): procesa cada hora de corte del día que ya llegó (de la plantilla, o la excepción `hora_corte` del servicio) y no está en `billing.cortes_ejecutados`; primero vence lo pendiente y luego evalúa cada servicio con `evaluarEstadoServicio`. `POST /facturas/corte { servicio_id?, ignorar_hora? }` es el corte manual del laboratorio (no registra `cortes_ejecutados`).

## Pagos (tarea 8, versión de cobro rápido)

| Acción            | Archivo                     | Permiso                               |
| ----------------- | --------------------------- | ------------------------------------- |
| `pagos.registrar` | `actions/registrar_pago.ts` | `POST /pagos` con `Idempotency-Key`   |
| `pagos.anular`    | `actions/anular_pago.ts`    | `POST /pagos/:id/anular` con `motivo` |
| `pagos.cerrar_diferencia` | `actions/cerrar_diferencia_pago.ts` | `POST /pagos/:id/cerrar-diferencia` (fase 4, §10.9) |

- Métodos: `caja`, `pasarela`, `deposito`, `transferencia`, `ach`, `remesa`, `agente`, `debito` (`METODOS_PAGO` en `app/shared/eventos.ts`). Datos obligatorios (`DATOS_POR_METODO`, 422 con un error por campo; `no_aplica` si se mandan donde no corresponden):

    | Método                 | Obligatorios                                                                  |
    | ---------------------- | ----------------------------------------------------------------------------- |
    | `transferencia`, `ach` | `banco_origen_id`, `cuenta_bancaria_id`, `referencia`                         |
    | `remesa`               | `cuenta_bancaria_id` (banco al que llegó), `referencia` (código de la remesa) |
    | `deposito`             | `cuenta_bancaria_id`, `referencia` (boleta)                                   |

- `referencia` única por (`metodo`, `cuenta_bancaria_id`, `referencia`) (409 `referencia_duplicada`; índice `pagos_metodo_referencia` con NULLS NOT DISTINCT). Misma `Idempotency-Key` → misma respuesta (middleware).
- Aplicación: primero las `facturas` pedidas, luego la más antigua (vencimiento, periodo, id). Lo que sobra va a **Anticipos** (auxiliar por cliente) y se aplica a las facturas que se emitan después (`aplicarAnticipos` en `cobros.ts`, asiento `Anticipos / CxC` con origen en el pago).
- Asiento: `Caja | subcuenta bancaria | Banco principal / CxC + Anticipos`. `caja` sin `caja_id` usa la caja del turno abierto del cajero o la principal; `deposito`, `transferencia`, `ach` y `remesa` van a la subcuenta de `1.1.02` de la cuenta bancaria de destino; `pasarela`, `agente`, `debito` al banco principal (comisión de pasarela: semana 2) o, con un **proveedor de cobro** configurado (fase 4, `ledger.proveedores_cobro`, desde su fecha de corte), a su `1.1.10.NN Cobros por liquidar` por el bruto y sin comisión; la comisión llega con la liquidación (`cobros.liquidar`, README de `ledger`). Un pago liquidado y luego anulado es un contracargo que la siguiente liquidación descuenta.
- **Cerrar diferencia** (`pagos.cerrar_diferencia`): por cada factura del pago con saldo, una nota de crédito por ese saldo si Σ ≤ `diferencia_cobro_tope` (Q1.00): NCRE con DTE; en un aviso sin DTE, nota interna con la base a `5.3.05` y su IVA desde `2.1.11`; sin documento fiscal (FEL desactivada) todo a `5.3.05`, sin rebajar `2.1.02`. 422 `diferencia_sobre_tope`, 409 `sin_diferencia`. Anular el pago anula la nota interna de su diferencia (H13, `facturas.anular_nota_credito` con el pago como causa). `billing.diferencias_cobro` (solo inserción) liga pago, factura y nota.
- **Castigo de cartera** (`cartera.castigar`, README de `ledger`): la factura castigada queda cubierta (`pagada`) y la cola FEL no la certifica.
- `pago.registrado` y, en la misma transacción, `evaluarEstadoServicio` de cada servicio afectado: la reactivación (`servicio.estado_cambiado`) sale con el pago. La respuesta trae `servicios[]` con cómo quedó cada uno.
- Anular: estado `anulado` con quién/cuándo/motivo, `RevertirAsiento` de cada asiento del pago (cobro y aplicaciones de su anticipo), descuenta lo aplicado (las facturas que ya habían vencido vuelven a `vencida`), `pago.anulado` y re-evaluación. `billing.pagos_aplicaciones` y `billing.saldos_iniciales_aplicaciones` son de solo inserción (trigger de UPDATE/DELETE/TRUNCATE y `REVOKE`): las aplicaciones de un pago anulado quedan como su historia.
- **Pago de terceros** (decisión del PM): `cliente_id` es el pagador y `facturas[]` puede traer facturas pendientes de cualquier cliente (422 `facturas.<i>` si no existe o no tiene saldo). Se aplican en ese orden y lo que sobra, a las del pagador de la más antigua a la más nueva; el excedente, a Anticipos del pagador. Un solo asiento: débito por el total y crédito en el auxiliar CxC de **cada dueño** por lo aplicado a sus facturas. Se re-evalúan los servicios de todos (`servicios[]`); `aplicaciones[]` trae `cliente_id`/`cliente_nombre` del dueño; `pago.registrado`/`pago.anulado` traen `clientes` (pagador + dueños). En el estado de cuenta del dueño el movimiento dice "pagado por <pagador>". Anular revierte todos los auxiliares, aplica de nuevo los anticipos del pagador **y de cada dueño** a sus facturas que vuelven a deber (asiento `Anticipos / CxC`; hallazgo H2 del auditor) y re-evalúa todos los servicios. La referencia sigue siendo única por (método, cuenta, referencia).
- Concurrencia: advisory lock por cliente (`bloquearCliente`/`bloquearClientes`, en orden ascendente: pagador y dueños) en toda acción que aplica dinero.

## Cuentas bancarias y bancos (`cuentas_bancarias.ts`)

- `billing.bancos`: catálogo de bancos de Guatemala (sembrado en su migración). `GET /bancos` (cualquier usuario con sesión).
- `billing.cuentas_bancarias`: cuentas propias (banco, número, alias, moneda `GTQ`/`USD`, activa). **Fuente única** de las cuentas para depósito del panel y del portal. `cuentas_bancarias.crear` (`POST /cuentas-bancarias`) crea además su subcuenta `1.1.02.NN` en el libro; `cuentas_bancarias.editar` (`PUT /cuentas-bancarias/:id`, con `version`) renombra la subcuenta y nunca la desactiva. Ambas con permiso `cuentas_bancarias.editar`; `GET /cuentas-bancarias[?activa]` y `/:id` con `cuentas_bancarias.ver`. Cambios en `audit.cambios` (`cuenta_bancaria`).
- Una cuenta inactiva o en USD no recibe pagos (422).
- Para el portal (A5, `/corte`): `listarCuentasDeposito()` (solo lectura): activas y en GTQ, con `id` (el `cuenta_bancaria_id` del comprobante), `banco_nombre`, `alias`, `numero` completo y `moneda`; sin datos del libro. `listarCuentasBancarias({ activa: true })` sigue disponible con todos los campos.

## Comprobantes de depósito (`comprobantes.ts`, `comprobantes_archivos.ts`)

| Acción                   | Archivo                            | Quién la llama                                                   |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| `comprobantes.registrar` | `actions/registrar_comprobante.ts` | el portal (A5) directo, actor sistema y canal `portal`; el panel |
| `comprobantes.aprobar`   | `actions/aprobar_comprobante.ts`   | `POST /comprobantes/:id/aprobar`                                 |
| `comprobantes.rechazar`  | `actions/rechazar_comprobante.ts`  | `POST /comprobantes/:id/rechazar { motivo }`                     |

- Un comprobante nace **antes** del pago: `pendiente` → `aprobado` (con `pago_id`) o `rechazado` (con `motivo_rechazo`). Registrarlo no mueve dinero ni cambia el servicio.
- Métodos `deposito`, `transferencia`, `ach`, `remesa`, con los mismos datos obligatorios que `POST /pagos` (`DATOS_POR_METODO` y `validarDatosBancarios` en `datos_bancarios.ts`, compartidos con `RegistrarPago`): cuenta bancaria propia y referencia siempre; banco de origen con transferencia y ACH. También monto (> 0, 2 decimales), `fecha_deposito` (no futura) y `servicio_id` opcional (del mismo cliente).
- Archivo: JPG, PNG, WebP o PDF de hasta 5 MB, con el tipo decidido por los primeros bytes (sin dependencias). Se guarda en `COMPROBANTES_DIR` (por defecto `apps/api/storage/comprobantes`, ruta `AAAA/MM/<uuid>.<ext>`), nunca en la base; la auditoría guarda nombre y tamaño, no el contenido. 422 `archivo` con `rule` `tipo`, `tamano` o `required`.
- Referencia única: 409 `referencia_duplicada` si ya es un pago (mismo método y cuenta) o si otro comprobante pendiente la tiene (índice parcial `comprobantes_referencia_pendiente`). Uno rechazado la libera.
- Aprobar llama a `RegistrarPago` anidada (pago, asiento a la subcuenta de la cuenta bancaria, `pago.registrado` y reactivación en la misma transacción) con `facturas[]` opcional; sin `facturas`, aplica primero a las pendientes del servicio del comprobante. La respuesta trae `pago` con `servicios[]`.
- Cola (`GET /comprobantes`): filtros `estado`, `cliente_id`, `metodo`, `cuenta_bancaria_id`, `desde`/`hasta` (fecha de depósito, inclusive) y `resumen { total, monto, pendientes, monto_pendiente }` con los mismos filtros y alcance (`pendientes` ignora `estado`: el contador del menú sale de `?limit=1`). Cada comprobante trae `verificado_por_nombre`.
- Eventos: `comprobante.recibido`, `comprobante.aprobado`, `comprobante.rechazado` (`comprobante_id`, `cliente_id`, `pago_id`, `motivo`). notify ya tiene plantillas de aprobado y rechazado.

## Pasarela en línea (semana 2, `pasarelas/`)

Contrato `Pasarela { crearCobro, verificarWebhook, consultar }` (`pasarelas/pasarela.ts`). Proveedor activo: `PASARELA_PROVEEDOR`; sin ella, `falsa` fuera de producción y ninguno en producción (503 `pasarela_no_configurada`). El adaptador real se agrega al registro de `pasarela.ts` cuando el PM entregue credenciales; nada más cambia.

| Acción                      | Archivo                                | Quién la llama                                                                                              |
| --------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pasarela.crear_cobro`      | `actions/crear_cobro_pasarela.ts`      | `POST /pasarela/cobros` (`pagos.registrar`); el portal (A5) directo                                         |
| `pasarela.procesar_webhook` | `actions/procesar_webhook_pasarela.ts` | `POST /pasarela/webhook/:proveedor` (público, firmado)                                                      |
| `pasarela.conciliar`        | `actions/conciliar_pasarela.ts`        | cron `conciliar` (06:30 Guatemala, día anterior, con lock); `POST /pasarela/conciliar` (`facturas.generar`) |

- Cobro: `monto` por defecto = lo pendiente de las `facturas` pedidas o de todo el cliente (422 `sin_deuda`). Devuelve `url_pago`. No mueve dinero.
- Webhook: el adaptador verifica HMAC-SHA256 y la ventana de ±5 min (401 `firma_invalida`); solo el proveedor configurado. Idempotente por id del evento (`billing.pasarela_eventos`, `ON CONFLICT DO NOTHING`): repetido o simultáneo responde `duplicado: true` sin otro pago; además `referencia` = id del cobro en el proveedor (única por método). Pagado → `RegistrarPago` anidada con `metodo: pasarela`, `comision` y las facturas del cobro: asiento `1.1.02.01 Banco principal (neto) + 5.1.02 Comisiones / CxC`, `pago.registrado` y reactivación en la misma transacción.
- Conciliación: compara cobros y pagos `pasarela` del día con `consultar` y guarda la corrida (`billing.pasarela_conciliaciones`) con diferencias `pago_sin_registrar`, `pago_sin_cobro_en_proveedor`, `monto_distinto`, `pago_anulado`, `pago_sin_cobro`, `error_consulta`. Solo reporta; los que cuadran quedan con `conciliado_en`.
- Pasarela falsa (`pasarelas/falsa.ts`, laboratorio y pruebas): guarda su lado en `billing.pasarela_falsa`, comisión simulada 3.5 %, firma `X-Pasarela-Firma: t=<unix>,v1=<hex>` sobre `"<t>.<cuerpo>"` con `PASARELA_FALSA_SECRETO`. `GET /pasarela/falsa/:cobro` (página con "Pagar (simulado)") y `POST /pasarela/falsa/:cobro/pagar { estado?, monto?, notificar? }` procesan el webhook firmado por el mismo camino que uno real (`notificar: false` simula un webhook perdido). Ambas responden 404 si la falsa no es la configurada.

## Promesas de pago (tarea 10)

| Acción                        | Archivo                               | Quién la llama                                         |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `promesas.crear`              | `actions/crear_promesa_pago.ts`       | `POST /promesas`; el portal (A5) directo, canal portal |
| `promesas.aprobar`            | `actions/aprobar_promesa.ts`          | `POST /promesas/:id/aprobar` (supervisor)              |
| `promesas.cumplir`            | `actions/cumplir_promesa.ts`          | `promesas.revisar_cliente` (evento `pago.registrado`)  |
| `promesas.revisar_cliente`    | `actions/revisar_promesas_cliente.ts` | `ConsumidorBilling` (grupo `billing`, `consumidor.ts`) |
| `promesas.incumplir`          | `actions/incumplir_promesa.ts`        | `promesas.incumplir_vencidas`                          |
| `promesas.incumplir_vencidas` | `actions/incumplir_promesas.ts`       | cron `promesas` (cada minuto, con lock)                |
| `promesas.rechazar`           | `actions/rechazar_promesa.ts`         | `POST /promesas/:id/rechazar { motivo }` (supervisor)  |
| `promesas.cancelar`           | `actions/cancelar_promesa.ts`         | `POST /promesas/:id/cancelar { motivo }` (supervisor)  |

- `crearPromesaPago` evalúa las `reglas_promesa` efectivas (plantilla + excepción `reglas_promesa` del servicio) con `evaluarReglas` (`promesas.ts`, pura) en este orden y se detiene en la primera que falla: `habilitadas`, `canal_permitido`, `sin_deuda`, `plazo_max_dias`, `no_exceder_siguiente_facturacion`, `deuda_maxima` (deuda vencida), `abono_inicial_pct` (lo pagado de las facturas pendientes), `antiguedad_minima_dias`, `cumplimiento_minimo_pct` (últimas `historial_ventana` promesas resueltas), `bloqueo_tras_incumplida_dias`, `max_por_periodo` (promesas creadas en el periodo de facturación actual; con cumplimiento ≥ `buen_historial_pct`, `max_por_periodo_buen_historial`). Los límites no nulos del canal reemplazan al general; `requiere_aprobacion` deja la promesa `pendiente_aprobacion`.
- Siempre guarda la promesa (también la rechazada) con `reglas_snapshot` y `resultado_evaluacion` = `{ resultado, regla, motivo, canal, evaluada_en, reglas[] (regla, ok, valor, limite, origen, detalle), deuda, historial, siguiente_facturacion }`. Al aprobar se agrega `aprobacion`; al cerrar, `cierre`.
- Aprobada → `activa`, `promesa.creada` y `evaluarEstadoServicio` anidada (reactiva en la misma transacción). La respuesta trae `servicio` (opcional). Una suspensión manual se respeta: la promesa queda activa y el servicio sigue suspendido.
- 409 `promesa_abierta` si el servicio ya tiene una promesa activa o pendiente; 422 si `vence_en` no es futura, el monto no es > 0 o supera la deuda pendiente del servicio, o el servicio está retirado o sin plantilla.
- Canal en `POST /promesas`: el del cuerpo, o `portal`/`ia` según `X-Canal`, o `operador`. `supervisor` exige el permiso `promesas.aprobar` (403).
- Cumplida: lo pagado a las facturas del servicio desde la creación de la promesa llega a su monto, o el servicio ya no tiene deuda vencida. Se revisa con cada `pago.registrado` y otra vez al vencer. Al cumplirse: `promesa.cumplida` y re-evaluación (una promesa parcial puede volver a limitar o cortar).
- Vencida sin cumplir → `incumplida`, `promesa.incumplida` y re-evaluación (corta con la hora de corte). Pendiente de aprobación vencida → `cancelada`.
- Supervisor (`admin`, `contabilidad`): rechazar una `pendiente_aprobacion` → `rechazada`; cancelar una `activa` o `pendiente_aprobacion` → `cancelada` (si estaba activa, re-evaluación en la misma transacción: puede volver a cortarse). Motivo y quién en `resultado_evaluacion.cierre`; 409 `promesa_no_pendiente` en otro estado. Sin evento (el catálogo no tiene `promesa.rechazada` ni `promesa.cancelada`).

## Vistas de lectura

`Factura`, `Pago` (pagador) y `Promesa` traen `cliente_nombre`. Filtros: `GET /facturas?tipo=servicio|mora`, `GET /pagos?factura_id=` (pagos aplicados a esa factura). `POST /pagos/:id/anular` responde `servicios[]` como el registro.

### Simulador (semana 2, `simulador_promesas.ts`)

`POST /promesas/simular { servicio_id, canal?, vence_en?, monto?, evaluar_en? }` (`promesas.ver`): la misma evaluación que crear (`datosEvaluacion` + `evaluarReglas` en modo `completo`), sin guardar nada ni auditar. Devuelve todas las reglas con `ok`, `aplica`, `valor`, `limite`, `origen` y `detalle`; `resultado`/`regla` iguales a los de crear con esos datos; `validaciones` (monto, vencimiento futuro, promesa abierta) y `resultado_creacion` (`error` si crear respondería 422/409); `limites` del canal (plazo, fecha máxima, abono, deuda, cupo). Por defecto vence mañana al final del día y el monto es la deuda pendiente. `limitesPromesa(servicioId, canal)` da solo los límites (portal). Contrato: `.claude/integration/contratos/promesas.md`.

## Estado de cuenta (tarea 11)

`estado_cuenta.ts`: `GET /clientes/:id/estado-cuenta` (permiso `clientes.estado_cuenta`, alcance por zona/router del cliente). Es el **auxiliar CxC** del libro:

- `saldo`: suma de los movimientos del cliente en CxC (debe − haber); positivo = debe.
- `saldo_a_favor` (aditivo): anticipos sin aplicar.
- `facturas_pendientes`: `emitida`/`parcial`/`vencida` (servicio y mora), la más antigua primero.
- `movimientos`: un renglón por asiento que toca su CxC (fecha, asiento) con `cargo`, `abono` y saldo acumulado; el último es igual a `saldo`. `referencia_id` = id de la factura, pago o mora de origen.
- Pago de terceros: en el estado de cuenta del dueño, la descripción nombra solo sus facturas y termina en "· pagado por <pagador>".

## Reportes y dashboard (semana 2, `reportes/`)

`GET /api/v1/reportes/<nombre>` con permiso `reportes.ver`, filtros por query y `formato=json|csv|xlsx`. Cada reporte declara sus columnas tipadas (`definicion.ts`): de ahí salen el schema del OpenAPI (`Reporte*`), el CSV y el XLSX. Respuesta `{ reporte, titulo, filtros, columnas, filas, totales, generado_en }`; los totales suman dinero (decimal.js) y enteros.

| Reporte                | Filtros                                                                    | Cuadra con el libro                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `cartera-vencida`      | `corte`, `agrupar` (cliente/zona/router/plan), cliente, zona, router, plan | Σ total = saldo del auxiliar CxC                                                                                                              |
| `ingresos`             | `desde`, `hasta`, `metodo`, `agrupar` (mes/dia), `origen`, cliente, zona   | Σ monto (sistema) = débitos a Caja, Bancos y Comisiones de los asientos de pago; `monto_importado` = débitos a 2.9.01 de los pagos históricos |
| `facturado-vs-cobrado` | `desde`, `hasta`, `tipo`, `origen`, cliente, zona, router, plan            | Σ facturado = cargos CxC de facturas y mora; Σ pendiente = saldo CxC; `cobrado` sin notas de crédito (`acreditado`)                           |
| `cobranza-diaria`      | `desde`, `hasta` (mes en curso), `caja_id`, `metodo`                       | igual que `ingresos`; los anulados aparte                                                                                                     |
| `cierres-caja`         | `desde`, `hasta`, `caja_id`                                                | Σ diferencia = asientos `cierre_caja` (sobrante − faltante)                                                                                   |
| `iva`                  | `desde`, `hasta`                                                           | desde el libro: `iva_neto` (facturado − anulado − acreditado) = `iva_libro` (2.1.02)                                                          |
| `promesas`             | `desde`, `hasta`, `canal`, cliente, zona, router, plan                     | (no mueve dinero) tasa = cumplidas / (cumplidas + incumplidas)                                                                                |
| `altas-bajas`          | `desde`, `hasta`, zona, router, plan                                       | altas por instalación; bajas/suspensiones por `servicio.estado_cambiado`                                                                      |
| `egresos`              | `desde`, `hasta`, `categoria`, `metodo`                                    | Σ monto = cuentas de gasto de los asientos `egreso` vigentes                                                                                  |

**Histórico** (decisión del PM, semana 3): los pagos históricos importados (`pagos.historico`) cuentan en `ingresos` en su mes de origen, y las facturas importadas (`facturas.clave_externa`) con lo que esos pagos cubrieron, en `facturado-vs-cobrado` en el mes de su periodo. `origen=sistema|importado` filtra; las columnas `pagos_importados`/`monto_importado` y `facturado_importado`/`cobrado_importado` separan sin filtrar. Columnas agregadas después de publicar un reporte llevan `agregada: true` en `definicion.ts`: van siempre en la respuesta, pero el OpenAPI las declara opcionales para no romper clientes tipados.

Rango por defecto: los últimos 12 meses (cobranza y cierres: el mes en curso). Alcance ACL por zona/router (o caja en cobranza, cierres y egresos).

Exportación sin dependencias (`exportar.ts`): CSV con BOM UTF-8, comillas y fórmulas neutralizadas; XLSX mínimo (ZIP STORE con CRC-32 de `node:zlib`, una hoja, encabezado en negrita y congelado, dinero `#,##0.00`, fila de totales). Se probó que LibreOffice lo abre.

### Dashboard (`resumenes.ts`)

`GET /dashboard/resumen` (`reportes.ver`): servicios y clientes por estado, facturado y cobrado del mes, cartera vencida, cobros de hoy, promesas activas, series de 12 meses y `actualizado_en` por vista. Lee **solo** vistas materializadas `billing.resumen_*` que se refrescan **por evento**: `ConsumidorResumenes` (grupo `billing` en `node ace billing:worker`) refresca las vistas que cada evento puede cambiar (`factura.*`, `pago.*`, `promesa.*`, `servicio.estado_cambiado`, `servicio.creado`) con `REFRESH MATERIALIZED VIEW CONCURRENTLY` vía `billing.refrescar_resumen(vista)` (SECURITY DEFINER: la app no es dueña de las vistas). Recalcular desde las tablas fuente es idempotente: repetir un evento deja lo mismo. `billing.resumenes_refrescos` guarda el último refresco y el último evento.

## Pruebas (tarea 12)

Japa contra Postgres real; después de cada paso, el SELECT de control del libro (`afirmarLibroCuadrado`: ningún asiento descuadrado y total debe = total haber).

| Archivo                                                                            | Qué cubre                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/billing/ciclo.spec.ts`                                                      | Emitir (dos veces sin duplicar) → vencer → limitar → cortar → pagar una (limitado) → pagar todo (activo); y promesa incumplida → corte, pago parcial y total en un turno de caja, anular pago, anular factura, cerrar caja con diferencia (motivo obligatorio y asiento)                                                                  |
| `tests/billing/pagos.spec.ts`, `pagos_bancarios.spec.ts`, `pagos_terceros.spec.ts` | Pago parcial, excedente a Anticipos, anulación con reverso, concurrencia; métodos bancarios con su subcuenta, 422 por campo y 409 por referencia; pago de terceros (un asiento, dos auxiliares, anulación)                                                                                                                                |
| `tests/billing/promesas.spec.ts`                                                   | Aprobada (reactiva), rechazada con la regla exacta, límites por canal, suspensión manual, cumplida por evento, incumplida por cron, aprobación y cancelación, endpoints                                                                                                                                                                   |
| `tests/billing/anular_factura.spec.ts`, `importacion.spec.ts`                      | Anular factura (y su mora), 409 con pagos; acciones del importador idempotentes                                                                                                                                                                                                                                                           |
| `tests/billing/comprobantes.spec.ts`                                               | Tipo por contenido; registrar desde el portal (archivo en disco, evento, auditoría sin contenido, cola y archivo del panel); aprobar (pago, asiento a la subcuenta, reactivación, 409 al repetir); `facturas[]` y excedente; rechazar (motivo, notificación, referencia libre); referencia duplicada; archivo inválido y datos por método |
| `tests/ledger/cajas.spec.ts`                                                       | Alcance por caja, turnos, cierre exacto, faltante y sobrante                                                                                                                                                                                                                                                                              |

Correr solo las del módulo: `DB_DATABASE=argosisp_test_a3 PORT=343 node ace test --files='billing/*' --files='ledger/*'` (el filtro de Japa compara por segmentos: `tests/billing` sola no selecciona nada).

## Endpoints

| Método   | Ruta                                              | Permiso                    |
| -------- | ------------------------------------------------- | -------------------------- |
| GET      | `/api/v1/plantillas-facturacion`                  | `plantillas.ver`           |
| POST     | `/api/v1/plantillas-facturacion`                  | `plantillas.crear`         |
| GET      | `/api/v1/plantillas-facturacion/:id`              | `plantillas.ver`           |
| PUT      | `/api/v1/plantillas-facturacion/:id`              | `plantillas.editar`        |
| GET      | `/api/v1/facturas`, `/api/v1/facturas/:id`        | `facturas.ver`             |
| POST     | `/api/v1/facturas/generar`, `/vencer`, `/corte`   | `facturas.generar`         |
| POST     | `/api/v1/facturas/:id/anular`                     | `facturas.anular`          |
| GET      | `/api/v1/pagos`, `/api/v1/pagos/:id`              | `pagos.ver`                |
| GET      | `/api/v1/cobros/:id`                              | `pagos.ver`                |
| POST     | `/api/v1/pagos`                                   | `pagos.registrar`          |
| POST     | `/api/v1/pagos/:id/anular`                        | `pagos.anular`             |
| GET      | `/api/v1/promesas`                                | `promesas.ver`             |
| POST     | `/api/v1/promesas`                                | `promesas.crear`           |
| POST     | `/api/v1/promesas/:id/aprobar`                    | `promesas.aprobar`         |
| POST     | `/api/v1/promesas/:id/rechazar`                   | `promesas.rechazar`        |
| POST     | `/api/v1/promesas/:id/cancelar`                   | `promesas.cancelar`        |
| GET      | `/api/v1/bancos`                                  | sesión (sin permiso)       |
| GET      | `/api/v1/cuentas-bancarias`, `/:id`               | `cuentas_bancarias.ver`    |
| POST/PUT | `/api/v1/cuentas-bancarias[/:id]`                 | `cuentas_bancarias.editar` |
| GET      | `/api/v1/comprobantes`, `/:id`, `/:id/archivo`    | `comprobantes.ver`         |
| POST     | `/api/v1/comprobantes/:id/aprobar`                | `comprobantes.aprobar`     |
| POST     | `/api/v1/comprobantes/:id/rechazar`               | `comprobantes.rechazar`    |
| GET      | `/api/v1/clientes/:id/estado-cuenta`              | `clientes.estado_cuenta`   |
| POST     | `/api/v1/pasarela/cobros`                         | `pagos.registrar`          |
| GET      | `/api/v1/pasarela/cobros`, `/:id`                 | `pagos.ver`                |
| POST     | `/api/v1/pasarela/webhook/:proveedor`             | público (firma HMAC)       |
| POST     | `/api/v1/pasarela/conciliar`                      | `facturas.generar`         |
| GET      | `/api/v1/pasarela/conciliaciones`                 | `pagos.ver`                |
| GET/POST | `/api/v1/pasarela/falsa/:cobro[/pagar]`           | público, solo laboratorio  |
| GET      | `/api/v1/reportes/*`, `/api/v1/dashboard/resumen` | `reportes.ver`             |

## Eventos

Emite: `factura.emitida`, `factura.vencida`, `pago.registrado`, `pago.anulado`, `promesa.creada`, `promesa.cumplida`, `promesa.incumplida`, `factura.anulada`, `nota_credito.emitida`, `comprobante.recibido`, `comprobante.aprobado`, `comprobante.rechazado`, `factura.sustituida`. Todos con `empresa_id` (multiempresa); `pago.*` además con `cobro_id`. Con FEL obligatoria y `certificar_al = emitir`, `factura.emitida` sale al certificarse la factura (contrato de localización fiscal §11.3).

Consume (grupo `billing`, `node ace billing:worker`): `pago.registrado` (cumplir promesas; y pedir la certificación FEL de los avisos cubiertos, `ConsumidorFel`); `factura.*`, `pago.*`, `promesa.*`, `servicio.estado_cambiado`, `servicio.creado` (refrescar los resúmenes del dashboard). Lee de A1 en solo lectura `core.servicios`, `core.servicios_excepciones` y `network.planes`.
