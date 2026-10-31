# Runbook · Red de compose rota o distinta del `.env`

Síntomas (en `argosisp actualizar`, `levantar`, `revertir` o en el registro de `/opt/argosisp/registros/`):

- `error while removing network: network argosisp_default has active endpoints (argosisp-redis-1, argosisp-backup-1)`
- `failed to set up container networking: network 7842da2f15… not found`
- `container … is not connected to the network argosisp_default`
- `argosisp estado` dice `AVISO: la red de compose no coincide con el .env (…)`

## Por qué pasa

La red del proyecto (`argosisp_default`; `argosisp-portal_default` en un nodo portal) sale de `COMPOSE_SUBNET_V4`, `COMPOSE_SUBNET_V6` y `COMPOSE_IPV6` del `.env`. Si esa config cambia, `docker compose` borra la red y la crea de nuevo, pero **solo detiene los contenedores de los servicios del comando**. Un `up` parcial (el respaldo previo a una actualización levanta solo `postgres`, con `redis` y `backup` arriba) no puede borrar la red, y los intentos siguientes dejan contenedores desconectados o apuntando al id de una red que ya no existe.

Hasta la 1.5.0, `argosisp actualizar` cancelaba la actualización y dejaba ArgosIsp **caído** en la versión anterior. Desde la 1.5.1:

- `levantar`, `actualizar`, `revertir` y la reversión automática comparan la red con el `.env` antes de cada `up`. Si no coincide (subred, IPv6, redes duplicadas, contenedores con una red borrada), bajan todo el proyecto (todos los perfiles, sin tocar volúmenes) y la red se crea de nuevo.
- El respaldo previo y la restauración usan `up -d --no-recreate`. Si aun así compose falla por la red, la rehacen y lo intentan una vez más. `levantar` hace lo mismo con su `up`.
- `argosisp estado` avisa cuando la red no coincide.

Para cambiar la subred: editar el `.env` y `sudo argosisp levantar` (baja todo y lo vuelve a subir en 1 o 2 minutos).

## Recuperación con un comando

```sh
sudo argosisp reparar-red        # pide confirmación; --si para no preguntar
```

Baja todo el proyecto (`docker compose down --remove-orphans` con todos los perfiles; los volúmenes con la base, los comprobantes y los certificados quedan), quita los contenedores del proyecto que `down` no vio, borra las redes `argosisp_default` (duplicadas o huérfanas incluidas) **que no tengan contenedores conectados** y levanta la versión instalada. Termina con `ArgosIsp X.Y.Z arriba y sano, con la red de compose nueva`.

Si dice `la red … sigue con contenedores conectados: <nombres>`, hay un contenedor de fuera de ArgosIsp en esa red (p. ej. un Nginx Proxy Manager conectado a mano). Desconéctalo y repite:

```sh
docker network disconnect argosisp_default <contenedor>
sudo argosisp reparar-red --si
```

Después vuelve a conectarlo a la red nueva si lo necesita (`docker network connect argosisp_default <contenedor>`).

## Recuperación a mano (sin `reparar-red`, p. ej. con la CLI 1.5.0 instalada)

```sh
cd /opt/argosisp
# 1. Bajar todo el proyecto, todos los perfiles y huérfanos. NUNCA con -v: borraría la base.
sudo COMPOSE_PROFILES='*' docker compose -p argosisp --env-file .env -f actual/docker-compose.yml down --remove-orphans

# 2. Lo que down no vio: contenedores del proyecto y las redes argosisp_default (puede haber más de una)
sudo docker ps -aq --filter label=com.docker.compose.project=argosisp | xargs -r sudo docker rm -f
sudo docker network ls --filter name=argosisp_default
sudo docker network inspect -f '{{.Name}} {{.Id}} {{len .Containers}}' $(sudo docker network ls -q --filter name=argosisp_default)
sudo docker network rm <id>       # cada una con 0 contenedores; con contenedores, network disconnect antes

# 3. Levantar la versión instalada (crea la red con la subred del .env y espera a que esté sana)
sudo argosisp levantar
```

Comprobar: `sudo argosisp estado` (sin el aviso de la red) y `docker network inspect argosisp_default -f '{{json .IPAM.Config}}'` con la subred del `.env`.

## Si la actualización a 1.5.0 te dejó caído

1. Recuperar con los pasos de arriba (`reparar-red` no existe en 1.5.0: recuperación a mano). ArgosIsp vuelve en la versión que dice `ARGOSISP_VERSION` en el `.env` (la anterior: la actualización se canceló antes de tocar la base).
2. Instalar el parche y actualizar: `sudo argosisp actualizar` (la CLI de 1.4.x/1.5.0 hace el respaldo; si vuelve a fallar por la red, repetir el paso 1 y actualizar de nuevo: con la red ya al día, el respaldo previo pasa).
