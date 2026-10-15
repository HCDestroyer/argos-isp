# @argosisp/aaa

Endpoints REST que FreeRADIUS 3.2 (`rlm_rest`) llama para autorizar y contabilizar sesiones PPPoE. Dueño: A2 (`.claude/agents/a2-radius.md`). Hoy es el esqueleto del día 1: `GET /health` → 200; `POST /aaa/authorize`, `/aaa/post-auth` y `/aaa/accounting` → 501.

| Ruta                   | Llamada desde                     | Estado        |
| ---------------------- | --------------------------------- | ------------- |
| `GET /health`          | healthcheck de compose            | hecho         |
| `POST /aaa/authorize`  | `authorize` de FreeRADIUS         | 501, A2 día 2 |
| `POST /aaa/post-auth`  | `post-auth` (no bloqueante)       | 501, A2       |
| `POST /aaa/accounting` | `accounting` (Start/Interim/Stop) | 501, A2 día 3 |

Eventos: emitirá `sesion.iniciada`, `sesion.terminada` y `aaa.caido` (A2). No consume eventos.

## Comandos

```
pnpm --filter @argosisp/aaa dev        # node --watch con type stripping (Node >= 22.18)
pnpm --filter @argosisp/aaa test       # node --test
pnpm --filter @argosisp/aaa build      # tsc → dist/
docker build -f services/aaa/Dockerfile .   # contexto = raíz del repo
```

Variables en `.env.example`.

## FreeRADIUS (`freeradius/`)

Se monta sobre la imagen oficial `freeradius/freeradius-server:3.2.10` (ver `infra/docker-compose.yml`):

| Archivo del repo                                                     | Destino en el contenedor                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `freeradius/mods-enabled/` (`rest`, `pap`, `chap`, `always`, `expr`) | `/etc/freeradius/mods-enabled/` (reemplaza el de la imagen: sin EAP, LDAP, etc.) |
| `freeradius/sites-enabled/default`                                   | `/etc/freeradius/sites-enabled/` (sin `inner-tunnel`)                            |
| `freeradius/clients.conf` + `freeradius/clients.d/`                  | `/etc/freeradius/clients.conf` y `clients.d/`                                    |

- El diccionario MikroTik (`Mikrotik-Rate-Limit`, `Mikrotik-Address-List`, `Mikrotik-Delegated-IPv6-Pool`, vendor 14988) viene incluido en la imagen (`/usr/share/freeradius/dictionary.mikrotik`, incluido por el diccionario principal); no se reemplaza, como recomienda FreeRADIUS. `Framed-IPv6-Prefix` y `Delegated-IPv6-Prefix` son de RFC 3162/4818.
- Contrato JSON y mapa HTTP → rcode: comentarios en `freeradius/mods-enabled/rest`. Un 200 con `{"control:Cleartext-Password": "...", "reply:Mikrotik-Rate-Limit": "..."}` acepta por PAP o CHAP; 401 rechaza; 5xx (el 501 actual) rechaza.
- El cuerpo que recibe `/aaa/authorize` y `/aaa/post-auth` incluye `User-Password` en claro (PAP): no lo registres en logs.
- Secrets por entorno: `RADIUS_LOCAL_SECRET` (cliente `localhost`, healthcheck y `radtest`), `RADIUS_LAB_NAS_IP` y `RADIUS_LAB_SECRET` (MikroTik del laboratorio). `pnpm aaa:clients` (A2) escribirá un archivo por router en `clients.d/`.

Validar la configuración y probar a mano:

```
docker compose -f infra/docker-compose.yml exec freeradius radiusd -XC
docker compose -f infra/docker-compose.yml exec freeradius radtest juan clave 127.0.0.1 0 "$RADIUS_LOCAL_SECRET"
```
