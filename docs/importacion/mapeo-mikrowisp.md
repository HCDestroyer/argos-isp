# Mapeo Mikrowisp 6 → ArgosIsp

De qué tablas y columnas de la base de Mikrowisp 6 sale cada entidad del formato canónico del importador (`apps/api/app/importacion/canonico.ts`) y cómo se transforma. El adaptador es `apps/api/app/importacion/origenes/mikrowisp.ts`; el esquema real de referencia, `scripts/importacion/esquemas/mikrowisp6.sql` (102 tablas, exportado con Adminer, MariaDB 10.11).

Marcas:

- **No existe**: el dato no está en Mikrowisp; se dice cómo se resuelve.
- **Duda (PM)**: solo se resuelve mirando datos reales. Están juntas al final, numeradas, como preguntas para el PM.

## Tablas que usa el adaptador

| Tabla | Para qué | Obligatoria |
| --- | --- | --- |
| `server` | routers (nodos) | sí |
| `nas` | IP con la que el router habla RADIUS y su secreto | no |
| `ipv4` | redes IPv4 por router | no |
| `perfiles` | planes | sí |
| `usuarios` | clientes y su estado | sí |
| `tblavisouser` | zona del cliente (y su configuración de avisos, que no se importa) | no |
| `zonas` | nombre de la zona | no |
| `tblservicios` | servicios | sí |
| `radcheck` | clave PPPoE cuando `tblservicios.ppppass` viene vacía | no |
| `facturas` | facturas y lo cobrado de cada una | no |
| `facturaitems` | concepto de la factura | no |
| `operaciones` | pagos | no |
| `saldos` | saldo a favor del cliente | no |
| `monedas` | moneda de facturas, pagos y saldos | no |

"Obligatoria" = sin ella el comando se detiene antes de tocar la base, con la lista de todo lo que falta. Las opcionales pueden faltar (la entidad entra vacía), pero si están deben tener las columnas que se leen.

**Ids con ceros.** Casi todos los ids de Mikrowisp son `int(6|8) unsigned zerofill` (`usuarios.id`, `facturas.id`, `operaciones.id`, `tblservicios.idcliente`...). `mysqldump` los escribe sin ceros (`1`), Adminer y phpMyAdmin a veces con ceros (`'000001'`). El adaptador quita los ceros a la izquierda de todo id numérico, así `000001` y `1` son el mismo cliente y la clave de idempotencia no cambia según la herramienta del volcado.

**Triggers.** El volcado trae seis triggers en bloques `DELIMITER ;;` con `INSERT` y `UPDATE` dentro. El lector (`mysql_dump.ts`) respeta `DELIMITER` y los ignora; sin eso tomaría el `INSERT INTO logsistema` del trigger por datos.

## Routers ← `server` (+ `nas`)

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `server.id` | |
| `nombre` | `server.nodo` | |
| `host` | `server.ip` | tal cual (puede traer nombre de host) |
| `nas_ip` | `nas.nasname` del `nas` con `idserver = server.id`; si no hay, `server.ip` | debe ser IPv4; si no, la fila se omite |
| `api_usuario` | `server.user` | vacío → sin credenciales (`router_sin_credenciales`, no bloquea) |
| `api_password` | `server.pass` | la acción `CrearRouter` la cifra; nunca sale en el reporte |
| `radius_secret` | `server.secret_radius`; si viene vacío, `nas.secret` | igual que la clave |

- **No existe**: el puerto de la API REST de RouterOS. Mikrowisp usa la API binaria (`server.port_api`, 8728/8729, `api_ssl`); ArgosIsp usa la REST (HTTPS). Se carga en el panel después.
- `server.seguridad` no es del router en ArgosIsp: decide el **tipo de conexión** de sus servicios (abajo).
- No se importan: `coordenadas`, `version`, `modelo`, `estado` (`API-ERROR`...), `velocidad` (`queues`), `openvpn`, `flow`, `mantenimiento`.

## Redes IPv4 ← `ipv4`

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `router_id` | `ipv4.nodo` | |
| `cidr` | `ipv4.red` + `/` + `ipv4.cidr` | si `red` ya trae `/nn`, se usa tal cual |
| `gateway` | — | **No existe** en la tabla: va vacío y ArgosIsp usa su regla por defecto |
| `tipo` | `ipv4.tipo` | `0` → `estatico`; `1` y `2` → `pool` (los triggers de Mikrowisp tratan `1` y `2` como IP dinámica) |

`ipv4.nombre` es el nombre del pool en RouterOS (el trigger `cambionombre` lo copia a `radreply`): no se importa como pool del plan porque en Mikrowisp el pool es de la red, no del plan.

## Planes ← `perfiles`

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `perfiles.id` | |
| `nombre` | `perfiles.plan` | |
| `precio` | `perfiles.costo` | `decimal(12,2)`; se toma como precio con IVA (duda 4) |
| `bajada`, `subida` | `perfiles.velocidad` | formato `max-limit` de MikroTik `subida/bajada` (`5M/10M`); un solo valor = igual en los dos sentidos (duda 3) |
| `bajada_limitada`, `subida_limitada` | `perfiles.limit_down`, `perfiles.limit_up` | `'0'` (el defecto) = sin dato → 512k o la normal si es menor (duda 5) |
| `perfil_ppp` | `perfiles.profile` | |
| `pool_ipv4` | — | **No existe** en el plan (es de la red `ipv4`) |

No se importan: `pcq`, `prioridad`, `burst_*`, `limitat`, `parent`, `queue_type_*`, `impuesto`, `is_disabled` (un plan deshabilitado se importa igual si algún servicio lo usa).

## Clientes ← `usuarios` (+ `tblavisouser`, `zonas`)

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `usuarios.id` | sin ceros a la izquierda |
| `nombre` | `usuarios.nombre` | |
| `tipo` | — | **No existe**: `persona` |
| `nit` | `usuarios.cedula` | `CF`, NIT o CUI; el importador valida el dígito (`nit_invalido`, `nit_duplicado`) |
| `nombre_fiscal`, `direccion_fiscal` | — | **No existen** en `usuarios` (FEL guarda `razon` y `nit` por factura en `factura_electronica_guatemala`; no se usa) |
| `email` | `usuarios.correo` | inválido → se descarta con aviso (duda 8: varios correos en el campo) |
| `telefono` | `usuarios.telefono` | |
| `movil` | `usuarios.movil` | |
| `direccion` | `usuarios.direccion_principal` | |
| `coordenadas` | — | están en el servicio (`tblservicios.coordenadas`), no en el cliente |
| `zona` | `zonas.zona` de `tblavisouser.zona` (fila con `tblavisouser.cliente = usuarios.id`) | `0` o sin fila → sin zona |

No se importan: `usuarios.codigo`, `pasarela`, el resto de `tblavisouser` (día de pago, avisos, `id_telegram`, `corteautomatico`, AFIP...). El día de corte y los recordatorios salen de la plantilla de facturación de ArgosIsp. El chat de Telegram se vuelve a vincular desde ArgosIsp.

## Servicios ← `tblservicios`

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `tblservicios.id` | |
| `cliente_id` | `tblservicios.idcliente` | sin ceros |
| `router_id` | `tblservicios.nodo` | |
| `plan_id` | `tblservicios.idperfil` | `0` = sin plan (`servicio_sin_plan`, no entra; su deuda va al saldo inicial) |
| `tipo_conexion` | `pppuser` y `server.seguridad` del router | ver abajo |
| `user_ppp` | `tblservicios.pppuser` | |
| `pass_ppp` | `tblservicios.ppppass`; si viene vacía, `radcheck.value` con `attribute = 'Cleartext-Password'` del mismo `username` | `CrearServicio` la cifra; nunca sale en logs ni en el reporte |
| `ip` | `tblservicios.ip` si `tipoipv4 = 0` | con `tipoipv4` `1` o `2` la IP es dinámica: los triggers de `radacct` la escriben al conectar y la borran al desconectar, así que no es del servicio y entra vacía (ArgosIsp asigna una). Varias IPs en el campo (`varchar(700)`) → la primera, con aviso |
| `mac` | `tblservicios.mac` | `aa:bb:..`, `AA-BB-..`, `aabb.ccdd.eeff` o `aabbccddeeff` → `AA:BB:CC:DD:EE:FF`; inválida → aviso |
| `amarre_ip_mac` | `server.seguridad` del router | ver abajo |
| `direccion` | `tblservicios.direccion` | |
| `coordenadas` | `tblservicios.coordenadas` | `lat,lng`; otra cosa → aviso |
| `fecha_instalacion` | `tblservicios.instalado` | `0000-00-00` = vacía |
| `estado` | `usuarios.estado` **del cliente** | **No existe** estado por servicio en Mikrowisp (`status_user` es ONLINE/OFFLINE de la sesión). `ACTIVO` → activo; `SUSPENDIDO` → suspendido (entra activo y el corte decide con las facturas); `RETIRADO` → no entra. Otro valor → fila omitida (duda 1) |

**Tipo de conexión.** Mikrowisp no lo guarda por servicio: lo decide la "seguridad" del router (`server.seguridad`).

| Condición | `tipo_conexion` | `amarre_ip_mac` |
| --- | --- | --- |
| `pppuser` no vacío | `pppoe` | no |
| sin `pppuser`, `server.seguridad` en `SEGURIDAD.dhcp` | `dhcp_fija` (MAC obligatoria) | no |
| sin `pppuser`, `server.seguridad` en `SEGURIDAD.amarre` | `ip_estatica` (IP obligatoria) | sí |
| sin `pppuser`, cualquier otra seguridad | `ip_estatica` | no |

`SEGURIDAD` (en `mikrowisp.ts`) es **supuesto**: `1` = amarre IP/MAC, `2` = DHCP leases (duda 2).

**Solo internet.** `tblservicios.tiposervicio` distinto de `internet` (duda 6) → fila omitida con su motivo. La telefonía va en otra tabla (`tblserviciosvoip`) y no se lee.

**Precio por servicio.** `tblservicios.costo` es el precio que paga ese servicio; ArgosIsp cobra el del plan. Si difiere de `perfiles.costo`, el servicio entra con el plan y el reporte lo avisa (`formato_campo`) para ajustar el plan o la plantilla después.

**No se importan**: `ipv6` y `ipv6_duid` (el formato canónico no los lleva; si vienen, aviso), `ipap`, `antena`, `emisor`, `user_ubnt`/`pass_ubnt`, `smartolt*`, `onu_*`, `idnap`/`portnap`, `ppp_routes`, `ppp_localaddress`, `limitado`, `firewall_state`, `personalizados`.

## Facturas ← `facturas` (+ `facturaitems`, `monedas`)

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `facturas.id` | sin ceros |
| `cliente_id` | `facturas.idcliente` | sin ceros |
| `servicio_id` | — | **No existe**: Mikrowisp factura al cliente. El importador usa el único servicio del cliente; con varios, la factura va al saldo inicial (`factura_a_saldo`) |
| `periodo` | `facturas.emitido` | mes de emisión (`2026-09-15` → `2026-09-01`) (duda 7) |
| `total` | `facturas.total` | con IVA (`sub_total` + `iva_igv`) |
| `pagado` | `Pagado` → `total`; `No pagado` → `facturas.cobrado` (máx. `total`) | ver estados |
| `vence` | `facturas.vencimiento` | |
| `concepto` | `facturaitems.descripcion` de la factura | varias líneas unidas con ` · ` |

Estados (`facturas.estado`, `varchar(10)`, defecto `No pagado`): `No pagado` → pendiente; `Pagado` → pagada (pendiente 0; entra solo si un pago la cubre); `Anulado` → no se importa. Otro valor → fila omitida con el valor en el mensaje (duda 9).

Moneda: `facturas.moneda` → `monedas`. Solo se importa la moneda cuyo `codigo` es `GTQ` (o `simbolo` `Q`); sin tabla `monedas` o sin fila para ese id, se asume quetzales. Otra moneda → fila omitida (duda 10).

No se importan: `legal`, `forma`, `tipo` (duda 11), `iva_igv` y `sub_total` por separado, `saldo` (duda 12), los campos de pasarelas (`mp_*`, `payu_*`, `oxxo_*`, `khipu`, `siro`...), `percepcion_afip`.

## Pagos ← `operaciones`

| Canónico | Origen | Transformación |
| --- | --- | --- |
| `id` | `operaciones.id` | sin ceros |
| `cliente_id` | `operaciones.idcliente` | quien pagó |
| `factura_id` | `operaciones.nfactura` | `0` = sin factura; puede ser de otro cliente (`pago_cruzado`) |
| `monto` | `operaciones.cobrado` | |
| `fecha` | `operaciones.fecha_pago` | `datetime`; se toma la fecha |
| `metodo` | `operaciones.forma_pago` | texto libre → `metodoPago` (`efectivo` → caja, `depósito` → depósito, `transferencia`...) |

Moneda: `operaciones.idmoneda`, misma regla que la factura. No se importan `transaccion` (referencia; queda en la nota solo la forma de pago), `comision`, `saldo`, `operador`, `meses`, `descripcion`.

Lo pagado de una factura `No pagado` sale de `facturas.cobrado`, no de la suma de sus operaciones. Si las dos no coinciden, el reporte avisa en la factura (duda 13).

## Saldos ← `saldos` (+ facturas)

- **Saldo a favor**: suma de `saldos.monto` del cliente (`iduser`) con `estado = 'no cobrado'` (el defecto: saldo aún sin aplicar). `cobrado` = ya aplicado, no cuenta (duda 14).
- **Saldo del origen** por cliente = lo pendiente de sus facturas − su saldo a favor. Solo se exporta fila de saldo cuando hay saldo a favor; si no, el importador usa la suma de sus facturas pendientes. Con eso el reporte compara la suma de saldos de ArgosIsp contra la del origen, cliente por cliente.
- **No existe** una columna de saldo total del cliente (`usuarios` no la tiene en la versión 6).

## Lo que no se importa

| Dato | Dónde está | Por qué |
| --- | --- | --- |
| Promesas de pago | `credito` (`fecha_limite`, `idfactura`, `estado`) | Las promesas vigentes se crean en ArgosIsp (duda 15) |
| Reconexiones cobradas | `reconexiones` | Si están facturadas, entran con la factura |
| Notas de crédito | `notacredito` (AFIP) y `factura_electronica_guatemala.nfactura_credito` | Ya están restadas del saldo en Mikrowisp; el saldo inicial cuadra |
| FEL emitidas | `factura_electronica_guatemala` | Historial fiscal: queda en INFILE |
| Sesiones RADIUS | `radacct`, `radpostauth` | Telemetría |
| Contratos, tickets, instalaciones, inventario, hotspot, VoIP, SMS, WhatsApp | varias | Fuera del alcance de la importación |
| Usuarios del panel | `login` | Se crean en ArgosIsp con su rol |

## Dudas para el PM (necesitan datos reales)

1. `usuarios.estado`: ¿qué valores aparecen? Suponemos `ACTIVO`, `SUSPENDIDO`, `RETIRADO`. ¿Hay otros (`CORTADO`, `MOROSO`, `INACTIVO`, `PENDIENTE` de instalación)? `SELECT estado, count(*) FROM usuarios GROUP BY estado;`
2. `server.seguridad`: ¿qué número es cada opción de "Seguridad" del router (ninguna, amarre IP/MAC, DHCP leases, PPPoE secrets, PPPoE RADIUS, hotspot)? Suponemos `1` amarre y `2` DHCP. `SELECT seguridad, seguridad2, count(*) FROM server GROUP BY 1,2;` y la pantalla de cada router.
3. `perfiles.velocidad`: ¿formato `subida/bajada` (`5M/10M`, como el `max-limit`) o `bajada/subida`? ¿Con unidades `k`/`M`? Basta un plan con velocidades distintas y su pantalla.
4. `perfiles.costo`: ¿incluye IVA? `perfiles.impuesto` es `decimal(4,2)`: ¿porcentaje que se suma al facturar?
5. `perfiles.limit_down` / `limit_up`: ¿son la velocidad del estado "limitado" (moroso)? ¿Con qué formato?
6. `tblservicios.tiposervicio`: ¿qué valores además de `internet`? `SELECT tiposervicio, count(*) FROM tblservicios GROUP BY 1;`
7. Periodo de la factura: ¿Mikrowisp emite la factura del mes en curso o la del siguiente (prepago)? Si emite el 25 la de octubre, el periodo debería ser el mes siguiente a `emitido`.
8. `usuarios.correo` es `text`: ¿guarda varios correos separados por coma?
9. `facturas.estado`: ¿solo `No pagado`, `Pagado` y `Anulado`? `SELECT estado, count(*) FROM facturas GROUP BY 1;`
10. ¿El ISP factura alguna vez en dólares? `SELECT * FROM monedas;` y `SELECT moneda, count(*) FROM facturas GROUP BY 1;`
11. `facturas.tipo` (`1` por defecto): ¿qué es `2` u otro? ¿Recibos, proformas, facturas de instalación?
12. `facturas.saldo`: ¿es saldo a favor aplicado a esa factura? ¿Ya está incluido en `cobrado`?
13. ¿`facturas.cobrado` siempre es la suma de sus `operaciones.cobrado`? Comparar: `SELECT f.id, f.cobrado, SUM(o.cobrado) FROM facturas f LEFT JOIN operaciones o ON o.nfactura = f.id GROUP BY f.id HAVING f.cobrado <> COALESCE(SUM(o.cobrado),0);`
14. `saldos.estado`: ¿valores? Suponemos `no cobrado` = disponible y `cobrado` = aplicado. ¿El saldo a favor que muestra el panel es esa suma?
15. ¿Hay promesas de pago vigentes (`credito.estado`) que haya que recrear en ArgosIsp el día del cambio?
16. `nas`: ¿cada router tiene su fila con la IP con la que llega al RADIUS? ¿Qué es `server.ip_radius`?
17. ¿`server.pass` está en claro o cifrada por Mikrowisp? Si está cifrada, las credenciales de la API se cargan a mano.
