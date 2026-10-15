# ledger · Libro contable (A3)

Libro de doble partida inmutable, plan de cuentas, cajas, bancos y egresos. Todo lo que mueve dinero termina aquí.

## Plan de cuentas

`plan_cuentas.ts` define el plan base y lo siembra `database/seeders/plan_cuentas_seeder.ts` (idempotente). El código se refiere a las cuentas por **código** (`CUENTAS.CXC_CLIENTES`), nunca por id.

| Código | Cuenta | Tipo | Notas |
| --- | --- | --- | --- |
| 1.1.01 | Cajas | activo | agrupación; una cuenta hija por caja (`1.1.01.01 Caja principal`) |
| 1.1.02 | Bancos | activo | agrupación; una cuenta hija por banco (`1.1.02.01 Banco principal`) |
| 1.1.03 | Cuentas por cobrar clientes | activo | auxiliar por cliente |
| 2.1.01 | Anticipos de clientes | pasivo | auxiliar por cliente |
| 2.1.02 | IVA débito fiscal | pasivo | |
| 4.1.01 | Ingresos por servicios de internet | ingreso | |
| 4.1.02 | Recargos por mora | ingreso | |
| 4.1.03 | Otros ingresos | ingreso | |
| 5.1.01 | Descuentos | gasto | |
| 5.1.02 | Comisiones de pasarelas | gasto | |
| 5.2.01–5.2.99 | Energía, tránsito, nómina, vehículos, alquileres, otros | gasto | una por categoría de egreso (`egresos_categorias.cuenta_id`) |

- `imputable = false`: cuenta de agrupación, no recibe movimientos.
- `auxiliar_cliente = true`: todo movimiento lleva `cliente_id`. **El saldo de un cliente es la suma de sus movimientos en CxC**; no existe columna `saldo`.

## Acciones

| Acción | Archivo | Qué hace |
| --- | --- | --- |
| `libro.registrar_asiento` | `actions/registrar_asiento.ts` | Única puerta de entrada al libro. Las demás acciones la llaman anidada: `new RegistrarAsiento().execute(entrada, t.ctx, { trx: t.trx })` |
| `libro.revertir_asiento` | `actions/revertir_asiento.ts` | Asiento espejo (debe ↔ haber) con `reversa_de`; única forma de corregir |

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
- `libroDiario`, `libroMayor` (saldo acumulado por línea, consistente entre páginas), `listarCuentas`.

## Endpoints

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/api/v1/libro/cuentas` | `libro.ver` |
| GET | `/api/v1/libro/diario?desde&hasta&origen_tipo&cursor&limit` | `libro.ver` |
| GET | `/api/v1/libro/mayor?cuenta_id&cliente_id&desde&hasta&cursor&limit` | `libro.ver` |

## Eventos

Emite: `caja.cerrada` (tarea 9). Consume: ninguno todavía.
