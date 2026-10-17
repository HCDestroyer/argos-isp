# Importación desde Mikrowisp (A6 ↔ A3)

Dueños: A3 (billing) expone las acciones; A6 (importador) las llama. Sin endpoints HTTP: el importador corre como comando (`node ace importar:mikrowisp`) y llama las acciones directo, dentro de su propia transacción si quiere (`execute(entrada, ctx, { trx })`).

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

`{ clave_externa, servicio_id, periodo: 'YYYY-MM-01', total, vence_en?, concepto?, aplicar_mora? }` → `{ factura_id, creada, estado }`. En el modo B, `total` es el total original de la factura. Asiento `CxC / 2.9.01` con fecha de hoy. Sin cambios en esta tanda.

### `RegistrarSaldoInicial` (`#billing/actions/registrar_saldo_inicial`)

Entrada:

```ts
{
    id_externo: 'mikrowisp:saldo:123', // o clave_externa (nombre anterior, se acepta igual)
    cliente_id: 45,
    monto: '80.00',                    // > 0 debe; < 0 saldo a favor ("-20.00")
    fecha?: '2026-10-01',              // por defecto hoy (Guatemala)
    descripcion?: string,
}
```

Salida: `{ saldo_inicial_id, creado, cliente_id, monto, factura_id }`.

- Debe: factura de apertura sin servicio (no cuenta para el corte) y asiento `CxC / 2.9.01`.
- A favor: asiento `2.9.01 / Anticipos`; se aplica a las facturas pendientes del cliente.

### `AnularSaldoInicial` (`#billing/actions/anular_saldo_inicial`) · nueva

Deshace un saldo inicial con asientos de reverso (fecha de hoy). Nunca borra ni edita el libro.

```ts
{ id_externo: 'mikrowisp:saldo:123' /* o saldo_inicial_id */, motivo: 'monto equivocado' }
```

Salida: `{ saldo_inicial_id, id_externo, cliente_id, monto, factura_id, reversos: number[] }`.

- Debe: revierte `CxC / 2.9.01` y anula la factura de apertura. Si ya tiene pagos aplicados → 409 `saldo_con_pagos` (anular primero esos pagos con `POST /pagos/:id/anular`).
- A favor: revierte la apertura y cada aplicación a facturas; esas facturas vuelven a quedar pendientes.
- Después, el mismo `id_externo` no se puede volver a registrar (409 `saldo_inicial_anulado`): una importación corregida usa otro id (p. ej. `mikrowisp:saldo:123:v2`).

### `RegistrarPagoHistorico` (`#billing/actions/registrar_pago_historico`) · nueva

```ts
{
    historico: true,                   // obligatorio
    id_externo: 'mikrowisp:pago:987',  // o clave_externa
    cliente_id: 45,
    metodo: 'deposito',                // uno de METODOS_PAGO (#shared/eventos)
    monto: '150.00',
    fecha: '2026-09-10',               // fecha del pago en el origen; no futura
    referencia?: 'BOL-123',            // se guarda tal cual; puede repetirse entre históricos
    nota?: string,
    facturas?: [101, 102],             // ids de ArgosIsp (de ImportarFacturaPendiente) que cubrió
}
```

Salida: `Pago` (como `GET /pagos/:id`, con `historico: true` y `aplicaciones[]`) más `creado`.

- Aplica a `facturas` en ese orden y luego a la más antigua del cliente; el excedente va a Anticipos.
- No exige caja, cuenta bancaria ni banco de origen. El pago queda con `created_at` = la fecha del origen (mediodía de Guatemala), así sale en su lugar del estado de cuenta.
- Se anula como cualquier pago (`POST /pagos/:id/anular`); esa anulación sí reevalúa el servicio y emite `pago.anulado`.

## Idempotencia

Las tres acciones (saldo inicial, pago histórico y factura) son idempotentes por su id del origen:

- Mismo id y mismos datos → devuelve lo ya registrado (`creado: false` / `creada: false`), sin asiento nuevo. Una segunda corrida del importador no duplica nada.
- Mismo id con otros datos (cliente, monto, fecha) → 409 `clave_externa_conflicto`.
- Para no auditar en la segunda corrida, el importador puede consultar antes (solo lectura) `billing.facturas.clave_externa`, `billing.saldos_iniciales.clave_externa` y `billing.pagos.clave_externa`.

## Periodos cerrados

Si la `fecha` (pago histórico o saldo inicial) cae en un mes cerrado del libro → **422 `periodo_cerrado`** antes de escribir nada, con un detalle que dice qué registro, qué fecha y qué hacer:

> Pago histórico mikrowisp:pago:987: la fecha 2026-05-15 cae en el periodo 2026-05, que está cerrado en el libro. Use una fecha de un periodo abierto o pida a contabilidad reabrir ese mes (POST /libro/periodos/reabrir) y vuelva a cerrarlo al terminar la importación.

Recomendación: importar antes de cerrar el primer mes en ArgosIsp. Una repetición idempotente de algo ya importado no falla aunque su mes se haya cerrado después.

## Errores

| Status | `type` (`urn:argosisp:problema:…`) | Cuándo |
| --- | --- | --- |
| 422 | `validacion` | Campo inválido (`errors[].field`: `id_externo`, `monto`, `fecha`, `metodo`, `historico`, `cliente_id`, `facturas.<i>`, `motivo`) |
| 422 | `periodo_cerrado` | Fecha en un mes cerrado |
| 409 | `clave_externa_conflicto` | Id del origen ya usado con otros datos |
| 409 | `saldo_con_pagos` | Anular un saldo deudor que ya tiene pagos |
| 409 | `saldo_inicial_anulado` | Anular dos veces, o volver a registrar un id anulado |
| 404 | `no_encontrado` | Saldo inicial inexistente al anular |
