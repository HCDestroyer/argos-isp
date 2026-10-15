# infra

| Ruta | Qué es |
| --- | --- |
| `docker-compose.yml` | Stack completo: postgres, redis, mailpit, migrate, api, worker, web, portal y, con el perfil `lab`, freeradius, aaa y coa |
| `.env.example` | Variables del compose; cópialo a `infra/.env` |
| `mikrotik/` | `lab.rsc` y su README: RouterOS del laboratorio (PPPoE, RADIUS, corte IPv4/IPv6, WireGuard) |
| `docker/daemon.lab.json` | Configuración del daemon de Docker para el servidor del laboratorio (IP real del cliente por IPv6) |
| `ci/` | Verificaciones de CI de infraestructura (FreeRADIUS) |
| `postgres/` | Inicialización de Postgres |

```sh
cp infra/.env.example infra/.env        # completa los secretos
docker compose -f infra/docker-compose.yml up -d
```

## Portal: IP real del cliente

La página de corte identifica al cliente por su IP de origen (`GET /api/v1/portal/quien-soy`). La cadena es:

```
cliente suspendido ──dst-nat TCP/80 (MikroTik)──▶ PORTAL_BIND_IP:PORTAL_CORTE_PORT_HOST ──▶ portal:3001
portal (Nitro) ──/api/v1/portal/** + X-Forwarded-For──▶ api:3333
```

- El MikroTik conserva la IP de origen al hacer dst-nat.
- El portal agrega la IP de su socket al final de `X-Forwarded-For`. La API acepta esa cabecera (`PORTAL_CABECERA_IP=x-forwarded-for`) solo si la conexión viene de `PORTAL_PROXIES_CONFIABLES`, que por defecto es la subred fija de la red de compose (`COMPOSE_SUBNET_V4`/`COMPOSE_SUBNET_V6`). Si pones un proxy inverso delante del portal, agrega su IP a `PORTAL_PROXIES_CONFIABLES`.
- **Docker debe entregar al portal la IP real del cliente.** Por IPv4, los puertos publicados con las reglas DNAT de iptables la conservan. Esto deja de cumplirse cuando entra en juego `userland-proxy`: Docker lo usa por defecto en las conexiones a IPv6 del host y para loopback, y en esos casos el portal ve la IP del puente y `quien-soy` no identifica a nadie.

### Perfil lab (IPv4 + IPv6)

En el servidor del laboratorio:

1. Daemon de Docker sin `userland-proxy` y con IPv6. Copia `infra/docker/daemon.lab.json` a `/etc/docker/daemon.json` (o combínalo con el que ya tengas) y reinicia Docker con `systemctl restart docker`.
2. En `infra/.env`:
   - `COMPOSE_PROFILES=lab`
   - `COMPOSE_IPV6=true`: la red de compose recibe `COMPOSE_SUBNET_V6`.
   - `PORTAL_BIND_IP` = `portalV4` de `lab.rsc`.
   - `PORTAL_CORTE_PORT_HOST` = `portalCortePuerto` (80).
   - `PORTAL_URL_PUBLICA=http://<portalFqdn>`.
   - `PORTAL_HOSTS=<portalV4>,<portalV6>`.
3. Para publicar también por IPv6, agrega una línea `"[<portalV6>]:80:3001"` a `ports` del servicio `portal`. `PORTAL_BIND_IP` acepta una sola dirección.
4. Si el host no puede desactivar `userland-proxy`, la alternativa es correr el portal con `network_mode: host`, en un archivo override solo del laboratorio. En ese caso el portal escucha directo en el host, `NUXT_API_BASE_INTERNAL` debe apuntar a la API publicada (`http://127.0.0.1:3333`) y `PORTAL_PROXIES_CONFIABLES` debe incluir `127.0.0.1` y `::1`.

`COMPOSE_IPV6=false` es el valor por defecto porque `enable_ipv6` falla en hosts sin IPv6 en el kernel (por ejemplo, contenedores de CI).

## Walled garden

`walledGarden` de `mikrotik/lab.rsc` está vacío hasta la semana 2. El portal no carga nada externo: no usa fuentes, CDN ni iconos remotos, y llama a la API por su propio origen. Cuando A5 declare los dominios de la pasarela, se agregan ahí.
