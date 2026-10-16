# ledger · Libro contable (A3)

Libro de doble partida inmutable, plan de cuentas, cajas, bancos y egresos. Todo lo que mueve dinero termina aquí.

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

## Consultas (`consultas.ts`)

- `saldoCliente(cliente_id)`: suma del auxiliar CxC (debe − haber). Positivo = el cliente debe.
- `libroDiario` (filtros `desde`, `hasta`, `origen_tipo`, `origen_id`; cada movimiento con `cliente_nombre`), `libroMayor` (saldo acumulado por línea, consistente entre páginas), `listarCuentas`.

## Cajas y turnos (tarea 9, `cajas.ts`)

| Acción         | Archivo                  | Qué hace                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cajas.abrir`  | `actions/abrir_caja.ts`  | Abre un turno con `fondo_inicial` y `abierto_por`. Uno abierto por caja (409 `turno_abierto`). Sin asiento: el fondo ya está en la cuenta de la caja                                                                                                                                                |
| `cajas.cerrar` | `actions/cerrar_caja.ts` | `esperado = fondo_inicial + Σ pagos vigentes del turno`, `diferencia = contado − esperado`. Diferencia ≠ 0 exige `motivo` (422) y deja asiento `cierre_caja`: faltante `5.2.06 Faltantes de caja / Caja`, sobrante `Caja / 4.1.04 Sobrantes de caja`. Emite `caja.cerrada`. 409 `sin_turno_abierto` |

- Cada pago en efectivo guarda el turno abierto de su caja (`billing.pagos.turno_id`, con `FOR SHARE` frente al cierre). `POST /pagos` con `caja` sin `caja_id` usa la caja del turno abierto del cajero (`cajaDelCajero`: el que él abrió o una caja asignada a él, dentro de su alcance) y, si no tiene, la principal.
- Alcance ACL por caja (`exigirAlcance` / `filtrarPorAlcance` de `#core/acl`): un cajero con el rol acotado a su caja solo la lista, la abre, la cierra, ve sus turnos y cobra en ella (403 en otra).
- Nombres para el panel: `CajaTurno.abierto_por_nombre`/`cerrado_por_nombre`; `Caja.cajero_nombre`, `turno_abierto_por` y `turno_abierto_por_nombre`.
- Un pago anulado después de cerrar su turno no cambia ese cierre (el reverso sale de la caja en el libro).

## Endpoints

| Método | Ruta                                                                  | Permiso        |
| ------ | --------------------------------------------------------------------- | -------------- |
| GET    | `/api/v1/libro/cuentas`                                               | `libro.ver`    |
| GET    | `/api/v1/libro/diario?desde&hasta&origen_tipo&origen_id&cursor&limit` | `libro.ver`    |
| GET    | `/api/v1/libro/mayor?cuenta_id&cliente_id&desde&hasta&cursor&limit`   | `libro.ver`    |
| GET    | `/api/v1/cajas`                                                       | `cajas.ver`    |
| POST   | `/api/v1/cajas/:id/abrir`                                             | `cajas.abrir`  |
| POST   | `/api/v1/cajas/:id/cerrar`                                            | `cajas.cerrar` |
| GET    | `/api/v1/cajas/:id/turnos?cursor&limit`                               | `cajas.ver`    |

## Eventos

Emite: `caja.cerrada` (`caja_id`, `cajero_id` = cajero asignado o quien abrió, `esperado`, `contado`, `diferencia`). Consume: ninguno.
