# Mapeo SmartISP → ArgosIsp

De qué tablas y columnas de la base de SmartISP sale cada entidad del formato canónico del importador (`apps/api/app/importacion/canonico.ts`) y cómo se transforma. El adaptador es `apps/api/app/importacion/origenes/smartisp.ts`; el esquema real de referencia, `scripts/importacion/esquemas/smartisp.sql` (112 tablas, exportado con phpMyAdmin, MySQL 5.7, Laravel).

Marcas:

- **No existe**: el dato no está en SmartISP; se dice cómo se resuelve.
- **Duda (PM)**: solo se resuelve mirando datos reales. Están juntas al final, numeradas.

SmartISP tiene tablas paralelas de versiones distintas (`bill_customers` e `invoices`; `payment_news` y `payments`). El adaptador lee las que tienen el modelo completo (`bill_customers`, con periodo, vencimiento y servicio; `payment_news`, con forma de pago y borrado lógico) y **avisa** si las otras traen filas, para que nada se pierda en silencio (duda 1).

## Tablas que usa el adaptador

| Tabla | Para qué | Obligatoria |
| --- | --- | --- |
| `routers` | routers | sí |
| `radius` | secreto RADIUS por router | no |
| `control_routers` | tipo de control del router (PPPoE, DHCP, amarre...) | no |
| `address_routers` | redes IPv4 por router | no |
| `plans` | planes | sí |
| `clients` | clientes, saldo y saldo a favor | sí |
| `zone` | nombre de la zona | no |
| `client_services` | servicios | sí |
| `bill_customers` | facturas | no |
| `bill_customer_item` | concepto de la factura | no |
| `payment_news` | pagos | no |
| `invoices`, `payments` | solo para avisar si traen filas | no |

"Obligatoria" = sin ella el comando se detiene antes de tocar la base con la lista de lo que falta. phpMyAdmin escribe las llaves primarias aparte (`ALTER TABLE ... ADD PRIMARY KEY`); el lector las ignora.

## Routers ← `routers` (+ `radius`)

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `routers.id` | |
| `nombre` | `routers.name` | |
| `host` | `routers.ip` | |
| `nas_ip` | `routers.ip` | **No existe** una IP RADIUS aparte: se usa la del router (debe ser IPv4) |
| `api_usuario` | `routers.login` | |
| `api_password` | `routers.password` | `CrearRouter` la cifra; nunca sale en el reporte (duda 10) |
| `radius_secret` | `radius.secret` con `radius.router_id = routers.id` | sin fila → sin secreto (`router_sin_credenciales`, no bloquea) |

No se importan `port` (API binaria de MikroTik; ArgosIsp usa la REST), `model`, `location`, `coordinates`, `status`, `connection`, `lan`.

## Redes IPv4 ← `address_routers`

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `router_id` | `address_routers.router_id` | |
| `cidr` | `address_routers.network` + `/` + `address_routers.mask` | si `network` ya trae `/nn` se usa tal cual; `mask` puede venir como `24` o `/24` |
| `gateway` | `address_routers.gateway` | |
| `tipo` | `address_routers.type` | contiene `pool` → `pool`; lo demás → `estatico` (duda 7) |

`networks` es la lista de IPs individuales (`is_used`, `client_id`): no hace falta, la IP va en el servicio.

## Planes ← `plans`

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `plans.id` | |
| `nombre` | `plans.name` | |
| `precio` | `plans.cost` | si `plans.iva` > 0, aviso: revisar si el precio lleva IVA (duda 5) |
| `bajada`, `subida` | `plans.download`, `plans.upload` | `int(6)` sin unidad → kbps (duda 6) |
| `perfil_ppp`, `pool_ipv4` | — | **No existen** en SmartISP; se configuran en la implementación del plan en ArgosIsp |

No se importan `burst_*`, `priority`, `limitat`, `aggregation`, `no_rules`, `address_list_name`, `title`, `smart_bandwidth` (velocidades por horario).

## Clientes ← `clients` (+ `zone`)

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `clients.id` | |
| `nombre` | `clients.name` | |
| `tipo` | — | **No existe**: `persona` (`typedoc_cod`/`typetaxpayer_cod` son códigos fiscales de Colombia y Ecuador) |
| `nit` | `clients.dni` | NIT, CUI o `CF`; se valida en el importador |
| `email` | `clients.email` | inválido → aviso |
| `telefono` | `clients.phone` | |
| `movil` | — | **No existe** aparte (`phone` es `varchar(255)`: puede traer varios) |
| `direccion` | `clients.address` | |
| `coordenadas` | `clients.coordinates` | `lat,lng`; otra cosa → aviso |
| `zona` | `zone.name` de `clients.zona_id` | |

No se importan `password` (clave del portal: el cliente entra a ArgosIsp con su propio acceso), `photo`, `odb_*`, `onu_*`, `port`, `onusn`, `map_marker_icon`, `billing_settings` (día de facturación, recordatorios: los da la plantilla de ArgosIsp).

## Servicios ← `client_services` (+ `control_routers`)

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `client_services.id` | |
| `cliente_id` | `client_services.client_id` | |
| `router_id` | `client_services.router_id` | |
| `plan_id` | `client_services.plan_id` | `0` = sin plan |
| `tipo_conexion` | `control_routers.type_control` del router y `user_hot` | ver abajo |
| `user_ppp` | `client_services.user_hot` | |
| `pass_ppp` | `client_services.pass_hot` | `CrearServicio` la cifra; nunca sale en logs ni en el reporte |
| `ip` | `client_services.ip` | `varchar(15)`, una sola IPv4 |
| `mac` | `client_services.mac` | `00:00:00:00:00:00` (el defecto) = sin MAC |
| `amarre_ip_mac` | `control_routers.arpmac` | `1` → sí (solo sin PPPoE) |
| `direccion`, `coordenadas` | — | **No existen** por servicio: son del cliente |
| `fecha_instalacion` | `client_services.date_in` | |
| `estado` | `client_services.status` | `ac` → activo; `de` → suspendido (entra activo y el corte decide). Otro valor → fila omitida (duda 2) |

**Tipo de conexión** (`control_routers`, una fila por router; `TIPOS_CONTROL` en `smartisp.ts` es **supuesto**, duda 3):

| Condición | `tipo_conexion` |
| --- | --- |
| `type_control` de hotspot (`ho`, `ha`) | `hotspot` → fila omitida (ArgosIsp no maneja hotspot) |
| `type_control` de PPPoE (`pp`, `ps`, `pt`, `pa`, `ra`), o sin control y con `user_hot` | `pppoe` (sin `user_hot` → fila omitida) |
| `control_routers.dhcp = 1` o `type_control = 'dl'` | `dhcp_fija` (MAC obligatoria) |
| cualquier otro (`sq` colas simples, `no`...) | `ip_estatica` (IP obligatoria), con amarre si `arpmac = 1` |

`client_services.typeauth` no se usa (duda 4). `online`, `onmikrotik`, `manually_cortado`, `billing_type`, `smartolt_sn`, `geo_json` no se importan.

## Facturas ← `bill_customers` (+ `bill_customer_item`)

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `bill_customers.id` | |
| `cliente_id` | `bill_customers.client_id` | |
| `servicio_id` | `bill_customers.service_id` | `NULL` → el único servicio del cliente |
| `periodo` | `bill_customers.start_date`; si falta, `release_date` | primer día del mes (`period` es texto libre, duda 8) |
| `total` | `bill_customers.total_pay`; si es `NULL`, `cost + iva` | |
| `pagado` | pagada → `total`; pendiente → suma de `payment_news.amount` no borrados con el mismo `num_bill` | |
| `vence` | `bill_customers.expiration_date` | |
| `concepto` | `bill_customer_item.description` | varias líneas unidas con ` · `; sin líneas, `period` |

**Estados** (`bill_customers.status`, `tinyint`; `ESTADOS_FACTURA` en `smartisp.ts` es **supuesto**, duda 1): `1` pagada, `2` pendiente, `3` pendiente (vencida), `4` anulada (no entra). Otro valor → fila omitida con el valor. Para detectar el supuesto equivocado en la corrida en seco, el reporte avisa cuando una factura "pagada" no tiene `paid_on` o una "pendiente" sí lo tiene.

No se importan `num_bill` (solo para enlazar pagos), `note`, `memo`, `xero_id`, `open`, `use_transactions`, `recurring_invoice`, `cortado_date`, `payment_id`. `recurring_invoices` (cobros recurrentes adicionales) no se importa: se recrean como plantilla o cargo en ArgosIsp.

## Pagos ← `payment_news`

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `payment_news.id` | |
| `cliente_id` | `payment_news.client_id` | quien pagó |
| `factura_id` | `bill_customers.id` cuyo `num_bill` = `payment_news.num_bill` | sin factura con ese número → el pago entra sin factura (queda a favor) |
| `monto` | `payment_news.amount` | `varchar(255)`: se valida como monto |
| `fecha` | `payment_news.date` | |
| `metodo` | `payment_news.way_to_pay` | texto → `metodoPago` |

Los pagos con `deleted_at` no se importan (borrado lógico de Laravel). No se importan `commentary`, `note`, `memo`, `received_by`, `id_pago`. Tampoco `wallet_payments` (pagos de facturas con el saldo a favor, duda 9) ni `transactions` (movimientos de la cuenta del cliente).

## Saldos ← `clients`

- **Saldo a favor**: `clients.wallet_balance` (duda 9).
- **Saldo del origen** por cliente = lo pendiente de sus facturas − `wallet_balance`. Solo se exporta fila de saldo cuando hay saldo a favor; si no, el importador usa la suma de sus facturas pendientes.
- `clients.balance` (comentario del esquema: *pending invoice balance*) se compara con lo pendiente de sus facturas: si no coincide, el reporte avisa con los dos montos. No se usa como saldo porque no sabemos si ya descuenta el saldo a favor (duda 9).

## Lo que no se importa

| Dato | Dónde está | Por qué |
| --- | --- | --- |
| Facturas de la tabla vieja | `invoices` | Aviso si trae filas (duda 1) |
| Pagos de la tabla vieja | `payments` | Aviso si trae filas (duda 1) |
| Cortes programados y motivos | `suspend_clients`, `cortado_reasons` | El corte lo decide ArgosIsp con las facturas |
| Notas de crédito | `note`, `detallenote` | Ya restadas del saldo en SmartISP |
| Factura electrónica (DIAN, SRI, SAT) | `invoices_dian`, `sri`, `invoice_sat`, `factel` | Otros países |
| Cajas y depósitos | `boxes`, `cashier_deposit_history`, `payment_records` | Historial de caja del sistema anterior |
| Inventario, tickets, monitoreo (`app_*`), SMS | varias | Fuera del alcance |
| Usuarios del panel | `users`, `core_users` | Se crean en ArgosIsp con su rol |

## Dudas para el PM (necesitan datos reales)

1. ¿Qué tabla de facturas usa el ISP: `bill_customers` o `invoices`? ¿Y de pagos: `payment_news` o `payments`? `SELECT count(*) FROM bill_customers; SELECT count(*) FROM invoices; SELECT count(*) FROM payment_news; SELECT count(*) FROM payments;` Y los valores de `bill_customers.status`: `SELECT status, count(*), sum(paid_on IS NULL) FROM bill_customers GROUP BY 1;` (suponemos 1 pagada, 2 pendiente, 3 vencida, 4 anulada).
2. `client_services.status`: ¿valores? Suponemos `ac` activo y `de` cortado. `SELECT status, count(*) FROM client_services GROUP BY 1;` ¿Cómo se ve un servicio dado de baja (se borra la fila)?
3. `control_routers.type_control`: ¿qué códigos aparecen y qué significa cada uno en la pantalla del router? `SELECT type_control, dhcp, arpmac, count(*) FROM control_routers GROUP BY 1,2,3;`
4. `client_services.typeauth`: ¿qué guarda (`userpass`, `binding`, `mac`)?
5. `plans.cost` y `plans.iva`: ¿`cost` es sin IVA y `iva` un porcentaje? ¿Qué cobra realmente al cliente (`bill_customers.total_pay` de un mes normal)?
6. `plans.download` / `upload`: ¿kbps? (`int(6)`: un plan de 10M sería `10240` o `10000`).
7. `address_routers.type`: ¿valores? (`char(7)`: ¿`static`, `pool`, `dhcp`?)
8. `bill_customers.period`: ¿formato? ¿`start_date` siempre viene lleno?
9. `clients.balance` y `clients.wallet_balance`: ¿`balance` es la deuda pendiente y `wallet_balance` el saldo a favor? ¿El saldo que muestra el panel es `balance − wallet_balance`? ¿`wallet_payments` ya está descontado de `wallet_balance`?
10. ¿`routers.password` está en claro?
