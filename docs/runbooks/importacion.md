# Runbook · Importación desde Mikrowisp

Para el operador que pasa los datos de Mikrowisp a ArgosIsp: clientes, routers, planes, servicios, facturas pendientes y saldos. Detalle técnico en `apps/api/app/importacion/README.md`.

La regla es **nunca importar en real sin dos corridas en seco limpias**. La corrida en seco hace todo dentro de una transacción y la revierte al final: no cambia nada en la base, pero el reporte dice exactamente lo que pasaría.

## 0. Antes de empezar

- [ ] Backup reciente de ArgosIsp (`infra/backups/respaldar.sh`, ver `docs/runbooks/restaurar-backup.md`).
- [ ] Una plantilla de facturación creada en el panel. Si hay varias, anota el id de la que llevarán los servicios importados (`--plantilla=<id>`).
- [ ] Volcado de la base de Mikrowisp, tomado con Mikrowisp sin cobros en curso:

    ```sh
    mysqldump --single-transaction --default-character-set=utf8mb4 -u root -p mikrowisp > mikrowisp-AAAAMMDD.sql
    ```

    Si no hay acceso a MySQL, la exportación SQL de phpMyAdmin (todas las tablas, con `CREATE TABLE`) sirve igual.

- [ ] El volcado tiene datos personales y contraseñas PPPoE: guárdalo fuera del repositorio y bórralo al terminar.

## 1. Corrida en seco

Desde la raíz del repositorio, con el `.env` de la API apuntando a la base destino:

```sh
pnpm importar --dry-run /ruta/mikrowisp-AAAAMMDD.sql --salida=/ruta/reporte-1
# con varias plantillas:
pnpm importar --dry-run /ruta/mikrowisp-AAAAMMDD.sql --plantilla=3 --salida=/ruta/reporte-1
```

En Docker: `docker compose -f infra/docker-compose.yml run --rm --no-deps -v /ruta:/datos api node ace.js importar:mikrowisp --dry-run /datos/mikrowisp-AAAAMMDD.sql --salida=/datos/reporte-1`.

Si el comando se detiene con "falta la tabla X" o "le faltan las columnas Y", el esquema de ese Mikrowisp no es el supuesto: avisa al equipo (A6) con el mensaje; se ajusta `apps/api/app/importacion/mikrowisp_sql.ts` y nada más.

También acepta un directorio con un CSV por entidad (formato en el README del módulo), para cuando los datos vienen de otra exportación.

## 2. Leer el reporte

`--salida` deja tres archivos:

| Archivo           | Para qué                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- |
| `reporte.md`      | Leerlo: resumen por entidad, saldos y una tabla por entidad con una fila por diferencia |
| `diferencias.csv` | Filtrarlo en Excel: las mismas filas, una por diferencia                                |
| `reporte.json`    | Guardarlo junto a la corrida (incluye el `request_id`)                                  |

Orden de lectura:

1. **Saldos.** "Cuadra" quiere decir que la suma de saldos en ArgosIsp es igual a la de Mikrowisp, cliente por cliente. Si no cuadra, la sección `saldo` lista cada cliente con su diferencia; la causa está en las otras líneas de ese cliente (un servicio que no entró, una acción que falló).
2. **Gravedad `error`**: una acción rechazó el dato o un saldo no cuadra. Hay que corregir antes de la corrida real.
3. **Gravedad `omitido`**: esa fila no entra. Decide si se corrige en el origen o si está bien que no entre (un retirado, un duplicado).
4. **`aviso`** e **`info`**: entra, con una observación. Revisa que la explicación tenga sentido.

Cada fila dice `detalle` (qué pasó), `causa` (por qué) y `accion` (qué hacer).

## 3. Corregir el origen

Se corrige **en Mikrowisp** (o en una copia de su base), nunca en ArgosIsp ni editando el volcado a mano, y se toma un volcado nuevo. Casos frecuentes:

| Diferencia (`tipo`)              | Qué hacer en Mikrowisp                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ip_duplicada`                   | Dejar la IP en un solo servicio; al otro, ponerle la suya o dejarla vacía (ArgosIsp le asigna una)                  |
| `ip_fuera_de_red`                | Registrar la red del router o corregir la IP                                                                        |
| `servicio_sin_plan`              | Asignar el plan. Mientras no lo tenga, su deuda entra como saldo inicial del cliente                                |
| `plan_sin_equivalente`           | Revisar el plan del servicio; si es un plan viejo, cambiar el servicio a uno vigente                                |
| `user_ppp_duplicado`             | Cambiar el usuario PPPoE de uno de los dos servicios (y en el equipo del cliente)                                   |
| `nit_duplicado`                  | Si es la misma persona, unir los clientes; si no, corregir el NIT                                                   |
| `nit_invalido`                   | Corregir el NIT (dígito verificador). Entra sin NIT si no se corrige                                                |
| `router_sin_credenciales`        | No bloquea: cargar usuario, clave de la API y secreto RADIUS en el panel de ArgosIsp después                        |
| `factura_a_saldo`                | No bloquea: el monto entra en el saldo inicial. Para que entre como factura, el cliente debe tener un solo servicio |
| `pago_cruzado`                   | Confirmar con caja que el pago a la factura de otro cliente fue a propósito                                         |
| `formato_fila` / `formato_campo` | Corregir el dato (correo, coordenadas, MAC, fecha, IP)                                                              |
| `error_accion`                   | Leer `causa`; si no se entiende, avisar al equipo con el `reporte.json`                                             |

Después, **repetir el paso 1** con el volcado nuevo en otra carpeta (`reporte-2`) y comparar:

```sh
diff /ruta/reporte-1/diferencias.csv /ruta/reporte-2/diferencias.csv
```

Dos corridas en seco sobre el mismo volcado y la misma base dan el mismo `reporte.md` y el mismo `diferencias.csv`; lo que cambie es lo que corregiste.

## 4. Importación real

Cuando dos corridas en seco seguidas dan un reporte aceptable (saldos que cuadran y ningún `error`):

1. Backup de ArgosIsp justo antes.
2. Pausar cobros en Mikrowisp durante la importación (el volcado debe ser el último).
3. Correr sin `--dry-run`, con el mismo volcado y las mismas opciones que la última corrida en seco:

    ```sh
    pnpm importar /ruta/mikrowisp-AAAAMMDD.sql --salida=/ruta/reporte-real
    ```

4. Comparar `reporte-real/diferencias.csv` con el de la última corrida en seco: deben ser iguales. El resumen dice `creados` donde en seco decía lo mismo.
5. Revisar en el panel tres clientes al azar: servicios, IP, saldo y facturas.

Todo queda auditado con el `request_id` de la corrida (`importacion-mikrowisp-<uuid>`, en `reporte.json`): `audit.acciones` y `audit.outbox` se filtran por él.

### Si hay que volver a correr

La importación es **idempotente**: reconoce lo ya importado por `core.ids_externos` (id de Mikrowisp ↔ id de ArgosIsp) y por la clave externa de facturas y saldos. Correrla otra vez con el mismo volcado no duplica nada: todo sale como `existentes`. Sirve para importar lo que faltó tras corregir el origen: solo se crean las filas nuevas.

No sirve para **actualizar** lo ya importado (un cambio de plan o de IP en Mikrowisp después de la importación real no se aplica): eso se hace en ArgosIsp.

## 5. Después

- [ ] Los servicios suspendidos en Mikrowisp entran activos: el corte lo decide la evaluación con las facturas importadas (cron de corte). Revisar la primera corrida de corte.
- [ ] Migrar los routers al nuevo RADIUS por grupos (`infra/mikrotik/README.md`).
- [ ] Borrar el volcado y los reportes con datos personales cuando ya no se necesiten.

## Pendiente

- El esquema del volcado es supuesto hasta que llegue la copia real de la base del ISP.
- Pagos históricos: no se importan hasta que A3 publique la acción de pago histórico. No cambia saldos: lo pendiente de cada factura ya descuenta lo pagado.
