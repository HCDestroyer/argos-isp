# inventario (A3)

Inventario interno del ISP: productos, bodegas (lugares y técnicos), kardex a costo promedio y su
asiento en el libro. Contrato: `.claude/integration/contratos/inventario.md`. Esta es la **fase A**
(§11): modelo, cuentas, productos, bodegas, saldo inicial, compras que entran al inventario,
consumo, traslado, ajuste, baja, existencias y kardex. Unidades por serie y comodato (B), venta,
conteos y reporte valorizado (C) llegan después; el modelo ya tiene sus tipos de movimiento y la
columna `unidad_id`.

## Piezas

| Archivo | Qué hace |
| --- | --- |
| `productos.ts`, `bodegas.ts` | Lectura, alcance ACL de bodegas y tope por técnico |
| `kardex.ts` | Única puerta de `inventario.movimientos`: costo, lock por producto, asiento propio, eventos; existencias, kardex y las lecturas del auditor (`valorKardex`, `existenciasDelKardex`) |
| `compras.ts` | Ganchos de `compras.registrar` (entrada) y `compras.anular` (reverso) |
| `actions/` | `productos.crear/editar/desactivar`, `bodegas.crear/editar/desactivar`, `inventario.cargar_saldo_inicial`, `inventario.consumir`, `inventario.trasladar`, `inventario.ajustar`, `inventario.dar_de_baja` |
| `start/routes/inventario.ts` | `/productos`, `/bodegas`, `/inventario/existencias`, `/inventario/movimientos`, `/inventario/{consumos,traslados,ajustes,bajas,saldos-iniciales}` |

## Reglas

- `inventario.movimientos` es solo inserción (trigger y `REVOKE`). `inventario.saldos` es la
  proyección por producto × bodega que mantiene un trigger; `cantidad >= 0`, `valor >= 0` y sin valor
  sin existencia.
- Costo promedio ponderado móvil **por producto y bodega**; la salida que vacía la bodega lleva todo
  su valor. Un reverso usa el costo del movimiento que corrige.
- Asientos (origen `inventario`, `origen_id` = movimiento): consumo `cuenta_consumo` (5.2.07) /
  1.1.14; faltante y baja 5.6.02 / 1.1.14; sobrante 1.1.14 / 4.2.04; saldo inicial 1.1.14 / 2.9.01.
  Las entradas de una compra van en el asiento de la compra (la línea `bien` con `producto_id` a
  1.1.14; un asiento de compra con varias líneas mueve 1.1.14 por la suma de sus movimientos). El
  traslado no tiene asiento.
- Consumo, traslado, ajuste y baja llevan fecha de hoy (nunca hay existencia negativa a ninguna
  fecha); saldo inicial y compras pueden ir a una fecha pasada. Los bloqueos del libro aplican por el
  asiento.
- Con el inventario sin usar, compras, facturas y cargos únicos se comportan igual que antes.

## Eventos

- Emite: `inventario.movimiento_registrado` (cada movimiento), `inventario.existencia_minima` (la
  existencia total cruza el mínimo hacia abajo).
- Consume: ninguno en la fase A (`servicio.estado_cambiado` llega con la fase B).
