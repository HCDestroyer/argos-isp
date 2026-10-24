# Validación en el MikroTik físico

Guía para el PM. Sirve para probar en el laboratorio lo que no se pudo probar en la nube, donde solo hubo CHR (RouterOS virtual). La escribió A2 (RADIUS). Está pensada para alguien que conoce MikroTik pero no el código de ArgosIsp.

Cada prueba trae lo mismo: **objetivo**, **requisitos**, **pasos** (RouterOS, servidor y cliente), **resultado esperado**, **qué enviar** y **si falla**. Todo lo que hay que enviar queda en una carpeta del servidor. Al final, un script la empaqueta en un `.tar.gz` (sección 8).

## Contenido

0. [Antes de empezar](#0-antes-de-empezar)
1. [Preparación](#1-preparación)
2. [PPPoE real con un CPE](#2-pppoe-real-con-un-cpe)
3. [RADIUS caído](#3-radius-caído)
4. [Modos de velocidad `simple` y `arbol_pcq`](#4-modos-de-velocidad-simple-y-arbol_pcq)
5. [Binding DHCPv6-PD en modo `radius_pool`](#5-binding-dhcpv6-pd-en-modo-radius_pool)
6. [IP real del cliente en el portal](#6-ip-real-del-cliente-en-el-portal)
7. [Prueba de carga de RADIUS](#7-prueba-de-carga-de-radius)
8. [Enviar los resultados](#8-enviar-los-resultados)
9. [Hoja de resultados](#9-hoja-de-resultados)

## 0. Antes de empezar

### Material

| Qué                                                                                                  | Para qué                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| MikroTik con RouterOS 7 (ver 1.1)                                                                    | Servidor PPPoE y NAS de RADIUS |
| Servidor Ubuntu 22.04/24.04 o Debian 12, 4 GB de RAM o más, en la red del MikroTik (o por WireGuard) | ArgosIsp completo              |
| Un CPE PPPoE con IPv6 (DHCPv6-PD)                                                                    | Cliente real                   |
| Una PC Linux detrás del CPE (o macOS)                                                                | Comandos del lado del cliente  |
| Un teléfono Android o iPhone por Wi-Fi del CPE                                                       | Página de corte (6)            |
| Opcional: un segundo CPE                                                                             | Reuso 1:4 (4.2)                |

### Topología

```
Internet ─ ether1 (wanIf)  MikroTik  ether2 (labIf) ─ CPE PPPoE ─ PC cliente
                              │
                              └─ LAN o WireGuard ─ Servidor ArgosIsp (FreeRADIUS 1812/1813, CoA → 3799)
```

### Cómo leer los pasos

- `[RouterOS]`: en la terminal del MikroTik (Winbox → New Terminal, o SSH).
- `[Servidor]`: en el servidor de ArgosIsp, en la carpeta del repositorio. Lo más simple es trabajar como root: `sudo -i` y `cd /root/argos-isp` (1.3, paso 4). Los ejemplos llevan `sudo -E` para que también sirvan desde otro usuario.
- `[Cliente]`: en la PC detrás del CPE.
- Lo que va entre `< >` se cambia por el valor real. Todo lo demás se copia tal cual.
- Los resultados quedan en `/root/argosisp-lab/salida/<prueba>/`. Los scripts los guardan solos. Si un paso dice «pega en», copia la salida de la terminal en ese archivo.

### Para no copiar a mano lo de RouterOS (recomendado)

`scripts/laboratorio/ros.sh` y otros scripts corren comandos de RouterOS por SSH y guardan la salida. Una vez:

```sh
# [Servidor] clave SSH para el router
sudo ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519
sudo cat /root/.ssh/id_ed25519.pub     # copia la línea
```

```
# [RouterOS] pega la línea en un archivo y súbelo como clave del admin
/file add name=argosisp.pub contents="<la línea de id_ed25519.pub>"
/user ssh-keys import public-key-file=argosisp.pub user=admin
```

```sh
# [Servidor] prueba; de aquí en adelante, exporta LAB_ROUTER_SSH antes de cada script
export LAB_ROUTER_SSH=admin@<ip del router>
sudo ssh -o BatchMode=yes "$LAB_ROUTER_SSH" '/system identity print'
```

Usa `sudo -E` para que los scripts vean `LAB_ROUTER_SSH` (todos los ejemplos lo hacen). Sin SSH, los scripts te dicen qué comando correr en el router y en qué archivo pegar la salida.

## 1. Preparación

### 1.1 Versiones de RouterOS

| Versión          | Dónde se probó            | Qué se probó                                                                                                                       |
| ---------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **7.24.5**       | Dos CHR (15 y 16-10-2026) | Todo `lab.rsc`, PPPoE con RADIUS, IPv6 (/64 + /56), CoA, Disconnect, perfil de corte, binding DHCPv6-PD, API REST, WISP, FastTrack |
| 7.15 o más nueva | —                         | Mínimo: desde 7.15 RouterOS exige `Message-Authenticator` (Blast-RADIUS) y la configuración ya lo cumple                           |
| 6.x              | —                         | No sirve: `lab.rsc` y la API REST son de RouterOS 7                                                                                |

Usa **7.24.5** en el equipo físico. Así lo único que cambia respecto de lo probado es el hardware.

```
# [RouterOS] versión y equipo
/system resource print
/system routerboard print
# si hace falta, pasar a 7.24.5 (con internet en el router)
/system package update set channel=stable
/system package update check-for-updates
```

Si el canal estable ya pasó de 7.24.5, baja el paquete exacto de mikrotik.com (arquitectura del equipo), súbelo a Files y reinicia. Anota la versión que quede: va en la hoja de resultados.

### 1.2 Aplicar `infra/mikrotik/lab.rsc` en el MikroTik físico

**Objetivo.** Dejar el router igual que el CHR de las pruebas: PPPoE dual-stack, RADIUS, CoA, corte y usuario de API.

**Requisitos.** Router con el firewall base ya puesto (gestión solo desde tu red). Acceso por Winbox o SSH.

1. Respaldo:

    ```
    # [RouterOS]
    /system backup save name=antes-argosisp
    /export file=antes-argosisp
    ```

2. Edita **solo** el bloque «Variables» al principio de `infra/mikrotik/lab.rsc` (en tu PC). Las que siempre hay que cambiar:

    | Variable              | Valor                                                                 | Anótalo para              |
    | --------------------- | --------------------------------------------------------------------- | ------------------------- |
    | `labIf`               | Interfaz (o bridge) donde va el CPE                                   | —                         |
    | `wanIf`               | Interfaz hacia internet                                               | —                         |
    | `radiusAddr`          | IP del **servidor** como la ve el router (LAN o túnel)                | `RADIUS_BIND_IP` (1.3)    |
    | `radiusAddr2`         | Vacío por ahora (se usa en 3.2)                                       | —                         |
    | `radiusSrc`           | IP del **router** hacia el servidor                                   | `LAB_NAS_IP` (1.5)        |
    | `radiusSecret`        | `openssl rand -hex 16`                                                | `LAB_RADIUS_SECRET` (1.5) |
    | `portalV4`            | IP del servidor (el proxy de ArgosIsp sirve `/corte` en el puerto 80) | —                         |
    | `portalFqdn`          | `portal.<tu dominio>`                                                 | —                         |
    | `dnsV4`, `dnsV6`      | Tus resolvedores                                                      | —                         |
    | `apiPassword`         | `openssl rand -base64 24`                                             | `LAB_API_PASSWORD` (1.5)  |
    | `apiDesde`            | IP del servidor con `/32`                                             | —                         |
    | `apiNombre`, `apiIp`  | Nombre e IP con que el servidor llega al router                       | `LAB_API_HOST` (1.5)      |
    | `arbolEjemplo`        | `false` (ArgosIsp crea su árbol en la prueba 4)                       | —                         |
    | `wgHabilitar` y `wg*` | Solo si el servidor no está en la LAN del router                      | —                         |

    No cambies los pools ni los prefijos IPv6 si no hace falta. Los scripts usan los de `lab.rsc` (pools del router `2001:db8:100::/48` y `2001:db8:200::/40`; IPAM de ArgosIsp `10.10.1.0/24` y `2001:db8:300::/40`). Si cambias `clientesV6`, el prefijo del IPAM (`LAB_BLOQUE_V6`) debe seguir dentro.

3. Activa Safe Mode si trabajas a distancia (`Ctrl+X` en la terminal).
4. Sube y aplica:

    ```sh
    # [PC con el repo]
    scp infra/mikrotik/lab.rsc admin@<router>:lab.rsc
    ```

    ```
    # [RouterOS]
    /import file-name=lab.rsc verbose=yes
    ```

5. Copia la CA del router para la API REST (la usa el servidor en 1.5):

    ```sh
    # [Servidor]
    sudo mkdir -p /root/argosisp-lab && sudo scp admin@<router>:argosisp-ca.crt /root/argosisp-lab/
    ```

**Resultado esperado.** El import termina con `argosisp: FastTrack OK` y `lab.rsc aplicado`, sin errores en rojo. `/radius print` muestra una entrada `argosisp: aaa nodo 1` con `timeout=1s`. `/radius incoming print` muestra `accept: yes port: 3799`.

**Qué enviar.** Lo junta `00-entorno.sh` (1.5). Si el import dio errores, pega toda la salida del `/import` en `/root/argosisp-lab/salida/00-entorno/import-lab-rsc.txt`.

**Si falla.** `/system backup load name=antes-argosisp` devuelve el router a como estaba. El error del import dice la línea; casi siempre es una interfaz que no existe (`labIf`, `wanIf`) o una IP mal escrita. `FastTrack MAL` quiere decir que una regla `fasttrack-connection` quedó antes de las de ArgosIsp: muévela debajo o desactívala y reaplica.

### 1.3 Instalar ArgosIsp 1.0.0 en el servidor

**Objetivo.** Tener la misma instalación que tendrá un cliente: imágenes publicadas, sin código fuente.

**Requisitos.** Servidor limpio (ver `docs/runbooks/instalacion.md`). TCP 80 y 443 y UDP 1812 y 1813 libres. Un dominio base, real o de laboratorio.

1. Instala la versión exacta 1.0.0:

    ```sh
    # [Servidor] con DNS público y 443 abierto a internet (Let's Encrypt)
    curl -fsSL https://github.com/HCDestroyer/argos-isp/releases/download/v1.0.0/instalar.sh \
      | sudo bash -s -- --version 1.0.0 --dominio <tu-dominio> --correo <tu-correo> --si

    # [Servidor] laboratorio sin DNS público: certificados de una CA interna
    curl -fsSL https://github.com/HCDestroyer/argos-isp/releases/download/v1.0.0/instalar.sh \
      | sudo ARGOSISP_TLS=interno bash -s -- --version 1.0.0 --dominio lab.argosisp.test --correo <tu-correo> --si
    ```

    Al final muestra la URL del panel y la clave del admin (también en `/opt/argosisp/credenciales-iniciales.txt`).

2. Configura RADIUS en `/opt/argosisp/.env`:

    ```sh
    # [Servidor]
    sudo sed -i 's/^RADIUS_BIND_IP=.*/RADIUS_BIND_IP=<radiusAddr de lab.rsc>/' /opt/argosisp/.env
    sudo argosisp levantar
    sudo argosisp estado        # todo "healthy"
    ```

    Deja `COA_ORIGEN_IP` vacía. `coa` corre en un contenedor; la IP de salida la pone el NAT del servidor según su ruta hacia el router. Esa IP debe ser `radiusAddr` (el router solo acepta CoA desde una dirección de `/radius`). Con WireGuard o con el servidor en la misma LAN se cumple solo.

3. Si el cliente no resuelve tu dominio (laboratorio sin DNS público), agrégalo al DNS del router:

    ```
    # [RouterOS]
    /ip dns static add name=portal.<tu-dominio> address=<IP del servidor> comment="lab: portal"
    /ip dns static add name=api.<tu-dominio> address=<IP del servidor> comment="lab: api"
    ```

4. Clona el repositorio en el servidor. Solo se usan los scripts de laboratorio; ArgosIsp sigue corriendo con las imágenes:

    ```sh
    # [Servidor]
    sudo apt-get install -y git
    sudo git clone https://github.com/HCDestroyer/argos-isp.git /root/argos-isp
    cd /root/argos-isp
    ```

**Resultado esperado.** `sudo argosisp estado` muestra la versión 1.0.0 y todos los servicios sanos, incluidos `aaa`, `coa`, `freeradius`, `sesiones-worker`, `routeros-worker` y `aaa-vigia`.

**Si falla.** `sudo argosisp logs migrate api` y `docs/runbooks/instalacion.md`, «Problemas». El instalador no se repite sobre una instalación con `.env`: corrige y usa `sudo argosisp levantar`.

### 1.4 Datos de demostración (opcional)

Para ver el panel con clientes, facturas y pagos de ejemplo. No son necesarios para las pruebas de red. Sus dos routers tienen IPs de ejemplo y no tocan tu MikroTik.

```sh
# [Servidor]
sudo scripts/laboratorio/demo.sh
```

Corre `scripts/demo/datos.mjs` (el mismo `pnpm demo:datos`) en un contenedor Node de un solo uso. Termina con `ok { creados: … }`. Es idempotente: se puede repetir. Si ya cambiaste la clave del admin: `sudo LAB_PASSWORD='<clave>' scripts/laboratorio/demo.sh`.

### 1.5 Datos del laboratorio y foto del entorno

**Objetivo.** Dar de alta tu MikroTik en ArgosIsp y crear los servicios de prueba. Dejar registro de versiones y configuración.

**Requisitos.** 1.2 y 1.3 hechos. Los valores que anotaste en 1.2.

```sh
# [Servidor]
sudo -E LAB_NAS_IP=<radiusSrc> LAB_RADIUS_SECRET='<radiusSecret>' \
     LAB_API_HOST=<apiIp> LAB_API_PASSWORD='<apiPassword>' LAB_API_CA=/root/argosisp-lab/argosisp-ca.crt \
     scripts/laboratorio/01-datos.sh
sudo -E scripts/laboratorio/00-entorno.sh
```

`01-datos.sh` crea, por la API y con auditoría, como lo haría un operador:

| Qué             | Valor                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router          | «Laboratorio físico», NAS-IP = `LAB_NAS_IP`, modo `simple`, con la API REST                                                                        |
| Redes           | IPv4 `10.10.1.0/24`; IPv6 enlace `2001:db8:300::/48` (/64) y delegación `2001:db8:380::/41` (/56)                                                  |
| Planes          | `Lab 10M` (10/5 Mbps), `Lab 20M` (20/10), `Lab reuso4` (20/10, 1:4); limitado 2/1 Mbps; perfil `default` y pools `argos-v6-enlace` / `argos-v6-pd` |
| Servicios PPPoE | `lab-cpe1` y `lab-cpe2` activos; `lab-limitado`, `lab-suspendido`, `lab-retirado`                                                                  |

Las contraseñas PPPoE quedan en `/root/argosisp-lab/credenciales-lab.txt` (solo root; nunca se envían). Configura el CPE con `lab-cpe1` y su contraseña de ese archivo.

Al final corre `argosisp radius-clientes`: escribe el cliente de FreeRADIUS de tu router (con `LAB_NAS_IP` y el secret) y reinicia FreeRADIUS.

**Resultado esperado.** `01-datos/servicios.txt` lista los cinco servicios con IPv4 de `10.10.1.0/24`, un /64 y un /56. `00-entorno/freeradius-clientes.txt` muestra un `router-<id>.conf` con `ipaddr = <radiusSrc>`. `00-entorno/freeradius-config.txt` termina en `Configuration appears to be OK`.

**Qué enviar.** Las carpetas `00-entorno` y `01-datos` (las junta el paquete de la sección 8).

**Si falla.** El script muestra la llamada que falló y la respuesta de la API (`problem+json`). Los casos típicos:

- `pool_traslapado` o `bloque`: los prefijos chocan con otros ya cargados; usa otros con `LAB_BLOQUE_V6`, `LAB_POOL_ENLACE` y `LAB_POOL_DELEGACION`, dentro de `clientesV6` de `lab.rsc`.
- 422 en `nas_ip`: otro router ya tiene esa IP.
- Login falló: cambiaste la clave del admin; pásala con `LAB_PASSWORD='…'`.

## 2. PPPoE real con un CPE

Lo que se probó en la nube con `radtest` y en CHR, ahora con un CPE real (`services/aaa/README.md`, «Prueba con radtest»). Criterios del brief de A2:

- Un cliente PPPoE autentica, recibe IPv4 + /64 + /56 y el rate-limit de su plan.
- Suspender desde la API → CoA → en menos de 5 s está en `suspendidos` y con rate-limit mínimo, sin reconectar.
- Reactivar → en menos de 5 s navega con su plan.
- Cambiar prefijo → Disconnect → al reconectar trae el prefijo nuevo.
- Cada CoA aparece en `audit.red` con la respuesta del NAS.

Carpeta: `02-pppoe`.

### 2.1 Autorización por estado (sin CPE)

**Objetivo.** Que el FreeRADIUS de producción conteste bien a cada estado antes de conectar el CPE.

```sh
# [Servidor]
sudo -E scripts/laboratorio/radtest.sh
```

**Resultado esperado.** Todas las líneas terminan en `OK`:

| Usuario                                    | Respuesta     | Atributos que deben verse                                                                                                                      |
| ------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `lab-cpe1`, `lab-cpe2`                     | Access-Accept | `Mikrotik-Rate-Limit` de 10M/5M, `Framed-IP-Address`, `Framed-IPv6-Prefix` (/64), `Delegated-IPv6-Prefix` (/56), `Acct-Interim-Interval = 300` |
| `lab-limitado`                             | Access-Accept | `Mikrotik-Rate-Limit` de 2M/1M                                                                                                                 |
| `lab-suspendido`                           | Access-Accept | `256k/256k`, `Mikrotik-Group = "suspendido"`, `Mikrotik-Address-List = "suspendidos"`, `Filter-Id = "argos-corte.in"`, más sus IPs             |
| `lab-retirado`, inexistente, clave errónea | Access-Reject | —                                                                                                                                              |

**Qué enviar.** `02-pppoe/radtest.txt` (sin contraseñas: el script las quita).

**Si falla.** Un Reject inesperado se explica en el log de `aaa`: `sudo argosisp logs aaa | grep post-auth`. Un 500 (`authorize: pass_ppp`) es `AAA_PPP_KEY` distinta entre `aaa` y la API (no debería pasar con `instalar.sh`). `sin respuesta`: FreeRADIUS caído (`sudo argosisp estado`).

### 2.2 Conexión del CPE y atributos

**Objetivo.** El CPE entra por RADIUS y recibe velocidad, IPv4, /64 y /56.

**Requisitos.** CPE en `labIf` con PPPoE (`lab-cpe1`), IPv6 activado y DHCPv6-PD pidiendo prefijo (`/56`).

1. Conecta el CPE. Luego:

    ```sh
    # [Servidor]
    sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 ver
    sudo -E scripts/laboratorio/ros.sh 02-pppoe router-conexion '/ppp active print detail' \
        '/radius monitor 0 once' '/ipv6 dhcp-server binding print detail' '/ipv6 route print detail where dynamic' \
        '/queue simple print detail where dynamic' '/log print where topics~"radius|pppoe"'
    ```

    Sin SSH, corre esos seis comandos en el router y pega la salida en `02-pppoe/router-conexion.txt`.

2. En la PC detrás del CPE (copia `scripts/laboratorio/cliente.sh` a la PC):

    ```sh
    # [Cliente]
    CLIENTE_VELOCIDAD=1 bash cliente.sh 02-pppoe-activo portal.<tu-dominio>
    ```

    Copia el archivo `cliente-02-pppoe-activo-*.txt` al servidor, a `/root/argosisp-lab/salida/02-pppoe/`.

**Resultado esperado.**

- `/ppp active`: `lab-cpe1`, `address` = la IPv4 de `01-datos/servicios.txt`, `radius=yes`.
- `/radius monitor 0`: `accepts` sube, `timeouts` en 0.
- `/ipv6 dhcp-server binding`: el /56 de la tabla, `server=<pppoe-lab-cpe1>`, `status=bound`.
- `/ipv6 route`: el /64 y el /56 de la tabla hacia `<pppoe-lab-cpe1>`.
- `/queue simple`: cola dinámica `<pppoe-lab-cpe1>` con `max-limit=5M/10M` (subida/bajada del cliente).
- Cliente: IPv4 e IPv6 navegan; velocidad de bajada cerca de 10 Mbps.

**Qué enviar.** `02-pppoe/servicio-lab-cpe1.txt`, `router-conexion.txt` y `cliente-02-pppoe-activo-*.txt`.

**Si falla.**

- El CPE no conecta: `/log print where topics~"radius"`. `timeout` = el router no llega al servidor o FreeRADIUS no reconoce su IP (revisa `radiusSrc` = `LAB_NAS_IP` y que exista `router-<id>.conf`). `rejected` = ver 2.1.
- Sin /56: el CPE no pide prefijo. Revisa la configuración IPv6 del CPE.
- La cola no limita: `/system script run argosisp-verificar-fasttrack`.

### 2.3 Accounting

**Objetivo.** Start, Interim-Update y Stop llegan y quedan en `network.sesiones`.

1. Con `lab-cpe1` conectado, espera 6 minutos (un Interim cada 300 s).
2. Desconecta el CPE (apágalo o desenchufa el cable) y vuelve a conectarlo.
3. Recoge:

    ```sh
    # [Servidor]
    sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 ver
    sudo -E scripts/laboratorio/recoger.sh 02-pppoe 20
    ```

**Resultado esperado.** En `servidor-sesiones.txt`: la sesión vieja con `fin` y `causa_fin` (`Lost-Carrier`, `Lost-Service` o `User-Request`), la nueva abierta con `ipv4`, `prefijo_enlace_v6` y `prefijo_delegado_v6`, y `bytes_in`/`bytes_out` mayores que 0 tras el Interim. En `servidor-eventos.txt`: `sesion.iniciada` y `sesion.terminada`.

**Si falla.** Sin sesión: `servidor-log-aaa.txt` (líneas `accounting`) y `servidor-log-sesiones-worker.txt`. `accounting: no se pudo encolar` = Redis.

### 2.4 Cambio de plan por CoA

**Objetivo.** Cambiar el plan cambia la velocidad sin reconectar.

```sh
# [Servidor]
sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 plan 20M
```

```
# [RouterOS] la cola cambia y el uptime NO vuelve a cero
/queue simple print detail where name="<pppoe-lab-cpe1>"
/ppp active print detail where name="lab-cpe1"
```

**Resultado esperado.** El script imprime `coa: ok, resultado ack, a los N ms` con N menor que 5000. La cola pasa a `max-limit=10M/20M`. El `uptime` de la sesión sigue contando. Vuelve al plan original con `… plan 10M`.

**Qué enviar.** `02-pppoe/servicio-lab-cpe1.txt` y la salida de RouterOS en `02-pppoe/router-plan.txt`.

**Si falla.** `resultado timeout`: el CoA no llegó o el router lo descartó. En el router: `/system logging add topics=radius,debug` y `/log print where topics~"radius"`. `unknown address, dropping` = la IP de origen del CoA no está en `/radius` (ver 1.3, `COA_ORIGEN_IP`). `nak` con `Session-Context-Not-Found` = el `Acct-Session-Id` no coincide: envía `servidor-audit-red` de `recoger.sh`.

### 2.5 Corte (suspender)

**Objetivo.** Suspender por la API pone al cliente en corte en menos de 5 s, sin reconectar. IPv4 ve `/corte`; IPv6 falla al instante (decisión del PM: sin NAT IPv6, `infra/mikrotik/README.md`, «Corte por IPv6»).

```sh
# [Servidor]
sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 suspender
```

```
# [RouterOS]
/ip firewall address-list print where list=suspendidos
/ip firewall filter print dynamic where chain=ppp
/ipv6 firewall filter print dynamic where chain=ppp
/queue simple print detail where name="<pppoe-lab-cpe1>"
/ppp active print detail where name="lab-cpe1"
```

```sh
# [Cliente] apenas el script diga "coa: ok"
bash cliente.sh 02-pppoe-suspendido portal.<tu-dominio>
```

Con el teléfono: conéctate al Wi-Fi del CPE y abre `http://example.com`. Cronometra cuánto tarda en salir la página de corte. Anota si apareció el aviso «Iniciar sesión en la red».

**Resultado esperado.**

- `coa: ok, resultado ack` a menos de 5000 ms.
- La IPv4 del cliente en `suspendidos`. Regla dinámica `chain=ppp … jump argos-corte` en IPv4 e IPv6. Cola en `256k/256k`. `uptime` sin reiniciar.
- Cliente: `curl -4 http://example.com/` devuelve la página de corte. `curl -6` y HTTPS fallan en milisegundos (`Connection reset`), no por timeout. `ping -6` responde «Administratively prohibited».
- Teléfono: página de corte en menos de 3 s.

**Qué enviar.** `servicio-lab-cpe1.txt`, `cliente-02-pppoe-suspendido-*.txt`, la salida del router en `02-pppoe/router-corte.txt` y una nota en `02-pppoe/telefono.txt` (modelo, sistema, segundos, si apareció el aviso).

**Si falla.** HTTP IPv4 no llega a `/corte`: revisa `portalV4` y que el 80 del servidor responda (`curl -i http://<portalV4>/` desde el router: `/tool fetch url=http://<portalV4>/ keep-result=no`). IPv6 tarda: busca reglas con `drop` en `argos-corte` de IPv6 (no debe haber). Conexiones que siguen abiertas: FastTrack (`argosisp-verificar-fasttrack`).

### 2.6 Reactivar

**Objetivo.** Reactivar devuelve el plan completo en menos de 5 s. Se hace con Disconnect: el CPE reconecta y entra con el perfil normal (en 7.24.5 un CoA de reactivación deja IPv6 cortado).

```sh
# [Servidor]
sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 reactivar
```

```sh
# [Cliente] cuando el script diga "reconectó"
bash cliente.sh 02-pppoe-reactivado portal.<tu-dominio>
```

**Resultado esperado.** `disconnect: ok, resultado ack` y `reconectó a los N s`. Anota N: el criterio es menos de 5 s hasta navegar. Sin entradas en `suspendidos` ni reglas `chain=ppp` de corte. IPv4 e IPv6 navegan.

**Qué enviar.** `servicio-lab-cpe1.txt` y `cliente-02-pppoe-reactivado-*.txt`.

**Si falla.** Si reconecta en más de 5 s, envía `/log print where topics~"pppoe|ppp"` del router: el tiempo lo pone el CPE (cuánto espera antes de volver a marcar). Anótalo en la hoja; no es un fallo de ArgosIsp, pero cambia el criterio.

### 2.7 Limitar y quitar el límite

```sh
# [Servidor]
sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 limitar
sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 quitar-limite
```

**Resultado esperado.** Dos CoA con `ack`. La cola pasa a `1M/2M` y vuelve a `5M/10M`, sin reconectar.

### 2.8 Cambio de IP y de prefijo (Disconnect)

**Objetivo.** Un cambio de IPv4 o de prefijo IPv6 desconecta, y la sesión nueva trae lo nuevo.

```sh
# [Servidor] IPv4 nueva (elige una libre de 10.10.1.0/24, p. ej. .200)
sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 ipv4 10.10.1.200
# Prefijo IPv6: pasar a pool y volver a IPs fijas (el IPAM entrega /64 y /56 de nuevo)
sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 ipv6 radius_pool
sudo -E scripts/laboratorio/servicio.sh 02-pppoe lab-cpe1 ipv6 radius_servicio
```

**Resultado esperado.** Cada cambio: `disconnect: ok` y `reconectó a los N s` con la IPv4 o los prefijos nuevos. Anota si al volver a `radius_servicio` el IPAM entregó el mismo /64 y /56 de antes o otros (las dos cosas son válidas; lo importante es que la sesión traiga lo que dice ArgosIsp). La prueba 5 usa el paso intermedio (`radius_pool`).

### 2.9 Retirado

`servicio.sh` no tiene `retirar` a propósito: no tiene vuelta atrás. Para esta prueba basta el radtest de 2.1 (`lab-retirado` → Reject). Si quieres verlo con el CPE: configúralo con `lab-retirado` y su contraseña. Esperado: no conecta y `/log` del router dice `authentication failed`.

Al terminar la sección: `sudo -E scripts/laboratorio/recoger.sh 02-pppoe 60`.

## 3. RADIUS caído

Las cuatro filas «Pendiente de laboratorio» de `docs/runbooks/aaa-caido.md` (sección «Probado y pendiente»). Carpeta: `03-aaa-caido`. Detener FreeRADIUS en este servidor de laboratorio no afecta a nadie más.

### 3.1 Las sesiones activas siguen sin RADIUS

**Objetivo.** Confirmar que el MikroTik no corta sesiones vivas cuando RADIUS no responde.

1. Con `lab-cpe1` conectado y navegando:

    ```sh
    # [Servidor]
    sudo -E scripts/laboratorio/ros.sh 03-aaa-caido antes '/ppp active print detail'
    sudo argosisp compose stop freeradius; date -u
    ```

2. Espera **12 minutos** (más de dos Interim-Update). En el cliente, deja corriendo `ping 1.1.1.1` y anota si se corta.
3. Revisa y vuelve a levantar:

    ```sh
    # [Servidor]
    sudo -E scripts/laboratorio/ros.sh 03-aaa-caido durante '/ppp active print detail' \
        '/radius monitor 0 once' '/log print where topics~"radius"'
    sudo argosisp compose start freeradius
    sudo -E scripts/laboratorio/recoger.sh 03-aaa-caido 20
    ```

**Resultado esperado.** La sesión sigue con el mismo `uptime` y el ping no se corta. `/radius monitor` muestra `timeouts` subiendo (los Interim que no llegaron). Al volver FreeRADIUS, la sesión sigue en `network.sesiones` y el siguiente Interim la actualiza.

**Si falla.** Si el router corta la sesión, anota a los cuántos minutos y envía el `/log`. Es un hallazgo importante: cambia el runbook.

### 3.2 Failover a la segunda entrada `/radius`

**Objetivo.** Con dos entradas en `/radius`, si la primera no responde, el router usa la segunda sin intervención.

**Requisitos.** Una segunda IP del servidor que el router alcance (otra IP en la misma LAN). Los dos «nodos» son el mismo servidor: la caída del nodo 1 se simula en el router, que deja de alcanzar la primera IP. Así se prueba lo que hace RouterOS, que es lo pendiente; dos servidores `aaa` de verdad quedan para cuando exista el segundo nodo.

1. Segunda IP en el servidor y FreeRADIUS escuchando en todas:

    ```sh
    # [Servidor] (temporal: se pierde al reiniciar)
    sudo ip addr add <IP2>/24 dev <interfaz LAN del servidor>
    sudo sed -i 's/^RADIUS_BIND_IP=.*/RADIUS_BIND_IP=0.0.0.0/' /opt/argosisp/.env
    sudo argosisp levantar
    ```

    Con `0.0.0.0` FreeRADIUS queda abierto en todas las IPs del servidor: limita UDP 1812/1813 a la IP del router en el firewall del servidor mientras dure la prueba.

2. Segunda entrada en el router (o pon `radiusAddr2 = <IP2>` en `lab.rsc` y reaplica):

    ```
    # [RouterOS]
    /radius add service=ppp address=<IP2> secret=<radiusSecret> src-address=<radiusSrc> timeout=1s comment="argosisp: aaa nodo 2"
    /ip firewall filter add chain=input protocol=udp dst-port=3799 src-address=<IP2> action=accept comment="argosisp:top CoA desde aaa nodo 2" place-before=0
    /radius print
    ```

3. Simula la caída del nodo 1 (el router deja de alcanzarlo):

    ```
    # [RouterOS]
    /ip firewall filter add chain=output protocol=udp dst-address=<radiusAddr> dst-port=1812,1813 action=drop comment="lab: nodo 1 caido" place-before=0
    ```

4. Deja midiendo en el servidor y, en cuanto empiece, corta la sesión en el router:

    ```sh
    # [Servidor] queda esperando la sesión nueva
    sudo -E scripts/laboratorio/esperar-sesion.sh 03-aaa-caido lab-cpe1
    ```

    ```
    # [RouterOS]
    /ppp active remove [find name="lab-cpe1"]
    ```

    ```sh
    # [Servidor] cuando vuelva
    sudo -E scripts/laboratorio/ros.sh 03-aaa-caido failover '/radius monitor 0 once' '/radius monitor 1 once' \
        '/log print where topics~"radius|pppoe"'
    ```

5. Prueba un CoA con el nodo 1 caído: `sudo -E scripts/laboratorio/servicio.sh 03-aaa-caido lab-cpe1 limitar` y luego `quitar-limite`.
6. Deshaz: `/ip firewall filter remove [find comment="lab: nodo 1 caido"]` en el router; en el servidor `RADIUS_BIND_IP` vuelve a su valor y `sudo argosisp levantar`.

**Resultado esperado.** El CPE vuelve a entrar. `/radius monitor 0` suma timeouts y `/radius monitor 1` suma accepts. Anota los segundos de `esperar-sesion.sh`. El CoA llega igual (sale del servidor, no depende de la entrada `/radius`).

**Si falla.** Si el CPE no vuelve, envía el `/log`: puede que el CPE se rinda antes de que el router pruebe el nodo 2 (1 s por intento, más reintentos). Anota cuántos intentos hizo el CPE.

### 3.3 Secrets de emergencia en el router

**Objetivo.** Probar el último recurso del runbook (`docs/runbooks/aaa-caido.md`, paso 3): exportar los clientes como `/ppp secret` locales, importarlos, que tengan prioridad, y quitarlos. Detalle del comando: `apps/api/app/operacion/README.md`.

1. Exporta los secrets del router del laboratorio (el `.rsc` lleva contraseñas: queda fuera de la carpeta de salida):

    ```sh
    # [Servidor]
    R=$(sudo jq -r .router_id /root/argosisp-lab/salida/01-datos/datos.json)
    sudo install -d -m 700 -o 1000 -g 1000 /root/argosisp-lab/emergencia
    sudo argosisp compose run --rm --no-deps -v /root/argosisp-lab/emergencia:/salida api \
        node ace.js emergencia:secrets-ppp "$R" --salida=/salida/argosisp-emergencia.rsc \
        | sudo tee /root/argosisp-lab/salida/03-aaa-caido/emergencia-resumen.txt
    sudo scp /root/argosisp-lab/emergencia/argosisp-emergencia.rsc admin@<router>:
    ```

2. Con RADIUS caído:

    ```sh
    # [Servidor]
    sudo argosisp compose stop freeradius
    ```

    ```
    # [RouterOS]
    /import file-name=argosisp-emergencia.rsc verbose=yes
    /ppp profile print detail where comment="argosisp-emergencia"
    /ppp secret print detail where comment="argosisp-emergencia"
    /ppp active remove [find name="lab-cpe1"]
    ```

    Espera a que el CPE vuelva y revisa `/ppp active print detail where name="lab-cpe1"` y `/queue simple print detail where dynamic`. `lab-suspendido` también debe estar en el archivo con el perfil `suspendido`; `lab-retirado`, no.

3. Prioridad con RADIUS vivo: `sudo argosisp compose start freeradius` y en el router `/ppp active remove [find name="lab-cpe1"]` otra vez. Mira en `/ppp active print detail` si la sesión nueva dice `radius=no` (entró por el secret local) o `radius=yes`.
4. Retiro:

    ```
    # [RouterOS]
    /ppp secret remove [find comment="argosisp-emergencia"]
    /ppp profile remove [find comment="argosisp-emergencia"]
    /ppp active remove [find name="lab-cpe1"]
    /file remove argosisp-emergencia.rsc
    ```

    ```sh
    # [Servidor]
    sudo rm -f /root/argosisp-lab/emergencia/argosisp-emergencia.rsc
    sudo -E scripts/laboratorio/ros.sh 03-aaa-caido despues-emergencia '/ppp active print detail where name="lab-cpe1"'
    ```

**Resultado esperado.** El import no da errores (`copy-from` en `/ppp profile add` y `remote-ipv6-prefix` en el secret los acepta 7.24.5). Sin RADIUS el CPE entra con `radius=no`, su IPv4 fija, su /64 y la velocidad del plan; el /56 sale del pool del perfil (limitación conocida). Con RADIUS vivo el secret local gana (`radius=no`): por eso se quita en cuanto vuelve `aaa`. Tras el retiro, la sesión nueva dice `radius=yes`.

**Qué enviar.** `emergencia-resumen.txt` (sin contraseñas), la salida del import y de los `print` en `03-aaa-caido/router-emergencia.txt` (**sin** `/ppp secret print` con `show-sensitive`). Nunca el `.rsc`.

**Si falla.** Copia el error del import tal cual: dice qué propiedad no acepta esta versión. Si el secret local no gana con RADIUS vivo, anótalo: el runbook dice lo contrario y hay que corregirlo.

### 3.4 Reintento de los CPE

**Objetivo.** Medir cuánto tarda un CPE típico en volver a entrar cuando RADIUS regresa.

1. Con FreeRADIUS detenido, desconecta la sesión y deja que el CPE intente durante 3 minutos:

    ```sh
    # [Servidor]
    sudo argosisp compose stop freeradius
    ```

    ```
    # [RouterOS]
    /system logging add topics=pppoe,debug action=memory comment="lab: reintentos"
    /ppp active remove [find name="lab-cpe1"]
    ```

2. Pasados 3 minutos, levanta FreeRADIUS y mide hasta la sesión nueva:

    ```sh
    # [Servidor]
    sudo -E scripts/laboratorio/esperar-sesion.sh 03-aaa-caido lab-cpe1 --iniciar-freeradius
    sudo -E scripts/laboratorio/ros.sh 03-aaa-caido reintentos '/log print where topics~"pppoe|radius"'
    ```

    ```
    # [RouterOS] al terminar
    /system logging remove [find comment="lab: reintentos"]
    ```

3. Repite con cada modelo de CPE que tengas (y, si puedes, apagando y encendiendo el CPE en vez de `remove`).

**Resultado esperado.** `sesión nueva a los N s`. En el `/log`, el intervalo entre intentos del CPE (las líneas `PADI` o `authentication failed`). Anota modelo, firmware, intervalo y N en la hoja de resultados.

Al terminar la sección: `sudo -E scripts/laboratorio/recoger.sh 03-aaa-caido 120`.

## 4. Modos de velocidad `simple` y `arbol_pcq`

Filas abiertas de `.claude/integration/a2.md` (reuso en `simple` y `arbol_pcq`) y `apps/api/app/network/routeros/README.md`, «Pendiente». Carpeta: `04-velocidad`.

**Requisitos.** El router tiene la API REST (1.5 con `LAB_API_PASSWORD` y `LAB_API_CA`) y `arbolEjemplo false` en `lab.rsc`. Comprueba la API:

```sh
# [Servidor]
sudo curl -sS --cacert /root/argosisp-lab/argosisp-ca.crt -u 'argosisp-api:<apiPassword>' https://<apiIp>/rest/system/identity
```

Debe responder `{"name":"…"}`. Si falla por el certificado, revisa que `apiIp`/`apiNombre` de `lab.rsc` sean los que usaste en `LAB_API_HOST`.

### 4.1 `simple` con reuso 1:4

**Objetivo.** Un plan con reuso crea su cola padre y su perfil PPP, y las colas de los clientes cuelgan de él.

1. Pasa los dos CPE al plan con reuso (cada cambio desconecta: el perfil `plan-<id>` solo se asigna al conectar):

    ```sh
    # [Servidor]
    sudo -E scripts/laboratorio/servicio.sh 04-velocidad lab-cpe1 plan reuso4
    sudo -E scripts/laboratorio/servicio.sh 04-velocidad lab-cpe2 plan reuso4   # si tienes el segundo CPE
    ```

2. Revisa:

    ```
    # [RouterOS]
    /queue simple print detail where comment~"argosisp:plan"
    /ppp profile print detail where name~"^plan-"
    /queue simple print detail where dynamic
    /ppp active print detail
    ```

3. Velocidad: speedtest con un solo CPE; luego con los dos a la vez.

**Resultado esperado.** (1) Existen `/queue simple argosisp-plan-<id>` con `comment=argosisp:plan:<id>` y `/ppp profile plan-<id>` con `parent-queue=argosisp-plan-<id>` y los pools del perfil `default`. (2) El CPE entra con el perfil `plan-<id>`, IPv4, /64 y /56, y su cola dinámica tiene `parent=argosisp-plan-<id>`. (3) El `target` del padre lista a las hijas y no captura tráfico de otros planes. (4) Con dos CPE a la vez, juntos no pasan del `max-limit` del padre.

**Si falla.** Si RouterOS pide que el padre vaya antes que las hijas en `/queue simple`, anótalo (hoy ArgosIsp no lo mueve). Envía `servidor-log-routeros-worker.txt` de `recoger.sh` y `servidor-audit-red.txt` (cada comando a RouterOS queda ahí).

### 4.2 Cambio a `arbol_pcq`

**Objetivo.** Pasar el router a `arbol_pcq` con la vista previa y verificar el árbol en RouterOS.

1. Vista previa (no toca el router) y cambio:

    ```sh
    # [Servidor]
    R=$(sudo jq -r .router_id /root/argosisp-lab/salida/01-datos/datos.json)
    sudo -E scripts/laboratorio/api.sh 04-velocidad vista-previa GET "/routers/$R/vista-previa-control?a=arbol_pcq"
    V=$(sudo -E scripts/laboratorio/api.sh 04-velocidad router GET "/routers/$R" | jq .version)
    sudo -E scripts/laboratorio/api.sh 04-velocidad cambiar-a-arbol POST "/routers/$R/cambiar-control-velocidad" \
        "{\"version\":$V,\"control_velocidad\":\"arbol_pcq\",\"motivo\":\"Laboratorio: prueba de arbol_pcq\"}"
    ```

    El cambio corre en el worker. Espera un minuto. Las sesiones de `sesiones_a_desconectar` de la vista previa reconectan.

2. Revisa:

    ```
    # [RouterOS]
    /queue tree print detail where name~"argosisp"
    /queue type print detail where name~"argosisp-plan"
    /ip firewall address-list print where list~"argosisp-plan"
    /ipv6 firewall address-list print where list~"argosisp-plan"
    /ip firewall mangle print stats where comment~"argosisp"
    /ipv6 firewall mangle print stats where comment~"argosisp"
    /queue simple print where dynamic
    ```

3. Speedtest por IPv4 y por IPv6 (`CLIENTE_VELOCIDAD=1 bash cliente.sh 04-velocidad-arbol portal.<tu-dominio>`).
4. Limitar sin reconectar: `sudo -E scripts/laboratorio/servicio.sh 04-velocidad lab-cpe1 limitar`, revisa que sus direcciones pasen a `argosisp-plan-<id>-limitado` y luego `quitar-limite`.

**Resultado esperado.** (1) `argosisp-global-bajada` y `-subida`, tipos PCQ `argosisp-plan-<id>[-limitado]-{bajada,subida}` con `pcq-*-address6-mask=64`, nodos por plan y mangle IPv4/IPv6. (2) La sesión PPPoE **no** tiene cola dinámica; su IPv4, /64 y /56 están en `argosisp-plan-<id>`. (3) Cada cliente queda en su MIR por IPv4 e IPv6. (4) Limitar mueve las entradas sin reconectar. (5) Los contadores del mangle `forward` suben (FastTrack excluido).

**Si falla.** Si RouterOS no acepta `passthrough=no` o las propiedades de máscara IPv6 por REST, el error está en `servidor-audit-red.txt` (`respuesta`). Envíalo tal cual.

### 4.3 Volver a `simple`

```sh
# [Servidor]
V=$(sudo -E scripts/laboratorio/api.sh 04-velocidad router GET "/routers/$R" | jq .version)
sudo -E scripts/laboratorio/api.sh 04-velocidad cambiar-a-simple POST "/routers/$R/cambiar-control-velocidad" \
    "{\"version\":$V,\"control_velocidad\":\"simple\",\"motivo\":\"Laboratorio: vuelta a simple\"}"
sudo -E scripts/laboratorio/servicio.sh 04-velocidad lab-cpe1 plan 10M
sudo -E scripts/laboratorio/recoger.sh 04-velocidad 60
```

**Resultado esperado.** Desaparecen los objetos `argosisp-global-*` y `argosisp-plan-*` del árbol. Las sesiones vuelven a tener cola dinámica. Nada sin `comment` `argosisp…` queda tocado.

## 5. Binding DHCPv6-PD en modo `radius_pool`

**Objetivo.** Confirmar el nombre del servidor DHCPv6 dinámico cuando el /56 viene de un pool por RADIUS (`Delegated-IPv6-Pool`), y que ArgosIsp lo lee (fila del binding en `.claude/integration/a2.md`). En CHR se vio `server = <pppoe-<usuario>>`, pero con `/ppp secret` local, no con RADIUS.

**Requisitos.** API REST del router (sección 4). `lab-cpe1` conectado.

```sh
# [Servidor]
sudo -E scripts/laboratorio/servicio.sh 05-radius-pool lab-cpe1 ipv6 radius_pool
sleep 60
sudo -E scripts/laboratorio/servicio.sh 05-radius-pool lab-cpe1 ver
```

```
# [RouterOS]
/ipv6 dhcp-server print detail
/ipv6 dhcp-server binding print detail
/ipv6 route print detail where dynamic
/ppp active print detail where name="lab-cpe1"
```

Espera 6 minutos (un Interim) y repite `servicio.sh … ver`. Luego vuelve: `servicio.sh 05-radius-pool lab-cpe1 ipv6 radius_servicio` y `recoger.sh 05-radius-pool 20`.

**Resultado esperado.**

- `/ipv6 dhcp-server`: un servidor dinámico `<pppoe-lab-cpe1>` con `prefix-pool=argos-v6-pd`.
- `binding`: `server=<pppoe-lab-cpe1>`, un /56 de `2001:db8:200::/40`, `status=bound`.
- La sesión en ArgosIsp: `prefijo_enlace_v6` del Start (pool `argos-v6-enlace`) y, a los pocos segundos, `prefijo_delegado_v6` igual al del binding. `servidor-audit-red.txt` muestra la lectura `GET /rest/ipv6/dhcp-server/binding?server=%3Cpppoe-lab-cpe1%3E`.

**Qué enviar.** Todo `05-radius-pool` y la salida del router en `05-radius-pool/router-binding.txt`. Si el nombre no es `<pppoe-lab-cpe1>`, cópialo exacto (con signos): es el dato que falta.

**Si falla.** `prefijo_delegado_v6` vacío: busca `routeros-prefijos` en `servidor-log-routeros-worker.txt` y la fila de `audit.red`. 401 = usuario de API o política `read`; `[]` = el nombre del servidor es otro.

## 6. IP real del cliente en el portal

**Objetivo.** La página de corte identifica al cliente por su IP. El portal debe ver la IP real, no la de Docker (`.claude/integration/a5.md`, `docs/seguridad/portal.md`, «Pendientes»).

**Requisitos.** `lab-cpe1` conectado. La PC detrás del CPE.

1. Activo:

    ```sh
    # [Cliente]
    curl -4 -sS http://portal.<tu-dominio>/api/v1/portal/quien-soy; echo
    curl -6 -sS http://portal.<tu-dominio>/api/v1/portal/quien-soy; echo
    ```

2. Suspendido (dst-nat del router al portal):

    ```sh
    # [Servidor]
    sudo -E scripts/laboratorio/servicio.sh 06-portal-ip lab-cpe1 suspender
    ```

    ```sh
    # [Cliente]
    bash cliente.sh 06-portal-ip portal.<tu-dominio>
    curl -4 -sS http://example.com/api/v1/portal/quien-soy; echo
    ```

3. Del lado del servidor:

    ```sh
    # [Servidor]
    sudo -E scripts/laboratorio/recoger.sh 06-portal-ip 10
    sudo argosisp compose logs --since 10m proxy api api-portal 2>/dev/null | grep quien-soy \
        | sudo tee /root/argosisp-lab/salida/06-portal-ip/servidor-log-quien-soy.txt
    sudo -E scripts/laboratorio/servicio.sh 06-portal-ip lab-cpe1 reactivar
    ```

**Resultado esperado.**

- IPv4: `"ip"` es la IPv4 de `lab-cpe1` (la de `/ppp active`; si la PC está detrás del NAT del CPE, es la IP PPPoE del CPE). `"identificado": true`.
- Suspendido por `http://example.com/…`: lo mismo (el dst-nat no cambia el origen) y `"estado": "suspendido"`.
- IPv6: `"ip"` dentro del /56 o del /64 de la sesión e `"identificado": true`. Si sale una IP de Docker (`172.…`, `fd…`) o `identificado: false`, es el `userland-proxy` de Docker en IPv6 (`infra/README.md`, «Portal: IP real del cliente»). Anótalo: es lo que se quería saber.

**Qué enviar.** `cliente-06-portal-ip-*.txt`, la salida de los `curl` en `06-portal-ip/cliente-curl.txt` y `servidor-log-quien-soy.txt`.

**Si falla.** Si por IPv4 sale la IP del gateway de Docker, envía `docker info | grep -i -A3 'userland\|iptables'` y `sudo iptables -t nat -S | grep -E ':(80|443) '`.

## 7. Prueba de carga de RADIUS

**Objetivo.** Repetir en el hardware real la prueba de la semana 2 (fila de carga en `.claude/integration/a2.md`). Criterio del PLAN: 200 reconexiones PPPoE simultáneas dual-stack, **cero timeouts ni rechazos y p95 de autorización < 100 ms** con la caché caliente. En la nube (4 vCPU compartidas) dio 82–166 ms (`services/aaa/README.md`, «Prueba de carga»).

**Qué mide.** `scripts/laboratorio/carga.sh` usa el mismo generador que `pnpm aaa:carga` (`services/aaa/carga`). Corre en un contenedor que comparte la red de FreeRADIUS y le habla por `127.0.0.1`. Mide FreeRADIUS + `aaa` + Redis/API de este servidor, sin la red ni el router. No toca el MikroTik: usa un router simulado con NAS-IP `192.0.2.250` y servicios `lab-carga-NNNN`.

Por cliente hace lo que haría el MikroTik tras un corte de luz: Stop de la sesión anterior, Access-Request CHAP y Start con IPv4 y /64. Rondas:

| Ronda             | Qué simula                                                        |
| ----------------- | ----------------------------------------------------------------- |
| Arranque          | Primera vez, Redis sin las claves de esos usuarios                |
| Redis vacío ×3    | Reconexión masiva justo después de perder Redis: todo va a la API |
| Caché caliente ×3 | Reconexión masiva normal (corte de luz en un sector)              |

### Cuántas sesiones simular

| Corrida     | Comando                                                                              | Para qué                                        |
| ----------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Criterio    | `sudo -E scripts/laboratorio/carga.sh` (200)                                         | Lo que pide el PLAN                             |
| Margen      | `sudo -E LAB_CARGA_CLIENTES=500 LAB_CARGA_ETIQUETA=500 scripts/laboratorio/carga.sh` | Ver cómo crece el p95 con más del doble         |
| Tamaño real | `LAB_CARGA_CLIENTES=<clientes del router más grande que vayas a migrar>`             | Lo que pasará el día que ese router se reinicie |

La primera corrida crea los servicios por la API (unos minutos). Las siguientes los reusan. No corras otras pruebas a la vez: comparten CPU.

### Cómo leer el resultado

Al final imprime (y guarda en `07-carga/<etiqueta>/resumen.md`) una tabla por ronda y:

```
p95 (mediana) con caché caliente: 41 ms (criterio < 100)
p95 (mediana) con Redis vacío: 180 ms (se exige < 400)
Veredicto: CUMPLE
```

- **p95** = el 95 % de las autorizaciones respondió en ese tiempo o menos. Se toma la **mediana** de las tres rondas de cada tipo (una ronda sola puede salir mal por algo ajeno).
- **Timeouts** = autorizaciones sin respuesta en 1 s. El MikroTik las ve como RADIUS caído. Deben ser 0 en todas las rondas.
- **Reject** debe ser 0. **Start/Stop** deben ser 200/200 (la de arranque, 200/0).
- La ronda de arranque no cuenta para el p95: incluye el calentamiento de procesos recién iniciados.

### Si no cumple

1. **Mira la carga del servidor.** `07-carga/<etiqueta>/antes.txt` y `despues.txt` traen `uptime` y `docker stats`. Si el loadavg ya era alto antes de empezar, detén lo que esté corriendo y repite.
2. **Timeouts o p95 alto solo con Redis vacío.** Lo limita la API (una consulta por usuario). La versión siguiente a 1.0.0 agrupa esas consultas en lotes de 100 (`AAA_API_LOTES`, `services/aaa/README.md`). Anota el resultado, actualiza (`sudo argosisp actualizar`) cuando salga y repite. En operación normal Redis está lleno; tras perderlo: `sudo argosisp compose exec api node ace.js aaa:repoblar`.
3. **p95 alto con caché caliente.** Prueba más hilos en FreeRADIUS. Es un cambio temporal dentro del contenedor (se pierde al recrearlo con `argosisp levantar` o `actualizar`):

    ```sh
    # [Servidor]
    C=$(sudo argosisp compose ps -q freeradius)
    sudo docker cp "$C:/etc/freeradius/radiusd.conf" /root/argosisp-lab/radiusd.conf
    sudo sed -i -e 's/^\(\s*start_servers\s*=\).*/\1 32/' -e 's/^\(\s*max_servers\s*=\).*/\1 64/' \
                -e 's/^\(\s*min_spare_servers\s*=\).*/\1 16/' -e 's/^\(\s*max_spare_servers\s*=\).*/\1 32/' \
                /root/argosisp-lab/radiusd.conf
    sudo docker cp /root/argosisp-lab/radiusd.conf "$C:/etc/freeradius/radiusd.conf"
    sudo argosisp compose restart freeradius
    sudo -E LAB_CARGA_ETIQUETA=hilos-32 scripts/laboratorio/carga.sh
    ```

    El pool de conexiones de `rlm_rest` hacia `aaa` sigue a esos valores solo (`services/aaa/freeradius/mods-enabled/rest`). Si mejora, avisa: A2 lo deja fijo en la configuración. Para volver al original: `sudo argosisp levantar`.

4. **Sigue sin cumplir.** Envía el paquete tal cual. Con `rondas.json`, `metricas-aaa.txt` (histograma dentro de `aaa`) y `log-aaa-errores.txt` se ve si el tiempo se va en `aaa`, en Redis o en FreeRADIUS.

### Limpiar

Las sesiones de carga quedan abiertas. El cron de sesiones colgadas las cierra en unos 15 minutos (`sin_interim`). Después:

```sh
# [Servidor]
sudo -E scripts/laboratorio/carga.sh --limpiar
```

Retira los servicios `lab-carga-*`. Se niega mientras queden sesiones abiertas: con una sesión abierta, retirar haría que `coa` intente un Disconnect a `192.0.2.250`, que no existe, y mandaría alertas `coa.fallido`.

**Qué enviar.** Toda la carpeta `07-carga` (una subcarpeta por etiqueta).

## 8. Enviar los resultados

```sh
# [Servidor]
sudo -E scripts/laboratorio/empaquetar.sh
```

Deja `/root/argosisp-lab/argosisp-lab-<fecha>.tar.gz` y su `.sha256`. Antes de empaquetar:

- tapa con `***` las contraseñas PPPoE del laboratorio y los secretos del `.env` si aparecen en algún archivo;
- avisa de cualquier línea que parezca una clave (`User-Password`, `Cleartext-Password`); revísala antes de enviar;
- arma `INDICE.md` con las pruebas y el resumen de la carga.

Nunca van en el paquete: `/opt/argosisp/.env`, `credenciales-lab.txt`, `argosisp-emergencia.rsc`. Envía el `.tar.gz`, el `.sha256` y la hoja de la sección 9.

Al terminar, en `docs/runbooks/aaa-caido.md` y `apps/api/app/operacion/README.md` se quita la marca «Pendiente de laboratorio» de lo que pasó, con la fecha (lo hace el líder con tus resultados).

## 9. Hoja de resultados

Cópiala en `/root/argosisp-lab/salida/RESULTADOS.md` y llénala (va en el paquete).

```markdown
# Resultados del laboratorio · <fecha>

Equipo: <modelo> · RouterOS <versión> · ArgosIsp <versión> · Servidor <CPU, RAM>
CPE: <modelo, firmware>

| #   | Prueba                                            | Resultado (OK / FALLA / N/A) | Dato medido             | Nota |
| --- | ------------------------------------------------- | ---------------------------- | ----------------------- | ---- |
| 1.2 | lab.rsc en el físico                              |                              |                         |      |
| 2.1 | radtest por estado                                |                              |                         |      |
| 2.2 | CPE con IPv4 + /64 + /56 y velocidad del plan     |                              | Mbps:                   |      |
| 2.3 | Accounting Start/Interim/Stop                     |                              |                         |      |
| 2.4 | Cambio de plan por CoA sin reconectar             |                              | ms:                     |      |
| 2.5 | Suspender < 5 s, sin reconectar                   |                              | ms:                     |      |
| 2.5 | Teléfono ve /corte                                |                              | s:                      |      |
| 2.6 | Reactivar < 5 s                                   |                              | s:                      |      |
| 2.7 | Limitar / quitar límite                           |                              |                         |      |
| 2.8 | Cambio de IP y prefijo → Disconnect               |                              | s:                      |      |
| 3.1 | Sesiones vivas sin RADIUS                         |                              | min sin corte:          |      |
| 3.2 | Failover a la segunda /radius                     |                              | s:                      |      |
| 3.3 | Secrets de emergencia (import, prioridad, retiro) |                              |                         |      |
| 3.4 | Reintento del CPE                                 |                              | intervalo s / vuelta s: |      |
| 4.1 | simple con reuso 1:4                              |                              |                         |      |
| 4.2 | arbol_pcq (árbol, PCQ, mangle, limitar)           |                              |                         |      |
| 4.3 | Vuelta a simple                                   |                              |                         |      |
| 5   | Binding DHCPv6-PD en radius_pool                  |                              | nombre del server:      |      |
| 6   | IP real en el portal (IPv4 / IPv6)                |                              |                         |      |
| 7   | Carga 200 (p95 caliente / vacío)                  |                              | ms: /                   |      |
| 7   | Carga 500                                         |                              | ms: /                   |      |
```

## Scripts

Todos en `scripts/laboratorio/`. Corren en el servidor con `sudo -E` (leen `/opt/argosisp/.env`) y solo usan bash, curl, jq y docker. `cliente.sh` corre en la PC del cliente.

| Script              | Qué hace                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `comun.sh`          | Funciones comunes (API con el usuario del panel, `psql`, `redis-cli`, guardar salidas, comandos de RouterOS por SSH). No se ejecuta solo |
| `00-entorno.sh`     | Versión, salud, hardware y configuración RADIUS no secreta, del servidor y del router                                                    |
| `01-datos.sh`       | Router, redes, planes y servicios del laboratorio por la API                                                                             |
| `demo.sh`           | Datos de demostración (`scripts/demo/datos.mjs`) en un contenedor Node                                                                   |
| `radtest.sh`        | Autorización PAP y CHAP por estado                                                                                                       |
| `servicio.sh`       | Cambia un servicio por la API y mide el CoA o Disconnect y la reconexión                                                                 |
| `esperar-sesion.sh` | Mide cuánto tarda un CPE en volver a tener sesión                                                                                        |
| `ros.sh`            | Comandos de RouterOS por SSH, guardando la salida                                                                                        |
| `api.sh`            | Llamada a la API guardando la respuesta                                                                                                  |
| `recoger.sh`        | Sesiones, `audit.red`, eventos, acciones, logs y métricas de los últimos minutos                                                         |
| `cliente.sh`        | Lado del cliente: IPv4, IPv6, corte, `quien-soy`, velocidad                                                                              |
| `carga.sh`          | Prueba de carga de RADIUS                                                                                                                |
| `empaquetar.sh`     | Junta todo en un `.tar.gz` sin secretos                                                                                                  |
