# Servidor WireGuard de los routers

Túnel entre el servidor de ArgosIsp y cada MikroTik (contrato: `.claude/integration/contratos/conexion-routers.md`). Se activa con `ARGOSISP_WIREGUARD=1` (perfil `wireguard` del compose; en producción lo activa `argosisp`, en desarrollo `COMPOSE_PROFILES=lab,wireguard`). El router se conecta con el script de conexión del panel (`infra/mikrotik/README.md`, «Conectar un router»).

## Piezas

| Servicio | Red | Qué hace |
| --- | --- | --- |
| `wireguard` (`servidor.sh`) | del **host** (`network_mode: host`, `NET_ADMIN`, `/dev/net/tun`) | Crea `wg-argos` con la `.1` de `ARGOSISP_WG_RED` y escucha `ARGOSISP_WG_PUERTO`/udp. Genera la clave privada una sola vez en el volumen `wireguard-clave` (solo este servicio lo monta). Aplica `/estado/peers/peers.conf` con `wg syncconf` cada vez que cambia (inotify sobre esa carpeta): los túneles vivos no se cortan. Escribe `/estado/servidor.json` (clave pública, IP, red, puerto, modo) y `/estado/handshakes.tsv` cada 30 s. Usa el módulo del kernel o, si falta, `wireguard-go`. |
| `wireguard-agente` (`agente.sh`) | de compose | Puente con la API, que el servidor no ve. Al arrancar y con cada `router.conexion_registrada`, `router.conexion_rotada` o `router.conexion_eliminada` (grupo `wireguard` de `argos:eventos`) pide la lista **completa** de peers (`GET internal/wireguard/peers`) y reescribe `peers.conf`: un evento repetido o perdido no deja peers de más ni de menos. Descarta (y avisa en el log) claves inválidas o IPs fuera de la red. Manda a la API la clave del servidor y el último handshake de cada peer (`POST internal/wireguard/estado`) cuando cambian, como mucho cada `ARGOSISP_WG_ESTADO_CADA_S` (60 s) y al menos cada 10 min. |

Los dos usan la imagen `argosisp/wireguard` (`Dockerfile`, Alpine, unos 45 MB). Nunca hay TTL ni sondeo de la API para los peers: solo eventos y la reconciliación al arrancar (regla 5).

### Endpoints internos que consume el agente (los implementa A1)

Con `Authorization: Bearer <AAA_INTERNAL_TOKEN>` (el `INTERNAL_TOKEN` de la API), como `internal/aaa/*`:

- `GET /api/v1/internal/wireguard/peers` → `{ data: [{ router_id, public_key, ip_tunel }] }`: todos los routers con clave registrada y no rotada, sin paginar.
- `POST /api/v1/internal/wireguard/estado` → `204`. Cuerpo:

```json
{
  "servidor": { "public_key": "…=", "ip": "10.255.0.1", "red": "10.255.0.0/16", "puerto": 51820, "interfaz": "wg-argos", "modo": "kernel" },
  "peers": [{ "public_key": "…=", "ultimo_handshake": "2026-10-28T22:26:25Z", "endpoint": "203.0.113.9:13231", "rx_bytes": 212, "tx_bytes": 92 }],
  "generado_en": "2026-10-28T22:26:58Z"
}
```

`ultimo_handshake` es `null` si el peer nunca se conectó. La API guarda `servidor.public_key` (va en la respuesta del registro y en el script) y marca cada router `conectado` si su handshake tiene menos de 3 minutos (WireGuard renegocia cada 2 y el router manda keepalive cada 25 s), `pendiente` si no. Nunca lleva claves privadas.

## Ruteo: cómo llegan api, routeros-worker, coa y freeradius a los routers

`wg-argos` vive en el host, así que la ruta `10.255.0.0/16 dev wg-argos` es del host. Los contenedores de la red de compose (`172.30.0.0/24`) no necesitan nada:

1. **Salida** (REST de `routeros-worker` y `api`, CoA de `coa`): el contenedor manda a `10.255.0.12` por su puerta de enlace (el bridge de Docker), el host lo enruta por `wg-argos` y el enmascarado de Docker (`MASQUERADE` de la red de compose) cambia el origen por la IP de la interfaz de salida: **`10.255.0.1`**. Es la IP que el router tiene en `/radius` (acepta el CoA) y en `address=` del usuario `argosisp-api`. Por eso `COA_ORIGEN_IP` queda **vacía**.
2. **Entrada** (RADIUS del router): FreeRADIUS publica 1812/1813 en `RADIUS_BIND_IP=10.255.0.1`; Docker hace DNAT al contenedor y conserva el origen (la IP del router en el túnel), que es la del cliente en `clients.d`.
3. **Arranque:** `freeradius` espera a `wireguard` sano (`depends_on` con `required: false`). Al reiniciar el servidor, Docker puede levantarlo antes que la interfaz: el instalador pone `net.ipv4.ip_nonlocal_bind=1` (`/etc/sysctl.d/90-argosisp-wireguard.conf`) para que el puerto se publique igual. En desarrollo, si `freeradius` no arranca con «cannot assign requested address», levanta `wireguard` primero o aplica ese sysctl.

Probado en el laboratorio con un CHR 7.24.5 por el túnel: `wg show` con handshake, REST con el usuario `argosisp-api` verificando el certificado del router por IP desde el host y desde un contenedor de compose, `Disconnect-Request` con `radclient` desde un contenedor (el router responde `Disconnect-NAK`: aceptó el origen `.1` y el secreto) y `Access-Request` del router llegando a la `.1:1812`.

## Firewall del túnel (`ARGOSISP_WG_FIREWALL=1`)

`servidor.sh` instala cadenas propias con el mismo backend que Docker (`iptables-nft` o `iptables-legacy`):

- `ARGOSISP-IN-wg-argos` (salto desde `INPUT`): desde el túnel al propio host solo respuestas (`ESTABLISHED,RELATED`) y ping a la `.1`; lo demás se descarta. Un router no llega al SSH del servidor ni a nada que escuche en `0.0.0.0`.
- `ARGOSISP-FWD-wg-argos` (salto desde `DOCKER-USER`, o `FORWARD` sin Docker): de router a router nada; respuestas sí; nuevas solo UDP 1812/1813 hacia la `.1` (el DNAT de RADIUS).

Docker reordena sus cadenas al reiniciarse: el servidor revisa en cada vuelta que su salto siga primero. Al detenerse borra la interfaz y sus reglas.

## Variables

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `ARGOSISP_WIREGUARD` | `0` | `1` activa el perfil (producción, con `argosisp`) |
| `ARGOSISP_WG_RED` | `10.255.0.0/16` | Red del túnel; el servidor es la `.1`, cada router una `/32` (IPAM de A1) |
| `ARGOSISP_WG_PUERTO` | `51820` | UDP público (el único puerto nuevo) |
| `ARGOSISP_WG_ENDPOINT` | `DOMINIO_API` | Nombre o IPv4 pública que reciben los routers (la API la pone en el script) |
| `ARGOSISP_WG_MTU` | `1420` | MTU de `wg-argos` (el router usa la misma) |
| `ARGOSISP_WG_MODO` | `auto` | `kernel`, `userspace` (`wireguard-go`) o `auto` |
| `ARGOSISP_WG_FIREWALL` | `1` | `0` deja el túnel sin filtrar (no recomendado) |
| `ARGOSISP_WG_ESTADO_CADA_S` | `60` | Mínimo entre envíos del estado a la API |

## Pruebas

`infra/wireguard/probar.sh` (CI, job `infra`; local con `WG_IMAGEN=argosisp/wireguard:dev` para no reconstruir): Redis, API falsa (`prueba/api_falsa.py`), servidor en la red del host, agente y un «router» en un contenedor con su propio WireGuard. Comprueba el peer aplicado por evento sin reiniciar, el descarte de peers inválidos, el handshake y el estado en la API (sin clave privada), contenedor de compose → router con origen `.1`, RADIUS por la `.1` sí y otros puertos del host no, rotación (el peer desaparece) y limpieza al detener. Tarda unos 25 s.
