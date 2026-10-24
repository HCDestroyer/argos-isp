# Runbook · Importación desde otro sistema (Mikrowisp, SmartISP, CSV)

Para el operador que pasa los datos del sistema anterior a ArgosIsp: clientes, routers, planes, servicios, facturas, pagos históricos y saldos. Detalle técnico en `apps/api/app/importacion/README.md`.

La regla es **nunca importar en real sin dos corridas en seco limpias**. La corrida en seco hace todo dentro de una transacción y la revierte al final: no cambia nada en la base, pero el reporte dice exactamente lo que pasaría.

## 0. Elegir el origen

| El ISP usa…                                                | `--origen`  | `--fuente`                           | Qué pedir                                     |
| ---------------------------------------------------------- | ----------- | ------------------------------------ | --------------------------------------------- |
| Mikrowisp                                                  | `mikrowisp` | volcado `.sql` de su base MySQL      | `mysqldump` (abajo)                           |
| SmartISP                                                   | `smartisp`  | volcado `.sql` de su base MySQL      | `mysqldump`; ver la nota de SmartISP          |
| Otro sistema, o uno de los anteriores sin acceso a la base | `csv`       | directorio con las plantillas llenas | exportación a Excel/CSV, una hoja por entidad |

- **Mikrowisp** (versión 6) y **SmartISP**: los adaptadores leen el esquema real de cada sistema. Qué tabla y columna da cada dato, y las preguntas abiertas: `docs/importacion/mapeo-mikrowisp.md` y `docs/importacion/mapeo-smartisp.md`. Antes de tocar la base, el comando compara el volcado con las tablas y columnas que necesita; si falta algo se detiene con la lista completa ("no tiene el esquema que espera el origen mikrowisp:" y una línea por tabla o columna). Casi siempre es que el volcado no es de la base completa: repite el `mysqldump` de abajo. Si la tabla existe con otras columnas (otra versión del sistema), manda el mensaje completo al equipo (A6).
- **CSV**: sirve para cualquier sistema. Ver el paso 0.2.

El origen y el id de cada fila en ese sistema forman la clave para no importar dos veces lo mismo. **Usa siempre el mismo origen para el mismo ISP**: si empezaste con CSV de un Mikrowisp, sigue con `--origen=csv --sistema=mikrowisp` (o pasa al volcado: `mikrowisp` reconoce lo que entró con `--sistema=mikrowisp`). Con otro `--sistema`, todo se crearía de nuevo.

### 0.1 Volcado SQL (Mikrowisp, SmartISP)

Tomado **con el sistema sin cobros en curso** (o fuera de horario), en el servidor del sistema anterior o desde una máquina con acceso a su MySQL/MariaDB. **La base completa**: decisión del PM, "se debe traer todo, para no perder ni dejar volando datos". Cada fila de cada tabla queda en el archivo del origen de ArgosIsp (`importacion.filas_origen`), también las que no tienen equivalente, con a qué registro se llevó o por qué no.

**Mikrowisp 6** (la base suele llamarse `mikrowisp`; MariaDB):

```sh
mysqldump --single-transaction --default-character-set=utf8mb4 --skip-triggers \
    -u <usuario> -p <base> \
    > mikrowisp-AAAAMMDD.sql
```

| Obligatorias para importar                       | Opcionales (sin ellas, ese dato entra vacío)                                                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`, `perfiles`, `usuarios`, `tblservicios` | `nas`, `ipv4` (redes), `tblavisouser` y `zonas` (zona del cliente), `radcheck` (clave PPPoE si falta en el servicio), `facturas`, `facturaitems` (concepto), `operaciones` (pagos), `saldos`, `monedas`, `credito` (promesas) |

**SmartISP** (la base suele llamarse `smartisp`; MySQL 5.7):

```sh
mysqldump --single-transaction --default-character-set=utf8mb4 --skip-triggers \
    -u <usuario> -p <base> \
    > smartisp-AAAAMMDD.sql
```

| Obligatorias para importar                       | Opcionales                                                                                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routers`, `plans`, `clients`, `client_services` | `radius` (secreto RADIUS), `control_routers` (tipo de conexión), `address_routers` (redes), `zone`, `bill_customers` y `bill_customer_item` (facturas), `payment_news` (pagos), `invoices` y `payments` (vienen vacías; si traen filas, el reporte avisa) |

Notas:

- `--skip-triggers` es opcional: el lector ignora los triggers (Mikrowisp trae seis). Con MySQL 8 y un usuario sin privilegio `PROCESS`, agrega `--no-tablespaces`.
- Sin acceso por consola, la exportación SQL de phpMyAdmin o de Adminer sirve igual: formato SQL, **estructura y datos**, todas las tablas.
- **Tablas enormes (`radacct`, `radpostauth`, logs).** Por defecto se importa **todo** (el PM pidió "traer todo"): también entran al archivo del origen (`importacion.filas_origen`), y en un ISP con años de historial `radacct` puede tener millones de filas: la corrida tarda mucho más y la base crece varios GB. Se pueden dejar fuera **del archivo** sin tocar el volcado con `--excluir-tablas=radacct,radpostauth,logs` (nombres de tabla del volcado, separados por coma). Esas tablas no se guardan ni se cuentan en el cuadre por tabla, y el reporte las lista con su número de filas ("tablas excluidas"). Solo se pueden excluir tablas que quedan solo en el archivo: una tabla que se importa (clientes, servicios, facturas…) hace fallar la corrida con el motivo. **Conserva el `.sql` original** (cifrado, fuera del repositorio, con el backup de la migración) como respaldo de lo excluido. La alternativa, sacarlas del volcado con `mysqldump --ignore-table=<base>.radacct`, también sirve, pero entonces el respaldo es otro volcado completo.
- **Montos ilegibles o ambiguos** nunca entran como 0: la fila (factura, pago, saldo a favor) se omite con su motivo y aparece en `diferencias.csv` y en el cuadre por tabla como omitida. Con CSV, `1,50` o `1,250` (una sola coma, sin punto) son ambiguos: corregir el archivo (`1.50`, `1250.00`) o, si el sistema exportó con coma decimal, importar con `--decimal=coma` (o `--decimal=facturas.csv:coma` para un solo archivo). Los volcados MySQL siempre traen punto decimal.
- Para mandar la estructura al equipo sin datos (cuando el comando no reconoce el esquema): el mismo comando con `--no-data`.
- El volcado lleva datos personales y **contraseñas en claro**: claves PPPoE (`tblservicios.ppppass`, `radcheck`, `client_services.pass_hot`), credenciales de los routers (`server.pass`, `routers.password`, que Mikrowisp y SmartISP guardan cifradas y no se importan) y los hashes del portal (`clients.password`). Nunca al repositorio ni por chat: en el servidor de ArgosIsp, con permisos `600`, y se borra al terminar. ArgosIsp cifra las claves PPPoE al importarlas; en el archivo del origen toda credencial queda como `***` y el reporte no las muestra.
- Las dudas de `docs/importacion/mapeo-*.md` ya se resolvieron con los diagnósticos (`docs/importacion/diagnostico*-*.sql`); con otro ISP conviene correrlos de nuevo. La corrida en seco también las delata: un estado o un código desconocido sale como fila omitida con el valor en el mensaje.

### 0.2 Plantillas CSV (cualquier sistema)

```sh
pnpm importar:plantillas /ruta/plantillas
```

Deja `routers.csv`, `redes.csv`, `planes.csv`, `clientes.csv`, `servicios.csv`, `facturas.csv`, `saldos.csv`, `pagos.csv` (encabezado y una fila de ejemplo) y `LEEME.md` con cada columna: obligatoria o no, qué es y un ejemplo.

1. Abre cada plantilla en Excel, **borra la fila de ejemplo** y pega los datos exportados del sistema anterior en las columnas que correspondan. Las columnas que no tengas se quedan vacías o se borran; las obligatorias no.
2. Los `id`, `cliente_id`, `router_id`, `plan_id` y `factura_id` son los ids del sistema anterior, tal cual: con ellos se enlazan los archivos entre sí.
3. Guarda cada hoja como **CSV UTF-8** con el mismo nombre de archivo, todas en un mismo directorio. Coma o punto y coma da igual.
4. `redes`, `facturas`, `saldos` y `pagos` pueden faltar. Sin `saldos.csv`, el saldo de cada cliente es lo pendiente de sus facturas.
5. Pon un nombre corto al sistema para `--sistema` (minúsculas, dígitos y `_`: `wisphub`, `smartisp`, `excel_2026`) y úsalo siempre igual.

Una columna con un nombre que el importador no conoce se ignora y sale como `aviso` en el reporte: revisa esos avisos, suelen ser un encabezado mal escrito.

### 0.3 Antes de la primera corrida

- [ ] **Empresa (multiempresa).** Todo lo importado (servicios, sus facturas, pagos y promesas, la empresa sugerida de las zonas y routers nuevos, la auditoría y el archivo del origen) va a **una** empresa: `--empresa=<id|nit>` (id o NIT, con o sin guion). Con una sola empresa activa no hace falta; con varias, el comando se detiene antes de tocar nada con la lista de empresas. Un ISP con dos NIT en el mismo sistema anterior se importa en dos corridas (un volcado o CSV por empresa), o se corrige después con "Cambiar empresa" del servicio. Si una segunda corrida usa otra empresa, lo ya importado no se mueve y el reporte lo lista en `servicios_otra_empresa`.
- [ ] Backup reciente de ArgosIsp (`infra/backups/respaldar.sh`, ver `docs/runbooks/restaurar-backup.md`).
- [ ] Una plantilla de facturación creada en el panel. Si hay varias, anota el id de la que llevarán los servicios importados (`--plantilla=<id>`).
- [ ] **Ningún mes cerrado en el libro** que caiga en las fechas de los pagos del origen: los pagos históricos entran con su fecha original y un mes cerrado los rechaza (`periodo_cerrado`). Importa antes del primer cierre mensual, o pide a contabilidad reabrir esos meses durante la importación.
- [ ] Historial completo (modo B, por defecto): todas las facturas por su total (también las pagadas, los cargos únicos, las de clientes retirados y las de total 0), todos los pagos con su fecha, las promesas vigentes y un saldo inicial solo para la diferencia. El saldo final de cada cliente es el del origen.
- [ ] El volcado y los CSV tienen datos personales y contraseñas PPPoE: guárdalos fuera del repositorio y bórralos al terminar.

## 1. Corrida en seco

Desde la raíz del repositorio, con el `.env` de la API apuntando a la base destino:

```sh
pnpm importar --origen=mikrowisp --fuente=/ruta/mikrowisp-AAAAMMDD.sql --dry-run --salida=/ruta/reporte-1
pnpm importar --origen=smartisp --fuente=/ruta/smartisp-AAAAMMDD.sql --dry-run --salida=/ruta/reporte-1
pnpm importar --origen=csv --fuente=/ruta/plantillas --sistema=wisphub --dry-run --salida=/ruta/reporte-1
# con varias plantillas de facturación (sin --plantilla, los servicios entran sin ella y sus facturas no se importan):
pnpm importar --origen=mikrowisp --fuente=/ruta/mikrowisp-AAAAMMDD.sql --plantilla=3 --dry-run --salida=/ruta/reporte-1
# con varias empresas: a cuál va todo (id o NIT); y sin guardar radacct en el archivo del origen
pnpm importar --origen=mikrowisp --fuente=/ruta/mikrowisp-AAAAMMDD.sql --empresa=2 --excluir-tablas=radacct --dry-run --salida=/ruta/reporte-1
```

Para practicar sin datos de un ISP, con los volcados sintéticos sobre el esquema real:

```sh
cat scripts/importacion/esquemas/mikrowisp6.sql scripts/importacion/mikrowisp-sintetico.sql > /tmp/mikrowisp.sql
pnpm importar --origen=mikrowisp --fuente=/tmp/mikrowisp.sql --plantilla=<id> --dry-run --salida=/tmp/reporte-mikrowisp
cat scripts/importacion/esquemas/smartisp.sql scripts/importacion/smartisp-sintetico.sql > /tmp/smartisp.sql
pnpm importar --origen=smartisp --fuente=/tmp/smartisp.sql --plantilla=<id> --dry-run --salida=/tmp/reporte-smartisp
```

En Docker: `docker compose -f infra/docker-compose.yml run --rm --no-deps -v /ruta:/datos api node ace.js importar --origen=mikrowisp --fuente=/datos/mikrowisp-AAAAMMDD.sql --dry-run --salida=/datos/reporte-1`.

Si el comando se detiene antes de importar ("no tiene el esquema que espera el origen…", "Falta clientes.csv…", "columna repetida…"), no tocó la base: corrige lo que dice y repite.

Qué revisar primero en el reporte de un volcado de Mikrowisp o SmartISP (son las filas que el adaptador no traduce o traduce con una observación, tipo `formato_fila` / `formato_campo`):

| Mensaje                                                 | Qué significa                                                 | Qué hacer                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `estado "X" desconocido` / `status "X" desconocido`     | El sistema usa un valor que no conocemos                      | Mandarlo al equipo con cuántas filas lo tienen; no corregir a mano |
| `moneda USD: solo se importan … en quetzales`           | Factura o pago en otra moneda (Mikrowisp)                     | Decidir con contabilidad; entra como saldo inicial si hace falta   |
| `tiposervicio "tv"`                                     | Servicio que no es de internet (Mikrowisp)                    | Nada, o cobrarlo en ArgosIsp como cargo aparte                     |
| `tipo_conexion "hotspot"`                               | Router de SmartISP en modo hotspot                            | ArgosIsp no maneja hotspot: queda fuera                            |
| `precio del servicio … distinto al del plan`            | El cliente paga otro precio que el de su plan (Mikrowisp)     | Ajustar el plan o crear uno para esos clientes antes de facturar   |
| `cobrado … y la suma de sus operaciones … no coinciden` | Abono registrado sin pago (Mikrowisp)                         | Revisar con caja; el saldo entra con lo cobrado                    |
| `balance del origen … no coinciden`                     | El saldo que muestra SmartISP no es la suma de sus facturas   | Revisar con caja; entra lo de las facturas                         |
| `IPv6 y DUID del origen no se importan`                 | Servicio con IPv6 en Mikrowisp                                | Configurar el IPv6 en ArgosIsp después                             |
| `invoices trae N filas`                                 | SmartISP tiene facturas en la tabla vieja                     | Confirmar con el ISP cuál usa antes de seguir                      |
| `status … sin paid_on` / `con paid_on`                  | El significado supuesto del estado de factura puede estar mal | Mandarlo al equipo antes de la corrida real                        |

## 2. Leer el reporte

`--salida` deja tres archivos:

| Archivo           | Para qué                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- |
| `reporte.md`      | Leerlo: resumen por entidad, saldos y una tabla por entidad con una fila por diferencia |
| `diferencias.csv` | Filtrarlo en Excel: las mismas filas, una por diferencia                                |
| `reporte.json`    | Guardarlo junto a la corrida (incluye el `request_id`)                                  |

Orden de lectura:

1. **Cuadre por tabla.** Cada tabla del origen: leídas = creadas + existentes + al saldo + solo archivo + omitidas. Si alguna fila no queda contada, la corrida falla antes de guardar nada ("Cuadre por tabla: hay filas del origen que no quedaron…"): avisar al equipo.
2. **Dinero.** Facturado, cobrado, pendiente y pagos del origen contra ArgosIsp, con lo que explica cada diferencia (saldos iniciales, facturas saldadas en el origen sin pago).
3. **Saldos.** "Cuadra" quiere decir que el saldo de cada cliente en ArgosIsp (CxC − anticipos) es el del origen. Si no cuadra, la sección `saldo` lista cada cliente con su diferencia; la causa está en las otras líneas de ese cliente (un servicio que no entró, una acción que falló).
4. **Gravedad `error`**: una acción rechazó el dato o un saldo no cuadra. Hay que corregir antes de la corrida real.
5. **Gravedad `omitido`**: esa fila no entra (queda en el archivo del origen con el motivo). Decide si se corrige en el origen o si está bien que no entre (un retirado, un duplicado).
6. **`aviso`** e **`info`**: entra, con una observación. Revisa que la explicación tenga sentido.

Cada fila dice `id_origen` (id en el sistema anterior), `detalle` (qué pasó), `causa` (por qué) y `accion` (qué hacer).

## 3. Corregir el origen

Se corrige **en el sistema anterior** (o en una copia de su base) y se toma un volcado nuevo, o en las hojas CSV; nunca en ArgosIsp ni editando el volcado a mano. Casos frecuentes:

| Diferencia (`tipo`)              | Qué hacer en el origen                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ip_duplicada`                   | Dejar la IP en un solo servicio; al otro, ponerle la suya o dejarla vacía (ArgosIsp le asigna una)                        |
| `ip_fuera_de_red`                | Registrar la red del router (`redes`) o corregir la IP                                                                    |
| `servicio_sin_plan`              | Asignar el plan. Mientras no lo tenga, su deuda entra como saldo inicial del cliente                                      |
| `plan_sin_equivalente`           | Revisar el plan del servicio; si es un plan viejo, cambiar el servicio a uno vigente                                      |
| `user_ppp_duplicado`             | Cambiar el usuario PPPoE de uno de los dos servicios (y en el equipo del cliente)                                         |
| `nit_duplicado`                  | Si es la misma persona, unir los clientes; si no, corregir el NIT                                                         |
| `nit_invalido`                   | Corregir el NIT (dígito verificador). Entra sin NIT si no se corrige                                                      |
| `router_sin_credenciales`        | No bloquea: cargar usuario, clave de la API y secreto RADIUS en el panel de ArgosIsp después                              |
| `cargo_unico`                    | Nada: la factura entra como cargo único sin periodo (tipo 1 de Mikrowisp, la segunda del mes, o sin servicio en ArgosIsp) |
| `saldada_en_origen`              | Revisar cómo se pagó: entra pagada sin asiento ni pago (no aparece dinero que no se registró)                             |
| `promesa_no_importada`           | Si sigue vigente, registrarla a mano en ArgosIsp                                                                          |
| `pago_cruzado`                   | Confirmar con caja que el pago a la factura de otro cliente fue a propósito (se importa igual y salda esa factura)        |
| `pago_sin_factura`               | No bloquea: la factura que pagó no entró (ver sus líneas); el pago queda a favor y el saldo inicial lo compensa           |
| `pago_no_importado`              | Completar la fecha del pago en el origen si se quiere en el estado de cuenta; el saldo cuadra igual                       |
| `formato_fila` / `formato_campo` | Corregir el dato (correo, coordenadas, MAC, fecha, IP) o el nombre de la columna                                          |
| `error_accion`                   | Leer `causa`; si no se entiende, avisar al equipo con el `reporte.json`                                                   |

Después, **repetir el paso 1** con el volcado o los CSV nuevos en otra carpeta (`reporte-2`) y comparar:

```sh
diff /ruta/reporte-1/diferencias.csv /ruta/reporte-2/diferencias.csv
```

Dos corridas en seco sobre la misma fuente y la misma base dan el mismo `reporte.md` y el mismo `diferencias.csv`; lo que cambie es lo que corregiste.

## 4. Importación real

Cuando dos corridas en seco seguidas dan un reporte aceptable (saldos que cuadran y ningún `error`):

1. Backup de ArgosIsp justo antes.
2. Pausar cobros en el sistema anterior durante la importación (el volcado o los CSV deben ser los últimos).
3. Correr sin `--dry-run`, con la misma fuente y las mismas opciones (incluido `--sistema`) que la última corrida en seco:

    ```sh
    pnpm importar --origen=mikrowisp --fuente=/ruta/mikrowisp-AAAAMMDD.sql --salida=/ruta/reporte-real
    ```

4. Comparar `reporte-real/diferencias.csv` con el de la última corrida en seco: deben ser iguales. El resumen dice `creados` donde en seco decía lo mismo.
5. Revisar en el panel tres clientes al azar: servicios, IP, saldo y facturas.

Todo queda auditado con el `request_id` de la corrida (`importacion-<origen>-<uuid>`, en `reporte.json`): `audit.acciones` y `audit.outbox` se filtran por él.

### Si hay que volver a correr

La importación es **idempotente por origen + id**: reconoce lo ya importado por `core.ids_externos` (sistema e id del origen ↔ id de ArgosIsp) y por la clave externa de facturas y saldos (`<origen>:factura:<id>`). Correrla otra vez con la misma fuente y el mismo origen no duplica nada: todo sale como `existentes`. Sirve para importar lo que faltó tras corregir el origen: solo se crean las filas nuevas.

No sirve para **actualizar** lo ya importado (un cambio de plan o de IP en el origen después de la importación real no se aplica): eso se hace en ArgosIsp.

## 5. Después

- [ ] Los servicios suspendidos en el origen entran activos: el corte lo decide la evaluación con las facturas importadas (cron de corte). Revisar la primera corrida de corte.
- [ ] Migrar los routers al nuevo RADIUS por grupos (`infra/mikrotik/README.md`).
- [ ] Borrar el volcado, los CSV y los reportes con datos personales cuando ya no se necesiten.

## Dudas del origen

Resueltas con los volcados reales de los dos sistemas: estados, seguridad del router y periodo en Mikrowisp; tablas, tipo de control y estados de factura en SmartISP. Las respuestas, con los conteos que las respaldan, están en "Dudas resueltas con los datos reales" de `docs/importacion/mapeo-mikrowisp.md` y `docs/importacion/mapeo-smartisp.md`, y el adaptador ya las aplica. Un volcado de otra instalación puede traer valores que estos no tenían: el adaptador no los adivina, omite la fila con el valor en el mensaje y el reporte lo lista.
