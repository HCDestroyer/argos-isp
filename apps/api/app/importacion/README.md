# importacion · importador desde Mikrowisp (A6)

Lleva los datos de un Mikrowisp a ArgosIsp: routers, redes IPv4, planes (y su implementación en cada router), zonas, clientes, servicios (PPPoE y WISP sin PPPoE), facturas pendientes y saldos. Todo se crea **por las acciones de dominio** de A1 (`CrearRouter`, `CrearRedIpv4`, `CrearPlan`, `ImplementarPlan`, `CrearZona`, `CrearCliente`, `CrearServicio`) y de A3 (`ImportarFacturaPendiente`, `RegistrarSaldoInicial`), así que queda auditoría y salen los eventos del outbox. Nunca hay `INSERT` directo; las lecturas para decidir (si ya existe, si la IP está libre) sí van directo a la base.

```sh
pnpm importar --dry-run mikrowisp.sql --salida=reporte/                 # en seco desde el volcado SQL; reporte en Markdown, CSV y JSON
pnpm importar --dry-run scripts/importacion/ejemplo                     # en seco desde CSV, reporte en pantalla
pnpm importar --dry-run <directorio> --reporte=reporte.json             # además, el reporte en JSON
pnpm importar <origen>                                                  # real
```

Paso a paso para operar (en seco, leer el reporte, corregir el origen, importación real): `docs/runbooks/importacion.md`.

Opciones de `node ace importar:mikrowisp <directorio>`:

| Opción                     | Qué hace                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`                | Corre todo en una transacción que se revierte al final. El reporte dice lo que pasaría                                                                                                                                              |
| `--salida=<directorio>`    | Guarda `reporte.md` (para leer), `diferencias.csv` (una línea por diferencia, para filtrar) y `reporte.json`. Ninguno lleva request_id ni horas salvo el JSON: dos corridas en seco sobre la misma base dan el mismo `.md` y `.csv` |
| `--reporte=<archivo>`      | Guarda el reporte completo en JSON (rutas relativas a donde se llamó)                                                                                                                                                               |
| `--ipv6=ninguno\|plan`     | `ninguno` (por defecto): los servicios entran solo con IPv4, porque Mikrowisp no maneja IPv6. `plan`: modo IPv6 por defecto del plan (requiere pools IPv6 en el router)                                                             |
| `--solo-planes-existentes` | No crea planes: mapea por nombre (o `equivale_a`) a planes que ya existen y deja el resto sin equivalente                                                                                                                           |
| `--plantilla=<id>`         | Plantilla de facturación de los servicios nuevos. Sin ella, la única que exista (`plantillaPorDefecto` de A1); con varias, los servicios entran sin plantilla y sus facturas pendientes no se importan (queda en errores)           |

## Volcado SQL de Mikrowisp

`<origen>` puede ser el volcado de la base MySQL de Mikrowisp (`mysqldump` o exportación SQL de phpMyAdmin), sin levantar un MySQL: `mysql_dump.ts` lee los `CREATE TABLE` y los `INSERT` (escapes, `NULL`, comentarios) y `mikrowisp_sql.ts` los lleva a las mismas filas que los CSV de abajo, con la misma validación.

**El esquema es supuesto** hasta que llegue la copia real del ISP: tablas `routers`, `redes`, `perfiles` (velocidad `subida/bajada` como el max-limit de MikroTik), `zonas`, `usuarios` (`cedula` = NIT o CUI, `saldo` = saldo a favor), `tblservicios` (`tipo` PPPOE/ESTATICO/DHCP, `idperfil` 0 = sin plan), `facturas` (estado `No pagado`/`Pagado`/`Anulado`) y `operaciones` (pagos: `nfactura`, `idcliente` del que pagó, `cobrado`). Todo el conocimiento del esquema está en `ESQUEMA` y en `fuenteDesdeDump` de `mikrowisp_sql.ts`: con el volcado real se ajusta ese archivo y nada más. Si falta una tabla o una columna, el comando lo dice antes de tocar la base.

Reglas del volcado: lo pagado de cada factura es la suma de sus `operaciones` (de quien sea); las anuladas no se importan; el saldo de un cliente con saldo a favor es lo pendiente de sus facturas menos ese saldo. El fixture `scripts/importacion/mikrowisp-sintetico.sql` tiene los casos difíciles (NIT duplicados, servicio sin plan, router sin credenciales, abonos, saldos a favor, pagos a facturas de otro, IPs repetidas, MAC en cuatro formatos, IP estática sin PPPoE) y su suma de saldos cuadra (Q 1830.00).

## Formato de entrada (CSV)

Un directorio con un CSV por entidad: UTF-8 (con o sin BOM), separador coma, encabezado en la primera fila, comillas dobles para campos con coma, comillas o saltos de línea (RFC 4180). Los nombres de columna no distinguen mayúsculas. Los `id` y las referencias (`cliente_id`, `router_id`, `plan_id`) son los ids de Mikrowisp. Columnas en **negrita** son obligatorias; el resto puede ir vacío o faltar. Ejemplo completo, con un caso de cada diferencia, en `scripts/importacion/ejemplo/`.

| Archivo                   | Columnas                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routers.csv`             | **`id`**, **`nombre`**, **`host`**, **`nas_ip`** (IPv4 con la que el router habla RADIUS), `api_usuario`, `api_password`, `radius_secret`                                                                                                                                                                                                                                                                                              |
| `redes.csv` (opcional)    | **`router_id`**, **`cidr`** (`198.19.10.0/24`), `gateway`, `tipo` (`estatico` por defecto, o `pool`)                                                                                                                                                                                                                                                                                                                                   |
| `planes.csv`              | **`id`**, **`nombre`**, **`precio`** (`150.00`, `Q 1,250.50`), **`bajada`**, **`subida`**, `bajada_limitada`, `subida_limitada`, `perfil_ppp`, `pool_ipv4`, `equivale_a`                                                                                                                                                                                                                                                               |
| `clientes.csv`            | **`id`**, **`nombre`**, `tipo` (`persona` o `empresa`), `nit` (NIT, CUI o `CF`), `nombre_fiscal`, `direccion_fiscal`, `email`, `telefono`, `movil`, `direccion`, `coordenadas` (`lat,lng`), `zona` (nombre)                                                                                                                                                                                                                            |
| `servicios.csv`           | **`id`**, **`cliente_id`**, **`router_id`**, **`plan_id`**, `tipo_conexion` (`pppoe` por defecto, `ip_estatica`, `dhcp_fija`), `user_ppp` (**obligatorio en `pppoe`**), `pass_ppp`, `ip` (**obligatoria en `ip_estatica`**), `mac` (**obligatoria en `dhcp_fija`**), `amarre_ip_mac` (`si`/`no`), `direccion`, `coordenadas`, `fecha_instalacion` (`2024-03-15`, `2024-03-15 10:00:00` o `15/03/2024`; `0000-00-00` = vacía), `estado` |
| `facturas.csv` (opcional) | **`id`**, **`cliente_id`**, `servicio_id`, **`periodo`** (`2026-08`, `08/2026` o `2026-08-01`), **`total`**, `pagado` (lo pendiente = total − pagado), `vence`, `concepto`                                                                                                                                                                                                                                                             |
| `saldos.csv` (opcional)   | **`cliente_id`**, **`saldo`** (saldo del cliente en Mikrowisp al exportar: `150.00` debe, `-20.00` a favor)                                                                                                                                                                                                                                                                                                                            |
| `pagos.csv` (opcional)    | **`id`**, **`cliente_id`** (quien pagó), `factura_id` (puede ser de otro cliente), **`monto`**, `fecha`, `metodo`. Si `facturas.csv` no trae `pagado`, lo pagado de cada factura es la suma de sus pagos                                                                                                                                                                                                                               |

- **`tipo_conexion`** (`contratos/routeros.md`): `pppoe`/`ppp`; `ip_estatica`/`estatica`/`static`; `dhcp_fija`/`dhcp`/`lease`. Sin PPPoE no hay `user_ppp` ni `pass_ppp` (se ignoran si vienen). Una fila `ip_estatica` sin IP o `dhcp_fija` sin MAC válida se omite (importarla le daría al cliente otra IP o un lease sin amarre).
- **Velocidades** en kbps (`10000`) o con unidad (`512k`, `10M`, `1.5M`, `1G`). Sin `bajada_limitada`/`subida_limitada` (Mikrowisp no las tiene) se usa 512 kbps o la velocidad normal si es menor.
- **MAC**: `aa:bb:cc:dd:ee:ff`, `AA-BB-CC-DD-EE-FF`, `aabb.ccdd.eeff` (Cisco) o `aabbccddeeff`; se guarda `AA:BB:CC:DD:EE:FF`.
- **`plan_id`** vacío o `0`: servicio sin plan (`servicios_sin_plan`), no se importa.
- **Estados**: `activo` (activo, habilitado), `suspendido` (suspendido, cortado, moroso, bloqueado), `retirado` (retirado, cancelado, baja, eliminado). Sin columna: activo.
- **`equivale_a`**: nombre de un plan de ArgosIsp al que se mapea el de Mikrowisp en lugar de crear uno nuevo.
- **Exportar desde MySQL**: un `SELECT` por archivo con alias a estos nombres de columna y `INTO OUTFILE ... FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'`, o la exportación CSV de phpMyAdmin con encabezados. Las consultas contra el esquema real de Mikrowisp se escriben cuando tengamos la copia de su base (pendiente en `.claude/integration/a6.md`).

## Qué hace con cada entidad

| Entidad        | Ya importada si…                                                      | Al crear                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router         | existe uno con la misma `nas_ip` o el mismo `nombre`                  | `CrearRouter` (credenciales cifradas por la acción)                                                                                                                                       |
| Red IPv4       | existe la misma red en el mismo router                                | `CrearRedIpv4`; si se traslapa con otra, queda en errores                                                                                                                                 |
| Plan           | existe un plan con su `nombre` (o con `equivale_a`)                   | `CrearPlan`, dual stack, `global = false`: solo disponible donde se implementa                                                                                                            |
| Implementación | existe (plan, router)                                                 | `ImplementarPlan` con `perfil_ppp` y `pool_ipv4`, una por cada par que usan los servicios                                                                                                 |
| Zona           | existe por nombre                                                     | `CrearZona`                                                                                                                                                                               |
| Cliente        | `campos_personalizados.mikrowisp_id` = id de Mikrowisp                | `CrearCliente` con `mikrowisp_id` en `campos_personalizados`                                                                                                                              |
| Servicio PPPoE | existe el `user_ppp` (sin distinguir mayúsculas) con el mismo cliente | `CrearServicio` con user y clave PPP del origen (la acción cifra la clave), IP fija, MAC, fecha de instalación y la plantilla                                                             |
| Servicio WISP  | su IP vigente es de un servicio del mismo cliente (sin IP: su MAC)    | `CrearServicio` con `tipo_conexion`, `amarre_ip_mac`, IP y MAC, sin credenciales. Necesita el modelo de A1 (`core.servicios.tipo_conexion`); sin él, queda en `tipos_conexion_pendientes` |
| Factura        | existe una factura con `clave_externa = mikrowisp:factura:<id>`       | `ImportarFacturaPendiente` (A3) con lo pendiente, el periodo y el vencimiento, en el servicio de la factura o, si no trae, en el único servicio importado del cliente                     |
| Saldo inicial  | existe uno con `clave_externa = mikrowisp:saldo:<cliente>`            | `RegistrarSaldoInicial` (A3) por la diferencia entre el saldo del origen y lo que entró como factura                                                                                      |

Por eso es **idempotente**: una segunda corrida no crea nada, no deja auditoría y reporta todo como `existentes`.

**Ids externos.** Antes de las claves naturales, el importador busca en `core.ids_externos (sistema, entidad_tipo, externo_id, entidad_id)` de A1 (`ids_externos.ts`) y, al crear, pasa `externo: { sistema: 'mikrowisp', id }` a `CrearRouter`, `CrearPlan`, `CrearCliente` y `CrearServicio`, que guardan el vínculo en su transacción: así reconoce un router renombrado o con otra IP en Mikrowisp. Si la tabla no existe todavía, usa solo las claves naturales y el reporte lo dice (`ids_externos: ninguno`). Las zonas van por nombre. Nunca hay `INSERT` directo.

## Saldos: suma contra el origen

- **Saldo del origen por cliente**: el de `saldos.csv`; si el cliente no está ahí, la suma de sus facturas pendientes.
- **Lo que entra**: cada factura pendiente con servicio (`ImportarFacturaPendiente`) y, por la diferencia, un saldo inicial (`RegistrarSaldoInicial`: positivo = factura de apertura, negativo = anticipo). Una factura sin servicio en ArgosIsp entra así dentro del saldo inicial (`facturas_a_saldo`).
- **Comparación**: al final de la corrida (en seco, antes de revertir) se lee el saldo de cada cliente en ArgosIsp = CxC (`saldoCliente`) − anticipos (`saldoAnticipos`) y se compara con el del origen. El reporte trae `saldos { clientes, suma_origen, suma_importada, diferencia, cuadra }` y `saldos_distintos` cliente por cliente. Lo que no cuadra es lo que no se pudo importar (un cliente inválido, una factura de un cliente que no existe, una acción que falló).
- Las facturas importadas no cambian el estado del servicio: el corte se aplica en la siguiente evaluación (A3).

## Reporte de diferencias

Por entidad: `origen`, `creados`, `existentes`, `omitidos`. Además:

| Diferencia                              | Qué se hace                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Routers sin credenciales                | Se importan; el reporte dice qué falta (usuario y clave de la API, secreto RADIUS) para cargarlo en el panel                             |
| Clientes con el mismo NIT               | Se importan todos (son cuentas distintas en el origen); el operador decide si unirlos                                                    |
| Servicios sin plan                      | No se importan; sus facturas van al saldo inicial del cliente, así que el saldo cuadra                                                   |
| Pagos a facturas de otro cliente        | Informativo: lo pendiente de la factura ya descuenta el pago                                                                             |
| IPs duplicadas en el origen             | Se importa el primer servicio del archivo; los demás se omiten                                                                           |
| IP fuera de las redes del router        | El servicio se omite (importarlo sin IP le daría otra al cliente)                                                                        |
| IP en uso por otro servicio de ArgosIsp | El servicio se omite                                                                                                                     |
| Servicio sin IP                         | Se importa; ArgosIsp le asigna una de las redes del router (se lista cuál)                                                               |
| Planes sin equivalente                  | Plan que no está en `planes.csv`, cuyo `equivale_a` no existe o que no se pudo crear; sus servicios se omiten                            |
| Clientes sin NIT                        | Se importan sin NIT                                                                                                                      |
| NIT inválidos                           | Se importan sin NIT; el valor original queda en `campos_personalizados.mikrowisp_nit` para corregirlo                                    |
| `user_ppp` duplicados                   | En el origen: se importa el primero. En ArgosIsp con otro cliente: se omite                                                              |
| Suspendidos en Mikrowisp                | Se importan activos; el corte se aplicará con las facturas (A3)                                                                          |
| Retirados en Mikrowisp                  | No se importan                                                                                                                           |
| Referencias faltantes                   | Servicio cuyo cliente, router o plan no está o no se pudo importar: se omite                                                             |
| Formato                                 | Fila omitida (falta un dato obligatorio, IP o red mal escrita) o campo descartado con aviso (correo, coordenadas, MAC o fecha inválidos) |
| Servicios sin PPPoE pendientes          | `ip_estatica` / `dhcp_fija` mientras ArgosIsp no tenga `tipo_conexion` (modelo de A1): no se importan                                    |
| Facturas a saldo                        | Factura sin servicio en ArgosIsp (no se importó o el cliente tiene varios y la factura no dice cuál): su monto va al saldo inicial       |
| Facturas pagadas                        | Pendiente 0 (total = pagado): se omiten                                                                                                  |
| Saldos distintos                        | Cliente cuyo saldo en ArgosIsp no es el del origen, con la diferencia                                                                    |
| Errores                                 | Lo que rechazó una acción de dominio, con su mensaje                                                                                     |

## Reporte en Markdown y CSV

`reporte_salidas.ts` convierte el reporte en **una línea por diferencia**: `entidad`, `id_mw`, `tipo` (código estable), `gravedad` (`error`, `omitido`, `aviso`, `info`), `detalle`, `causa` y `accion` (qué corregir en el origen). El Markdown agrupa por entidad (router, red, plan, cliente, servicio, factura, pago, saldo); el CSV es la misma tabla, UTF-8 con BOM para Excel.

## Carga financiera (A3) detrás de un puerto

Las facturas pendientes, los saldos iniciales y los pagos históricos pasan por `CargaFinanciera` (`carga_financiera.ts`), no por las acciones directamente. El adaptador `cargaFinancieraA3` usa `ImportarFacturaPendiente` y `RegistrarSaldoInicial`; el pago histórico queda en `null` hasta que A3 publique `contratos/importacion.md` (los pagos se cuentan como omitidos y el reporte lo dice en `pendiente`). Supuesto: el pago histórico es solo historial y no mueve el saldo.

## Transacción y auditoría

- Una sola transacción para toda la corrida; cada acción en su savepoint. Si una acción falla, se revierte solo esa entidad y se sigue con las demás. En seco, la transacción se revierte al final; en real, se confirma al final.
- Todas las acciones de una corrida comparten el `request_id` `importacion-mikrowisp-<uuid>` (aparece en el reporte), con actor `sistema` y canal `consola`: `audit.acciones` y `audit.outbox` se filtran por él.
- `DomainAction` escribe la auditoría de un error en una transacción aparte, así que un error de una acción queda en `audit.acciones` aunque la corrida sea en seco.

## Pendiente

- Aplicar el estado suspendido de Mikrowisp: con las facturas, por `evaluarEstadoServicio` en la siguiente evaluación.
- Ajustar `mikrowisp_sql.ts` al esquema real cuando llegue el volcado del ISP (falta la copia del PM).
- Pagos históricos: adaptador en `carga_financiera.ts` cuando A3 publique su contrato.

## Eventos

No consume. Emite, por las acciones que llama, `servicio.creado` y `asignacion.cambiada` por servicio. Las acciones de facturas y saldos de A3 no emiten eventos (no notifican: es carga histórica).

## Archivos

| Archivo                                   | Qué es                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `csv.ts`                                  | Lector de CSV (RFC 4180)                                                             |
| `mysql_dump.ts`                           | Lector de volcados MySQL (CREATE TABLE e INSERT), sin MySQL                          |
| `mikrowisp_sql.ts`                        | Esquema supuesto de Mikrowisp y su paso a las filas del importador                   |
| `carga_financiera.ts`                     | Puerto hacia las acciones de carga histórica de A3                                   |
| `reporte_salidas.ts`                      | Reporte en Markdown y CSV, una línea por diferencia                                  |
| `fuente.ts`                               | Lee el directorio, valida y normaliza cada fila                                      |
| `ids_externos.ts`                         | Interfaz `IdsExternos` y lectura de `core.ids_externos` cuando exista                |
| `importador.ts`                           | `importarMikrowisp(fuente, opciones)`: orquesta las acciones y arma el reporte       |
| `reporte.ts`                              | Tipos del reporte y versión en texto                                                 |
| `commands/importar_mikrowisp.ts`          | Comando `node ace importar:mikrowisp` (`pnpm importar` desde la raíz)                |
| `tests/importacion/importador.spec.ts`    | Pruebas con el ejemplo                                                               |
| `tests/importacion/mikrowisp_sql.spec.ts` | Pruebas con el fixture SQL: dos en seco iguales, real dos veces sin duplicar, saldos |
