---
orden: 4
---

# Runbook · Respaldos

Para el operador del servidor. Cómo se respalda ArgosIsp, dónde quedan los respaldos y cómo comprobar que sirven. Restaurar uno: [Restaurar un respaldo](./restaurar-backup.md).

## Qué se respalda y cuándo

El servicio `backup` (siempre encendido) hace **una vez al día** un respaldo de la base completa y de los comprobantes de depósito que suben los clientes:

- Hora: `BACKUP_HORA` del `.env`, en UTC. Por defecto `03:13` UTC (21:13 en Guatemala). Si el servidor estaba apagado a esa hora, respalda al volver; si falla, lo reintenta cada 15 minutos.
- Retención: `BACKUP_RETENCION_DIAS` (por defecto 14). Los respaldos más viejos se borran, en el servidor y en la copia remota.
- Redis no se respalda: las colas se reconstruyen solas (los eventos sin publicar siguen en la base) y la caché de RADIUS se vuelve a llenar.

Además, `argosisp actualizar` hace un respaldo propio justo antes de cada actualización, en `respaldos/actualizaciones/`, **sin cifrar y sin copia remota**: sirve para revertir en ese mismo servidor.

::: warning
El respaldo no incluye el archivo `/opt/argosisp/.env`. Ahí están `AAA_PPP_KEY` (cifra las contraseñas PPPoE, los secretos RADIUS y las credenciales guardadas) y `APP_KEY`. **Sin esas claves un respaldo no sirve para recuperar todo.** Guarda una copia del `.env` fuera del servidor (gestor de contraseñas o bóveda) desde el día de la instalación.
:::

## Dónde quedan

| Variable del `.env`     | Por defecto                      | Qué es                                                                                                                         |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `BACKUP_HOST_DIR`       | `/opt/argosisp/respaldos`        | Carpeta del servidor donde quedan los respaldos. **Debería ser otro disco o un NFS**, nunca el mismo disco que la base         |
| `BACKUP_CONFIG_DIR`     | `/opt/argosisp/respaldos-config` | `rclone.conf` (copia remota) y, solo mientras restauras un respaldo cifrado, `age.key`                                         |
| `BACKUP_AGE_RECIPIENTS` | vacío                            | Claves públicas de [age](https://age-encryption.org), separadas por espacio. Con valor, los respaldos quedan cifrados (`.age`) |
| `BACKUP_RCLONE_DESTINO` | vacío                            | Copia remota con rclone: `s3:bucket/ruta`, `b2:…`, `sftp:…`, con el remoto definido en `rclone.conf`                           |

Después de cambiar cualquiera: `sudo argosisp levantar`.

Cada respaldo deja, con la misma marca de fecha y hora (UTC):

| Archivo                                                                             | Qué es                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `argosisp-<AAAAMMDDTHHMMSSZ>.dump[.age]`                                            | La base completa (`pg_dump`)                                          |
| `….dump.sha256`                                                                     | Suma para detectar un archivo dañado                                  |
| `….dump.conteos`                                                                    | Filas por tabla según el propio respaldo; la restauración las compara |
| `argosisp-<marca>.comprobantes.tar.gz[.age]`, su `.sha256` y `.comprobantes.conteo` | Los archivos de los comprobantes de depósito y cuántos son            |

## Recomendado

1. **Otro disco:** monta un disco externo o un NFS y pon su ruta en `BACKUP_HOST_DIR`.
2. **Cifrado:** genera la clave **fuera del servidor** y guarda la privada en un gestor de secretos:

    ```sh
    age-keygen -o age.key   # imprime la clave pública: va a BACKUP_AGE_RECIPIENTS
    ```

    La clave privada **no** vive en el servidor: solo se copia a `respaldos-config/age.key` mientras restauras, y se borra después.

3. **Copia remota:** crea el remoto con `rclone config` en otra máquina, copia el `rclone.conf` resultante a `/opt/argosisp/respaldos-config/` y pon `BACKUP_RCLONE_DESTINO`.
4. En un Raspberry Pi, sobre todo: respaldo fuera del equipo y UPS.

## Respaldo a mano

```sh
sudo argosisp respaldar
```

Es el mismo respaldo del diario (cifrado y copia remota incluidos). Hazlo antes de una operación delicada: importación real, cambio grande de configuración, `argosisp revertir`.

## Cómo saber si funcionan

- `sudo argosisp estado`: el servicio `backup` aparece sano. Su chequeo de salud falla si el **último intento** de respaldo terminó en error.
- `sudo ls -lh /opt/argosisp/respaldos/` (o tu `BACKUP_HOST_DIR`): hay un `.dump` (o `.dump.age`) de hoy o de anoche.
- `sudo argosisp logs backup`: qué hizo el último respaldo y, si falló, por qué.

## Probar que un respaldo se puede restaurar

Un respaldo que nunca se restauró no está probado. **Una vez al mes** y después de cambiar algo de los respaldos, restaura el más reciente en una base aparte, en el mismo servidor, sin tocar la de producción:

```sh
sudo argosisp compose run --rm backup \
  restaurar.sh /backups/argosisp-<marca>.dump --base argosisp_prueba
```

- Para un respaldo cifrado, copia antes la clave privada a `/opt/argosisp/respaldos-config/age.key`, usa el nombre con `.age`, y borra la clave al terminar.
- `restaurar.sh` verifica la suma `sha256`, descifra si hace falta, restaura en `argosisp_prueba` y compara las filas de **cada tabla** con las del respaldo. Verifica también el archivo de comprobantes de la misma marca. Cualquier diferencia con el respaldo termina con error y la lista de tablas.
- Al terminar, borra la base de prueba:

    ```sh
    sudo argosisp compose exec postgres psql -U argosisp -c 'DROP DATABASE argosisp_prueba'
    ```

En el repositorio hay además un ensayo completo en un entorno limpio (restaurar, migrar, levantar la API e iniciar sesión), `infra/backups/ensayo.sh`, que corre en CI en cada cambio: ver [Restaurar un respaldo](./restaurar-backup.md). Ese ensayo usa el compose de desarrollo, no el de un servidor instalado.

## Si algo falla

| Síntoma                               | Causa probable                                          | Qué hacer                                                                                          |
| ------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `backup` no queda sano                | El último respaldo falló                                | `sudo argosisp logs backup` y corregir lo que diga (disco lleno, NFS sin montar, remoto de rclone) |
| No hay respaldos nuevos en la carpeta | `BACKUP_HOST_DIR` apunta a un disco que no está montado | Montarlo y `sudo argosisp levantar`                                                                |
| La copia remota no aparece            | `BACKUP_RCLONE_DESTINO` o `rclone.conf` mal             | Probar el remoto con `rclone ls` desde otra máquina con el mismo `rclone.conf`                     |
| Disco lleno                           | Retención larga o respaldos muy grandes                 | Bajar `BACKUP_RETENCION_DIAS` o mover `BACKUP_HOST_DIR` a un disco más grande                      |

Detalle técnico (scripts `respaldar.sh` y `restaurar.sh`, comprobantes, pruebas): [`infra/README.md`](../../infra/README.md), sección «Respaldos».
