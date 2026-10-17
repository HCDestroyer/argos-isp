# ledger · Libro contable (A3)

Libro de doble partida inmutable, plan de cuentas, cajas, bancos y egresos. Todo lo que mueve dinero termina aquí.

## Libro por empresa (multiempresa)

- Catálogo de cuentas **común**; cada asiento es de **una** empresa (`ledger.asientos.empresa_id`) y sus saldos son de esa empresa. `registrarAsiento` recibe `empresa_id` (sin él, la empresa activa o la única activa) y rechaza movimientos en subcuentas de otra empresa (`ledger.cuentas.empresa_id`: cajas y cuentas bancarias; 422 rule `cuenta_de_otra_empresa`, también por trigger). Debe = Haber por asiento ⇒ por empresa. Un reverso va al libro del original.
- Periodos por empresa: `ledger.periodo_cerrado(fecha, empresa_id)`; `cerrarPeriodo`/`reabrirPeriodo` reciben `empresa_id` (por defecto la activa) y el resumen del cierre es del libro de esa empresa.
- Cajas por empresa: `POST /cajas` (`cajas.crear`) crea la caja y su subcuenta `1.1.01.NN` de la empresa; el cierre de caja va al libro de su empresa y `caja.cerrada` lleva `empresa_id`. Un cajero que cobra para varias empresas abre una caja en cada una.
- Egresos: la empresa de su caja, cuenta bancaria o banco del libro.
- Consultas: diario, mayor, periodos, bancos y cuentas filtran por las empresas de la petición; `GET /libro/balance` y `GET /libro/estado-resultados` (`estados_financieros.ts`) dan una sección por empresa y el total del grupo (`?empresas=todas`).
- `saldoCliente(cliente, trx?, empresaId?)`: con empresa, el auxiliar de esa empresa; sin ella, el consolidado. `saldoClientePorEmpresa(cliente)`.

## Plan de cuentas

`plan_cuentas.ts` define el plan base y lo siembra `database/seeders/plan_cuentas_seeder.ts` (idempotente). El código se refiere a las cuentas por **código** (`CUENTAS.CXC_CLIENTES`), nunca por id.

| Código        | Cuenta                                                  | Tipo    | Notas                                                               |
| ------------- | ------------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| 1.1.01        | Cajas                                                   | activo  | agrupación; una cuenta hija por caja (`1.1.01.01 Caja principal`)   |
| 1.1.02        | Bancos                                                  | activo  | agrupación; una cuenta hija por banco (`1.1.02.01 Banco principal`) |
| 1.1.03        | Cuentas por cobrar clientes                             | activo  | auxiliar por cliente                                                |
| 2.1.01        | Anticipos de clientes                                   | pasivo  | auxiliar por cliente                                                |
| 2.1.02        | IVA débito fiscal                                       | pasivo  |                                                                     |
| 4.1.01        | Ingresos por servicios de internet                      | ingreso |                                                                     |
| 4.1.02        | Recargos por mora                                       | ingreso |                                                                     |
| 4.1.03        | Otros ingresos                                          | ingreso |                                                                     |
| 5.1.01        | Descuentos                                              | gasto   |                                                                     |
| 5.1.02        | Comisiones de pasarelas                                 | gasto   |                                                                     |
| 5.2.01–5.2.99 | Energía, tránsito, nómina, vehículos, alquileres, otros | gasto   | una por categoría de egreso (`egresos_categorias.cuenta_id`)        |

- `imputable = false`: cuenta de agrupación, no recibe movimientos.
- Localización fiscal (fase 2, `app/fiscal/README.md`): el paquete `gt-2026.1` agrega las cuentas GT (impuestos, activo fijo y depreciación, proveedores, **patrimonio** `3.x`, lealtad, no deducibles, ISR). Columnas nuevas: `pais` (el código es único por país; `cuentasPorCodigo` filtra `PAIS_PLAN = 'GT'`), `contracuenta`, `naturaleza` y `reinicia_anual` (generadas), `categoria_flujo`, `categoria_fiscal`, `auxiliar_proveedor`, `libro_inventario`. Los saldos (mayor, balance) usan la naturaleza: las contracuentas restan del total de su tipo y el balance cuadra con activo = pasivo + patrimonio + resultado.
- `ledger.movimientos.impuesto_codigo` + `cuadricula`: etiqueta de impuesto con signo (`+V_IVA`, de `CUADRICULAS_GT`) en la línea de la base y en la de la cuota (contrato §10.2). `registrarAsiento` la acepta por movimiento y la valida (van juntas; CHECK de formato en la base). Las acciones la irán poniendo en las fases de FEL y declaraciones.
- `auxiliar_cliente = true`: todo movimiento lleva `cliente_id`. **El saldo de un cliente es la suma de sus movimientos en CxC**; no existe columna `saldo`.

## Acciones

| Acción                    | Archivo                        | Qué hace                                                                                                                                 |
| ------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `libro.registrar_asiento` | `actions/registrar_asiento.ts` | Única puerta de entrada al libro. Las demás acciones la llaman anidada: `new RegistrarAsiento().execute(entrada, t.ctx, { trx: t.trx })` |
| `libro.revertir_asiento`  | `actions/revertir_asiento.ts`  | Asiento espejo (debe ↔ haber) con `reversa_de`; única forma de corregir                                                                  |

`registrarAsiento` recibe `{ fecha?, descripcion, origen_tipo, origen_id, movimientos: [{ cuenta (código o id), debe | haber, cliente_id? }] }` con montos como string o `Decimal` (nunca `number`) y valida antes de escribir (422 legibles):

- al menos 2 movimientos, exactamente uno de debe/haber > 0, como máximo 2 decimales (el que llama redondea al final de su cálculo);
- Debe = Haber exacto con decimal.js (`asiento_descuadrado`);
- cuenta existente, activa, imputable; `cliente_id` obligatorio en cuentas con auxiliar;
- `origen_id` obligatorio salvo `ajuste`;
- fecha contable (por defecto hoy en Guatemala) fuera de un mes cerrado (`periodo_cerrado`).

La base de datos lo verifica otra vez: constraint trigger diferido de cuadre (día 1), triggers `asientos_validar` y `movimientos_validar` (periodo cerrado, cuenta, auxiliar), `CHECK` de origen, índice único de reverso, triggers de inmutabilidad y `REVOKE UPDATE, DELETE, TRUNCATE` para `argosisp_app`. La acción ejecuta `SET CONSTRAINTS ledger.asientos_cuadre, ledger.movimientos_cuadre IMMEDIATE` tras insertar, así el descuadre falla **dentro** de la acción (también anidada) y no se pierde en un COMMIT silencioso de knex.

Dinero: `dinero.ts` (`dec`, `redondear`, `aTexto`) sobre decimal.js; fechas contables: `fechas.ts`.

### Reverso de asiento (`POST /libro/asientos/:id/revertir`, `libro.revertir_asiento`)

`{ motivo, fecha? }` + `Idempotency-Key` → 201 `Asiento` (el reverso). Crea el asiento espejo con `reversa_de = :id`; el original nunca se edita.

- Motivo obligatorio (422 por campo).
- Fecha: hoy (o la indicada); nunca anterior al original ni en un mes cerrado (`periodo_cerrado`). Un asiento de un mes cerrado se revierte con fecha de hoy.
- Una sola vez (422 `asiento_revertido`); un reverso no se revierte (422 `asiento_es_reverso`).
- Solo asientos sin documento: `cierre_caja` y `ajuste` manual (sin `origen_id`). Los de `factura`, `mora`, `pago`, `nota_credito`, `egreso` y `ajuste` de saldo inicial responden 422 `reverso_por_documento` con la acción a usar (`reversos.ts`): anular pago, anular factura, anular egreso… Esas acciones llaman `RevertirAsiento` anidada con `por_anulacion: true`.
- `GET /libro/diario` y `GET /libro/asientos/:id` traen `revertido_por`, `revertible` y `motivo_no_revertible` para que el panel muestre (o no) el botón.

## Consultas (`consultas.ts`)

- `saldoCliente(cliente_id)`: suma del auxiliar CxC (debe − haber). Positivo = el cliente debe.
- `libroDiario` (filtros `desde`, `hasta`, `origen_tipo`, `origen_id`; cada movimiento con `cliente_nombre`), `libroMayor` (saldo acumulado por línea, consistente entre páginas), `listarCuentas`.

## Diarios y numeración guardada (`diarios.ts`, contrato de localización fiscal §10.7)

- `ledger.diarios` por empresa: `VEN` ventas, `COB` cobros, `COM` compras y egresos, `IMP`, `CIE`, `VAR`, un `CAJ-<caja>` por caja y un `BAN-<cuenta>` por cuenta bancaria propia. Se crean en la migración para lo existente y, después, cuando un asiento los necesita por primera vez.
- Diario de cada asiento (`diarioDeAsiento`): factura, mora y nota de crédito → `VEN`; ajuste → `VAR`; si toca la cuenta de una caja → `CAJ-n`; la subcuenta de una cuenta bancaria → `BAN-n`; si no, pago → `COB`, egreso → `COM`. `RegistrarAsiento` acepta `diario` (código) para fijarlo; el reverso va al diario de su original.
- **Número** (`numerarAsiento`, en la transacción de `RegistrarAsiento`): `ledger.secuencias` (`diario_id`, `anio`, `ultimo`) con `SELECT … FOR UPDATE` y `ultimo + 1`; se guarda en `ledger.asientos_numeros` (único `diario_id, anio, numero`). Sin huecos ni repetidos: dos asientos simultáneos del mismo diario esperan su turno y un rollback deshace también la secuencia. Un trigger solo deja avanzar la secuencia de uno en uno. Un asiento con fecha anterior no cambia el número de nadie.
- **Partida** del Libro Diario: `ledger.asientos_partidas`, correlativo por empresa y año, se asigna en `cerrarPeriodo` a los asientos del mes que no la tienen, en orden `(fecha, numero, id)`, después de la última del año. Las partidas asignadas nunca cambian. El trigger rechaza una partida de un mes abierto.
- **Reabrir** (decisión del líder, 2026-10-17): solo si ningún mes posterior **cerrado** del mismo año tiene partidas (409 `reapertura_fuera_de_orden`: se reabre del más reciente hacia atrás). Al volver a cerrar, los asientos nuevos del mes reciben las partidas siguientes. Libros emitidos o bloqueo duro impiden reabrir (fase fiscal). **Confirmar con contador**: si las partidas de asientos agregados tras una reapertura pueden ir al final de la secuencia (con el mes posterior también reabierto, quedan después de las de ese mes).
- `GET /libro/diario` y `GET /libro/asientos/:id` traen `diario`, `numero` y `partida` (null con el mes abierto).
- Inmutables: `asientos_numeros` y `asientos_partidas` (trigger y `REVOKE`); `secuencias` solo admite `UPDATE (ultimo)`; `diarios` es configuración (`version`).

## Cajas y turnos (tarea 9, `cajas.ts`)

| Acción         | Archivo                  | Qué hace                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cajas.abrir`  | `actions/abrir_caja.ts`  | Abre un turno con `fondo_inicial` y `abierto_por`. Uno abierto por caja (409 `turno_abierto`). Sin asiento: el fondo ya está en la cuenta de la caja                                                                                                                                                |
| `cajas.cerrar` | `actions/cerrar_caja.ts` | `esperado = fondo_inicial + Σ pagos vigentes del turno`, `diferencia = contado − esperado`. Diferencia ≠ 0 exige `motivo` (422) y deja asiento `cierre_caja`: faltante `5.2.06 Faltantes de caja / Caja`, sobrante `Caja / 4.1.04 Sobrantes de caja`. Emite `caja.cerrada`. 409 `sin_turno_abierto` |

- Cada pago en efectivo guarda el turno abierto de su caja (`billing.pagos.turno_id`, con `FOR SHARE` frente al cierre). `POST /pagos` con `caja` sin `caja_id` usa la caja del turno abierto del cajero (`cajaDelCajero`: el que él abrió o una caja asignada a él, dentro de su alcance) y, si no tiene, la principal.
- Alcance ACL por caja (`exigirAlcance` / `filtrarPorAlcance` de `#core/acl`): un cajero con el rol acotado a su caja solo la lista, la abre, la cierra, ve sus turnos y cobra en ella (403 en otra).
- Nombres para el panel: `CajaTurno.abierto_por_nombre`/`cerrado_por_nombre`; `Caja.cajero_nombre`, `turno_abierto_por` y `turno_abierto_por_nombre`.
- Un pago anulado después de cerrar su turno no cambia ese cierre (el reverso sale de la caja en el libro).
- Un turno cerrado es inmutable (hallazgo H3): el trigger `cajas_turnos_inmutable` rechaza DELETE, cualquier UPDATE de un turno con `cerrado_en` y, en el abierto, todo UPDATE que no sea su cierre o que cambie los datos de apertura; TRUNCATE también se rechaza. `argosisp_app` no tiene DELETE ni TRUNCATE y su UPDATE se limita a las columnas del cierre.

## Cierre mensual (`cierres.ts`)

| Acción                  | Archivo                      | Permiso                 | Qué hace                                                                                                                                                                                  |
| ----------------------- | ---------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libro.cerrar_periodo`  | `actions/cerrar_periodo.ts`  | `libro.cerrar_periodo`  | `cerrarPeriodo(anio, mes)`: solo meses terminados (422 `periodo_en_curso`), 409 `periodo_cerrado` si ya lo está. Guarda el resumen del mes (asientos, debe, haber, movimiento por cuenta) |
| `libro.reabrir_periodo` | `actions/reabrir_periodo.ts` | `libro.reabrir_periodo` | Con motivo obligatorio; agrega `ledger.reaperturas_mensuales` (no borra el cierre). 409 `periodo_abierto`. Se puede volver a cerrar (cierre nuevo)                                        |

- Un mes está cerrado si tiene un cierre sin reapertura: `ledger.periodo_cerrado(fecha)`, la misma función en la acción (`registrarAsiento`) y en los triggers de asientos y movimientos. Después del cierre ningún asiento puede tener fecha en el mes, **ni siquiera un reverso**: `RevertirAsiento` usa la fecha de hoy (periodo abierto) y con una fecha del mes cerrado responde 422.
- `cierres_mensuales` y `reaperturas_mensuales` son inmutables (trigger de UPDATE/DELETE/TRUNCATE y `REVOKE`); un trigger impide cerrar un mes ya cerrado.
- `cerrar_periodo` está en `contabilidad`; `reabrir_periodo` solo en `admin`.

## Egresos (`egresos.ts`)

| Acción              | Archivo                       | Qué hace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `egresos.registrar` | `actions/registrar_egreso.ts` | Gasto con categoría (`energia`, `transito`, `nomina`, `vehiculos`, `alquileres`, `otros` → su cuenta `5.2.xx`), monto, fecha (hoy por defecto, no futura), proveedor, descripción y `comprobante` opcional (número del documento). Método: `caja` (`caja_id`; sin ella, la del turno abierto del usuario o la principal), `banco` (`banco_id` del libro; por defecto el principal) o `cuenta_bancaria` (propia, activa y GTQ). Asiento `Gasto / Caja \| Banco \| subcuenta` con origen `egreso` |
| `egresos.anular`    | `actions/anular_egreso.ts`    | Motivo obligatorio; `RevertirAsiento` con fecha de hoy y fila en `ledger.egresos_anulaciones`. 409 `egreso_anulado`                                                                                                                                                                                                                                                                                                                                                                             |

- Inmutable como el libro: `ledger.egresos` y `ledger.egresos_anulaciones` rechazan UPDATE/DELETE (trigger y `REVOKE`). El estado (`registrado`/`anulado`) y el asiento se derivan (por origen), no se escriben en la fila.
- Efectivo: el egreso queda en el turno abierto de la caja (`turno_id`) y `cerrarCaja` lo resta del esperado (`fondo + cobros − egresos vigentes del turno`).
- Alcance por caja: un usuario con rol acotado a una caja solo ve y registra egresos de esa caja.

## Endpoints

| Método | Ruta                                                                  | Permiso        |
| ------ | --------------------------------------------------------------------- | -------------- |
| GET    | `/api/v1/libro/cuentas`                                               | `libro.ver`    |
| GET    | `/api/v1/libro/diario?desde&hasta&origen_tipo&origen_id&cursor&limit` | `libro.ver`    |
| GET    | `/api/v1/libro/mayor?cuenta_id&cliente_id&desde&hasta&cursor&limit`   | `libro.ver`    |
| GET    | `/api/v1/libro/bancos` (origen `banco_id` de los egresos)             | `egresos.ver`  |
| GET    | `/api/v1/cajas`                                                       | `cajas.ver`    |
| POST   | `/api/v1/cajas`                                                       | `cajas.crear`  |
| GET    | `/api/v1/libro/balance?hasta`, `/api/v1/libro/estado-resultados`      | `libro.ver`    |
| POST   | `/api/v1/cajas/:id/abrir`                                             | `cajas.abrir`  |
| POST   | `/api/v1/cajas/:id/cerrar`                                            | `cajas.cerrar` |
| GET    | `/api/v1/cajas/:id/turnos?cursor&limit`                               | `cajas.ver`    |

## Eventos

Emite: `caja.cerrada` (`caja_id`, `empresa_id`, `cajero_id` = cajero asignado o quien abrió, `esperado`, `contado`, `diferencia`). Consume: ninguno.
