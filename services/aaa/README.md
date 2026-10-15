# @argosisp/aaa

Endpoints REST que FreeRADIUS 3.2 (`rlm_rest`) llama para autorizar y contabilizar sesiones PPPoE. Dueño: A2 (`.claude/agents/a2-radius.md`). Servidor HTTP con Fastify 5 (antes `node:http`; ver "Dependencias").

| Ruta                   | Llamada desde                     | Estado                       |
| ---------------------- | --------------------------------- | ---------------------------- |
| `GET /health`          | healthcheck de compose            | hecho (incluye estado Redis) |
| `POST /aaa/authorize`  | `authorize` de FreeRADIUS         | hecho (tarea 1)              |
| `POST /aaa/post-auth`  | `post-auth` (no bloqueante)       | 204, solo registra           |
| `POST /aaa/accounting` | `accounting` (Start/Interim/Stop) | 501, tarea 4 (día 3)         |

Eventos: emitirá `sesion.iniciada`, `sesion.terminada` (tarea 4) y `aaa.caido` (tarea 9). No consume eventos: la caché la mantiene A1.

## `/aaa/authorize`

1. Lee `User-Name` del cuerpo de `rlm_rest`.
2. Busca `aaa:user:<user_ppp>` en Redis. Si no está, o Redis no responde (timeout 150 ms), consulta el respaldo: `GET $API_INTERNAL_URL/internal/aaa/servicio?user_ppp=` con `Authorization: Bearer $AAA_INTERNAL_TOKEN` o, mientras A1 no lo publique, `fixtures/servicios.json` (`AAA_RESPALDO=fixtures`).
3. Cachea lo obtenido con `SET NX` y **sin TTL**: si A1 escribió mientras se consultaba, gana A1. Los inexistentes no se cachean.
4. Descifra `pass_ppp` (`v1.<iv>.<tag>.<datos>`, AES-256-GCM, `AAA_PPP_KEY`) y responde a FreeRADIUS, que autentica PAP o CHAP contra `control:Cleartext-Password`.

| Estado del servicio        | HTTP | rlm_rest → FreeRADIUS | Atributos `reply:`                                                                                                                            |
| -------------------------- | ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `activo`                   | 200  | updated → Accept      | `Mikrotik-Rate-Limit` = `<subida>k/<bajada>k` o `rate_limit_override` (burst); `Mikrotik-Group` = `profile_ppp` si lo hay                     |
| `limitado`                 | 200  | updated → Accept      | `Mikrotik-Rate-Limit` = `<subida_limitada>k/<bajada_limitada>k` (si el plan no la define: la del plan y un aviso en el log)                   |
| `suspendido`               | 200  | updated → Accept      | `Mikrotik-Rate-Limit` = `256k/256k`, `Mikrotik-Group` = `suspendido`, `Mikrotik-Address-List` = `suspendidos`, `Filter-Id` = `argos-corte.in` |
| `retirado`                 | 401  | reject → Reject       | —                                                                                                                                             |
| inexistente o lápida       | 404  | notfound → Reject     | —                                                                                                                                             |
| Redis y respaldo sin datos | 503  | fail → Reject         | —                                                                                                                                             |
| `pass_ppp` no descifrable  | 500  | fail → Reject         | —                                                                                                                                             |

Además, en todo Accept:

| Atributo                       | Cuándo                                             |
| ------------------------------ | -------------------------------------------------- |
| `Framed-IP-Address`            | `ipv4.modo = estatico`                             |
| `Framed-Pool`                  | `ipv4.modo = pool`                                 |
| `Framed-IPv6-Prefix`           | `ipv6.modo = radius_servicio` (/64 de enlace)      |
| `Delegated-IPv6-Prefix`        | `ipv6.modo = radius_servicio` (/56 o /48 delegado) |
| `Framed-IPv6-Pool`             | `ipv6.modo = radius_pool` (pool de enlace)         |
| `Mikrotik-Delegated-IPv6-Pool` | `ipv6.modo = radius_pool` (pool de delegación) ¹   |
| `Acct-Interim-Interval`        | siempre, 300                                       |

¹ FreeRADIUS 3.2 no define `Delegated-IPv6-Pool`; RouterOS usa el VSA `Mikrotik-Delegated-IPv6-Pool` (vendor 14988, atributo 22).

El suspendido conserva su IPv4 y sus prefijos (A5 lo identifica por IP en la página de corte). El perfil sale de lo verificado en RouterOS 7.24.5 (`infra/mikrotik/README.md`): `Mikrotik-Group` aplica el perfil de corte completo al conectar (address-list e interface-list IPv4/IPv6); `Mikrotik-Address-List` y `Filter-Id` son los mismos atributos que `coa` usa para suspender una sesión viva, así el router queda igual en ambos caminos. Se configuran con `AAA_SUSPENDIDO_*`.

## Comandos

```
pnpm --filter @argosisp/aaa dev        # node --watch con type stripping (Node >= 22.18)
pnpm --filter @argosisp/aaa test       # node --test; usa Redis local (base 2, prefijo propio)
pnpm --filter @argosisp/aaa build      # tsc → dist/
docker build -f services/aaa/Dockerfile .   # contexto = raíz del repo
```

Variables en `.env.example`. Las pruebas leen `REDIS_HOST`/`REDIS_PORT` (por defecto `127.0.0.1:6379`) y escriben solo en la base 2 con un prefijo aleatorio que borran al terminar.

## FreeRADIUS (`freeradius/`)

Se monta sobre la imagen oficial `freeradius/freeradius-server:3.2.10` (ver `infra/docker-compose.yml`):

| Archivo del repo                                                     | Destino en el contenedor                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `freeradius/mods-enabled/` (`rest`, `pap`, `chap`, `always`, `expr`) | `/etc/freeradius/mods-enabled/` (reemplaza el de la imagen: sin EAP, LDAP, etc.) |
| `freeradius/sites-enabled/default`                                   | `/etc/freeradius/sites-enabled/` (sin `inner-tunnel`)                            |
| `freeradius/clients.conf` + `freeradius/clients.d/`                  | `/etc/freeradius/clients.conf` y `clients.d/`                                    |

- El diccionario MikroTik (`Mikrotik-Rate-Limit`, `Mikrotik-Group`, `Mikrotik-Address-List`, `Mikrotik-Delegated-IPv6-Pool`, vendor 14988) viene incluido en la imagen (`/usr/share/freeradius/dictionary.mikrotik`); no se reemplaza. `Filter-Id` y `Framed-Pool` son de RFC 2865/2869; `Framed-IPv6-Prefix`, `Framed-IPv6-Pool` y `Delegated-IPv6-Prefix` de RFC 3162/4818.
- El cuerpo que recibe `/aaa/authorize` incluye `User-Password` en claro (PAP): nunca se registra (Fastify no registra cuerpos y el logger lo redacta).
- Secrets por entorno: `RADIUS_LOCAL_SECRET` (cliente `localhost`, healthcheck y `radtest`), `RADIUS_LAB_NAS_IP` y `RADIUS_LAB_SECRET` (cliente fijo `mikrotik-lab`).

### Clientes desde `network.routers` (`pnpm aaa:clients`)

```
DB_HOST=127.0.0.1 DB_USER=argosisp DB_PASSWORD=... DB_DATABASE=argosisp \
AAA_PPP_KEY=... RADIUS_LAB_NAS_IP=10.255.255.2 pnpm aaa:clients
docker compose -f infra/docker-compose.yml restart freeradius   # FreeRADIUS lee los clientes al arrancar
```

- Lee `network.routers` con `activo` y `modo_seguridad = 'radius'`, descifra `radius_secret` (formato `v1`, `AAA_PPP_KEY`) y escribe `freeradius/clients.d/router-<id>.conf` (`ipaddr = nas_ip`, `require_message_authenticator = yes`, permisos 0640). `AAA_CLIENTS_DIR` cambia el directorio.
- Borra los `router-*.conf` de routers que ya no aplican (inactivos, en modo `api`, sin secret). Si un router tiene IP o secret inválidos, conserva su archivo anterior, lo informa y sale con 1.
- Omite el router cuya `nas_ip` es `RADIUS_LAB_NAS_IP`: ya tiene el cliente fijo `mikrotik-lab` en `clients.conf` y FreeRADIUS no arranca con dos clientes en la misma IP.
- Los `.conf` generados llevan el secret en claro: están en `services/aaa/.gitignore`.

## Dependencias

| Paquete          | Motivo                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fastify` 5.12.5 | El brief pide Fastify o Hono. Fastify: logger pino incluido (JSON), `inject` para pruebas sin puerto, buen rendimiento para el p95 < 100 ms de la semana 2 |
| `ioredis` 5.11.1 | Cliente Redis; misma versión que ya usa BullMQ en el workspace                                                                                             |
| `pg` 8.23.1      | `pnpm aaa:clients` lee `network.routers`; misma versión que ya usa Lucid en `apps/api`                                                                     |
