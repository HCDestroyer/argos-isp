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

## Endpoints

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/api/v1/libro/cuentas` | `libro.ver` |

## Eventos

Emite: `caja.cerrada` (tarea 9). Consume: ninguno todavía.
