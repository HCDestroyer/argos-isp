# Importación desde otros sistemas (A6 ↔ A3)

Dueños: A3 (billing) expone las acciones; A6 (importador y sus adaptadores por sistema: Mikrowisp, SmartISP, CSV…) las llama. Las acciones **no saben de qué sistema viene el dato** (decisión del PM, semana 3): todo lo propio de cada sistema vive en el adaptador de A6. Sin endpoints HTTP: el importador corre como comando y llama las acciones directo, dentro de su propia transacción si quiere (`execute(entrada, ctx, { trx })`).

## Origen e id externo

Toda acción de importación recibe:

| Campo | Qué es |
| --- | --- |
| `origen` | Sistema de origen, texto libre en minúsculas: `mikrowisp`, `smartisp`, `csv`, `wisphub`… Formato `^[a-z0-9_]{1,40}$` (el mismo de `core.ids_externos.sistema`); se normaliza con `trim` y minúsculas; otro formato → 422 `origen`. |
| `id_externo` | Id del registro en ese origen (alias `clave_externa`, nombre anterior). Opaco para A3: se guarda tal cual. |

- **Único por `origen`**: el mismo `id_externo` en dos orígenes son dos registros distintos (índices únicos `(origen, clave_externa)` en `billing.facturas`, `billing.pagos` y `billing.saldos_iniciales`). La idempotencia (abajo) es por el par.
- **Transición**: sin `origen`, A3 lo toma del prefijo del id antes de `:` (`mikrowisp:pago:987` → `mikrowisp`), como se guardó lo ya importado; sin prefijo válido, `externo`. Pasen siempre `origen`.
- **No cambien el formato de sus ids entre corridas**: si ya importaron `mikrowisp:pago:987`, la siguiente corrida debe mandar el mismo id (con `origen: 'mikrowisp'`); `pago:987` sería otro registro.
- Lectura: `Factura.origen`/`id_externo` y `Pago.origen`/`id_externo` (null en lo creado por ArgosIsp). Columnas `origen` + `clave_externa` en las tres tablas.

- `ctx`: `contextoSistema('consola')` o el actor del importador. Todas auditan en `audit.acciones`.
- Dinero siempre como string decimal con 2 decimales (`"150.00"`); nunca `number`.
- Fechas contables `YYYY-MM-DD` en hora de Guatemala.
- **Ninguna emite eventos** (no notifica al cliente, no cumple promesas) y **ninguna reevalúa el estado del servicio**: el siguiente corte (`EjecutarCorte`) decide con todo ya cargado.

## Decisión: el pago histórico mueve el libro

El pago histórico **no es solo historial**: mueve el saldo del cliente. Su asiento, con la fecha del pago, es

```
2.9.01 Saldos de apertura      debe   monto
1.1.03 CxC clientes (auxiliar)  haber  lo aplicado a facturas
2.1.01 Anticipos (auxiliar)     haber  el excedente (si no encontró factura)
```

No toca Caja ni Bancos: ese dinero entró y se depositó en el sistema de origen.

Por eso hay **dos formas válidas** de importar un cliente, y el importador elige una por cliente (no las mezcla):

| Modo | Facturas | Pagos | Saldo inicial |
| --- | --- | --- | --- |
| A. Solo saldo (lo que hace hoy) | Solo las pendientes, por lo que se debe (`total` = pendiente) | No se importan | Diferencia con el origen (`RegistrarSaldoInicial`) |
| B. Con historial | **Todas** las que los pagos cubren, **por su total** (`total` = total original), y las pendientes por su total | Todos, con `RegistrarPagoHistorico` y `facturas: [ids]` de lo que cubrió cada uno | Solo si queda diferencia con el origen |

En el modo B, si un pago histórico se importa sin su factura, el dinero queda como saldo a favor (Anticipos) y el saldo no cuadra con el origen. El orden dentro de un cliente es: facturas → pagos → saldo inicial. Comprobación de cuadre por cliente: `saldoCliente(cliente_id) − saldoAnticipos(cliente_id)` = saldo del origen.

## Acciones

### `ImportarFacturaPendiente` (`#billing/actions/importar_factura_pendiente`) · ampliada (importación completa)

Una sola acción para toda factura del origen (decisión de A3: una acción hermana repetiría la idempotencia, el IVA y el asiento).

```ts
{
    origen: 'mikrowisp',
    id_externo: 'factura-123',         // o clave_externa
    servicio_id?: 45,                  // sin él: cargo único del cliente (exige cliente_id)
    cliente_id?: 12,                   // obligatorio sin servicio; con servicio, si viene, debe ser su dueño (422)
    periodo?: '2026-09-01',            // sin él: cargo único (exige emitida_en)
    cargo_unico?: true,                // por defecto: true si falta servicio_id o periodo
    emitida_en?: '2026-09-03',         // fecha de emisión en el origen (YYYY-MM-DD, no futura)
    total: '150.00',                   // total original, IVA incluido; "0.00" permitido (historial)
    saldada_en_origen?: true,          // pagada en el origen sin ningún pago registrado
    vence_en?: '2026-09-08',
    concepto?: 'INSTALACION',
    aplicar_mora?: false,              // solo con servicio
}
```

Salida: `{ factura_id, creada, estado, cargo_unico }`.

- **De periodo** (`servicio_id` + `periodo`, sin `cargo_unico`): ocupa `clave_unica = servicio_id-periodo`; `generarFacturas` ya no emite ese periodo. Si ya existe → 409 `periodo_facturado` (el detalle sugiere `cargo_unico: true`).
- **Cargo único**: `clave_unica = importada-<origen>:<id_externo>`. No ocupa ningún periodo y el cron nunca la genera. El `periodo` guardado es el dado o el primer día del mes de `emitida_en` (para los reportes).
- `emitida_en`: se guarda en `facturas.emitida_en` (mediodía de Guatemala) y es la **fecha del asiento**, así el estado de cuenta la muestra en su lugar. En un mes cerrado → 422 `periodo_cerrado`. Sin ella: hoy (como antes).
- `vence_en` por defecto: periodo (o `emitida_en` en un cargo sin periodo) + días de gracia de la plantilla (0 sin servicio). Si ya pasó, nace `vencida`.
- Asiento `CxC / 2.9.01` (origen `factura`) por `total`; aplica el anticipo del cliente si tiene. **Sin asiento** si `total` es 0 o `saldada_en_origen`: la factura queda `pagada`.
- En el modo B, `total` es el total original de la factura.

### `RegistrarSaldoInicial` (`#billing/actions/registrar_saldo_inicial`)

Entrada:

```ts
{
    origen: 'smartisp',
    id_externo: 'saldo-123',           // o clave_externa (nombre anterior, se acepta igual)
    cliente_id: 45,
    monto: '80.00',                    // > 0 debe; < 0 saldo a favor ("-20.00")
    fecha?: '2026-10-01',              // por defecto hoy (Guatemala)
    descripcion?: string,
}
```

Salida: `{ saldo_inicial_id, creado, cliente_id, monto, factura_id }`.

- Debe: factura de apertura sin servicio (no cuenta para el corte; `clave_unica = apertura-<origen>:<id_externo>`, mismo `origen`) y asiento `CxC / 2.9.01`.
- A favor: asiento `2.9.01 / Anticipos`; se aplica a las facturas pendientes del cliente.

### `AnularSaldoInicial` (`#billing/actions/anular_saldo_inicial`) · nueva

Deshace un saldo inicial con asientos de reverso (fecha de hoy). Nunca borra ni edita el libro.

```ts
{ origen: 'smartisp', id_externo: 'saldo-123' /* o saldo_inicial_id */, motivo: 'monto equivocado' }
```

Salida: `{ saldo_inicial_id, origen, id_externo, cliente_id, monto, factura_id, reversos: number[] }`.

- Debe: revierte `CxC / 2.9.01` y anula la factura de apertura. Si ya tiene pagos aplicados → 409 `saldo_con_pagos` (anular primero esos pagos con `POST /pagos/:id/anular`).
- A favor: revierte la apertura y cada aplicación a facturas; esas facturas vuelven a quedar pendientes.
- Después, el mismo `id_externo` no se puede volver a registrar (409 `saldo_inicial_anulado`): una importación corregida usa otro id (p. ej. `saldo-123-v2`).

### `RegistrarPagoHistorico` (`#billing/actions/registrar_pago_historico`) · nueva

```ts
{
    historico: true,                   // obligatorio
    origen: 'smartisp',
    id_externo: 'pago-987',            // o clave_externa
    cliente_id: 45,
    metodo: 'deposito',                // uno de METODOS_PAGO (#shared/eventos)
    monto: '150.00',
    fecha: '2026-09-10',               // fecha del pago en el origen; no futura
    referencia?: 'BOL-123',            // se guarda tal cual; puede repetirse entre históricos
    nota?: string,
    facturas?: [101, 102],             // ids de ArgosIsp (de ImportarFacturaPendiente) que cubrió
}
```

Salida: `Pago` (como `GET /pagos/:id`, con `historico: true`, `origen`, `id_externo` y `aplicaciones[]`) más `creado`.

- Aplica a `facturas` en ese orden y luego a la más antigua del cliente; el excedente va a Anticipos.
- No exige caja, cuenta bancaria ni banco de origen. El pago queda con `created_at` = la fecha del origen (mediodía de Guatemala), así sale en su lugar del estado de cuenta.
- Se anula como cualquier pago (`POST /pagos/:id/anular`); esa anulación sí reevalúa el servicio y emite `pago.anulado`.

### `ImportarPromesa` (`#billing/actions/importar_promesa`) · nueva

```ts
{
    origen: 'mikrowisp',
    id_externo: 'promesa-77',          // o clave_externa
    facturas?: [101, 102],             // ids de ArgosIsp; todas del mismo servicio
    factura_id?: 101,                  // equivale a facturas: [101]
    servicio_id?: 45,                  // obligatorio sin facturas; con ellas debe ser el suyo
    vence: '2026-10-25',               // YYYY-MM-DD (= 23:59:59 Guatemala) o instante ISO 8601
    monto?: '300.00',                  // por defecto: lo pendiente de esas facturas (o del servicio)
    creada_en: '2026-10-05',           // YYYY-MM-DD (= mediodía Guatemala) o instante ISO 8601; no futura
    canal?: 'operador',                // por defecto operador
}
```

Salida: `Promesa` (como `GET /promesas`) más `creada`, `origen` e `id_externo`.

- Queda `activa` **sin evaluar las reglas de la plantilla** (el origen ya la aprobó), con `created_at = creada_en` y `resultado_evaluacion` = `{ resultado: 'aprobada', regla: null, motivo: 'Importada de …', reglas: [] … }`. `reglas_snapshot.importacion` guarda origen, id, facturas y `creada_en`.
- Sin eventos y sin reevaluar: el siguiente corte (`EjecutarCorte`) la ve activa y no corta (o reactiva). Desde ahí vive como cualquier promesa: se cumple con el primer `pago.registrado` que la cubra y el cron `incumplirPromesas` la incumple al vencer (esos sí emiten eventos: son hechos nuevos).
- Un pago histórico con fecha **anterior** a `creada_en` no cuenta para cumplirla aunque se importe después; uno posterior sí.
- `vence` ya pasado → **422 `promesa_vencida`**: una promesa vencida no está vigente; si el cliente no pagó, el corte decide con sus facturas vencidas. No se importa como incumplida (no tendría efecto y emitiría eventos al cliente).
- Factura sin servicio (retirados) → 422 `facturas.<i>`: una promesa protege un servicio.
- Sin deuda pendiente (sin `monto`) → 422 `sin_deuda`. El servicio ya tiene otra promesa activa o pendiente → 409 `promesa_abierta`.
- Idempotente por (`origen`, `id_externo`): repetirla devuelve la misma (`creada: false`), aunque ya haya vencido o se haya cumplido; con otro servicio, `vence` o `monto` → 409 `clave_externa_conflicto`.

## Idempotencia

Las acciones de importación (saldo inicial, pago histórico, factura y promesa) son idempotentes por (`origen`, `id_externo`):

- Mismo id y mismos datos → devuelve lo ya registrado (`creado: false` / `creada: false`), sin asiento nuevo. Una segunda corrida del importador no duplica nada.
- Mismo id con otros datos (cliente, monto, fecha) → 409 `clave_externa_conflicto`.
- Para no auditar en la segunda corrida, el importador puede consultar antes (solo lectura) `billing.facturas`, `billing.saldos_iniciales`, `billing.pagos` y `billing.promesas` por `(origen, clave_externa)`.

## Periodos cerrados

Si la `fecha` (pago histórico o saldo inicial) o la `emitida_en` de una factura con asiento cae en un mes cerrado del libro → **422 `periodo_cerrado`** antes de escribir nada, con un detalle que dice qué registro, qué fecha y qué hacer:

> Pago histórico smartisp:pago-987: la fecha 2026-05-15 cae en el periodo 2026-05, que está cerrado en el libro. Use una fecha de un periodo abierto o pida a contabilidad reabrir ese mes (POST /libro/periodos/reabrir) y vuelva a cerrarlo al terminar la importación.

Recomendación: importar antes de cerrar el primer mes en ArgosIsp. Una repetición idempotente de algo ya importado no falla aunque su mes se haya cerrado después.

## Errores

| Status | `type` (`urn:argosisp:problema:…`) | Cuándo |
| --- | --- | --- |
| 422 | `validacion` | Campo inválido (`errors[].field`: `origen`, `id_externo`, `monto`, `total`, `fecha`, `emitida_en`, `periodo`, `vence`, `creada_en`, `metodo`, `historico`, `cliente_id`, `servicio_id`, `cargo_unico`, `aplicar_mora`, `canal`, `factura_id`, `facturas.<i>`, `motivo`) |
| 422 | `periodo_cerrado` | Fecha (o `emitida_en` de una factura con asiento) en un mes cerrado |
| 422 | `sin_plantilla` | Factura de un servicio sin plantilla de facturación |
| 422 | `promesa_vencida` | Promesa cuyo `vence` ya pasó |
| 422 | `sin_deuda` | Promesa sin `monto` sobre facturas o servicio sin saldo pendiente |
| 409 | `clave_externa_conflicto` | (`origen`, `id_externo`) ya usado con otros datos |
| 409 | `periodo_facturado` | Factura de periodo cuyo `servicio_id-periodo` ya existe (use `cargo_unico: true` para la segunda) |
| 409 | `promesa_abierta` | El servicio ya tiene otra promesa activa o pendiente |
| 409 | `saldo_con_pagos` | Anular un saldo deudor que ya tiene pagos |
| 409 | `saldo_inicial_anulado` | Anular dos veces, o volver a registrar un id anulado |
| 404 | `no_encontrado` | Saldo inicial, servicio o cliente inexistente |

## Importación completa: casos especiales

Decisión del PM (17 oct): «Se debe traer todo, para no perder ni dejar volando datos». Cómo se importa cada caso real de los diagnósticos (`docs/importacion/diagnostico-*.sql`):

| Caso del origen | Cómo lo importa A6 | Efecto en ArgosIsp |
| --- | --- | --- |
| Cargos únicos sin periodo (Mikrowisp `tipo 1`: «INSTALACION», «TV adicional», «PAGO DE SEPTIEMBRE»…) | `ImportarFacturaPendiente` con `servicio_id` (si lo tiene) o `cliente_id`, **sin `periodo`**, `emitida_en`, `concepto` y `total`; sus pagos con `RegistrarPagoHistorico` y `facturas: [id]` | Cargo único (`importada-<origen>:<id>`), no ocupa periodo; el cron sigue facturando los periodos normales |
| Dos facturas de servicio del mismo cliente + mes | La primera como factura de periodo; la segunda con `cargo_unico: true` (puede llevar el mismo `periodo`) | Las dos suman al saldo y, si vencen, al corte del servicio |
| Clientes RETIRADO sin servicios con facturas no pagadas | Una `ImportarFacturaPendiente` **por factura**, con `cliente_id`, sin `servicio_id`, `emitida_en`, `concepto`, `total` (no un saldo inicial genérico) | Deuda real en el auxiliar CxC con su fecha y concepto; se cobra como cualquier factura; no corta a nadie |
| Factura con total 0 (SmartISP status 2) | `ImportarFacturaPendiente` con `total: "0.00"` | Factura `pagada` sin cargo, sin asiento (historial) |
| Factura pagada sin ningún pago en el origen | `ImportarFacturaPendiente` con `saldada_en_origen: true` y su `total` | `pagada` (`pagado = total`) **sin asiento ni pago**: no aparece dinero que no entró y el saldo queda igual que en el origen (0 por esa factura). No sale en ingresos ni en la cobranza diaria (no hubo pago); en facturado vs cobrado cuenta como facturada y cobrada (columnas `*_importado`) |
| Pago cuyo número de factura no existe en el origen | `RegistrarPagoHistorico` sin `facturas` | Se aplica a la más antigua del cliente o queda en Anticipos |
| Promesas de pago vigentes | `ImportarPromesa` con sus `facturas` (ya importadas), `vence`, `creada_en` y `monto` | Promesa `activa`; el siguiente corte no corta ese servicio |

Corte: cuentan las facturas importadas **con servicio** (de periodo o cargo único) en estado `vencida`, como cualquier factura de servicio. Las que no tienen servicio no cortan: no hay servicio que cortar.

Orden por cliente: facturas (todas) → pagos históricos → saldo inicial (solo si queda diferencia) → promesas. Cuadre: `saldoCliente − saldoAnticipos` = saldo del origen.

## Multiempresa (A3, 2026-10-17)

Las cinco acciones aceptan `empresa_id` opcional (contrato `multiempresa.md`). Todo lo importado (factura, saldo inicial, pago histórico, promesa, sus asientos) queda en el libro de una sola empresa:

| Acción | Sin `empresa_id` | Con `empresa_id` |
| --- | --- | --- |
| `ImportarFacturaPendiente` | la del servicio; sin servicio, la de los servicios del cliente si es una sola, la activa del contexto, la única activa o la 1 | con servicio debe ser la suya (422 `empresa_id`, rule `empresa_servicio`) |
| `RegistrarSaldoInicial` | la de los servicios del cliente si es una sola, la activa, la única activa o la 1 | esa (422 si no existe o está desactivada) |
| `RegistrarPagoHistorico` | la de las `facturas` pedidas (si son de una sola), si no como el saldo inicial; aplica solo a facturas de esa empresa (422 `facturas`, rule `factura_de_otra_empresa`) | esa |
| `ImportarPromesa` | la del servicio | debe ser la del servicio (422 `empresa_servicio`) |
| `AnularSaldoInicial` | la del saldo (los reversos van a su libro) | — |

- `--empresa=<id|nit>` del importador (A6) se pasa como `empresa_id` a cada acción; el mapa por zona o router lo resuelve A6 y pasa el id. Hecho por A6 (17 oct): explícito en las cuatro acciones; lo que cuelga de un servicio ya importado en otra empresa va con la empresa de ese servicio. El reporte lo verifica en `empresas` (`fuera_de_empresa`, saldo por empresa).
- Periodo cerrado: el 422 `periodo_cerrado` mira el cierre **de esa empresa** (`ledger.periodo_cerrado(fecha, empresa_id)`).
- El saldo a favor (anticipo) de un saldo inicial negativo o de un pago histórico solo se aplica a facturas de su misma empresa.
- Cuadre del importador: `saldoCliente(cliente)` y `saldoAnticipos(trx, cliente)` sin empresa siguen siendo el consolidado del cliente; con un tercer argumento `empresa_id`, el de esa empresa.
