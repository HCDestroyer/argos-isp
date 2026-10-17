# Mapeo SmartISP → ArgosIsp

De qué tablas y columnas de la base de SmartISP sale cada entidad del formato canónico del importador (`apps/api/app/importacion/canonico.ts`) y cómo se transforma. El adaptador es `apps/api/app/importacion/origenes/smartisp.ts`; el esquema real de referencia, `scripts/importacion/esquemas/smartisp.sql` (112 tablas, exportado con phpMyAdmin, MySQL 5.7, Laravel).

Marcas:

- **No existe**: el dato no está en SmartISP; se dice cómo se resuelve.
- **Duda (PM)**: se resolvió con los datos reales (`diagnostico-smartisp.sql` y `diagnostico2-smartisp.sql`). Están al final, numeradas, con la respuesta.

SmartISP tiene tablas paralelas de versiones distintas (`bill_customers` e `invoices`; `payment_news` y `payments`). Con los datos reales, `invoices` y `payments` vienen vacías: el adaptador lee `bill_customers` y `payment_news`, y **avisa** si las otras traen filas (duda 1).

**Todo el volcado va al archivo del origen.** Decisión del PM: "se debe traer todo, para no perder ni dejar volando datos". Cada fila de cada tabla del volcado (también las que no tienen equivalente) se guarda tal cual en `importacion.filas_origen`, con a qué registro de ArgosIsp se llevó o por qué no; las credenciales quedan como `***`. El reporte cuenta cada tabla: leídas = creadas + existentes + al saldo + solo archivo + omitidas.

## Tablas que usa el adaptador

| Tabla                  | Para qué                                            | Obligatoria |
| ---------------------- | --------------------------------------------------- | ----------- |
| `routers`              | routers                                             | sí          |
| `radius`               | secreto RADIUS por router                           | no          |
| `control_routers`      | tipo de control del router (PPPoE, DHCP, amarre...) | no          |
| `address_routers`      | redes IPv4 por router                               | no          |
| `plans`                | planes                                              | sí          |
| `clients`              | clientes, saldo y saldo a favor                     | sí          |
| `zone`                 | nombre de la zona                                   | no          |
| `client_services`      | servicios                                           | sí          |
| `bill_customers`       | facturas                                            | no          |
| `bill_customer_item`   | concepto de la factura                              | no          |
| `payment_news`         | pagos                                               | no          |
| `invoices`, `payments` | solo para avisar si traen filas                     | no          |

"Obligatoria" = sin ella el comando se detiene antes de tocar la base con la lista de lo que falta. phpMyAdmin escribe las llaves primarias aparte (`ALTER TABLE ... ADD PRIMARY KEY`); el lector las ignora.

## Routers ← `routers` (+ `radius`)

| Canónico                      | Origen                                              | Transformación                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                          | `routers.id`                                        |                                                                                                                                                                                                 |
| `nombre`                      | `routers.name`                                      |                                                                                                                                                                                                 |
| `host`                        | `routers.ip`                                        |                                                                                                                                                                                                 |
| `nas_ip`                      | `routers.ip`                                        | **No existe** una IP RADIUS aparte: se usa la del router (debe ser IPv4)                                                                                                                        |
| `api_usuario`, `api_password` | —                                                   | `routers.password` viene **cifrada por SmartISP** (88 caracteres, duda 10): no se importa y el router queda con credenciales pendientes (cargarlas en el panel). Queda en el archivo como `***` |
| `radius_secret`               | `radius.secret` con `radius.router_id = routers.id` | sin fila → sin secreto (`router_sin_credenciales`, no bloquea)                                                                                                                                  |

No se importan `port` (API binaria de MikroTik; ArgosIsp usa la REST), `model`, `location`, `coordinates`, `status`, `connection`, `lan`.

## Redes IPv4 ← `address_routers`

| Canónico    | Origen                                                   | Transformación                                                                   |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `router_id` | `address_routers.router_id`                              |                                                                                  |
| `cidr`      | `address_routers.network` + `/` + `address_routers.mask` | si `network` ya trae `/nn` se usa tal cual; `mask` puede venir como `24` o `/24` |
| `gateway`   | `address_routers.gateway`                                |                                                                                  |
| `tipo`      | `address_routers.type`                                   | `pool` → `pool`; `static` → `estatico` (duda 7)                                  |

`networks` es la lista de IPs individuales (`is_used`, `client_id`): no hace falta, la IP va en el servicio.

## Planes ← `plans`

| Canónico                  | Origen                           | Transformación                                                                                        |
| ------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`                      | `plans.id`                       |                                                                                                       |
| `nombre`                  | `plans.name`                     |                                                                                                       |
| `precio`                  | `plans.cost`                     | sin IVA y `plans.iva` = 0 en los datos reales: el precio entra tal cual (duda 5); si `iva` > 0, aviso |
| `bajada`, `subida`        | `plans.download`, `plans.upload` | kbps (`50000` = 50M, `10240` = 10M; duda 6)                                                           |
| `perfil_ppp`, `pool_ipv4` | —                                | **No existen** en SmartISP; se configuran en la implementación del plan en ArgosIsp                   |

No se importan `burst_*`, `priority`, `limitat`, `aggregation`, `no_rules`, `address_list_name`, `title`, `smart_bandwidth` (velocidades por horario).

## Clientes ← `clients` (+ `zone`)

| Canónico      | Origen                           | Transformación                                                                                         |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`          | `clients.id`                     |                                                                                                        |
| `nombre`      | `clients.name`                   |                                                                                                        |
| `tipo`        | —                                | **No existe**: `persona` (`typedoc_cod`/`typetaxpayer_cod` son códigos fiscales de Colombia y Ecuador) |
| `nit`         | `clients.dni`                    | NIT, CUI o `CF`; se valida en el importador                                                            |
| `email`       | `clients.email`                  | inválido → aviso                                                                                       |
| `telefono`    | `clients.phone`                  |                                                                                                        |
| `movil`       | —                                | **No existe** aparte (`phone` es `varchar(255)`: puede traer varios)                                   |
| `direccion`   | `clients.address`                |                                                                                                        |
| `coordenadas` | `clients.coordinates`            | `lat,lng`; otra cosa → aviso                                                                           |
| `zona`        | `zone.name` de `clients.zona_id` |                                                                                                        |

No se importan `password` (clave del portal: el cliente entra a ArgosIsp con su propio acceso), `photo`, `odb_*`, `onu_*`, `port`, `onusn`, `map_marker_icon`, `billing_settings` (día de facturación, recordatorios: los da la plantilla de ArgosIsp).

## Servicios ← `client_services` (+ `control_routers`)

| Canónico                   | Origen                                                 | Transformación                                                                                                             |
| -------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | `client_services.id`                                   |                                                                                                                            |
| `cliente_id`               | `client_services.client_id`                            |                                                                                                                            |
| `router_id`                | `client_services.router_id`                            |                                                                                                                            |
| `plan_id`                  | `client_services.plan_id`                              | `0` = sin plan                                                                                                             |
| `tipo_conexion`            | `control_routers.type_control` del router y `user_hot` | ver abajo                                                                                                                  |
| `user_ppp`                 | `client_services.user_hot`                             |                                                                                                                            |
| `pass_ppp`                 | `client_services.pass_hot`                             | `CrearServicio` la cifra; nunca sale en logs ni en el reporte                                                              |
| `ip`                       | `client_services.ip`                                   | `varchar(15)`, una sola IPv4                                                                                               |
| `mac`                      | `client_services.mac`                                  | `00:00:00:00:00:00` (el defecto) = sin MAC                                                                                 |
| `amarre_ip_mac`            | `control_routers.arpmac`                               | `1` → sí (solo sin PPPoE)                                                                                                  |
| `direccion`, `coordenadas` | —                                                      | **No existen** por servicio: son del cliente                                                                               |
| `fecha_instalacion`        | `client_services.date_in`                              |                                                                                                                            |
| `estado`                   | `client_services.status`                               | `ac` → activo; `de` y `manually_cortado` → suspendido (entra activo y el corte decide). Otro valor → fila omitida (duda 2) |

**Tipo de conexión** (`control_routers`, una fila por router; en los datos reales `type_control = ps` → PPPoE, duda 3):

| Condición                                                                              | `tipo_conexion`                                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `type_control` de hotspot (`ho`, `ha`)                                                 | `hotspot` → fila omitida (ArgosIsp no maneja hotspot)      |
| `type_control` de PPPoE (`pp`, `ps`, `pt`, `pa`, `ra`), o sin control y con `user_hot` | `pppoe` (sin `user_hot` → fila omitida)                    |
| `control_routers.dhcp = 1` o `type_control = 'dl'`                                     | `dhcp_fija` (MAC obligatoria)                              |
| cualquier otro (`sq` colas simples, `no`...)                                           | `ip_estatica` (IP obligatoria), con amarre si `arpmac = 1` |

`client_services.typeauth` es siempre `userpass` (duda 4): no se usa. `online`, `onmikrotik`, `billing_type`, `smartolt_sn`, `geo_json` quedan en el archivo.

## Facturas ← `bill_customers` (+ `bill_customer_item`)

| Canónico      | Origen                                                                                          | Transformación                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `bill_customers.id`                                                                             |                                                                                                                                        |
| `cliente_id`  | `bill_customers.client_id`                                                                      |                                                                                                                                        |
| `servicio_id` | `bill_customers.service_id`                                                                     | `NULL` → el único servicio del cliente                                                                                                 |
| `periodo`     | `bill_customers.start_date`; si falta, `release_date`                                           | primer día del mes (`period` es texto libre, duda 8). Sin servicio en ArgosIsp, o la segunda del mismo servicio y periodo: cargo único |
| `total`       | `bill_customers.total_pay`; si es `NULL`, `cost + iva`                                          |                                                                                                                                        |
| `pagado`      | pagada → `total`; pendiente → suma de `payment_news.amount` no borrados con el mismo `num_bill` |                                                                                                                                        |
| `vence`       | `bill_customers.expiration_date`                                                                |                                                                                                                                        |
| `emitida`     | `bill_customers.release_date`                                                                   |                                                                                                                                        |
| `fecha_pago`  | `bill_customers.paid_on`                                                                        |                                                                                                                                        |
| `concepto`    | `bill_customer_item.description`                                                                | varias líneas unidas con `·`; sin líneas, `period`                                                                                     |

**Estados** (`bill_customers.status`, confirmados, duda 1): `1` pagada (14,794, todas con `paid_on`; 14,725 con pago); `2` sin cargo (423, total 0: entra como factura sin cargo); `3` pendiente (236, Q 39,360.58). No existe `4`. La columna `open` **no** significa pendiente: se ignora. Otro valor → fila omitida con el valor. El reporte avisa si una pagada no tiene `paid_on` o una pendiente sí lo tiene.

Pagadas sin ningún `payment_news` (69 reales, Q 1,550): entran `saldada_en_origen` (A3: pagada sin asiento ni pago; no aparece dinero que no se registró).

No se importan `num_bill` (solo para enlazar pagos), `note`, `memo`, `xero_id`, `open`, `use_transactions`, `recurring_invoice`, `cortado_date`, `payment_id`. `recurring_invoices` (cobros recurrentes adicionales) no se importa: se recrean como plantilla o cargo en ArgosIsp.

## Pagos ← `payment_news`

| Canónico     | Origen                                                        | Transformación                                                                                                           |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`         | `payment_news.id`                                             |                                                                                                                          |
| `cliente_id` | `payment_news.client_id`                                      | quien pagó                                                                                                               |
| `factura_id` | `bill_customers.id` cuyo `num_bill` = `payment_news.num_bill` | `num_bill` que no existe (11 reales) → el pago entra sin factura (se aplica a la más antigua o queda a favor), con aviso |
| `monto`      | `payment_news.amount`                                         | `varchar(255)`: se valida como monto                                                                                     |
| `fecha`      | `payment_news.date`                                           |                                                                                                                          |
| `metodo`     | `payment_news.way_to_pay`                                     | texto → `metodoPago`                                                                                                     |

Los pagos con `deleted_at` quedan solo en el archivo (borrado lógico de Laravel). No se importan `commentary`, `note`, `memo`, `received_by`, `id_pago`. Tampoco `wallet_payments` (pagos de facturas con el saldo a favor, duda 9) ni `transactions` (movimientos de la cuenta del cliente).

## Saldos ← `clients`

- **Saldo a favor**: `clients.wallet_balance` (duda 9).
- **Saldo del origen** por cliente = lo pendiente de sus facturas − `wallet_balance`. Solo se exporta fila de saldo cuando hay saldo a favor; si no, el importador usa la suma de sus facturas pendientes.
- `clients.balance` = suma de las facturas status 3 en 493 de 673 clientes (duda 9). Los 180 distintos van al reporte cliente por cliente con los dos montos; manda lo de las facturas.

## Lo que no se importa (queda en el archivo del origen)

| Dato                                          | Dónde está                                            | Por qué                                                 |
| --------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Facturas de la tabla vieja                    | `invoices`                                            | Vacía en los datos reales; aviso si trae filas (duda 1) |
| Pagos de la tabla vieja                       | `payments`                                            | Vacía en los datos reales; aviso si trae filas (duda 1) |
| Cortes programados y motivos                  | `suspend_clients`, `cortado_reasons`                  | El corte lo decide ArgosIsp con las facturas            |
| Notas de crédito                              | `note`, `detallenote`                                 | Ya restadas del saldo en SmartISP                       |
| Factura electrónica (DIAN, SRI, SAT)          | `invoices_dian`, `sri`, `invoice_sat`, `factel`       | Otros países                                            |
| Cajas y depósitos                             | `boxes`, `cashier_deposit_history`, `payment_records` | Historial de caja del sistema anterior                  |
| Inventario, tickets, monitoreo (`app_*`), SMS | varias                                                | Fuera del alcance                                       |
| Usuarios del panel                            | `users`, `core_users`                                 | Se crean en ArgosIsp con su rol                         |

## Dudas resueltas con los datos reales

Diagnósticos: `docs/importacion/diagnostico-smartisp.sql` y `docs/importacion/diagnostico2-smartisp.sql` (solo lectura).

1. Tablas: `bill_customers` y `payment_news` (`invoices` y `payments` vacías). `bill_customers.status`: 1 pagada, 2 sin cargo (total 0), 3 pendiente; no hay 4. `open` no es pendiente.
2. `client_services.status`: `ac`, `de` y 7 `manually_cortado` (suspendido).
3. `control_routers.type_control`: `ps` → PPPoE.
4. `client_services.typeauth`: siempre `userpass`.
5. `plans.cost`: sin IVA, `iva` = 0: el precio entra tal cual.
6. `plans.download` / `upload`: kbps (`50000` = 50M, `10240` = 10M).
7. `address_routers.type`: `pool` / `static`.
8. `bill_customers.period`: texto libre; el periodo sale de `start_date` (o `release_date`).
9. `clients.balance` = suma de status 3 en 493 de 673 clientes; los 180 distintos se listan en el reporte con los dos montos. `wallet_balance` = saldo a favor.
10. `routers.password`: cifrada (88 caracteres): no se importa; credenciales pendientes.
11. Pagadas sin ningún pago: 69 (Q 1,550) → `saldada_en_origen`. Pagos con `num_bill` que no existe: 11 → pago histórico sin factura.
