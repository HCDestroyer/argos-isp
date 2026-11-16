---
orden: 5
---

# Runbook · Restaurar un respaldo

Para el operador que necesita recuperar la base de ArgosIsp o comprobar que los respaldos sirven. Cómo se hacen los respaldos (hora, retención, cifrado, copia remota, dónde quedan): [Respaldos](./respaldos.md); detalle técnico en `infra/README.md`, "Respaldos".

- **Servidor instalado con `instalar.sh`** (lo normal): la sección «En un servidor instalado», abajo. Los comandos van con `sudo argosisp compose …`.
- **Compose de desarrollo o laboratorio** (`infra/docker-compose.yml`, con `infra/.env`): las secciones 1 a 3.

## Qué hay en cada respaldo

En `BACKUP_HOST_DIR` (disco externo o NFS) y, si está configurado, en el remoto de rclone:

| Archivo                                                                           | Qué es                                                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `argosisp-<AAAAMMDDTHHMMSSZ>.dump[.age]`                                          | `pg_dump` de toda la base (cifrado con age si hay `BACKUP_AGE_RECIPIENTS`) |
| `….sha256`                                                                        | Suma para detectar un archivo dañado                                       |
| `….dump.conteos`                                                                  | Filas por tabla según el propio dump (`restaurar.sh` las compara)          |
| `argosisp-<marca>.comprobantes.tar.gz[.age]` + `.sha256` + `.comprobantes.conteo` | Archivos de los comprobantes de depósito                                   |

Redis no se respalda: colas y streams se reconstruyen (el relay republica lo que quedó en `audit.outbox` y los crons procesan lo pendiente).

## En un servidor instalado

Respaldos en `/opt/argosisp/respaldos/` (o tu `BACKUP_HOST_DIR`, que dentro del contenedor es `/backups`); la clave privada de un respaldo cifrado va, solo mientras restauras, en `/opt/argosisp/respaldos-config/age.key`.

### Probar un respaldo sin tocar producción

Restaura en una base aparte del mismo servidor: [Respaldos](./respaldos.md#probar-que-un-respaldo-se-puede-restaurar).

### Volver la base de producción a un respaldo (mismo servidor)

Por ejemplo, la base quedó dañada. Todo lo registrado después de la hora del respaldo se pierde.

1. **Avisar** al equipo: el panel, el portal y RADIUS quedan fuera de línea unos minutos. Los clientes conectados siguen navegando.
2. **Detener la aplicación**, dejando arriba Postgres, Redis y el servicio de respaldos:

    ```sh
    sudo argosisp compose stop $(sudo argosisp compose config --services | grep -vxE 'postgres|redis|backup|permisos')
    ```

3. **Restaurar** (borra y recrea la base `argosisp`, verifica filas y comprobantes):

    ```sh
    sudo argosisp compose run --rm backup restaurar.sh /backups/argosisp-<marca>.dump.age       --base argosisp --reemplazar --comprobantes-dir /comprobantes
    ```

    Si termina con error, **no sigas**: el mensaje dice qué tabla o archivo no coincide. Prueba con el respaldo anterior.

4. **Levantar** (las migraciones se ponen al día con la versión instalada) y repoblar la caché de RADIUS:

    ```sh
    sudo argosisp levantar
    sudo argosisp compose exec api node ace.js aaa:repoblar --forzar
    sudo rm -f /opt/argosisp/respaldos-config/age.key
    ```

5. **Comprobar** y revisar **lo perdido** como en los pasos 6 y 7 de la sección 2.

Para deshacer una actualización reciente, no hace falta esto: `sudo argosisp revertir` restaura el respaldo previo a la actualización ([Actualizar y revertir](./actualizacion.md)).

### Servidor nuevo (el anterior se perdió)

1. Instala **la misma versión** que tenía el servidor perdido (o una más nueva, nunca más vieja): `instalar.sh --version X.Y.Z` ([Instalar](./instalacion.md)).
2. Copia el respaldo (dump, tar de comprobantes y sus `.sha256`, `.conteos` y `.comprobantes.conteo`) a `/opt/argosisp/respaldos/` y, si está cifrado, la clave a `/opt/argosisp/respaldos-config/age.key`.
3. Detén la aplicación y restaura con los pasos 2 y 3 de arriba.
4. En `/opt/argosisp/.env` del servidor nuevo, pon `APP_KEY` y `AAA_PPP_KEY` **del `.env` del servidor perdido** (la copia que guardaste fuera): con ellas se cifraron las contraseñas PPPoE, los secretos RADIUS y las credenciales guardadas. Deja las contraseñas de Postgres del servidor nuevo.
5. Sigue con los pasos 4 y 5 de arriba y corre `sudo argosisp radius-clientes`. Si los routers se conectaban por WireGuard: la clave del túnel del servidor nuevo es otra (se genera al instalar), así que cada router necesita un script de conexión nuevo desde su ficha ([MikroTik](./mikrotik.md#conectar-un-router)). Revisa con `sudo argosisp estado` y la ficha de cada router que vuelvan a quedar conectados.

::: warning
El camino de «servidor nuevo» no tiene una prueba automática de punta a punta en un servidor instalado. Ensáyalo una vez en una máquina de prueba antes de necesitarlo, y anota aquí el tiempo que tomó.
:::

## 1. Ensayo (sin tocar producción) · una vez al mes y tras cambiar algo de respaldos

```sh
infra/backups/ensayo.sh                                   # el respaldo más reciente de BACKUP_HOST_DIR
infra/backups/ensayo.sh /ruta/argosisp-20261016T031300Z.dump.age
ENSAYO_EMAIL=operador@isp.example ENSAYO_PASSWORD=… infra/backups/ensayo.sh
```

Levanta un compose **limpio** en un proyecto aparte (`argosisp-ensayo-<n>`, volúmenes propios), restaura el respaldo con `restaurar.sh` (sha256, filas de cada tabla iguales al dump, comprobantes), levanta `migrate` y la API, y hace un smoke test: login, lista de clientes y estado de cuenta del primer cliente. Imprime los tiempos y borra todo. Nunca toca el proyecto `argosisp`.

- El usuario del smoke test tiene que existir en el respaldo (`ENSAYO_EMAIL`/`ENSAYO_PASSWORD`; por defecto `SEED_ADMIN_*` de `infra/.env`).
- Si el respaldo está cifrado, la clave privada va en `infra/backups/config/age.key` **solo durante el ensayo**; bórrala al terminar.
- Usa `infra/.env` (mismas claves que producción). Sin él, `infra/.env.example` con claves de un solo uso: sirve para el ensayo, pero las contraseñas PPPoE y secretos de routers cifrados con la clave real no se podrán leer.
- `--conservar` deja el entorno levantado (API en `127.0.0.1:3399`) para revisarlo a mano. `--demo` no necesita respaldo: crea un "producción" con `pnpm demo:datos`, lo respalda y lo restaura (es lo que corre CI).

**Último ensayo** (2026-10-16, `--demo`, código de `agente/a6-infra`): 107 tablas y 1 027 filas iguales al dump, `migrate` "Already up to date", login 200, 8 clientes, estado de cuenta 200.

| Paso                                       |   Tiempo |
| ------------------------------------------ | -------: |
| Postgres limpio                            |      6 s |
| `restaurar.sh` (verificado)                |      4 s |
| `migrate` + API sana                       |     12 s |
| Smoke test                                 |      1 s |
| **Restauración hasta la API respondiendo** | **23 s** |

Con la base real el paso de `restaurar.sh` crece con el tamaño del dump; anota aquí el tiempo de cada ensayo para saber cuánto dura una restauración de verdad.

## 2. Desastre: restaurar producción en un entorno limpio

Servidor nuevo o volumen de Postgres perdido. Tiempo esperado: el del último ensayo más copiar el respaldo.

1. **Avisar** al equipo: el sistema queda fuera de línea. Los clientes conectados siguen navegando (RADIUS no se toca); las altas, pagos y cortes esperan.
2. **Copiar** el respaldo más reciente (dump, tar de comprobantes y sus `.sha256`/`.conteos`/`.conteo`) a `BACKUP_HOST_DIR`. Si es `.age`, la clave privada a `infra/backups/config/age.key`. `infra/.env` debe ser el de producción (sobre todo `APP_KEY`, `AAA_PPP_KEY`, `AAA_INTERNAL_TOKEN` y las contraseñas de Postgres).
3. **Postgres limpio** (crea schemas y roles con `init.sql` y `usuarios.sh`):

    ```sh
    docker compose -f infra/docker-compose.yml up -d --wait postgres
    ```

4. **Restaurar** (borra y recrea la base `argosisp`, verifica filas y comprobantes):

    ```sh
    docker compose -f infra/docker-compose.yml run --rm --no-deps backup \
      restaurar.sh /backups/argosisp-<marca>.dump.age --base argosisp --reemplazar --comprobantes-dir /comprobantes
    ```

    Si termina con error, **no sigas**: el mensaje dice qué tabla o archivo no coincide. Prueba con el respaldo anterior.

5. **Levantar todo** (`migrate` pone las migraciones al día con el código actual):

    ```sh
    docker compose -f infra/docker-compose.yml up -d --wait
    rm infra/backups/config/age.key
    ```

6. **Comprobar**: login en el panel, un cliente con su estado de cuenta, `docker compose -f infra/docker-compose.yml ps` todo `healthy`, y en Alertmanager/Telegram que no queden alertas abiertas.
7. **Lo perdido**: todo lo ocurrido entre la hora del respaldo y la caída. Revisar con caja los pagos de ese intervalo y volver a registrarlos; los cortes y reactivaciones los recalcula el cron.

## 3. Restaurar solo para consultar (base aparte, mismo servidor)

Para ver datos de un día anterior sin tocar producción:

```sh
docker compose -f infra/docker-compose.yml run --rm backup \
  restaurar.sh /backups/argosisp-<marca>.dump.age --base argosisp_consulta
# … consultar con psql …
docker compose -f infra/docker-compose.yml exec postgres psql -U argosisp -c 'DROP DATABASE argosisp_consulta'
```

## Si algo falla

| Síntoma                              | Causa probable                                          | Qué hacer                                                           |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------- |
| `la suma sha256 … no coincide`       | Archivo dañado en la copia                              | Usar la copia remota (rclone) o el respaldo anterior                |
| `Falta BACKUP_AGE_IDENTITY`          | Respaldo cifrado sin clave                              | Copiar `age.key` a `infra/backups/config/`                          |
| `falta el rol argosisp_owner`        | Postgres no se creó desde cero                          | `down -v` del volumen de Postgres y repetir el paso 3               |
| `las filas restauradas no coinciden` | Restauración incompleta                                 | No usar esa base; repetir o usar otro respaldo                      |
| `migrate` falla                      | Respaldo de un código más nuevo que el desplegado       | Desplegar la versión del código del día del respaldo                |
| La API no queda `healthy`            | Variables de `infra/.env` distintas a las de producción | Revisar `APP_KEY`, `AAA_PPP_KEY`, `AAA_INTERNAL_TOKEN`, contraseñas |
