# Laboratorio: QoS por clases, PPPoE sin RADIUS y router sin RADIUS

Guía para el PM. Cubre lo que el RouterOS falso de las pruebas no puede probar de tres funciones nuevas: la prioridad por protocolo (`.claude/integration/contratos/qos.md`), el PPPoE con `/ppp secret` locales (`contratos/pppoe-local.md`) y el router sin RADIUS con clientes de IP estática. La escribió A6. Sigue el formato de `validacion-fisica.md` (A2): mismos scripts, misma carpeta de resultados y mismas marcas `[RouterOS]`, `[Servidor]` y `[Cliente]` (ver «Cómo leer los pasos» allí).

Cada prueba trae **objetivo**, **pasos**, **resultado esperado** y **si falla**. Lo que hay que enviar se guarda solo en `/root/argosisp-lab/salida/<prueba>/` con `ros.sh` y `api.sh`; al final, `scripts/laboratorio/empaquetar.sh` como en la sección 8 de `validacion-fisica.md`.

## Contenido

0. [Preparación](#0-preparación)
1. [QoS por clases](#1-qos-por-clases)
2. [PPPoE sin RADIUS](#2-pppoe-sin-radius)
3. [Router sin RADIUS con IP estática](#3-router-sin-radius-con-ip-estática)
4. [Hoja de resultados](#4-hoja-de-resultados)

## 0. Preparación

### 0.1 Material

- El MikroTik del laboratorio con RouterOS **7.24.x** (`/system resource print`). Si es otra versión, anótala en la hoja: los resultados valen para esa versión.
- El servidor con ArgosIsp (1.3 de `validacion-fisica.md`) y `LAB_ROUTER_SSH` exportado (sección 0 de esa guía).
- Un CPE PPPoE dual-stack y una PC detrás (con `curl`, `dig`, `ping`, `mtr` o `ping -i 0.2`).
- Para la sección 3: un equipo con IP fija en el segmento WISP (una PC sirve).

### 0.2 Dos routers lógicos

QoS (sección 1) corre en el router **con RADIUS** de siempre (`lab.rsc`). PPPoE local y la sección 3 necesitan un router **sin RADIUS**. Con un solo MikroTik, haz primero la sección 1 y después pásalo a sin RADIUS (0.3). Con dos, usa uno para cada cosa.

### 0.3 Pasar el MikroTik a sin RADIUS

El script de conexión del panel todavía no sirve para un router `api` (422 `script_requiere_radius`; pedido a A1 en `.claude/integration/a6.md`). Se usa `infra/mikrotik/lab-sin-radius.rsc`, que es `lab.rsc` con RADIUS y CoA anulados.

1. Copia la cabecera que ya usas en `lab.rsc` (bloque «Variables») sobre la de `lab-sin-radius.rsc`. Pon una clave en `apiPassword` (`openssl rand -base64 24`) y guárdala: hace falta en el panel y en las pruebas por REST.
2. Súbelo e impórtalo:

    ```
    # [RouterOS]
    /import file-name=lab-sin-radius.rsc verbose=yes
    ```

3. Comprueba:

    ```sh
    # [Servidor]
    sudo -E scripts/laboratorio/ros.sh 00-sin-radius router-base \
        '/ppp aaa print' \
        '/radius print' \
        '/radius incoming print' \
        '/user group print detail where name=argosisp-api' \
        '/ppp profile print detail where name=default or name=suspendido' \
        '/interface pppoe-server server print detail' \
        '/system script run argosisp-verificar-fasttrack'
    ```

    **Resultado esperado.** `use-radius: no`, `accounting: no`. Ninguna entrada `argosisp: aaa nodo` en `/radius` (las tuyas, si había, siguen). `accept: no` si no queda ningún `/radius`. El grupo con `policy=read,write,api,rest-api,sensitive`. `default` con `remote-ipv6-prefix-pool=argos-v6-enlace` y `dhcpv6-pd-pool=argos-v6-pd`; `suspendido` con `rate-limit`, `address-list=suspendidos` e `interface-list=suspendidos`. Servidor PPPoE con `default-profile=default`. Termina con `argosisp: FastTrack OK` y `argosisp: lab.rsc aplicado`.

4. En el panel: ficha del router → Editar → **Modo de seguridad: sin RADIUS (API)**; `api_url` = `https://<apiIp>`, usuario `argosisp-api`, la clave del paso 1 y la CA (`argosisp-ca.crt` del router, como en `infra/mikrotik/README.md`, «Usuario de la API REST y HTTPS»). Guarda y pulsa **Probar conexión**.

    **Resultado esperado.** Probar conexión en verde, sin el chequeo de `/radius`. `sudo argosisp compose exec -T aaa ls /radius-clientes` ya no tiene `router-<router_id>.conf` (`router.radius_cambiado` regeneró los clientes de FreeRADIUS).

    **Si falla.** 422 `servicios_pppoe_en_router`: el router todavía tiene servicios PPPoE con RADIUS; muévelos o retíralos (`contratos/pppoe-local.md` §9). Probar conexión falla por certificado: carga la CA del paso 4.

Para las pruebas por REST de las secciones 1 y 2, en el servidor:

```sh
# [Servidor] una vez por terminal
export ROS=https://<apiIp> CLAVE_API='<apiPassword>'
scp "$LAB_ROUTER_SSH":argosisp-ca.crt /root/argosisp-lab/argosisp-ca.crt
rest() { curl -sS --cacert /root/argosisp-lab/argosisp-ca.crt -u "argosisp-api:$CLAVE_API" -H 'content-type: application/json' "$@"; }
rest "$ROS/rest/system/identity"      # {"name":"..."}
# .id de un objeto por un campo: rid <ruta> <campo> <valor>  (p. ej. rid queue/tree name lab-qos-padre)
rid() { rest "$ROS/rest/$1?$2=$3" | jq -r '.[0].".id"'; }
```

## 1. QoS por clases

**Requisitos.** Router con `lab.rsc`, un plan con reuso **1:4** (el `reuso4` de `01-datos.sh`) y el CPE con un servicio de ese plan. En el panel: ficha del router → **Control de velocidad** → aplicación `arbol_pcq`, padre `plan`, extras `excluir_fasttrack` y **`qos`** (perfil «Predeterminado»). Aplica y espera a que la vista previa quede sin pendientes.

```sh
# [Servidor] lo que escribió ArgosIsp
sudo -E scripts/laboratorio/ros.sh 10-qos router-qos \
    '/queue tree print detail where name~"argosisp-plan-"' \
    '/ip firewall mangle print detail where comment~"argosisp:(qos|plan)"' \
    '/ipv6 firewall mangle print detail where comment~"argosisp:(qos|plan)"'
```

Anota el id del plan (`<p>`) y los ids de las clases (`q<k>` en los nombres de las hojas). En el perfil predeterminado: Interactivo, Streaming, Web, Descargas y Resto.

### 1.1 `packet-mark=""` en un nodo con hijas, por REST

**Objetivo.** El nodo del plan pasa a interno: RouterOS acepta `packet-mark` vacío por REST en un nodo que ya tiene hijas, y lo deja vacío.

```sh
# [Servidor] nodo de prueba con marca, una hija, y luego quitar la marca al padre
rest -X PUT "$ROS/rest/queue/tree" -d '{"name":"lab-qos-padre","parent":"global","max-limit":"10M","packet-mark":"lab-qos-x","comment":"argosisp: lab qos"}'
rest -X PUT "$ROS/rest/queue/tree" -d '{"name":"lab-qos-hija","parent":"lab-qos-padre","packet-mark":"lab-qos-h","comment":"argosisp: lab qos"}'
rest -X PATCH "$ROS/rest/queue/tree/$(rid queue/tree name lab-qos-padre)" -d '{"packet-mark":""}'
rest "$ROS/rest/queue/tree?name=lab-qos-padre" | tee -a /root/argosisp-lab/salida/10-qos/rest-packet-mark.txt
# limpiar (hija antes que padre)
rest -X DELETE "$ROS/rest/queue/tree/$(rid queue/tree name lab-qos-hija)"
rest -X DELETE "$ROS/rest/queue/tree/$(rid queue/tree name lab-qos-padre)"
```

**Resultado esperado.** Los dos `PUT` devuelven el objeto con su `.id`; el `PATCH` responde 200 sin `error`; el `GET` muestra `"packet-mark":""` (o sin la clave). En `router-qos.txt`, cada `argosisp-plan-<p>-bajada|subida` (y `-limitado-…`) tiene `packet-mark=""` y sus hojas `…-q<k>` tienen `packet-mark` = su nombre y `parent` = el nodo del plan.

**Si falla.** `PATCH` con `"error":400` («value of packet-mark … invalid»): anota el `detail` exacto. Prueba `{"packet-mark":"no-mark"}` y repórtalo a A2 (el reconciliador usa `""`).

### 1.2 `connection-bytes` en `/ipv6/firewall/mangle`

**Objetivo.** La clase Descargas reclasifica por bytes también en IPv6.

```sh
# [Servidor] la regla que crea ArgosIsp ya debería estar; además, una de prueba por REST
sudo -E scripts/laboratorio/ros.sh 10-qos router-pesadas-v6 \
    '/ipv6 firewall mangle print detail where comment~"argosisp:qos:pesada"'
rest -X PUT "$ROS/rest/ipv6/firewall/mangle" -d '{"chain":"argosisp-lab","connection-bytes":"10000000-0","action":"passthrough","comment":"argosisp: lab qos"}'
rest "$ROS/rest/ipv6/firewall/mangle?chain=argosisp-lab"
rest -X DELETE "$ROS/rest/ipv6/firewall/mangle/$(rid ipv6/firewall/mangle chain argosisp-lab)"
```

```sh
# [Cliente] una descarga grande solo por IPv6 (más de 10 MB)
curl -6 -o /dev/null -w '%{size_download} bytes\n' https://speed.cloudflare.com/__down?bytes=100000000
```

```sh
# [Servidor] mientras corre la descarga
sudo -E scripts/laboratorio/ros.sh 10-qos router-conexiones-v6 \
    '/ipv6 firewall connection print detail where connection-mark~"argosisp-qos"' \
    '/ipv6 firewall mangle print stats where comment~"argosisp:qos:pesada"'
```

**Resultado esperado.** La regla `argosisp:qos:pesada:…` existe en IPv6 con `connection-bytes=10000000-0`. El `PUT` de prueba devuelve su `.id`. Durante la descarga, la conexión IPv6 del cliente pasa de `argosisp-qos-<web>` a `argosisp-qos-<descargas>` y el contador de la regla `pesada` sube.

**Si falla.** `PUT` rechazado o la regla falta en IPv6: anota la respuesta. Es lo que A2 necesita saber para escribir `connection-bytes` solo en IPv4.

### 1.3 Salto de `forward` con `passthrough`: cada paquete con la marca de su clase

**Objetivo.** En la cadena `argosisp-qos-plan-<p>-bajada`, la regla de resto (`passthrough=yes`) marca y sigue y la de la clase (`passthrough=no`) sobrescribe y termina: ningún paquete del plan queda sin marca ni en otra clase.

```sh
# [Servidor] contadores a cero
sudo -E scripts/laboratorio/ros.sh 10-qos router-reset \
    '/ip firewall mangle reset-counters [find where chain~"argosisp-qos"]' \
    '/queue tree reset-counters-all'
```

```sh
# [Cliente] tres tipos de tráfico, uno tras otro
ping -c 50 -i 0.2 1.1.1.1                       # Interactivo (icmp)
for _ in $(seq 50); do dig +short example.com @<ppp_local_v4> > /dev/null; done   # Interactivo (udp 53)
curl -4 -o /dev/null https://speed.cloudflare.com/__down?bytes=50000000          # Web y luego Descargas
```

```sh
# [Servidor]
sudo -E scripts/laboratorio/ros.sh 10-qos router-salto \
    '/ip firewall mangle print detail where chain~"argosisp-qos-plan-"' \
    '/ip firewall mangle print stats where chain~"argosisp-qos-plan-"' \
    '/queue tree print stats where name~"argosisp-plan-"'
```

**Resultado esperado.**

- En `detail`: la regla de resto con `passthrough=yes` y cada regla de clase con `connection-mark=argosisp-qos-<k>` y `passthrough=no`. El salto en `forward` (`…:qos`) es `action=jump`.
- En `stats`: la regla de resto cuenta **todos** los paquetes del plan; cada regla de clase, los suyos.
- En el árbol: el ping y el DNS en la hoja de Interactivo; el `curl` en Web y, pasados ~10 MB, en Descargas. La suma de bytes de las hojas de un nodo es la del nodo (nada pasa sin hoja). Resto casi en cero.

**Si falla.** Todo el tráfico en Resto: el `passthrough=no` de la clase no se respetó o la conexión no tiene marca (mira `/ip firewall connection print detail where src-address~"<ip del cliente>"`). Bytes en el nodo que no están en ninguna hoja: hay paquetes sin `packet-mark`; envía `router-salto.txt`.

### 1.4 Latencia de Interactivo con el plan lleno

**Objetivo.** Con el nodo del plan lleno, una descarga grande no sube la latencia del ping y del DNS del mismo plan.

La prioridad solo actúa cuando el cuello es el **nodo del plan** (o el global), no el MIR de un cliente (`contratos/qos.md` §3.5). En `router-qos.txt`, mira el `max-limit` de `argosisp-plan-<p>-bajada`: debe ser **menor** que el MIR del plan (con 1:4 y un solo cliente activo es ~1/4). Si es igual o mayor, usa dos CPE del mismo plan y satura desde los dos.

```sh
# [Cliente] A: base sin carga (60 s)
ping -c 300 -i 0.2 1.1.1.1 | tail -2 | tee lat-base.txt
# B: con carga (en otra terminal, 4 descargas en paralelo durante el ping)
for _ in 1 2 3 4; do curl -4 -s -o /dev/null https://speed.cloudflare.com/__down?bytes=500000000 & done
ping -c 300 -i 0.2 1.1.1.1 | tail -2 | tee lat-qos.txt
for _ in $(seq 20); do dig example.com @<ppp_local_v4> | grep 'Query time'; done | tee dns-qos.txt
kill %1 %2 %3 %4
```

Repite B con `qos` apagado (panel → Control de velocidad → quitar `qos` → aplicar) y guárdalo como `lat-sin-qos.txt` y `dns-sin-qos.txt`. Vuelve a prender `qos` al terminar. Copia los cuatro archivos a `10-qos/`.

**Resultado esperado.** Con `qos`, el promedio de `lat-qos.txt` queda a menos de **20 ms** del de `lat-base.txt` y el DNS por debajo de 50 ms. Sin `qos`, la latencia sube claramente (cientos de ms con el nodo lleno). Durante B, `/queue tree print stats where name~"argosisp-plan-<p>-bajada"` muestra el nodo en su `max-limit` y la hoja de Interactivo sin `dropped`.

**Si falla.** Latencia igual con y sin `qos`: el cuello no era el nodo (revisa el `max-limit`) o FastTrack (`/system script run argosisp-verificar-fasttrack`). Si la hoja de Interactivo tiene `dropped`, envía `router-salto.txt` de este momento.

## 2. PPPoE sin RADIUS

**Requisitos.** El router de 0.3 (sin RADIUS). Un plan implementado en el router con perfil (panel → plan → Routers) y la estrategia del router en `perfil_ppp` (o `arbol_pcq` para 2.6). El CPE con un usuario PPPoE nuevo (`<user>`).

### 2.1 Alta

En el panel: Nuevo servicio → router sin RADIUS, tipo PPPoE, `<user>` y su contraseña, IPv4 fija y modo IPv6 `radius_servicio`.

```sh
# [Servidor] ~5 s después del alta
sudo -E scripts/laboratorio/ros.sh 20-pppoe-local router-alta \
    '/ppp secret print detail where comment~"argosisp:servicio"' \
    '/ppp profile print detail where name~"^plan-"'
rest "$ROS/rest/ppp/secret?name=<user>" | jq 'map(.password |= "***")'
```

Conecta el CPE. Luego:

```sh
# [Servidor]
sudo -E scripts/laboratorio/ros.sh 20-pppoe-local router-sesion \
    '/ppp active print detail where name="<user>"' \
    '/ipv6 dhcp-server binding print detail where server~"<user>"'
rest "$ROS/rest/ppp/active?name=<user>" | tee -a /root/argosisp-lab/salida/20-pppoe-local/rest-active.txt
sleep 70
sudo -E scripts/laboratorio/api.sh 20-pppoe-local sesion GET '/sesiones?servicio_id=<id>&activa=true'
```

**Resultado esperado.**

- Un secret `name=<user>`, `service=pppoe`, `profile=plan-<p>`, `remote-address=<IPv4 fija>`, `remote-ipv6-prefix=<el /64>`, `comment=argosisp:servicio:<id>`. El `rest` trae la clave `password` (gracias a `sensitive`; se imprime como `***`).
- El CPE conecta con la IPv4 fija y el /64; recibe un /56 del pool `argos-v6-pd` (no el del IPAM: limitación conocida).
- `rest-active.txt` trae `session-id` y `uptime` con el formato `1h2m3s` (o `45s`).
- A los ≤ 70 s, la API muestra la sesión con `origen: "sondeo"`, `acct_session_id: "sondeo:<session-id>"`, la IPv4 y el /56 del binding.

**Si falla.** Sin secret: mira `audit.red` y `routeros.fallido` (`sudo -E scripts/laboratorio/recoger.sh 20-pppoe-local 10`). 400 `already have such name`: hay un secret ajeno con ese nombre (no se toca); bórralo a mano. Sesión que no aparece: cron `sesiones_ppp` apagado (`ROUTEROS_SESIONES_PPP_CADA_MS=0`) o router sin credenciales.

### 2.2 Corte (se ve `/corte`)

```sh
# [Servidor]
sudo -E scripts/laboratorio/api.sh 20-pppoe-local suspender POST '/servicios/<id>/suspender' '{"motivo":"Laboratorio: corte sin RADIUS"}'
sleep 10
sudo -E scripts/laboratorio/ros.sh 20-pppoe-local router-corte \
    '/ppp secret print detail where name="<user>"' \
    '/ppp active print detail where name="<user>"' \
    '/ip firewall address-list print where list=suspendidos' \
    '/interface list member print where list=suspendidos'
```

```sh
# [Cliente] cuando el CPE reconecte; espera un sondeo (≤ 60 s) antes de abrir el portal
bash cliente.sh 20-pppoe-local-suspendido portal.<tu-dominio>
curl -4 -s http://example.com/ | grep -i corte
curl -4 -m 3 https://example.com/ ; echo "salida $?"
```

**Resultado esperado.** El secret pasa a `profile=suspendido`; la sesión anterior se quitó (uptime nuevo, `audit.red` con `DELETE /ppp/active`) y la fila vieja cerrada con `Admin-Reset`. Al reconectar, la IPv4 está en `suspendidos` (entrada **dinámica**, puesta por el perfil) y la interfaz en la lista `suspendidos`. `curl -4 http://example.com/` devuelve la página de corte y el portal identifica al cliente (por la IP de la sesión de sondeo). HTTPS falla al instante (reset), no por timeout. Teléfono: `/corte` en menos de 3 s.

**Si falla.** IP fuera de `suspendidos`: el perfil `suspendido` no tiene `address-list` (revisa 0.3). `/corte` sale pero el portal dice «no te reconocemos»: la sesión de sondeo todavía no existe; espera 60 s y recarga.

### 2.3 Reactivación

```sh
# [Servidor]
sudo -E scripts/laboratorio/api.sh 20-pppoe-local reactivar POST '/servicios/<id>/reactivar' '{"motivo":"Laboratorio: reactivar sin RADIUS"}'
sudo -E scripts/laboratorio/esperar-sesion.sh 20-pppoe-local <user>
```

**Resultado esperado.** El secret vuelve a `profile=plan-<p>`, la sesión se quita y el CPE reconecta en pocos segundos (anota cuántos), fuera de `suspendidos`, navegando por IPv4 e IPv6. Llega por evento, sin esperar al cron.

### 2.4 Cambio de plan

```sh
# [Servidor] version actual y plan nuevo
sudo -E scripts/laboratorio/api.sh 20-pppoe-local servicio GET '/servicios/<id>'
sudo -E scripts/laboratorio/api.sh 20-pppoe-local cambiar-plan PUT '/servicios/<id>' '{"version":<version>,"plan_id":<p2>}'
sleep 10
sudo -E scripts/laboratorio/ros.sh 20-pppoe-local router-plan \
    '/ppp secret print detail where name="<user>"' \
    '/ppp active print detail where name="<user>"' \
    '/queue simple print detail where name="<pppoe-<user>>"'
```

**Resultado esperado.** `profile=plan-<p2>`, sesión nueva (reconectó) y la cola dinámica del PPPoE con el `rate-limit` del plan nuevo. Un **cambio de velocidad del mismo plan** (editar el plan) no corta: rige al reconectar; para forzarlo, `POST /sesiones/<sesion>/desconectar`.

### 2.5 Sondeo de sesiones y reconciliador

```sh
# [Cliente] desconecta el CPE (cable o reinicio). [Servidor] espera ≤ 70 s:
sudo -E scripts/laboratorio/api.sh 20-pppoe-local sesion-cerrada GET '/sesiones?servicio_id=<id>&limit=2'
# Reconecta el CPE. Corte manual por REST (lo que hace el dispatcher):
rest -X DELETE "$ROS/rest/ppp/active/$(rid ppp/active name <user>)"
# Secret borrado a mano y contraseña cambiada a mano → el reconciliador lo corrige
sudo -E scripts/laboratorio/ros.sh 20-pppoe-local router-a-mano '/ppp secret set [find name="<user>"] password=otra-clave'
sudo -E scripts/laboratorio/api.sh 20-pppoe-local reconciliar POST '/routers/<router_id>/reconciliar'
sleep 20
sudo -E scripts/laboratorio/recoger.sh 20-pppoe-local 15
```

**Resultado esperado.** La sesión desconectada queda cerrada con causa `sondeo_sin_sesion` en ≤ 70 s. El `DELETE` responde vacío (200) y el CPE reconecta. Tras reconciliar, `audit.red` muestra un `PATCH` del secret con `password: "***"` (la contraseña se detectó gracias a `sensitive`) y el CPE sigue entrando con su clave de ArgosIsp. Si borras el secret a mano, el reconciliador lo vuelve a crear.

### 2.6 Con `arbol_pcq`: el perfil del plan alimenta el árbol

Cambia la estrategia del router a `arbol_pcq` (panel) y reconecta el CPE.

```sh
# [Servidor]
sudo -E scripts/laboratorio/ros.sh 20-pppoe-local router-arbol \
    '/ppp profile print detail where name~"^plan-"' \
    '/ip firewall address-list print where list~"argosisp-plan-"' \
    '/ipv6 firewall address-list print where list~"argosisp-plan-"' \
    '/queue tree print stats where name~"argosisp-plan-"'
```

**Resultado esperado.** `plan-<p>` con `address-list=argosisp-plan-<p>`; la IPv4 de la sesión aparece **dinámica** en esa lista al conectar; el /64 y el /56 entran en la lista IPv6 tras un sondeo (comment `argosisp:servicio:<id>:enlace|delegado`). Un speedtest cuenta bytes en `argosisp-plan-<p>-bajada`. Con `qos`, las mismas pruebas 1.3 y 1.4 valen aquí.

## 3. Router sin RADIUS con IP estática

**Requisitos.** El router de 0.3 con el segmento WISP de `lab.rsc` (`wispHabilitar true` en la cabecera) y un equipo con IP fija del segmento (`<ip>`, gateway `wispGateway`, DNS el router).

```sh
# [Servidor] alta por el panel: tipo ip_estatica, router sin RADIUS, IP <ip>. Luego:
sudo -E scripts/laboratorio/ros.sh 30-ip-estatica router-alta \
    '/queue simple print detail where comment~"argosisp:servicio"' \
    '/radius print'
sudo -E scripts/laboratorio/api.sh 30-ip-estatica suspender POST '/servicios/<id>/suspender' '{"motivo":"Laboratorio: corte IP estática"}'
sudo -E scripts/laboratorio/ros.sh 30-ip-estatica router-corte '/ip firewall address-list print where list=suspendidos'
```

```sh
# [Cliente] (el equipo con IP fija)
curl -4 -s http://example.com/ | grep -i corte
curl -4 -m 3 https://example.com/ ; echo "salida $?"
```

```sh
# [Servidor]
sudo -E scripts/laboratorio/api.sh 30-ip-estatica reactivar POST '/servicios/<id>/reactivar' '{"motivo":"Laboratorio: reactivar IP estática"}'
sudo -E scripts/laboratorio/ros.sh 30-ip-estatica router-reactivado '/ip firewall address-list print where list=suspendidos'
sudo argosisp compose exec -T aaa ls /radius-clientes | tee /root/argosisp-lab/salida/30-ip-estatica/radius-clientes.txt
```

**Resultado esperado.** Cola simple con `target=<ip>/32` y `comment=argosisp:servicio:<id>` sin ningún `/radius` en el router. Suspender pone `<ip>` en `suspendidos` (entrada **estática** con `comment=argosisp:servicio:<id>`) en menos de 30 s; el equipo ve `/corte` por HTTP y HTTPS falla al instante; el portal lo identifica por la IP. Reactivar la saca en menos de 30 s y navega. `radius-clientes.txt` no tiene `router-<router_id>.conf`.

**Si falla.** Sin cola: el router no tiene credenciales de API o Probar conexión falla (0.3, paso 4). Corte sin `/corte`: revisa `portalV4` y el NAT `argosisp:top corte NAT` (`/ip firewall nat print where comment~"corte"`).

## 4. Hoja de resultados

Copia en `/root/argosisp-lab/salida/resultados-sin-radius-qos.md` y marca cada fila.

```markdown
# Resultados · <fecha> · RouterOS <versión> · <modelo>

| Prueba                                                                    | Resultado | Nota                      |
| ------------------------------------------------------------------------- | --------- | ------------------------- |
| 0.3 lab-sin-radius.rsc (use-radius=no, sensitive, perfiles, FastTrack OK) | ✓/✗       |                           |
| 1.1 packet-mark="" en un nodo con hijas por REST                          | ✓/✗       | detail del error si falla |
| 1.2 connection-bytes en /ipv6/firewall/mangle                             | ✓/✗       |                           |
| 1.3 salto forward + passthrough: cada paquete en su hoja                  | ✓/✗       |                           |
| 1.4 latencia Interactivo con el plan lleno (base / con qos / sin qos, ms) | ✓/✗       | __ / __ / __              |
| 2.1 alta: secret, sesión por sondeo, uptime y session-id                  | ✓/✗       |                           |
| 2.2 corte: suspendidos dinámico y /corte                                  | ✓/✗       | segundos hasta /corte:    |
| 2.3 reactivación                                                          | ✓/✗       | segundos hasta navegar:   |
| 2.4 cambio de plan                                                        | ✓/✗       |                           |
| 2.5 sondeo (cierre ≤ 70 s), DELETE /ppp/active, contraseña a mano         | ✓/✗       |                           |
| 2.6 address-list del perfil alimenta el árbol                             | ✓/✗       |                           |
| 3 IP estática sin RADIUS: alta, corte, reactivación                       | ✓/✗       |                           |
```

Enviar: la carpeta empaquetada (`scripts/laboratorio/empaquetar.sh`) y esta hoja. Con los resultados, A2 confirma o ajusta el dispatcher (1.1, 1.2, 2.1) y A6 marca los pedidos de `a2.md` como verificados.
