# Runbook · Restaurar un respaldo

Para el operador que necesita recuperar la base de ArgosIsp o comprobar que los respaldos sirven. Detalle de los respaldos (hora, retención, cifrado, copia remota) en `infra/README.md`, "Respaldos".

## Qué hay en cada respaldo

En `BACKUP_HOST_DIR` (disco externo o NFS) y, si está configurado, en el remoto de rclone:

| Archivo | Qué es |
| --- | --- |
| `argosisp-<AAAAMMDDTHHMMSSZ>.dump[.age]` | `pg_dump` de toda la base (cifrado con age si hay `BACKUP_AGE_RECIPIENTS`) |
| `….sha256` | Suma para detectar un archivo dañado |
| `….dump.conteos` | Filas por tabla según el propio dump (`restaurar.sh` las compara) |
| `argosisp-<marca>.comprobantes.tar.gz[.age]` + `.sha256` + `.comprobantes.conteo` | Archivos de los comprobantes de depósito |

Redis no se respalda: colas y streams se reconstruyen (el relay republica lo que quedó en `audit.outbox` y los crons procesan lo pendiente).

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

| Paso | Tiempo |
| --- | ---: |
| Postgres limpio | 6 s |
| `restaurar.sh` (verificado) | 4 s |
| `migrate` + API sana | 12 s |
| Smoke test | 1 s |
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

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| `la suma sha256 … no coincide` | Archivo dañado en la copia | Usar la copia remota (rclone) o el respaldo anterior |
| `Falta BACKUP_AGE_IDENTITY` | Respaldo cifrado sin clave | Copiar `age.key` a `infra/backups/config/` |
| `falta el rol argosisp_owner` | Postgres no se creó desde cero | `down -v` del volumen de Postgres y repetir el paso 3 |
| `las filas restauradas no coinciden` | Restauración incompleta | No usar esa base; repetir o usar otro respaldo |
| `migrate` falla | Respaldo de un código más nuevo que el desplegado | Desplegar la versión del código del día del respaldo |
| La API no queda `healthy` | Variables de `infra/.env` distintas a las de producción | Revisar `APP_KEY`, `AAA_PPP_KEY`, `AAA_INTERNAL_TOKEN`, contraseñas |
