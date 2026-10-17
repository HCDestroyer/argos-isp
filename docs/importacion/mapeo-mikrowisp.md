# Mapeo Mikrowisp 6 → ArgosIsp

De qué tablas y columnas de la base de Mikrowisp 6 sale cada entidad del formato canónico del importador (`apps/api/app/importacion/canonico.ts`) y cómo se transforma. El adaptador es `apps/api/app/importacion/origenes/mikrowisp.ts`; el esquema real de referencia, `scripts/importacion/esquemas/mikrowisp6.sql` (102 tablas, exportado con Adminer, MariaDB 10.11).

Marcas:

- **No existe**: el dato no está en Mikrowisp; se dice cómo se resuelve.
- **Duda (PM)**: se resolvió con los datos reales (`diagnostico-mikrowisp.sql` y `diagnostico2-mikrowisp.sql`). Están al final, numeradas, con la respuesta.

**Todo el volcado va al archivo del origen.** Decisión del PM: "se debe traer todo, para no perder ni dejar volando datos". Además de lo que se mapea abajo, cada fila de cada tabla del volcado (también las que no tienen equivalente: `radacct`, logs, contratos…) se guarda tal cual en `importacion.filas_origen`, con a qué registro de ArgosIsp se llevó o por qué no; las credenciales quedan como `***`. El reporte cuenta cada tabla: leídas = creadas + existentes + al saldo + solo archivo + omitidas.

## Tablas que usa el adaptador

| Tabla          | Para qué                                                                             | Obligatoria |
| -------------- | ------------------------------------------------------------------------------------ | ----------- |
| `server`       | routers (nodos)                                                                      | sí          |
| `nas`          | respaldo de la IP RADIUS (en los datos reales viene vacía)                           | no          |
| `ipv4`         | redes IPv4 por router                                                                | no          |
| `perfiles`     | planes                                                                               | sí          |
| `usuarios`     | clientes y su estado                                                                 | sí          |
| `tblavisouser` | zona del cliente (y su configuración de avisos, que no se importa)                   | no          |
| `zonas`        | nombre de la zona                                                                    | no          |
| `tblservicios` | servicios                                                                            | sí          |
| `radcheck`     | clave PPPoE cuando `tblservicios.ppppass` viene vacía                                | no          |
| `facturas`     | facturas y lo cobrado de cada una                                                    | no          |
| `facturaitems` | concepto de la factura                                                               | no          |
| `operaciones`  | pagos                                                                                | no          |
| `saldos`       | saldo a favor del cliente (en los datos reales solo traslados: quedan en el archivo) | no          |
| `monedas`      | moneda de facturas, pagos y saldos                                                   | no          |
| `credito`      | promesas de pago vigentes                                                            | no          |

"Obligatoria" = sin ella el comando se detiene antes de tocar la base, con la lista de todo lo que falta. Las opcionales pueden faltar (la entidad entra vacía), pero si están deben tener las columnas que se leen.

**Ids con ceros.** Casi todos los ids de Mikrowisp son `int(6|8) unsigned zerofill` (`usuarios.id`, `facturas.id`, `operaciones.id`, `tblservicios.idcliente`...). `mysqldump` los escribe sin ceros (`1`), Adminer y phpMyAdmin a veces con ceros (`'000001'`). El adaptador quita los ceros a la izquierda de todo id numérico, así `000001` y `1` son el mismo cliente y la clave de idempotencia no cambia según la herramienta del volcado.

**Triggers.** El volcado trae seis triggers en bloques `DELIMITER ;;` con `INSERT` y `UPDATE` dentro. El lector (`mysql_dump.ts`) respeta `DELIMITER` y los ignora; sin eso tomaría el `INSERT INTO logsistema` del trigger por datos.

## Routers ← `server` (+ `nas`)

| Canónico                      | Origen                                                                                                  | Transformación                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                          | `server.id`                                                                                             |                                                                                                                                                                                                                                                   |
| `nombre`                      | `server.nodo`                                                                                           |                                                                                                                                                                                                                                                   |
| `host`                        | `server.ip`                                                                                             | tal cual (puede traer nombre de host)                                                                                                                                                                                                             |
| `nas_ip`                      | `server.ip_radius` (lleno en los 11 routers reales); si viene vacío, `nas.nasname` y si no, `server.ip` | debe ser IPv4; si no, la fila se omite                                                                                                                                                                                                            |
| `api_usuario`, `api_password` | —                                                                                                       | `server.pass` viene **cifrada por Mikrowisp** (siempre 32 caracteres): no se importa como credencial y el router queda con credenciales pendientes (`router_sin_credenciales`, no bloquea; cargarlas en el panel). Queda en el archivo como `***` |
| `radius_secret`               | `server.secret_radius`; si viene vacío, `nas.secret`                                                    | igual que la clave                                                                                                                                                                                                                                |

- **No existe**: el puerto de la API REST de RouterOS. Mikrowisp usa la API binaria (`server.port_api`, 8728/8729, `api_ssl`); ArgosIsp usa la REST (HTTPS). Se carga en el panel después.
- `server.seguridad` y `seguridad2` **no** deciden el tipo de conexión (ver abajo): quedan en el archivo del origen y el reporte dice cuántos servicios sin PPPoE hay por router.
- No se importan: `coordenadas`, `version`, `modelo`, `estado` (`API-ERROR`...), `velocidad` (`queues`), `openvpn`, `flow`, `mantenimiento`.

## Redes IPv4 ← `ipv4`

| Canónico    | Origen                         | Transformación                                                                                     |
| ----------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `router_id` | `ipv4.nodo`                    |                                                                                                    |
| `cidr`      | `ipv4.red` + `/` + `ipv4.cidr` | si `red` ya trae `/nn`, se usa tal cual                                                            |
| `gateway`   | —                              | **No existe** en la tabla: va vacío y ArgosIsp usa su regla por defecto                            |
| `tipo`      | `ipv4.tipo`                    | `0` → `estatico`; `1` y `2` → `pool` (los triggers de Mikrowisp tratan `1` y `2` como IP dinámica) |

`ipv4.nombre` es el nombre del pool en RouterOS (el trigger `cambionombre` lo copia a `radreply`): no se importa como pool del plan porque en Mikrowisp el pool es de la red, no del plan.

## Planes ← `perfiles`

| Canónico                             | Origen               | Transformación                                                                                                                    |
| ------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                 | `perfiles.id`        |                                                                                                                                   |
| `nombre`                             | `perfiles.plan`      |                                                                                                                                   |
| `precio`                             | `perfiles.costo`     | `decimal(12,2)`; **incluye IVA** (12 %: Q200 = 178.57 + 21.43), igual que el precio de ArgosIsp (duda 4)                          |
| `bajada`, `subida`                   | `perfiles.velocidad` | formato `max-limit` de MikroTik `subida/bajada` con `K` o `M` (`3000K/5000K`); un solo valor = igual en los dos sentidos (duda 3) |
| `bajada_limitada`, `subida_limitada` | —                    | `perfiles.limit_down`/`limit_up` no se usan (duda 5): 512k o la normal si es menor                                                |
| `perfil_ppp`                         | `perfiles.profile`   |                                                                                                                                   |
| `pool_ipv4`                          | —                    | **No existe** en el plan (es de la red `ipv4`)                                                                                    |

No se importan: `pcq`, `prioridad`, `burst_*`, `limitat`, `parent`, `queue_type_*`, `impuesto`, `is_disabled` (un plan deshabilitado se importa igual si algún servicio lo usa).

## Clientes ← `usuarios` (+ `tblavisouser`, `zonas`)

| Canónico                            | Origen                                                                              | Transformación                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`                                | `usuarios.id`                                                                       | sin ceros a la izquierda                                                                                            |
| `nombre`                            | `usuarios.nombre`                                                                   |                                                                                                                     |
| `tipo`                              | —                                                                                   | **No existe**: `persona`                                                                                            |
| `nit`                               | `usuarios.cedula`                                                                   | `CF`, NIT o CUI; el importador valida el dígito (`nit_invalido`, `nit_duplicado`)                                   |
| `nombre_fiscal`, `direccion_fiscal` | —                                                                                   | **No existen** en `usuarios` (FEL guarda `razon` y `nit` por factura en `factura_electronica_guatemala`; no se usa) |
| `email`                             | `usuarios.correo`                                                                   | un solo correo por cliente (duda 8); inválido → se descarta con aviso                                               |
| `telefono`                          | `usuarios.telefono`                                                                 |                                                                                                                     |
| `movil`                             | `usuarios.movil`                                                                    |                                                                                                                     |
| `direccion`                         | `usuarios.direccion_principal`                                                      |                                                                                                                     |
| `coordenadas`                       | —                                                                                   | están en el servicio (`tblservicios.coordenadas`), no en el cliente                                                 |
| `zona`                              | `zonas.zona` de `tblavisouser.zona` (fila con `tblavisouser.cliente = usuarios.id`) | `0` o sin fila → sin zona                                                                                           |

No se importan: `usuarios.codigo`, `pasarela`, el resto de `tblavisouser` (día de pago, avisos, `id_telegram`, `corteautomatico`, AFIP...). El día de corte y los recordatorios salen de la plantilla de facturación de ArgosIsp. El chat de Telegram se vuelve a vincular desde ArgosIsp.

## Servicios ← `tblservicios`

| Canónico            | Origen                                                                                                               | Transformación                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `tblservicios.id`                                                                                                    |                                                                                                                                                                                                                                                               |
| `cliente_id`        | `tblservicios.idcliente`                                                                                             | sin ceros                                                                                                                                                                                                                                                     |
| `router_id`         | `tblservicios.nodo`                                                                                                  |                                                                                                                                                                                                                                                               |
| `plan_id`           | `tblservicios.idperfil`                                                                                              | `0` = sin plan (`servicio_sin_plan`, no entra; su deuda va al saldo inicial)                                                                                                                                                                                  |
| `tipo_conexion`     | `pppuser`                                                                                                            | ver abajo                                                                                                                                                                                                                                                     |
| `user_ppp`          | `tblservicios.pppuser`                                                                                               |                                                                                                                                                                                                                                                               |
| `pass_ppp`          | `tblservicios.ppppass`; si viene vacía, `radcheck.value` con `attribute = 'Cleartext-Password'` del mismo `username` | `CrearServicio` la cifra; nunca sale en logs ni en el reporte                                                                                                                                                                                                 |
| `ip`                | `tblservicios.ip` si `tipoipv4 = 0`                                                                                  | con `tipoipv4` `1` o `2` la IP es dinámica: los triggers de `radacct` la escriben al conectar y la borran al desconectar, así que no es del servicio y entra vacía (ArgosIsp asigna una). Varias IPs en el campo (`varchar(700)`) → la primera, con aviso     |
| `mac`               | `tblservicios.mac`                                                                                                   | `aa:bb:..`, `AA-BB-..`, `aabb.ccdd.eeff` o `aabbccddeeff` → `AA:BB:CC:DD:EE:FF`; inválida → aviso                                                                                                                                                             |
| `amarre_ip_mac`     | —                                                                                                                    | siempre `no` (ver abajo)                                                                                                                                                                                                                                      |
| `direccion`         | `tblservicios.direccion`                                                                                             |                                                                                                                                                                                                                                                               |
| `coordenadas`       | `tblservicios.coordenadas`                                                                                           | `lat,lng`; otra cosa → aviso                                                                                                                                                                                                                                  |
| `fecha_instalacion` | `tblservicios.instalado`                                                                                             | `0000-00-00` = vacía                                                                                                                                                                                                                                          |
| `estado`            | `usuarios.estado` **del cliente**                                                                                    | **No existe** estado por servicio en Mikrowisp (`status_user` es ONLINE/OFFLINE de la sesión). Solo `ACTIVO` → activo; `SUSPENDIDO` → suspendido (entra activo y el corte decide con las facturas); `RETIRADO` → no entra (duda 1). Otro valor → fila omitida |

**Tipo de conexión** (confirmado, duda 2). `server.seguridad` **no** lo decide: el router con `seguridad = 1` tiene 648 servicios, todos con `pppuser`; los routers con `seguridad = 0` (`seguridad2` 0 o 3) mezclan PPPoE y servicios sin `pppuser`. Los 556 servicios sin `pppuser` tienen IP (332 además MAC).

| Condición          | `tipo_conexion`                                             | `amarre_ip_mac` |
| ------------------ | ----------------------------------------------------------- | --------------- |
| `pppuser` no vacío | `pppoe`                                                     | no              |
| sin `pppuser`      | `ip_estatica` con su IP y su MAC (sin IP, la fila se omite) | no              |

El reporte (`notas_origen`) dice por router cuántos servicios entraron como IP estática, con su `seguridad` y `seguridad2`.

**Solo internet.** Todos los servicios reales son `internet` (duda 6). Otro `tiposervicio` → fila omitida con su motivo. La telefonía va en otra tabla (`tblserviciosvoip`) y queda en el archivo.

**Precio por servicio.** `tblservicios.costo` es el precio que paga ese servicio; ArgosIsp cobra el del plan. Si difiere de `perfiles.costo`, el servicio entra con el plan y el reporte lo avisa (`formato_campo`) para ajustar el plan o la plantilla después.

**No se importan**: `ipv6` y `ipv6_duid` (el formato canónico no los lleva; si vienen, aviso), `ipap`, `antena`, `emisor`, `user_ubnt`/`pass_ubnt`, `smartolt*`, `onu_*`, `idnap`/`portnap`, `ppp_routes`, `ppp_localaddress`, `limitado`, `firewall_state`, `personalizados`.

## Facturas ← `facturas` (+ `facturaitems`, `monedas`)

| Canónico      | Origen                                                              | Transformación                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | `facturas.id`                                                       | sin ceros                                                                                                                                                                                                                |
| `cliente_id`  | `facturas.idcliente`                                                | sin ceros                                                                                                                                                                                                                |
| `servicio_id` | —                                                                   | **No existe**: Mikrowisp factura al cliente. El importador usa el único servicio del cliente; sin servicio en ArgosIsp (cliente RETIRADO, servicio sin plan) o con varios, entra como cargo único del cliente            |
| `periodo`     | `facturas.vencimiento`                                              | **mes del vencimiento** (prepago, duda 7): `2026-10-01` → `2026-10-01`. `tipo = 1` → sin periodo (cargo único). La segunda factura de servicio del mismo cliente con vencimiento en el mismo mes → sin periodo, con nota |
| `total`       | `facturas.total`                                                    | con IVA (`sub_total` + `iva_igv`)                                                                                                                                                                                        |
| `pagado`      | `pagado` → `total`; `No pagado` → `facturas.cobrado` (máx. `total`) | ver estados                                                                                                                                                                                                              |
| `vence`       | `facturas.vencimiento`                                              |                                                                                                                                                                                                                          |
| `emitida`     | `facturas.emitido`                                                  | fecha de emisión de los cargos únicos                                                                                                                                                                                    |
| `fecha_pago`  | `facturas.pago`                                                     |                                                                                                                                                                                                                          |
| `concepto`    | `facturaitems.descripcion` de la factura                            | varias líneas unidas con `·`                                                                                                                                                                                             |

Estados (`facturas.estado`): `No pagado` → pendiente; `pagado` → pagada (entra por su total; la saldan sus pagos o, si ninguno la cubre, entra `saldada_en_origen`); `anulado` → solo en el archivo (duda 9). Otro valor → fila omitida con el valor en el mensaje.

`facturas.tipo` (duda 11): `2` = factura de servicio (la gran mayoría); `1` = **cargo único** (63 reales, todas pagadas, Q 15,265: instalación, TV adicional, "PAGO DE SEPTIEMBRE"): entra sin periodo.

Moneda: una sola en los datos reales (duda 10). Solo se importa la moneda cuyo `codigo` es `GTQ` (o `simbolo` `Q`); sin tabla `monedas` o sin fila para ese id, se asume quetzales. Otra moneda → fila omitida.

No se importan (quedan en el archivo): `legal`, `forma`, `iva_igv` y `sub_total` por separado, `saldo` (siempre 0, duda 12), los campos de pasarelas (`mp_*`, `payu_*`, `oxxo_*`, `khipu`, `siro`...), `percepcion_afip`.

## Pagos ← `operaciones`

| Canónico     | Origen                   | Transformación                                                                            |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------------- |
| `id`         | `operaciones.id`         | sin ceros                                                                                 |
| `cliente_id` | `operaciones.idcliente`  | quien pagó                                                                                |
| `factura_id` | `operaciones.nfactura`   | `0` = sin factura; puede ser de otro cliente (`pago_cruzado`)                             |
| `monto`      | `operaciones.cobrado`    |                                                                                           |
| `fecha`      | `operaciones.fecha_pago` | `datetime`; se toma la fecha                                                              |
| `metodo`     | `operaciones.forma_pago` | texto libre → `metodoPago` (`efectivo` → caja, `depósito` → depósito, `transferencia`...) |

Moneda: `operaciones.idmoneda`, misma regla que la factura. No se importan `transaccion` (referencia; queda en la nota solo la forma de pago), `comision`, `saldo`, `operador`, `meses`, `descripcion`.

Lo pagado de una factura `No pagado` sale de `facturas.cobrado`; en los datos reales es siempre la suma de sus operaciones (duda 13). Si no coinciden, el reporte avisa en la factura.

## Saldos ← `saldos` (+ facturas)

- **Saldo a favor**: suma de `saldos.monto` del cliente (`iduser`) con `estado = 'no cobrado'`. En los datos reales `saldos` solo tiene 10 filas `facturado` (traslados entre facturas, ya reflejados en `cobrado`): no hay saldo a favor y esas filas quedan solo en el archivo (duda 14).
- **Saldo del origen** por cliente = lo pendiente de sus facturas − su saldo a favor. Solo se exporta fila de saldo cuando hay saldo a favor; si no, el importador usa la suma de sus facturas pendientes. Con eso el reporte compara la suma de saldos de ArgosIsp contra la del origen, cliente por cliente.
- **No existe** una columna de saldo total del cliente (`usuarios` no la tiene en la versión 6).

## Promesas ← `credito`

| Canónico      | Origen                 | Transformación                                                                               |
| ------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| `id`          | `credito.id`           |                                                                                              |
| `cliente_id`  | `credito.idcliente`    | sin ceros                                                                                    |
| `factura_id`  | `credito.idfactura`    |                                                                                              |
| `vence`       | `credito.fecha_limite` | solo las vigentes (`fecha_limite` ≥ hoy) sobre facturas `No pagado`; las demás, solo archivo |
| `fecha`       | `credito.fechaingreso` | `creada_en` de la promesa                                                                    |
| `descripcion` | `credito.descripcion`  |                                                                                              |

Entran con `ImportarPromesa` de A3 después de pagos y saldo inicial (14 vigentes en los datos reales, todas sobre facturas No pagado, duda 15).

## Lo que no se importa (queda en el archivo del origen)

| Dato                                                                        | Dónde está                                                              | Por qué                                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Reconexiones cobradas                                                       | `reconexiones`                                                          | Si están facturadas, entran con la factura                        |
| Notas de crédito                                                            | `notacredito` (AFIP) y `factura_electronica_guatemala.nfactura_credito` | Ya están restadas del saldo en Mikrowisp; el saldo inicial cuadra |
| FEL emitidas                                                                | `factura_electronica_guatemala`                                         | Historial fiscal: queda en INFILE                                 |
| Sesiones RADIUS                                                             | `radacct`, `radpostauth`                                                | Telemetría                                                        |
| Contratos, tickets, instalaciones, inventario, hotspot, VoIP, SMS, WhatsApp | varias                                                                  | Fuera del alcance de la importación                               |
| Usuarios del panel                                                          | `login`                                                                 | Se crean en ArgosIsp con su rol                                   |

## Dudas resueltas con los datos reales

Diagnósticos: `docs/importacion/diagnostico-mikrowisp.sql` y `docs/importacion/diagnostico2-mikrowisp.sql` (solo lectura).

1. `usuarios.estado`: solo `ACTIVO`, `SUSPENDIDO` y `RETIRADO`.
2. `server.seguridad`: no es el tipo de conexión. Con `pppuser` → PPPoE; sin `pppuser` → IP estática con su IP y MAC, sin amarre. `seguridad`/`seguridad2` quedan en el archivo y el reporte cuenta los servicios sin PPPoE por router.
3. `perfiles.velocidad`: `subida/bajada` con `K` (`3000K/5000K`).
4. `perfiles.costo`: incluye IVA (12 %).
5. `perfiles.limit_down` / `limit_up`: no se usan.
6. `tblservicios.tiposervicio`: siempre `internet`.
7. Periodo: prepago. El vencimiento cae el día 1 (17,210 facturas) o el 15 (1,701); respecto a la emisión vence el mes siguiente en 15,830, el mismo mes en 2,958, el anterior en 54 y 2 o más meses después en 180 (adelantos). Regla: **periodo = mes del vencimiento**. 14 grupos de cliente + mes con 2 facturas de servicio: la segunda entra como cargo único con nota.
8. `usuarios.correo`: un solo correo por cliente.
9. `facturas.estado`: `pagado`, `No pagado` y `anulado`.
10. Una sola moneda.
11. `facturas.tipo`: `1` = cargo único (63, todas pagadas, Q 15,265), `2` = servicio.
12. `facturas.saldo`: siempre 0.
13. `facturas.cobrado` = suma de sus `operaciones` en el 100 %.
14. `saldos`: solo 10 filas `facturado` (traslados entre facturas, ya en `cobrado`); no hay saldo a favor.
15. Promesas: 14 de `credito` vigentes, todas sobre facturas No pagado: se importan.
16. `nas` vacía; `server.ip_radius` lleno en los 11 routers: es la IP NAS.
17. `server.pass`: cifrada (32 caracteres): no se importa; credenciales pendientes.
18. Clientes `RETIRADO`: 131 sin servicios con 133 facturas No pagado (Q 28,725): se importan el cliente y **cada factura** (cargo único del cliente, sin servicio), no un saldo genérico.
