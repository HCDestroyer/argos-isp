# MikroTik del laboratorio

`lab.rsc` deja un RouterOS 7 listo para que A2 pruebe RADIUS, accounting y CoA, y para que A5 pruebe la página de corte por IPv4 e IPv6.

## Qué configura

| Bloque              | Configuración                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PPPoE               | Servidor `argosisp` en `labIf`, perfil `default`, solo PAP/CHAP, MTU/MRU 1480, `one-session-per-host`                                                                                                        |
| Perfil `default`    | `local-address`, pool IPv4 `argos-v4-pppoe`, `/64` de enlace desde `argos-v6-enlace` (`remote-ipv6-prefix-pool`), `/56` por DHCPv6-PD desde `argos-v6-pd` (`dhcpv6-pd-pool`), DNS = router, `change-tcp-mss` |
| Perfil `suspendido` | Igual que `default` más `rate-limit=256k/256k`, `address-list=suspendidos` (el router agrega la IPv4, el /64 y el /56 de la sesión a las listas `suspendidos` de IPv4 e IPv6) e `interface-list=suspendidos` |
| RADIUS              | `/radius service=ppp timeout=1s src-address=...` (segunda entrada si `radiusAddr2` no está vacío), `/radius incoming accept=yes port=3799`, `/ppp aaa use-radius=yes accounting=yes interim-update=5m`       |
| Corte IPv4          | Cadena `argos-corte`: DNS (`argos-dns`), portal (`argos-portal`), walled garden por FQDN (`argos-walled`), drop del resto. NAT `argos-corte-nat`: TCP/80 → `portalV4:portalCortePuerto`                      |
| Corte IPv6          | Cadena `argos-corte` espejo sin NAT: DNS, portal, walled garden, `tcp-reset` al resto de TCP (el navegador cae a IPv4, donde sí se redirige) y drop                                                          |
| Filter-Id           | Salto `forward → ppp` en IPv4 e IPv6 para las reglas dinámicas que RouterOS crea con `Filter-Id`; cadena neutra `argos-activo`                                                                               |
| Hacia el router     | Suspendidos solo alcanzan DNS, ICMP y, en IPv6, ND/RA y DHCPv6 (renovación del PD)                                                                                                                           |
| WireGuard           | Opcional (`wgHabilitar true`): túnel `wg-argosisp` hacia el servidor                                                                                                                                         |

Las reglas de salto (`argosisp:top`) se colocan al inicio de `filter` y `nat`, antes de fasttrack y de `accept established,related`, que de otro modo dejarían pasar al suspendido.

### Nombres que A1 registra en `planes_routers`

| Uso                           | Nombre            | Prefijo de ejemplo         | Atributo RADIUS (modo `radius_pool`)                              |
| ----------------------------- | ----------------- | -------------------------- | ----------------------------------------------------------------- |
| Pool IPv4                     | `argos-v4-pppoe`  | `10.10.0.10-10.10.0.250`   | `Framed-Pool`                                                     |
| /64 de enlace                 | `argos-v6-enlace` | `2001:db8:100::/48` en /64 | `Framed-IPv6-Pool`                                                |
| /56 delegado                  | `argos-v6-pd`     | `2001:db8:200::/40` en /56 | `Delegated-IPv6-Pool` (RFC 4818) o `Mikrotik-Delegated-IPv6-Pool` |
| Perfil de corte               | `suspendido`      | —                          | `Mikrotik-Group`                                                  |
| Address-list / interface-list | `suspendidos`     | —                          | `Mikrotik-Address-List`                                           |

Para el modo `radius_servicio` (IP y prefijos fijos por servicio), el IPAM debe usar rangos fuera de esos pools, por ejemplo `10.10.1.0/24`, `2001:db8:101::/48` (enlace) y `2001:db8:300::/40` (delegados). El router instala la ruta al recibir `Framed-IP-Address`, `Framed-IPv6-Prefix` y `Delegated-IPv6-Prefix`.

## Aplicar

1. Edita solo el bloque **Variables** de `lab.rsc`: interfaces, IPs, `radiusSecret` (= `RADIUS_LAB_SECRET`), `radiusSrc` (= `RADIUS_LAB_NAS_IP`), portal, walled garden, DNS y prefijos. Los valores de ejemplo son de documentación (RFC 5737, RFC 1918, `2001:db8::/32`, `.example`).
2. Si el cambio es remoto, activa **Safe Mode** (`Ctrl+X` en la terminal) antes de importar: si pierdes la sesión, RouterOS revierte.
3. Sube el archivo y aplícalo:

    ```
    scp infra/mikrotik/lab.rsc admin@<router>:lab.rsc
    /import file-name=lab.rsc verbose=yes
    ```

    Es re-ejecutable: borra lo que lleva comentario `argosisp...` y lo vuelve a crear; los pools, perfiles y el servidor PPPoE se actualizan en sitio. Se probó con `/import` en un CHR 7.24.5 limpio y sobre reglas tipo defconf (fasttrack, `accept established`), dos veces seguidas, con y sin WireGuard y segundo nodo RADIUS.

4. En el servidor, en `infra/.env`: `COMPOSE_PROFILES=lab`, `RADIUS_BIND_IP` = IP del servidor que ve el router (LAN o túnel), `RADIUS_LAB_NAS_IP` = `radiusSrc`, `RADIUS_LAB_SECRET` = `radiusSecret`, `PORTAL_BIND_IP` = `portalV4` si el portal corre en el mismo servidor, y las variables del portal de `infra/README.md` (IP real del cliente, IPv6). Luego `docker compose -f infra/docker-compose.yml up -d`.

Rollback: `/system backup save name=antes-argosisp` antes de importar y `/system backup load name=antes-argosisp` para volver.

## Exponer FreeRADIUS, aaa y coa al router (perfil `lab`)

- **Misma LAN**: `RADIUS_BIND_IP=<IP LAN del servidor>`; en `lab.rsc`, `radiusAddr` = esa IP y `radiusSrc` = IP del router en esa LAN.
- **WireGuard** (servidor fuera de la LAN o detrás de NAT): `wgHabilitar true` en `lab.rsc`; el router se conecta al endpoint público del servidor. En el servidor (`/etc/wireguard/wg0.conf`, `wg-quick up wg0`):

    ```
    [Interface]
    Address = 10.255.255.1/30
    ListenPort = 51820
    PrivateKey = <clave privada del servidor>

    [Peer]
    # MikroTik del laboratorio (clave que imprime lab.rsc al aplicarse)
    PublicKey = <clave pública del router>
    AllowedIPs = 10.255.255.2/32
    ```

    y `RADIUS_BIND_IP=10.255.255.1`. Abre UDP 51820 en el firewall del servidor; 1812/1813 quedan publicados solo en la IP del túnel.

- FreeRADIUS ve la IP real del router: Docker conserva la IP de origen del tráfico UDP publicado, así que `clients.conf` la reconoce como `mikrotik-lab`.
- **CoA** (`coa` → router UDP 3799): sale del contenedor con NAT del host. El router solo acepta CoA desde la dirección de un `/radius`, así que la ruta del servidor hacia el router debe salir por la IP que el router tiene como `radiusAddr` (la del túnel o la LAN). Con WireGuard ocurre solo, porque la ruta a `10.255.255.2` sale por `wg0`.
- La red bridge de compose no debe solaparse con las redes del laboratorio. Si choca, fija una subred en el compose.

## Verificación

En el router:

```
/radius print detail
/radius monitor 0
    # pending 0, accepts y rejects suben con cada conexión; timeouts debe quedarse en 0
/ppp active print detail
    # usuario conectado: address (IPv4), caller-id, uptime
/interface pppoe-server print
/ipv6 dhcp-server binding print
    # el /56 delegado al cliente (servidor dinámico creado por el perfil)
/ipv6 route print where dynamic
    # /64 de enlace y /56 delegado hacia la interfaz <pppoe-usuario>
/queue simple print
    # cola dinámica <pppoe-usuario> con el Mikrotik-Rate-Limit del plan
/ip firewall address-list print where list=suspendidos
/interface list member print where list=suspendidos
/ip firewall filter print stats where comment~"argosisp"
/log print where topics~"radius"
```

En el servidor:

```
docker compose -f infra/docker-compose.yml ps                  # todos healthy
docker compose -f infra/docker-compose.yml logs -f freeradius aaa
docker compose -f infra/docker-compose.yml exec freeradius radiusd -XC
```

Desde el cliente PPPoE (PC o CPE detrás de `labIf`): obtiene IPv4, `/64` por SLAAC y `/56` por DHCPv6-PD; navega con el rate-limit del plan. Suspendido: `http://example.com` muestra la página de corte, el portal y los dominios del walled garden cargan, el resto no.

### Prueba de CoA y Disconnect con `radclient`

Desde el contenedor de FreeRADIUS (sale con la IP del host, que debe ser `radiusAddr`). Usa el `Acct-Session-Id` o el `User-Name` de `/ppp active print detail`:

```
# CoA: cambiar velocidad sin reconectar → CoA-ACK y la cola dinámica cambia
docker compose -f infra/docker-compose.yml exec -T freeradius \
  radclient -x <ip-del-router>:3799 coa "$RADIUS_LAB_SECRET" <<'EOF'
User-Name = "cliente-prueba"
Acct-Session-Id = "81a00003"
Mikrotik-Rate-Limit = "1M/1M"
EOF

# Disconnect-Request → Disconnect-ACK y la sesión se cierra
docker compose -f infra/docker-compose.yml exec -T freeradius \
  radclient -x <ip-del-router>:3799 disconnect "$RADIUS_LAB_SECRET" <<'EOF'
User-Name = "cliente-prueba"
Acct-Session-Id = "81a00003"
EOF
```

NAK con `Error-Cause = Session-Context-Not-Found` indica que el `Acct-Session-Id` no corresponde a una sesión activa; sin respuesta indica secret distinto, `/radius incoming` apagado o una IP de origen que el router no tiene en `/radius`.

### Comportamiento verificado de RADIUS y CoA (para A2)

Probado el 15-10-2026 en dos CHR RouterOS **7.24.5** (servidor con `lab.rsc` y cliente PPPoE), contra FreeRADIUS 3.2.10 con la config de `services/aaa/freeradius` y un `aaa` simulado:

| Prueba                                      | Resultado                                                                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PPPoE con CHAP vía RADIUS                   | Accept; IPv4 del pool, `/64` de enlace como ruta a `<pppoe-usuario>`, `/56` por DHCPv6-PD (binding `bound`), cola dinámica con `Mikrotik-Rate-Limit`; `/radius monitor` sin timeouts (rtt ~10 ms)                           |
| Accounting                                  | Accounting-On, Start y Stop llegan a `/aaa/accounting` con `Framed-IP-Address` y `Framed-IPv6-Prefix`; **no** incluyen `Delegated-IPv6-Prefix` (el /56 del pool hay que leerlo de otra forma o confirmar en Interim-Update) |
| Login con `Mikrotik-Group = "suspendido"`   | Perfil de corte completo: 256k, IPv4 + /64 + /56 en `suspendidos` (IPv4 e IPv6), interface-list; ping y TCP bloqueados, HTTP IPv4 → dst-nat al portal, TCP IPv6 → reset                                                     |
| CoA `Mikrotik-Rate-Limit`                   | CoA-ACK; la cola cambia sin reconectar                                                                                                                                                                                      |
| CoA `Mikrotik-Group = "suspendido"`         | CoA-ACK, pero **no** aplica address-list ni interface-list a la sesión viva                                                                                                                                                 |
| CoA `Mikrotik-Address-List = "suspendidos"` | CoA-ACK; agrega la IPv4 a `suspendidos` (solo IPv4). Otro valor la reemplaza; `""` no la quita                                                                                                                              |
| CoA `Filter-Id = "argos-corte.in"`          | CoA-ACK; crea `chain=ppp jump argos-corte in-interface=<pppoe-usuario>` en IPv4 **e** IPv6. Sin `.in` también crea la regla de salida, que cortaría las respuestas del portal                                               |
| CoA `Filter-Id = "argos-activo.in"`         | En IPv4 reemplaza la regla; en IPv6 **la de corte se queda** (y `""` no quita ninguna)                                                                                                                                      |
| Disconnect-Request                          | Disconnect-ACK; el cliente reconecta en segundos sin reglas ni listas residuales                                                                                                                                            |

Recomendación para `coa`:

- **Suspender sin reconectar**: un CoA con `Mikrotik-Rate-Limit` mínimo, `Mikrotik-Address-List = "suspendidos"` (filtro y redirección HTTP IPv4) y `Filter-Id = "argos-corte.in"` (filtro IPv4 e IPv6). Verificado: ping y TCP bloqueados, HTTP IPv4 redirigido al portal, TCP IPv6 con reset. Las conexiones ya en fasttrack no pasan por el filtro; si importa, Disconnect.
- **Reactivar**: Disconnect-Request. Un CoA de reactivación deja IPv6 cortado en 7.24.5. Al reconectar, `aaa` devuelve el perfil normal.
- `/aaa/authorize` de un suspendido: `Mikrotik-Group = "suspendido"` (más `Mikrotik-Rate-Limit` mínimo) cubre IPv4 e IPv6 desde el login.
- El router solo acepta CoA desde la dirección de un `/radius`: en la prueba, la IP de origen llegó sin NAT y hubo que darla de alta. En producción `coa` sale con la IP del host, que debe ser `radiusAddr`. Si no, `/log` con `topics=radius,debug` muestra `received remote request from <ip> with unknown address, dropping`.

## Seguridad

- `radiusSecret` largo y aleatorio (`openssl rand -hex 16`), distinto por router. Nunca en el repo: va en `infra/.env` del servidor y en el router.
- RouterOS 7.15+ exige `Message-Authenticator` en las respuestas (`require-message-auth=yes-for-request-resp`, mitigación de Blast-RADIUS); FreeRADIUS 3.2.10 lo envía y `clients.conf` lo exige al router.
- `allow-remote-requests=yes` del DNS se limita con las reglas `argosisp:top DNS del router solo interno` sobre `wanIf`.
- Las reglas de este script no sustituyen el firewall base del router (input desde WAN, gestión solo por IPs de administración); aplícalo antes.

## Documentación consultada

- PPP AAA (perfil y `/ppp aaa`): https://manual.mikrotik.com/docs/authentication-authorization-accounting/ppp-aaa/
- Referencia CLI `/ppp` (RouterOS 7.24): https://manual.mikrotik.com/docs/7.24/cli-reference/ppp/
- RADIUS cliente, `/radius incoming` y atributos de CoA: https://manual.mikrotik.com/docs/authentication-authorization-accounting/radius/
- PPPoE server: https://manual.mikrotik.com/docs/cli-reference/interface/pppoe-server/server
- RFC 3162 (RADIUS e IPv6), RFC 4818 (Delegated-IPv6-Prefix), RFC 5176 (CoA/Disconnect), RFC 3849 y RFC 5737 (prefijos de documentación)
