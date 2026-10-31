# importacion · importador multi-origen (A6)

Lleva a ArgosIsp los datos de otro sistema de gestión (Mikrowisp, SmartISP o cualquiera que exporte a hoja de cálculo): routers, redes IPv4, planes (y su implementación en cada router), zonas, clientes, servicios (PPPoE y WISP sin PPPoE), **todas** las facturas, pagos históricos, promesas vigentes y saldos. Todo se crea **por las acciones de dominio** de A1 (`CrearRouter`, `CrearRedIpv4`, `CrearPlan`, `ImplementarPlan`, `CrearZona`, `CrearCliente`, `CrearServicio`), de A3 (`ImportarFacturaPendiente`, `RegistrarPagoHistorico`, `RegistrarSaldoInicial`, `ImportarPromesa`) y la propia (`ArchivarFilasOrigen`), así que queda auditoría y salen los eventos del outbox. Nunca hay `INSERT` directo; las lecturas para decidir (si ya existe, si la IP está libre) sí van directo a la base.

**Se trae todo** (decisión del PM, "para no perder ni dejar volando datos"):

- **Historial completo por defecto (modo B)**: todas las facturas por su total (también las pagadas, los cargos únicos, las de clientes retirados y las de total 0), todos los pagos con su fecha, las promesas vigentes y un saldo inicial solo para la diferencia que quede.
- **Archivo del origen** (`importacion.filas_origen`, schema `importacion` de A6): cada fila de **cada** tabla del volcado (o de cada CSV) se guarda tal cual (`jsonb`) con origen, tabla, id externo y a qué registro de ArgosIsp se llevó, o "solo archivo" / "omitida" con el motivo. Credenciales (contraseñas de router, PPPoE, tokens, `radcheck` de contraseña) como `***`; la clave PPPoE sí entra al servicio, cifrada.
- **Cuadre obligatorio** (en seco y real): por tabla, leídas = creadas + existentes + al saldo + solo archivo + omitidas, y **la corrida falla** (`FilasSinContar`, no se guarda nada) si una fila no queda contada; dinero (facturado, cobrado, pendiente y pagos del origen contra ArgosIsp, con lo que explica cada diferencia); y saldo cliente por cliente (`saldoCliente − saldoAnticipos` = saldo del origen).

```sh
pnpm importar --origen=mikrowisp --fuente=mikrowisp.sql --dry-run --salida=reporte/   # en seco desde el volcado SQL; reporte en Markdown, CSV y JSON
pnpm importar --origen=smartisp --fuente=smartisp.sql --dry-run                       # SmartISP
pnpm importar --origen=csv --fuente=exportacion/ --sistema=wisphub --dry-run          # cualquier sistema, con las plantillas CSV
pnpm importar:plantillas plantillas/                                                  # plantillas CSV vacías con su LEEME
pnpm importar --origen=<origen> --fuente=<ruta>                                       # real
pnpm importar ... --empresa=<id|nit>                                                  # varias empresas: a cuál va todo
pnpm importar ... --excluir-tablas=radacct,logs                                       # tablas enormes fuera del archivo
pnpm importar --origen=csv ... --decimal=coma                                         # CSV con coma decimal (o facturas.csv:coma)
```

## Multiempresa y tablas excluidas

- **`--empresa=<id|nit>`** (`resolverEmpresaImportacion`): todo lo importado va a esa empresa. Los servicios se crean con `empresa_id`; las facturas, pagos históricos, promesas y saldos iniciales reciben `empresa_id` **explícito** en cada acción de A3 (`contratos/importacion.md` § Multiempresa): el de `--empresa`, salvo lo que cuelga de un servicio ya importado en otra empresa (`servicios_otra_empresa`): sus facturas van con la empresa de su servicio (A3 rechaza otra con `empresa_servicio`) y los pagos y promesas de esas facturas las siguen; las zonas y routers nuevos con `empresa_sugerida_id`, el contexto de la corrida lleva `empresaId` (lo registra `audit.acciones.empresa_id` y lo usan las acciones que no dependen de un servicio) y el archivo del origen guarda `importacion.filas_origen.empresa_id`. Se busca primero por id y después por NIT (sin guion ni espacios). Sin `--empresa`: la única empresa activa; con varias, falla antes de tocar la base (`EmpresaImportacionRequerida`, con la lista de empresas); desactivada o inexistente, también. Un servicio ya importado en otra empresa no se mueve: sale en `servicios_otra_empresa`. El reporte lleva `empresa { id, nombre, nit }`.
- **`--excluir-tablas=a,b`** (`tablasExcluidas`): por defecto se archiva todo. Las tablas indicadas no se guardan en el archivo ni se cuentan en el cuadre; el reporte las lista en `tablas_excluidas` con sus filas. Solo tablas sin filas vinculadas a una entidad de ArgosIsp; una tabla que se importa, o que no está en el volcado, hace fallar la corrida. Pensado para `radacct` y los logs (runbook).
- **`--decimal=punto|coma`** (solo `--origen=csv`): separador decimal de los montos, para todo el directorio (`coma`) o por archivo (`facturas.csv:coma,pagos.csv:coma`; `coma,planes.csv:punto`). Por defecto punto. Los volcados MySQL siempre usan punto y rechazan la opción.

**Montos** (`montos.ts`, `leerMonto`): un monto ilegible o ambiguo **nunca entra como 0**: la fila se omite con su motivo (problema del reporte, `formato` y `diferencias.csv`) y cuenta como omitida en el cuadre por tabla. Con punto decimal: `1250.50`, `1,250.50`, `1,234,567`, `Q 150`, `-20` bien; `1,50` o `1,250` (una sola coma, sin punto) son ambiguos y se reportan; `1.250,50`, `1e3`, `abc` o vacío, ilegibles. Con coma decimal, lo simétrico (`1.250,50` bien; `1.250` y `150.00` ambiguos). En los volcados (`montoOrigen` de `esquema_sql.ts`) un `total`, `cobrado`, `amount`, `cost`/`iva`/`total_pay` o saldo a favor ilegible omite su factura, pago o saldo; si el monto solo se usa para comparar (`tblservicios.costo`, `clients.balance`, `plans.iva`) queda un aviso. Se calcula con `D` de `#ledger/dinero` (precisión 40), como el resto del sistema.

Paso a paso para operar (en seco, leer el reporte, corregir el origen, importación real): `docs/runbooks/importacion.md`.

## Núcleo y adaptadores

```
origen (volcado .sql, CSV)  ──adaptador──▶  formato canónico  ──normalizarFuente──▶  FuenteCanonica  ──importar()──▶  acciones de A1 y A3 + reporte
                              origenes/*.ts   COLUMNAS (canonico.ts)                  (validada)        importador.ts
```

- **Formato canónico** (`canonico.ts`): una tabla por entidad (`routers`, `redes`, `planes`, `clientes`, `servicios`, `facturas`, `saldos`, `pagos`) con las columnas de `COLUMNAS`. Es la única definición del formato: con ella se valida, se generan las plantillas CSV y su LEEME. `normalizarFuente` valida y normaliza (montos, velocidades, MAC, fechas, estados) y deja los problemas de formato en `problemas`.
- **Adaptadores de origen** (`origenes/`): solo traducen su fuente al formato canónico; no deciden nada. Cada uno guarda todo su conocimiento del origen en un archivo.
- **Núcleo** (`importador.ts`, `importar(fuente, { sistema, ... })`): las reglas de negocio, la idempotencia, el cuadre de saldos y el reporte, iguales para todos los orígenes.

| `--origen`  | `--fuente`                        | Adaptador               | Estado                                                                                                                                        |
| ----------- | --------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `mikrowisp` | volcado SQL (`mysqldump`)         | `origenes/mikrowisp.ts` | Esquema real de Mikrowisp 6 (`docs/importacion/mapeo-mikrowisp.md`); estados, tipos y reglas confirmados con los diagnósticos de datos reales |
| `smartisp`  | volcado SQL (`mysqldump`)         | `origenes/smartisp.ts`  | Esquema real de SmartISP (`docs/importacion/mapeo-smartisp.md`); estados y control confirmados con los diagnósticos de datos reales           |
| `csv`       | directorio con un CSV por entidad | `origenes/csv.ts`       | Listo: es el formato canónico tal cual. Para cualquier sistema que exporte a hoja de cálculo                                                  |

**Agregar un origen**: un archivo `origenes/<sistema>.ts` que lea la fuente y devuelva `normalizarFuente(filas)` (con `tablasDelEsquema` y `filasCanonicas` de `origenes/esquema_sql.ts` si es un volcado MySQL), y su entrada en `ADAPTADORES` de `origenes/index.ts`. Nada más cambia.

### Idempotencia por origen + id externo

El nombre del sistema de origen (`sistema`: `mikrowisp`, `smartisp`, `csv` o el `--sistema` que se indique con CSV) y el id de cada fila en ese sistema forman la clave:

- `core.ids_externos (sistema, entidad_tipo, externo_id)` para routers, planes, clientes y servicios (A1); al crear, `externo: { sistema, id }`.
- `campos_personalizados.<sistema>_id` del cliente (respaldo sin `core.ids_externos`).
- `clave_externa` de A3: `<sistema>:factura:<id>`, `<sistema>:saldo:<cliente>`, `<sistema>:pago:<id>`.
- `request_id` de la corrida: `importacion-<sistema>-<uuid>`.

Mismo origen y mismo id = misma entidad (una segunda corrida no crea nada). Otro origen = otra entidad. Por eso, si los CSV son una exportación de un Mikrowisp que ya se importó (o se importará) desde su volcado, van con `--sistema=mikrowisp`.

## Orígenes `mikrowisp` y `smartisp`: volcado SQL

`origenes/mikrowisp.ts` y `origenes/smartisp.ts` leen el volcado de la base MySQL (`mysqldump`, Adminer o phpMyAdmin) sin levantar un MySQL: `mysql_dump.ts` lee los `CREATE TABLE` y los `INSERT` (escapes, `NULL`, comentarios, `DELIMITER` de los triggers) y el adaptador los lleva al formato canónico.

- **Esquema real**: `scripts/importacion/esquemas/mikrowisp6.sql` (Mikrowisp 6, 102 tablas) y `scripts/importacion/esquemas/smartisp.sql` (112 tablas), solo estructura. De qué tabla y columna sale cada dato, con sus transformaciones y las dudas para el PM: `docs/importacion/mapeo-mikrowisp.md` y `docs/importacion/mapeo-smartisp.md`.
- **Validación del esquema** (`tablasDelEsquema`, `origenes/esquema_sql.ts`): antes de tocar la base compara el volcado con las tablas y columnas que el adaptador lee (`ESQUEMA` de cada archivo). Si falta algo, se detiene con la lista completa (`EsquemaIncompleto`). Las tablas marcadas `opcional` pueden faltar (la entidad entra vacía), pero si están deben traer sus columnas.
- **Problemas del origen** (`ProblemasOrigen`): lo que el adaptador no traduce (factura en dólares, estado desconocido, servicio que no es de internet, hotspot) o traduce con una observación (precio del servicio distinto al del plan, IPv6 que no se importa, `cobrado` distinto de la suma de pagos) sale en el reporte junto a los problemas de formato (`formato_fila` / `formato_campo`).
- **Ids `zerofill`**: `normalizarId` quita los ceros a la izquierda (`000001` = `1`), así la clave de idempotencia no depende de la herramienta del volcado.
- **Códigos del origen**: viven en constantes con nombre (`TIPO_FACTURA_CARGO_UNICO` en Mikrowisp; `ESTADOS_FACTURA`, `ESTADOS_SERVICIO` y `TIPOS_CONTROL` en SmartISP), confirmados con los diagnósticos (`docs/importacion/diagnostico*-*.sql`). Un valor desconocido omite la fila con el valor en el mensaje: nunca se adivina.
- **Trazas para el archivo** (`TrazaOrigen`, `origenes/esquema_sql.ts`): el adaptador dice a qué entidad canónica va cada fila del volcado (`vincular`) o por qué queda solo en el archivo (`soloArchivo`, por fila o tabla); las filas que descarta van por `ProblemasOrigen.omitir`.
- **Contraseñas**: la clave PPPoE (y las credenciales del router) viajan a `CrearServicio` / `CrearRouter`, que las cifran; ningún mensaje del adaptador ni del reporte las lleva (lo comprueba `tests/importacion/mikrowisp.spec.ts`).

Datos de prueba: `scripts/importacion/mikrowisp-sintetico.sql` y `scripts/importacion/smartisp-sintetico.sql` son solo `INSERT` con datos inventados (los casos difíciles de cada uno en su cabecera); el volcado de prueba es la estructura real seguida de esos datos (`tests/importacion/ayudas_importacion.ts`). `scripts/importacion/sintetico-csv/` son los datos de Mikrowisp como CSV canónicos (`generar-csv-sintetico.mts`): el importador da el mismo reporte con los dos.

## Origen `csv`: plantillas

Un directorio con un CSV por entidad en el formato canónico. `pnpm importar:plantillas <directorio>` (o `node ace importar:plantillas`) deja las ocho plantillas con su encabezado y una fila de ejemplo, y un `LEEME.md` con cada columna (generado de `COLUMNAS`, la misma definición que valida). Desde Excel: llenar y "Guardar como → CSV UTF-8".

- UTF-8 (con o sin BOM), separador coma o punto y coma (Excel en español), encabezado en la primera fila, comillas dobles para campos con separador, comillas o saltos de línea (RFC 4180). Los nombres de columna no distinguen mayúsculas y el orden no importa.
- Una columna que no está en el formato se ignora con un **aviso** (un nombre mal escrito no pasa en silencio).
- `routers`, `planes`, `clientes` y `servicios` son obligatorios; `redes`, `facturas`, `saldos` y `pagos`, opcionales.
- Los `id` y las referencias (`cliente_id`, `router_id`, `plan_id`) son los ids del sistema de origen. Columnas en **negrita** son obligatorias; el resto puede ir vacío o faltar. Ejemplos: `scripts/importacion/ejemplo/` (un caso de cada diferencia) y `scripts/importacion/sintetico-csv/`.

| Archivo                   | Columnas                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routers.csv`             | **`id`**, **`nombre`**, **`host`**, **`nas_ip`** (IPv4 con la que el router habla RADIUS; vacía solo con `modo_seguridad` = `api`), `api_usuario`, `api_password`, `radius_secret`, `modo_seguridad` (`radius` por defecto; `api` = router sin RADIUS, PPPoE con `/ppp secret` locales, `contratos/pppoe-local.md`). Sin la columna, todo es `radius` como antes                                                                       |
| `redes.csv` (opcional)    | **`router_id`**, **`cidr`** (`198.19.10.0/24`), `gateway`, `tipo` (`estatico` por defecto, o `pool`)                                                                                                                                                                                                                                                                                                                                   |
| `planes.csv`              | **`id`**, **`nombre`**, **`precio`** (`150.00`, `Q 1,250.50`), **`bajada`**, **`subida`**, `bajada_limitada`, `subida_limitada`, `perfil_ppp`, `pool_ipv4`, `equivale_a`                                                                                                                                                                                                                                                               |
| `clientes.csv`            | **`id`**, **`nombre`**, `tipo` (`persona` o `empresa`), `nit` (NIT, CUI o `CF`), `nombre_fiscal`, `direccion_fiscal`, `email`, `telefono`, `movil`, `direccion`, `coordenadas` (`lat,lng`), `zona` (nombre)                                                                                                                                                                                                                            |
| `servicios.csv`           | **`id`**, **`cliente_id`**, **`router_id`**, **`plan_id`**, `tipo_conexion` (`pppoe` por defecto, `ip_estatica`, `dhcp_fija`), `user_ppp` (**obligatorio en `pppoe`**), `pass_ppp`, `ip` (**obligatoria en `ip_estatica`**), `mac` (**obligatoria en `dhcp_fija`**), `amarre_ip_mac` (`si`/`no`), `direccion`, `coordenadas`, `fecha_instalacion` (`2024-03-15`, `2024-03-15 10:00:00` o `15/03/2024`; `0000-00-00` = vacía), `estado` |
| `facturas.csv` (opcional) | **`id`**, **`cliente_id`**, `servicio_id`, `periodo` (`2026-08`, `08/2026` o `2026-08-01`; vacío = cargo único), **`total`** (0 = sin cargo), `pagado` (lo pendiente = total − pagado), `vence`, `emitida`, `concepto`, `fecha_pago`, `nota`                                                                                                                                                                                           |
| `saldos.csv` (opcional)   | **`cliente_id`**, **`saldo`** (saldo del cliente en el origen al exportar: `150.00` debe, `-20.00` a favor)                                                                                                                                                                                                                                                                                                                            |
| `pagos.csv` (opcional)    | **`id`**, **`cliente_id`** (quien pagó), `factura_id` (puede ser de otro cliente), **`monto`**, `fecha`, `metodo`. Si `facturas.csv` no trae `pagado`, lo pagado de cada factura es la suma de sus pagos                                                                                                                                                                                                                               |
| `promesas.csv` (opcional) | **`id`**, **`cliente_id`**, `factura_id`, **`vence`**, `fecha` (cuándo se hizo), `monto` (vacío: lo pendiente), `descripcion`. Solo las vigentes                                                                                                                                                                                                                                                                                       |

- **`tipo_conexion`** (`contratos/routeros.md`): `pppoe`/`ppp`; `ip_estatica`/`estatica`/`static`; `dhcp_fija`/`dhcp`/`lease`. Sin PPPoE no hay `user_ppp` ni `pass_ppp` (se ignoran si vienen). Una fila `ip_estatica` sin IP o `dhcp_fija` sin MAC válida se omite (importarla le daría al cliente otra IP o un lease sin amarre).
- **Velocidades** en kbps (`10000`) o con unidad (`512k`, `10M`, `1.5M`, `1G`). Sin `bajada_limitada`/`subida_limitada` se usa 512 kbps o la velocidad normal si es menor.
- **MAC**: `aa:bb:cc:dd:ee:ff`, `AA-BB-CC-DD-EE-FF`, `aabb.ccdd.eeff` (Cisco) o `aabbccddeeff`; se guarda `AA:BB:CC:DD:EE:FF`.
- **`plan_id`** vacío o `0`: servicio sin plan (`servicios_sin_plan`), no se importa.
- **Estados**: `activo` (activo, habilitado), `suspendido` (suspendido, cortado, moroso, bloqueado), `retirado` (retirado, cancelado, baja, eliminado). Sin columna: activo.
- **`equivale_a`**: nombre de un plan de ArgosIsp al que se mapea el del origen en lugar de crear uno nuevo.
- **Exportar desde MySQL**: un `SELECT` por archivo con alias a estos nombres de columna y `INTO OUTFILE ... FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'`, o la exportación CSV de phpMyAdmin con encabezados.

Opciones de `node ace importar`:

| Opción                     | Qué hace                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--origen=<origen>`        | `mikrowisp`, `smartisp` o `csv` (obligatoria)                                                                                                                                                                                       |
| `--fuente=<ruta>`          | Volcado `.sql` (mikrowisp, smartisp) o directorio de CSV (csv). Relativa a donde se llamó (obligatoria)                                                                                                                             |
| `--sistema=<nombre>`       | Solo con `csv`: nombre del sistema que exportó los CSV (`[a-z0-9_]`, por defecto `csv`). Es la clave de idempotencia: siempre el mismo para el mismo sistema                                                                        |
| `--dry-run`                | Corre todo en una transacción que se revierte al final. El reporte dice lo que pasaría                                                                                                                                              |
| `--salida=<directorio>`    | Guarda `reporte.md` (para leer), `diferencias.csv` (una línea por diferencia, para filtrar) y `reporte.json`. Ninguno lleva request_id ni horas salvo el JSON: dos corridas en seco sobre la misma base dan el mismo `.md` y `.csv` |
| `--reporte=<archivo>`      | Guarda el reporte completo en JSON (rutas relativas a donde se llamó)                                                                                                                                                               |
| `--ipv6=ninguno\|plan`     | `ninguno` (por defecto): los servicios entran solo con IPv4 (los orígenes no traen IPv6). `plan`: modo IPv6 por defecto del plan (requiere pools IPv6 en el router)                                                                 |
| `--solo-planes-existentes` | No crea planes: mapea por nombre (o `equivale_a`) a planes que ya existen y deja el resto sin equivalente                                                                                                                           |
| `--plantilla=<id>`         | Plantilla de facturación de los servicios nuevos. Sin ella, la única que exista (`plantillaPorDefecto` de A1); con varias, los servicios entran sin plantilla y sus facturas pendientes no se importan (queda en errores)           |

## Qué hace con cada entidad

| Entidad         | Ya importada si…                                                      | Al crear                                                                                                                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router          | existe uno con la misma `nas_ip` (si trae) o el mismo `nombre`        | `CrearRouter` (credenciales cifradas por la acción)                                                                                                                                                                                                                                                                                                   |
| Red IPv4        | existe la misma red en el mismo router                                | `CrearRedIpv4`; si se traslapa con otra, queda en errores                                                                                                                                                                                                                                                                                             |
| Plan            | existe un plan con su `nombre` (o con `equivale_a`)                   | `CrearPlan`, dual stack, `global = false`: solo disponible donde se implementa                                                                                                                                                                                                                                                                        |
| Implementación  | existe (plan, router)                                                 | `ImplementarPlan` con `perfil_ppp` y `pool_ipv4`, una por cada par que usan los servicios                                                                                                                                                                                                                                                             |
| Zona            | existe por nombre                                                     | `CrearZona`                                                                                                                                                                                                                                                                                                                                           |
| Cliente         | `campos_personalizados.<sistema>_id` = id del origen                  | `CrearCliente` con `<sistema>_id` en `campos_personalizados`                                                                                                                                                                                                                                                                                          |
| Servicio PPPoE  | existe el `user_ppp` (sin distinguir mayúsculas) con el mismo cliente | `CrearServicio` con user y clave PPP del origen (la acción cifra la clave), IP fija, MAC, fecha de instalación y la plantilla                                                                                                                                                                                                                         |
| Servicio WISP   | su IP vigente es de un servicio del mismo cliente (sin IP: su MAC)    | `CrearServicio` con `tipo_conexion`, `amarre_ip_mac`, IP y MAC, sin credenciales. Necesita el modelo de A1 (`core.servicios.tipo_conexion`); sin él, queda en `tipos_conexion_pendientes`                                                                                                                                                             |
| Factura         | existe una factura con `clave_externa = <sistema>:factura:<id>`       | `ImportarFacturaPendiente` (A3) por su total (modo B): de periodo en el servicio de la factura (o el único del cliente); sin periodo, sin servicio en ArgosIsp o la segunda del mismo servicio y periodo, **cargo único** (`cargo_unico`, `cliente_id`, `emitida_en`); total 0 = sin cargo; pagada sin ningún pago en el origen = `saldada_en_origen` |
| Pago            | existe un pago con `clave_externa = <sistema>:pago:<id>`              | `RegistrarPagoHistorico` (A3) con la fecha del origen, `historico: true`, el método mapeado (`metodoPago`) y `facturas: [id]` de la factura que cubrió (puede ser de otro cliente)                                                                                                                                                                    |
| Saldo inicial   | existe uno con `clave_externa = <sistema>:saldo:<cliente>`            | `RegistrarSaldoInicial` (A3) por la diferencia entre el saldo del origen y lo que entró (facturas y pagos)                                                                                                                                                                                                                                            |
| Promesa         | existe una con `clave_externa = <sistema>:promesa:<id>`               | `ImportarPromesa` (A3) sobre la factura ya importada, con `vence`, `creada_en` y `monto`, después del saldo inicial. `promesa_vencida`, `sin_deuda` y `promesa_abierta` quedan omitidas con su motivo (no son error)                                                                                                                                  |
| Fila del origen | existe en `importacion.filas_origen` con la misma huella              | `ArchivarFilasOrigen` (`importacion.archivar`) por lotes de 500: solo las nuevas o que cambiaron                                                                                                                                                                                                                                                      |

Por eso es **idempotente**: una segunda corrida no crea nada, no deja auditoría y reporta todo como `existentes`.

**Ids externos.** Antes de las claves naturales, el importador busca en `core.ids_externos (sistema, entidad_tipo, externo_id, entidad_id)` de A1 (`ids_externos.ts`) y, al crear, pasa `externo: { sistema, id }` a `CrearRouter`, `CrearPlan`, `CrearCliente` y `CrearServicio`, que guardan el vínculo en su transacción: así reconoce un router renombrado o con otra IP en el origen. Si la tabla no existe, usa solo las claves naturales y el reporte lo dice (`ids_externos: ninguno`). Las zonas van por nombre. Nunca hay `INSERT` directo.

## Saldos: suma contra el origen

- **Saldo del origen por cliente**: el de `saldos`; si el cliente no está ahí, la suma de sus facturas pendientes.
- **Modo B por defecto** (`contratos/importacion.md`): todos los clientes. El pago histórico de A3 **mueve el libro** (`2.9.01 / CxC + Anticipos`, con la fecha del pago; no toca caja ni bancos), así que todas las facturas entran **por su total**; después, cada pago del origen entra con `RegistrarPagoHistorico` y `facturas: [id]` de la factura que cubrió (sin factura: se aplica a la más antigua o queda a favor); al final, el saldo inicial cubre la diferencia entre el saldo del origen y el que el cliente ya tiene en ArgosIsp (CxC − anticipos), p. ej. un abono que el origen no registró como pago o un saldo a favor.
- **Modo A** solo sin acción de pago histórico (`registrarPagoHistorico: null` en el puerto): las facturas pendientes entran **por lo pendiente**, las pagadas quedan en el archivo y los pagos salen como omitidos.
- Orden dentro de la corrida (contrato): facturas → pagos → saldos iniciales → promesas.
- **Saldo inicial**: `RegistrarSaldoInicial`, positivo = factura de apertura, negativo = anticipo. Una factura sin servicio en ArgosIsp entra así dentro del saldo inicial (`facturas_a_saldo`).
- **Comparación**: al final de la corrida (en seco, antes de revertir) se lee el saldo de cada cliente en ArgosIsp = CxC (`saldoCliente`) − anticipos (`saldoAnticipos`) y se compara con el del origen. El reporte trae `saldos { clientes, suma_origen, suma_importada, diferencia, cuadra }` y `saldos_distintos` cliente por cliente. Lo que no cuadra es lo que no se pudo importar (un cliente inválido, una factura de un cliente que no existe, una acción que falló).
- **Por empresa** (`verificarEmpresas`): después de la comparación, el reporte lee de la base la `empresa_id` de cada factura, pago, promesa y saldo inicial que tocó la corrida y la compara con la esperada; trae `empresas { corrida, por_empresa[] { empresa_id, facturas, pagos, promesas, saldos_iniciales, saldo }, fuera_de_empresa[], suma, cuadra }`. `saldo` es CxC − anticipos de los clientes del cuadre en esa empresa (`saldoClientePorEmpresa`, `saldoAnticipos(trx, cliente, empresa)`); `cuadra` exige que nada creado por la corrida quede fuera de su empresa y que la suma por empresa sea `saldos.suma_importada`. Lo ya importado por una corrida anterior no se mueve: se cuenta en su empresa sin marcarlo. El texto y el Markdown lo muestran en «Empresas».
- Las facturas importadas no cambian el estado del servicio: el corte se aplica en la siguiente evaluación (A3).

## Reporte de diferencias

Encabezado: `origen` (sistema), `fuente` (ruta), `modo`, `request_id`. Por entidad: `origen`, `creados`, `existentes`, `omitidos`. `dinero` (origen, ArgosIsp, diferencia y explicación), `tablas` (cuadre por tabla del origen) y `notas_origen` (p. ej. servicios sin PPPoE por router). Los ids del sistema de origen van en campos `*_origen` (`cliente_origen`, `servicios_origen`...); los de ArgosIsp, sin sufijo. Además:

| Diferencia                              | Qué se hace                                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routers sin credenciales                | Se importan; el reporte dice qué falta (usuario y clave de la API, secreto RADIUS) para cargarlo en el panel                                       |
| Clientes con el mismo NIT               | Se importan todos (son cuentas distintas en el origen); el operador decide si unirlos                                                              |
| Servicios sin plan                      | No se importan; sus facturas van al saldo inicial del cliente, así que el saldo cuadra                                                             |
| Pagos a facturas de otro cliente        | Informativo: el pago se importa a nombre de quien pagó y salda la factura del otro cliente (los dos van en modo B)                                 |
| Pagos sin factura                       | Su factura no entró (sin servicio, cliente faltante): el pago queda a favor del pagador y el saldo inicial lo compensa                             |
| Pagos no importados                     | Sin fecha en el origen (el pago histórico la exige): no entra al historial; el saldo inicial lo compensa                                           |
| IPs duplicadas en el origen             | Se importa el primer servicio del archivo; los demás se omiten                                                                                     |
| IP fuera de las redes del router        | El servicio se omite (importarlo sin IP le daría otra al cliente)                                                                                  |
| IP en uso por otro servicio de ArgosIsp | El servicio se omite                                                                                                                               |
| Servicio sin IP                         | Se importa; ArgosIsp le asigna una de las redes del router (se lista cuál)                                                                         |
| Planes sin equivalente                  | Plan que no está en `planes`, cuyo `equivale_a` no existe o que no se pudo crear; sus servicios se omiten                                          |
| Clientes sin NIT                        | Se importan sin NIT                                                                                                                                |
| NIT inválidos                           | Se importan sin NIT; el valor original queda en `campos_personalizados.<sistema>_nit` para corregirlo                                              |
| Teléfonos (`telefono`, `movil`)         | `CrearCliente` los normaliza con `#core/telefonos` (`5512-3344` → `+502 5512-3344`). Los que no cumplen la regla se importan **tal cual** (recortados; canal `consola`, no rechaza el cliente) y salen en `telefonos_invalidos` (`telefono_invalido` en el reporte), para corregirlos en el origen o en el panel |
| `user_ppp` duplicados                   | En el origen: se importa el primero. En ArgosIsp con otro cliente: se omite                                                                        |
| Suspendidos en el origen                | Se importan activos; el corte se aplicará con las facturas (A3)                                                                                    |
| Retirados en el origen                  | No se importan                                                                                                                                     |
| Referencias faltantes                   | Servicio cuyo cliente, router o plan no está o no se pudo importar: se omite                                                                       |
| Formato                                 | Fila omitida (falta un dato obligatorio, IP o red mal escrita) o campo descartado con aviso (correo, coordenadas, MAC, fecha, columna desconocida) |
| Servicios sin PPPoE pendientes          | `ip_estatica` / `dhcp_fija` mientras ArgosIsp no tenga `tipo_conexion` (modelo de A1): no se importan                                              |
| Facturas a saldo                        | Factura sin servicio en ArgosIsp (no se importó o el cliente tiene varios y la factura no dice cuál): su monto va al saldo inicial                 |
| Cargos únicos                           | Factura sin periodo (tipo 1 de Mikrowisp), sin servicio en ArgosIsp o la segunda del mismo servicio y periodo: entra como cargo único con su nota  |
| Facturas sin cargo                      | Total 0 (SmartISP status 2): entra pagada, sin asiento                                                                                             |
| Saldadas en el origen                   | Pagada y ningún pago del origen la cubre: entra `saldada_en_origen` (pagada, sin asiento ni pago)                                                  |
| Promesas no importadas                  | Vencida, sin deuda, el servicio ya tiene una abierta, o su factura no entró: queda en el archivo con el motivo                                     |
| Saldos distintos                        | Cliente cuyo saldo en ArgosIsp no es el del origen, con la diferencia                                                                              |
| Errores                                 | Lo que rechazó una acción de dominio, con su mensaje                                                                                               |

## Reporte en Markdown y CSV

`reporte_salidas.ts` convierte el reporte en **una línea por diferencia**: `entidad`, `id_origen`, `tipo` (código estable), `gravedad` (`error`, `omitido`, `aviso`, `info`), `detalle`, `causa` y `accion` (qué corregir en el origen). El Markdown agrupa por entidad (router, red, plan, cliente, servicio, factura, pago, saldo); el CSV es la misma tabla, UTF-8 con BOM para Excel.

## Carga financiera (A3) detrás de un puerto

Las facturas, los saldos iniciales y los pagos históricos pasan por `CargaFinanciera` (`carga_financiera.ts`), no por las acciones directamente. El adaptador `cargaFinancieraA3` usa `ImportarFacturaPendiente`, `RegistrarSaldoInicial` y `RegistrarPagoHistorico` (contrato en `.claude/integration/contratos/importacion.md`). Para no auditar en la segunda corrida, el importador consulta antes (solo lectura) `billing.facturas`, `billing.saldos_iniciales` y `billing.pagos` por `(origen, clave_externa)`; cada acción recibe `origen` = el sistema de la corrida y el `id_externo` con el mismo formato de siempre (`<sistema>:factura:<id>`…), para que lo ya importado se siga reconociendo.

- Una fecha de pago en un mes cerrado del libro termina en `errores` (422 `periodo_cerrado` de A3) y el saldo de ese cliente no cuadra: importar antes de cerrar el primer mes, o reabrir el mes (ver el contrato).
- Forma de pago del origen → `METODOS_PAGO` con `metodoPago` (`efectivo` → `caja`, `depósito`/`boleta` → `deposito`, `transferencia`, `tarjeta` → `debito`, `en línea`/`PayPal` → `pasarela`; lo desconocido, `caja`). El texto original queda en la nota del pago.

## Transacción y auditoría

- Una sola transacción para toda la corrida; cada acción en su savepoint. Si una acción falla, se revierte solo esa entidad y se sigue con las demás. En seco, la transacción se revierte al final; en real, se confirma al final.
- Todas las acciones de una corrida comparten el `request_id` `importacion-<sistema>-<uuid>` (aparece en el reporte), con actor `sistema` y canal `consola`: `audit.acciones` y `audit.outbox` se filtran por él.
- `DomainAction` escribe la auditoría de un error en una transacción aparte, así que un error de una acción queda en `audit.acciones` aunque la corrida sea en seco.

## Pendiente

- Aplicar el estado suspendido del origen: con las facturas, por `evaluarEstadoServicio` en la siguiente evaluación.
- IPv6 y DUID de Mikrowisp (`tblservicios.ipv6`, `ipv6_duid`): el formato canónico no los lleva; hoy salen como aviso (y quedan en el archivo).
- Multiempresa: el mapa por zona o router en el archivo de origen (contrato `multiempresa.md`); hoy una corrida = una empresa.

## Eventos

No consume. Emite, por las acciones que llama, `servicio.creado` y `asignacion.cambiada` por servicio. Las acciones de facturas, pagos, saldos y promesas de A3 no emiten eventos (no notifican: es carga histórica), ni `ArchivarFilasOrigen`.

## Archivos

| Archivo                                | Qué es                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `canonico.ts`                          | Formato canónico: tipos, `COLUMNAS` (única definición del formato) y `normalizarFuente` (validación) |
| `origenes/index.ts`                    | `ADAPTADORES` y `leerOrigen(origen, ruta)`                                                           |
| `origenes/mikrowisp.ts`                | Adaptador Mikrowisp 6: tablas y columnas reales y su traducción al formato canónico                  |
| `origenes/smartisp.ts`                 | Adaptador SmartISP: tablas y columnas reales y su traducción al formato canónico                     |
| `origenes/csv.ts`                      | Adaptador CSV: lee el directorio, avisa de columnas desconocidas, genera plantillas y LEEME          |
| `origenes/esquema_sql.ts`              | Comprobación del esquema de un volcado (`EsquemaIncompleto`), ids, montos, problemas del origen      |
| `montos.ts`                            | Lectura de montos sin ambigüedad (`leerMonto`) y `--decimal` (`parsearFormatoDecimal`)               |
| `csv.ts`                               | Lector y escritor de CSV (RFC 4180, coma o punto y coma)                                             |
| `mysql_dump.ts`                        | Lector de volcados MySQL (CREATE TABLE e INSERT), sin MySQL                                          |
| `carga_financiera.ts`                  | Puerto hacia las acciones de carga histórica de A3                                                   |
| `archivo.ts`                           | Archivo del origen y cuadre por tabla (`archivarYCuadrar`, `FilasSinContar`, `enmascararFila`)       |
| `actions/archivar_filas_origen.ts`     | `ArchivarFilasOrigen` (`importacion.archivar`): escribe un lote en `importacion.filas_origen`        |
| `ids_externos.ts`                      | Interfaz `IdsExternos` y lectura de `core.ids_externos` por sistema                                  |
| `importador.ts`                        | Núcleo: `importar(fuente, { sistema, ... })` orquesta las acciones y arma el reporte                 |
| `reporte.ts`                           | Tipos del reporte y versión en texto                                                                 |
| `reporte_salidas.ts`                   | Reporte en Markdown y CSV, una línea por diferencia                                                  |
| `commands/importar.ts`                 | `node ace importar --origen --fuente` (`pnpm importar` desde la raíz)                                |
| `commands/importar_plantillas.ts`      | `node ace importar:plantillas <dir>` (`pnpm importar:plantillas`)                                    |
| `tests/importacion/montos.spec.ts`     | Montos en todos los formatos y en cada adaptador (CSV, Mikrowisp, SmartISP)                          |
| `tests/importacion/importador.spec.ts` | Pruebas con el ejemplo CSV (`scripts/importacion/ejemplo/`)                                          |
| `tests/importacion/mikrowisp.spec.ts`  | Volcado sintético sobre el esquema real: dos en seco iguales, real dos veces sin duplicar, saldos    |
| `tests/importacion/smartisp.spec.ts`   | Lo mismo con el volcado sintético de SmartISP sobre su esquema real                                  |
| `tests/importacion/origenes.spec.ts`   | Esquemas reales, CSV = Mikrowisp con los mismos datos, idempotencia por origen, plantillas           |
| `tests/importacion/archivo.spec.ts`    | Archivo del origen: credenciales enmascaradas, fila sin contar = la corrida falla, fila que cambia   |
