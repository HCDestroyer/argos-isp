---
orden: 3
---

# Runbook · Comandos del servidor (`argosisp`)

Para el operador de un servidor instalado con `instalar.sh` ([Instalar](./instalacion.md)). El instalador deja el comando `argosisp` en `/usr/local/bin` (enlace a `/opt/argosisp/actual/argosisp`). Se corre con `sudo`: lee el `.env` (permisos `600`, solo root) y maneja Docker.

```sh
sudo argosisp ayuda      # esta lista, desde el propio comando (también -h y --help)
```

Origen: [`infra/produccion/argosisp`](../../infra/produccion/argosisp).

## Resumen

| Comando                                                         | Para qué                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| `argosisp estado`                                               | Ver cómo está todo                                             |
| `argosisp version`                                              | Versión instalada                                              |
| `argosisp actualizar [--version X.Y.Z] [--si] [--auto]`         | Pasar a una versión nueva, con respaldo y reversión automática |
| `argosisp revertir [--si]`                                      | Volver a la versión anterior a la última actualización         |
| `argosisp respaldar`                                            | Hacer un respaldo ahora                                        |
| `argosisp levantar`                                             | Levantar todo después de editar el `.env`                      |
| `argosisp reparar-red [--si]`                                   | Rehacer la red de Docker cuando quedó rota                     |
| `argosisp auto activar\|desactivar\|estado`                     | Parches automáticos                                            |
| `argosisp radius-clientes`                                      | Regenerar los clientes de FreeRADIUS desde los routers         |
| `argosisp admin-clave <correo> [--stdin]`                       | Clave nueva para un usuario del panel                          |
| `argosisp nodo-portal crear <nombre>\|listar\|revocar <nombre>` | Nodos portal remotos                                           |
| `argosisp desinstalar [--borrar-datos] [--si]`                  | Quitar ArgosIsp del servidor                                   |
| `argosisp logs [servicio...]`                                   | Registros en vivo                                              |
| `argosisp compose <args...>`                                    | `docker compose` del proyecto con la versión instalada         |

`--si` responde que sí a todas las confirmaciones (incluido un cambio mayor de versión). Úsalo solo en scripts que ya probaste.

En un **nodo portal** (`instalar.sh --rol portal`) solo tienen sentido `estado`, `version`, `actualizar`, `revertir`, `levantar`, `logs`, `compose` y `desinstalar`; los que tocan la base (`respaldar`, `radius-clientes`, `admin-clave`, `nodo-portal`) responden «esto no aplica en un nodo portal: se hace en el servidor principal».

## Cada comando

### `estado`

```sh
sudo argosisp estado
```

Muestra la versión instalada y la última publicada (y si el cambio es parche, menor o mayor), si los parches automáticos están activos, el estado de cada servicio, el túnel WireGuard (IP, puerto y cuántos routers) y avisos: puertos abiertos de más, `PORTAL_IPS_SERVIDOR` incompleta, datos de `ROUTERS_SERVICIO_*` que faltan, DNS de documentación en el `.env`. En un nodo portal avisa si su versión no coincide con la del servidor principal.

### `version`

Imprime la versión instalada (`ARGOSISP_VERSION` del `.env`).

### `actualizar`

```sh
sudo argosisp actualizar                  # a la última del canal estable
sudo argosisp actualizar --version 1.15.0
```

Respaldo previo, imágenes nuevas, migraciones y verificación; si algo falla, vuelve sola a la versión anterior con su respaldo. Pide confirmación; un cambio mayor pide escribir la versión. Nunca baja de versión. `--auto` lo usa el timer: solo aplica parches. Detalle, pasos y qué pasa si falla cada uno: [Actualizar y revertir](./actualizacion.md).

### `revertir`

```sh
sudo argosisp revertir
```

Vuelve a la versión anterior a la **última** actualización y restaura el respaldo que se tomó justo antes. Pide escribir `revertir`.

::: danger
Todo lo registrado después de la actualización (pagos, facturas, cambios de servicios) se pierde. Si hay que conservarlo, respáldalo primero y anota qué se registró. Ver [Actualizar y revertir](./actualizacion.md#revertir-a-mano).
:::

### `respaldar`

```sh
sudo argosisp respaldar
```

Hace ahora el mismo respaldo que el diario (base y comprobantes, con cifrado y copia remota si están configurados). Ver [Respaldos](./respaldos.md).

### `levantar`

```sh
sudo argosisp levantar
```

Levanta la versión instalada y espera a que cada servicio quede sano. Úsalo **después de cada cambio al `.env`**. Si la red de Docker no coincide con el `.env`, la rehace antes. Si falta `ARGOSISP_API_PORTAL` en el `.env`, la escribe (`si`, o `no` con menos de 3 GB de RAM).

### `reparar-red`

```sh
sudo argosisp reparar-red
```

Baja todo el proyecto (sin tocar los volúmenes de datos), borra la red de compose y las duplicadas o huérfanas, y vuelve a levantar. Para errores como `has active endpoints` o `network … not found`: [Red de compose rota](./red-compose.md).

### `auto`

```sh
sudo argosisp auto activar      # timer diario a las 04:20 UTC (+ hasta 30 min al azar)
sudo argosisp auto desactivar
sudo argosisp auto estado
```

Parches automáticos, apagados por defecto. Solo aplican parches (misma versión mayor y menor). Ver [Actualizar y revertir](./actualizacion.md#parches-automaticos-opcional-apagado-por-defecto).

### `radius-clientes`

```sh
sudo argosisp radius-clientes
```

Regenera la lista de routers que FreeRADIUS acepta (su IP y su secreto) a partir de los routers dados de alta en el panel, y reinicia FreeRADIUS. Córrelo si un router nuevo recibe rechazos porque FreeRADIUS no lo conoce.

### `admin-clave`

```sh
sudo argosisp admin-clave admin@tu-isp.example
echo 'clave-nueva' | sudo argosisp admin-clave admin@tu-isp.example --stdin
```

Pone una clave nueva a ese usuario del panel y la muestra **una sola vez**; si el usuario no existe, lo crea con el rol `admin`. Con `--stdin` usa la clave que le pasas. Cierra las sesiones del usuario y queda en la bitácora (actor sistema, canal consola, la clave como `***`).

### `nodo-portal`

```sh
sudo argosisp nodo-portal crear portal-norte    # el token se muestra una sola vez
sudo argosisp nodo-portal listar
sudo argosisp nodo-portal revocar portal-norte  # pide confirmación
```

Solo en el servidor principal. Crea el token con que un nodo portal remoto habla con la API. Ver [Instalar](./instalacion.md#nodo-portal-otro-servidor-opcional).

### `desinstalar`

```sh
sudo argosisp desinstalar                  # quita servicios, comando y timer; conserva los datos
sudo argosisp desinstalar --borrar-datos   # además borra volúmenes, red y /opt/argosisp
```

Sin `--borrar-datos` quedan los volúmenes y `/opt/argosisp` (`.env`, respaldos); se vuelve con `/opt/argosisp/actual/argosisp levantar`.

::: danger
`--borrar-datos` borra la base, los comprobantes y los certificados. Pide escribir `BORRAR` y ofrece un respaldo final en `/var/backups/argosisp-final-<fecha>/` con una copia del `.env`. Con `--si` no pregunta nada ni hace ese respaldo.
:::

### `logs`

```sh
sudo argosisp logs                # todos los servicios
sudo argosisp logs api worker     # solo esos
```

Últimas 100 líneas y sigue en vivo (`Ctrl+C` para salir).

### `compose`

```sh
sudo argosisp compose ps
sudo argosisp compose restart worker
sudo argosisp compose exec api node ace.js <comando>
```

`docker compose` del proyecto, con el `.env` y la versión instalada. Es la forma correcta de usar `docker compose` en el servidor: un `docker compose` a mano no sabe qué versión ni qué perfiles están activos.

## Comandos de la API (dentro del contenedor)

Algunas tareas se hacen con comandos de la API. En el servidor se corren con `sudo argosisp compose exec api node ace.js <comando>` (la API tiene que estar arriba) o, para leer o escribir archivos del servidor, con un contenedor de una vez que monta una carpeta:

```sh
sudo argosisp compose run --rm --no-deps -v /root/datos:/datos api node ace.js <comando> …
```

El contenedor corre como el usuario `node` (uid 1000): la carpeta montada tiene que poder leerla (y escribirla, si el comando deja archivos) ese usuario.

| Comando                                                           | Para qué                                                                                                                               | Más                                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `telegram:webhook [--empresa=<id>] [--info] [--borrar] [--url=…]` | Registrar el webhook del bot de Telegram (una vez, después de guardar el token en el panel), ver su estado o quitarlo                  | [Configuración de notificaciones](../manual/notificaciones/configuracion.md) |
| `importar --origen=… --fuente=… [--dry-run] [--salida=…]`         | Importar desde Mikrowisp, SmartISP o CSV                                                                                               | [Importación](./importacion.md)                                              |
| `importar:plantillas <directorio>`                                | Dejar las plantillas CSV vacías con su `LEEME.md`                                                                                      | [Importar desde CSV](../importacion/csv.md)                                  |
| `aaa:repoblar [--forzar]`                                         | Reescribir en Redis las autorizaciones RADIUS de todos los servicios (después de perder Redis; `--forzar` solo tras restaurar la base) | [RADIUS caído](./aaa-caido.md)                                               |
| `emergencia:secrets-ppp <router_id> --salida=<archivo.rsc>`       | Exportar los clientes de un router como `/ppp secret` locales, último recurso con RADIUS caído                                         | [RADIUS caído](./aaa-caido.md)                                               |
| `aaa:verificar-router <router_id>`                                | Informe de un router antes de migrarlo al RADIUS nuevo                                                                                 | [`services/aaa/RUNBOOK.md`](../../services/aaa/RUNBOOK.md)                   |
| `integraciones:horus-token`                                       | Token de la integración con Horus (se muestra una sola vez)                                                                            | [Conectar Horus](./conectar-horus.md)                                        |
| `usuarios:clave <correo>`                                         | Lo mismo que `argosisp admin-clave` (usa ese)                                                                                          | Arriba                                                                       |

En desarrollo, los mismos comandos van con `node ace <comando>` dentro de `apps/api`, o con los atajos de `pnpm` de la raíz (`pnpm importar`, `pnpm importar:plantillas`, `pnpm emergencia:secrets-ppp`, `pnpm aaa:verificar-router`).

## Archivos y carpetas

| Ruta                              | Qué es                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `/opt/argosisp/.env`              | Configuración y secretos (600). Después de editarlo: `sudo argosisp levantar` |
| `/opt/argosisp/actual`            | Enlace a la versión en uso (`versiones/<v>/`)                                 |
| `/opt/argosisp/respaldos/`        | Respaldos diarios y, en `actualizaciones/`, los previos a cada actualización  |
| `/opt/argosisp/respaldos-config/` | `rclone.conf` y, solo para restaurar un respaldo cifrado, `age.key`           |
| `/opt/argosisp/registros/`        | Registro de cada actualización y reversión (90 días)                          |
| `/opt/argosisp/estado/`           | Datos de la última actualización (para `revertir`)                            |
| `/opt/argosisp/.bloqueo`          | Solo una operación a la vez                                                   |
