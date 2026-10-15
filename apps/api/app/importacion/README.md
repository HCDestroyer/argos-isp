# importacion · importador desde Mikrowisp (A6)

Lleva los datos de un Mikrowisp a ArgosIsp: routers, redes IPv4, planes (y su implementación en cada router), zonas, clientes y servicios PPPoE. Todo se crea **por las acciones de dominio de A1** (`CrearRouter`, `CrearRedIpv4`, `CrearPlan`, `ImplementarPlan`, `CrearZona`, `CrearCliente`, `CrearServicio`), así que queda auditoría y salen los eventos del outbox. Nunca hay `INSERT` directo; las lecturas para decidir (si ya existe, si la IP está libre) sí van directo a la base.

```sh
pnpm importar --dry-run scripts/importacion/ejemplo                     # en seco, reporte en pantalla
pnpm importar --dry-run <directorio> --reporte=reporte.json             # además, el reporte en JSON
pnpm importar <directorio>                                              # real
```

Opciones de `node ace importar:mikrowisp <directorio>`:

| Opción                     | Qué hace                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`                | Corre todo en una transacción que se revierte al final. El reporte dice lo que pasaría                                                                                  |
| `--reporte=<archivo>`      | Guarda el reporte completo en JSON (rutas relativas a donde se llamó)                                                                                                   |
| `--ipv6=ninguno\|plan`     | `ninguno` (por defecto): los servicios entran solo con IPv4, porque Mikrowisp no maneja IPv6. `plan`: modo IPv6 por defecto del plan (requiere pools IPv6 en el router) |
| `--solo-planes-existentes` | No crea planes: mapea por nombre (o `equivale_a`) a planes que ya existen y deja el resto sin equivalente                                                               |

## Formato de entrada

Un directorio con un CSV por entidad: UTF-8 (con o sin BOM), separador coma, encabezado en la primera fila, comillas dobles para campos con coma, comillas o saltos de línea (RFC 4180). Los nombres de columna no distinguen mayúsculas. Los `id` y las referencias (`cliente_id`, `router_id`, `plan_id`) son los ids de Mikrowisp. Columnas en **negrita** son obligatorias; el resto puede ir vacío o faltar. Ejemplo completo, con un caso de cada diferencia, en `scripts/importacion/ejemplo/`.

| Archivo                | Columnas                                                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routers.csv`          | **`id`**, **`nombre`**, **`host`**, **`nas_ip`** (IPv4 con la que el router habla RADIUS), `api_usuario`, `api_password`, `radius_secret`                                                                                                 |
| `redes.csv` (opcional) | **`router_id`**, **`cidr`** (`198.19.10.0/24`), `gateway`, `tipo` (`estatico` por defecto, o `pool`)                                                                                                                                      |
| `planes.csv`           | **`id`**, **`nombre`**, **`precio`** (`150.00`, `Q 1,250.50`), **`bajada`**, **`subida`**, `bajada_limitada`, `subida_limitada`, `perfil_ppp`, `pool_ipv4`, `equivale_a`                                                                  |
| `clientes.csv`         | **`id`**, **`nombre`**, `tipo` (`persona` o `empresa`), `nit` (NIT, CUI o `CF`), `nombre_fiscal`, `direccion_fiscal`, `email`, `telefono`, `movil`, `direccion`, `coordenadas` (`lat,lng`), `zona` (nombre)                               |
| `servicios.csv`        | **`id`**, **`cliente_id`**, **`router_id`**, **`plan_id`**, **`user_ppp`**, `pass_ppp`, `ip`, `mac`, `direccion`, `coordenadas`, `fecha_instalacion` (`2024-03-15`, `2024-03-15 10:00:00` o `15/03/2024`; `0000-00-00` = vacía), `estado` |

- **Velocidades** en kbps (`10000`) o con unidad (`512k`, `10M`, `1.5M`, `1G`). Sin `bajada_limitada`/`subida_limitada` (Mikrowisp no las tiene) se usa 512 kbps o la velocidad normal si es menor.
- **Estados**: `activo` (activo, habilitado), `suspendido` (suspendido, cortado, moroso, bloqueado), `retirado` (retirado, cancelado, baja, eliminado). Sin columna: activo.
- **`equivale_a`**: nombre de un plan de ArgosIsp al que se mapea el de Mikrowisp en lugar de crear uno nuevo.
- **Exportar desde MySQL**: un `SELECT` por archivo con alias a estos nombres de columna y `INTO OUTFILE ... FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'`, o la exportación CSV de phpMyAdmin con encabezados. Las consultas contra el esquema real de Mikrowisp se escriben cuando tengamos la copia de su base (pendiente en `.claude/integration/a6.md`).

## Qué hace con cada entidad

| Entidad        | Ya importada si…                                                      | Al crear                                                                                                       |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Router         | existe uno con la misma `nas_ip` o el mismo `nombre`                  | `CrearRouter` (credenciales cifradas por la acción)                                                            |
| Red IPv4       | existe la misma red en el mismo router                                | `CrearRedIpv4`; si se traslapa con otra, queda en errores                                                      |
| Plan           | existe un plan con su `nombre` (o con `equivale_a`)                   | `CrearPlan`, dual stack, `global = false`: solo disponible donde se implementa                                 |
| Implementación | existe (plan, router)                                                 | `ImplementarPlan` con `perfil_ppp` y `pool_ipv4`, una por cada par que usan los servicios                      |
| Zona           | existe por nombre                                                     | `CrearZona`                                                                                                    |
| Cliente        | `campos_personalizados.mikrowisp_id` = id de Mikrowisp                | `CrearCliente` con `mikrowisp_id` en `campos_personalizados`                                                   |
| Servicio       | existe el `user_ppp` (sin distinguir mayúsculas) con el mismo cliente | `CrearServicio` con user y clave PPP del origen (la acción cifra la clave), IP fija, MAC, fecha de instalación |

Por eso es **idempotente**: una segunda corrida no crea nada y reporta todo como `existentes`.

## Reporte de diferencias

Por entidad: `origen`, `creados`, `existentes`, `omitidos`. Además:

| Diferencia                              | Qué se hace                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
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
| Errores                                 | Lo que rechazó una acción de dominio, con su mensaje                                                                                     |

## Transacción y auditoría

- Una sola transacción para toda la corrida; cada acción en su savepoint. Si una acción falla, se revierte solo esa entidad y se sigue con las demás. En seco, la transacción se revierte al final; en real, se confirma al final.
- Todas las acciones de una corrida comparten el `request_id` `importacion-mikrowisp-<uuid>` (aparece en el reporte), con actor `sistema` y canal `consola`: `audit.acciones` y `audit.outbox` se filtran por él.
- `DomainAction` escribe la auditoría de un error en una transacción aparte, así que un error de una acción queda en `audit.acciones` aunque la corrida sea en seco.

## Pendiente

- Facturas pendientes y saldos por cliente, con la suma de saldos contra la del origen: cuando A3 tenga sus acciones (día 4).
- Aplicar el estado suspendido de Mikrowisp: con las facturas, por `evaluarEstadoServicio`.

## Eventos

No consume. Emite, por las acciones que llama, `servicio.creado` y `asignacion.cambiada` por servicio.

## Archivos

| Archivo                                | Qué es                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `csv.ts`                               | Lector de CSV (RFC 4180)                                                       |
| `fuente.ts`                            | Lee el directorio, valida y normaliza cada fila                                |
| `importador.ts`                        | `importarMikrowisp(fuente, opciones)`: orquesta las acciones y arma el reporte |
| `reporte.ts`                           | Tipos del reporte y versión en texto                                           |
| `commands/importar_mikrowisp.ts`       | Comando `node ace importar:mikrowisp` (`pnpm importar` desde la raíz)          |
| `tests/importacion/importador.spec.ts` | Pruebas con el ejemplo                                                         |
