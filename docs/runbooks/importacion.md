# Runbook · Importación desde otro sistema (Mikrowisp, SmartISP, CSV)

Para el operador que pasa los datos del sistema anterior a ArgosIsp: clientes, routers, planes, servicios, facturas pendientes y saldos. Detalle técnico en `apps/api/app/importacion/README.md`.

La regla es **nunca importar en real sin dos corridas en seco limpias**. La corrida en seco hace todo dentro de una transacción y la revierte al final: no cambia nada en la base, pero el reporte dice exactamente lo que pasaría.

## 0. Elegir el origen

| El ISP usa…                                                | `--origen`  | `--fuente`                           | Qué pedir                                     |
| ---------------------------------------------------------- | ----------- | ------------------------------------ | --------------------------------------------- |
| Mikrowisp                                                  | `mikrowisp` | volcado `.sql` de su base MySQL      | `mysqldump` (abajo)                           |
| SmartISP                                                   | `smartisp`  | volcado `.sql` de su base MySQL      | `mysqldump`; ver la nota de SmartISP          |
| Otro sistema, o uno de los anteriores sin acceso a la base | `csv`       | directorio con las plantillas llenas | exportación a Excel/CSV, una hoja por entidad |

- **Mikrowisp**: el esquema del volcado todavía es supuesto (falta el volcado real del primer ISP). Si el comando se detiene con "no tiene el esquema que espera el origen mikrowisp (falta la tabla X; a la tabla Y le faltan las columnas Z)", avisa al equipo (A6) con el mensaje completo; se ajusta `apps/api/app/importacion/origenes/mikrowisp.ts` y nada más. Mientras tanto se puede ir por CSV.
- **SmartISP**: el adaptador es un **esqueleto con un esquema supuesto sin verificar**: con el primer volcado real casi seguro se detendrá con la lista de tablas y columnas que faltan (no toca la base). Manda ese mensaje y el volcado (sin datos, `mysqldump --no-data`, basta para empezar) al equipo. Mientras tanto, usa CSV con `--sistema=smartisp`.
- **CSV**: sirve para cualquier sistema. Ver el paso 0.2.

El origen y el id de cada fila en ese sistema forman la clave para no importar dos veces lo mismo. **Usa siempre el mismo origen para el mismo ISP**: si empezaste con CSV de un Mikrowisp, sigue con `--origen=csv --sistema=mikrowisp` (o pasa al volcado: `mikrowisp` reconoce lo que entró con `--sistema=mikrowisp`). Con otro `--sistema`, todo se crearía de nuevo.

### 0.1 Volcado SQL (Mikrowisp, SmartISP)

Tomado con el sistema sin cobros en curso:

```sh
mysqldump --single-transaction --default-character-set=utf8mb4 -u root -p <base> > origen-AAAAMMDD.sql
```

Si no hay acceso a MySQL, la exportación SQL de phpMyAdmin (todas las tablas, con `CREATE TABLE`) sirve igual.

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

- [ ] Backup reciente de ArgosIsp (`infra/backups/respaldar.sh`, ver `docs/runbooks/restaurar-backup.md`).
- [ ] Una plantilla de facturación creada en el panel. Si hay varias, anota el id de la que llevarán los servicios importados (`--plantilla=<id>`).
- [ ] El volcado y los CSV tienen datos personales y contraseñas PPPoE: guárdalos fuera del repositorio y bórralos al terminar.

## 1. Corrida en seco

Desde la raíz del repositorio, con el `.env` de la API apuntando a la base destino:

```sh
pnpm importar --origen=mikrowisp --fuente=/ruta/origen-AAAAMMDD.sql --dry-run --salida=/ruta/reporte-1
pnpm importar --origen=csv --fuente=/ruta/plantillas --sistema=wisphub --dry-run --salida=/ruta/reporte-1
# con varias plantillas de facturación:
pnpm importar --origen=mikrowisp --fuente=/ruta/origen-AAAAMMDD.sql --plantilla=3 --dry-run --salida=/ruta/reporte-1
```

En Docker: `docker compose -f infra/docker-compose.yml run --rm --no-deps -v /ruta:/datos api node ace.js importar --origen=mikrowisp --fuente=/datos/origen-AAAAMMDD.sql --dry-run --salida=/datos/reporte-1`.

Si el comando se detiene antes de importar ("no tiene el esquema que espera el origen…", "Falta clientes.csv…", "columna repetida…"), no tocó la base: corrige lo que dice y repite.

## 2. Leer el reporte

`--salida` deja tres archivos:

| Archivo           | Para qué                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- |
| `reporte.md`      | Leerlo: resumen por entidad, saldos y una tabla por entidad con una fila por diferencia |
| `diferencias.csv` | Filtrarlo en Excel: las mismas filas, una por diferencia                                |
| `reporte.json`    | Guardarlo junto a la corrida (incluye el `request_id`)                                  |

Orden de lectura:

1. **Saldos.** "Cuadra" quiere decir que la suma de saldos en ArgosIsp es igual a la del origen, cliente por cliente. Si no cuadra, la sección `saldo` lista cada cliente con su diferencia; la causa está en las otras líneas de ese cliente (un servicio que no entró, una acción que falló).
2. **Gravedad `error`**: una acción rechazó el dato o un saldo no cuadra. Hay que corregir antes de la corrida real.
3. **Gravedad `omitido`**: esa fila no entra. Decide si se corrige en el origen o si está bien que no entre (un retirado, un duplicado).
4. **`aviso`** e **`info`**: entra, con una observación. Revisa que la explicación tenga sentido.

Cada fila dice `id_origen` (id en el sistema anterior), `detalle` (qué pasó), `causa` (por qué) y `accion` (qué hacer).

## 3. Corregir el origen

Se corrige **en el sistema anterior** (o en una copia de su base) y se toma un volcado nuevo, o en las hojas CSV; nunca en ArgosIsp ni editando el volcado a mano. Casos frecuentes:

| Diferencia (`tipo`)              | Qué hacer en el origen                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ip_duplicada`                   | Dejar la IP en un solo servicio; al otro, ponerle la suya o dejarla vacía (ArgosIsp le asigna una)                                                   |
| `ip_fuera_de_red`                | Registrar la red del router (`redes`) o corregir la IP                                                                                               |
| `servicio_sin_plan`              | Asignar el plan. Mientras no lo tenga, su deuda entra como saldo inicial del cliente                                                                 |
| `plan_sin_equivalente`           | Revisar el plan del servicio; si es un plan viejo, cambiar el servicio a uno vigente                                                                 |
| `user_ppp_duplicado`             | Cambiar el usuario PPPoE de uno de los dos servicios (y en el equipo del cliente)                                                                    |
| `nit_duplicado`                  | Si es la misma persona, unir los clientes; si no, corregir el NIT                                                                                    |
| `nit_invalido`                   | Corregir el NIT (dígito verificador). Entra sin NIT si no se corrige                                                                                 |
| `router_sin_credenciales`        | No bloquea: cargar usuario, clave de la API y secreto RADIUS en el panel de ArgosIsp después                                                         |
| `factura_a_saldo`                | No bloquea: el monto entra en el saldo inicial. Para que entre como factura, el cliente debe tener un solo servicio (o la factura, su `servicio_id`) |
| `pago_cruzado`                   | Confirmar con caja que el pago a la factura de otro cliente fue a propósito                                                                          |
| `formato_fila` / `formato_campo` | Corregir el dato (correo, coordenadas, MAC, fecha, IP) o el nombre de la columna                                                                     |
| `error_accion`                   | Leer `causa`; si no se entiende, avisar al equipo con el `reporte.json`                                                                              |

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
    pnpm importar --origen=mikrowisp --fuente=/ruta/origen-AAAAMMDD.sql --salida=/ruta/reporte-real
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

## Pendiente

- El esquema de Mikrowisp es supuesto hasta que llegue la copia real de la base del ISP.
- El adaptador de SmartISP es un esqueleto: falta un volcado real.
- Pagos históricos: no se importan todavía. No cambia saldos: lo pendiente de cada factura ya descuenta lo pagado.
