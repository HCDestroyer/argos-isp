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

### `ImportarFacturaPendiente` (`#billing/actions/importar_factura_pendiente`) · ya existía

`{ origen, id_externo (o clave_externa), servicio_id, periodo: 'YYYY-MM-01', total, vence_en?, concepto?, aplicar_mora? }` → `{ factura_id, creada, estado }`. En el modo B, `total` es el total original de la factura. Asiento `CxC / 2.9.01` con fecha de hoy.

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

## Idempotencia

Las tres acciones (saldo inicial, pago histórico y factura) son idempotentes por (`origen`, `id_externo`):

- Mismo id y mismos datos → devuelve lo ya registrado (`creado: false` / `creada: false`), sin asiento nuevo. Una segunda corrida del importador no duplica nada.
- Mismo id con otros datos (cliente, monto, fecha) → 409 `clave_externa_conflicto`.
- Para no auditar en la segunda corrida, el importador puede consultar antes (solo lectura) `billing.facturas`, `billing.saldos_iniciales` y `billing.pagos` por `(origen, clave_externa)`.

## Periodos cerrados

Si la `fecha` (pago histórico o saldo inicial) cae en un mes cerrado del libro → **422 `periodo_cerrado`** antes de escribir nada, con un detalle que dice qué registro, qué fecha y qué hacer:

> Pago histórico smartisp:pago-987: la fecha 2026-05-15 cae en el periodo 2026-05, que está cerrado en el libro. Use una fecha de un periodo abierto o pida a contabilidad reabrir ese mes (POST /libro/periodos/reabrir) y vuelva a cerrarlo al terminar la importación.

Recomendación: importar antes de cerrar el primer mes en ArgosIsp. Una repetición idempotente de algo ya importado no falla aunque su mes se haya cerrado después.

## Errores

| Status | `type` (`urn:argosisp:problema:…`) | Cuándo |
| --- | --- | --- |
| 422 | `validacion` | Campo inválido (`errors[].field`: `origen`, `id_externo`, `monto`, `fecha`, `metodo`, `historico`, `cliente_id`, `facturas.<i>`, `motivo`) |
| 422 | `periodo_cerrado` | Fecha en un mes cerrado |
| 409 | `clave_externa_conflicto` | (`origen`, `id_externo`) ya usado con otros datos |
| 409 | `saldo_con_pagos` | Anular un saldo deudor que ya tiene pagos |
| 409 | `saldo_inicial_anulado` | Anular dos veces, o volver a registrar un id anulado |
| 404 | `no_encontrado` | Saldo inicial inexistente al anular |
