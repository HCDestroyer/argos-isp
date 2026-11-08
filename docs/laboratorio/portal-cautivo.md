# Portal cautivo en un MikroTik real (Android y iPhone)

Guía de laboratorio del bug de producción v1.9.0 (5 nov): «el portal de corte no aparece; en varios dispositivos sale "sin conexión a internet" en vez de "iniciar sesión"». Contrato: `.claude/integration/contratos/control-velocidad.md` §10.4 y §10.5. Dueño de la guía: A6; arreglo: A5.

Qué tiene que pasar: un cliente suspendido conecta el teléfono a la Wi-Fi de su CPE, el sistema dice **«Iniciar sesión en la red»** (Android) o abre la **hoja del portal** (iPhone) y muestra `/corte`, donde puede pagar, pedir promesa o subir comprobante sin salir a internet.

## 0. Antes de empezar

- RouterOS 7 con Argos ≥ 1.9.1 conectado por API (el reconciliador corre cada 15 min; «Reconciliar ahora» lo adelanta).
- Un CPE en PPPoE contra el MikroTik (o una laptop con PPPoE) y su Wi-Fi.
- Un teléfono Android (Chrome, DNS privado en **Automático**) y un iPhone, ambos **olvidando** antes la red Wi-Fi del CPE.
- En el servidor de Argos: `COA_SUSPENDER` sin definir o `disconnect`. Si hay un proxy delante (Nginx Proxy Manager), `PORTAL_CORTE_V4=<IP del servidor>` y `PORTAL_CORTE_PUERTO=8088` en `.env`, el puerto 8088 abierto desde la red de los routers, y `docker compose up -d`.

## 1. Diagnóstico de corte en verde (panel)

Router → «Probar conexión» → bloque **Corte**. Todo en verde. Si algo sale en rojo, el panel dice qué hacer; los que explican este bug:

| Código | Qué significa | Qué hacer |
| --- | --- | --- |
| `dns_router_documentacion` | `/ip dns servers` tiene 192.0.2.x, 198.51.100.x, 203.0.113.x o 2001:db8:: (ejemplos de los scripts) | `/ip dns set servers=<DNS de tu proveedor>` |
| `dns_router_sin_servidores` | El router no tiene DNS | Igual |
| `dns_router_sin_remotas` | Los clientes usan el router como DNS y `allow-remote-requests=no` | `/ip dns set allow-remote-requests=yes` |
| `portal_no_acepta_host` | En el destino del NAT hay un proxy que solo atiende sus dominios | Puerto dedicado (`PORTAL_CORTE_PUERTO`) o, en NPM, Default Site → Redirect a `http://<dominio del portal>/corte` |
| `portal_en_router` | El destino del NAT es una IP del propio router | `ROUTERS_SERVICIO_PORTAL_V4=<IP LAN del servidor>` |
| `fasttrack`, `reglas_desordenadas` | Los saltos de corte quedaron detrás de FastTrack | «Reconciliar ahora» |

## 2. Reglas en el router (terminal del MikroTik)

```
/ip dns print
:put [:resolve connectivitycheck.gstatic.com]
/ip firewall filter print where chain=argos-corte
/ip firewall nat print where comment~"argosisp"
/ipv6 firewall nat print where comment~"argosisp"
```

Ver:

1. `:resolve` devuelve una IP (si no: el DNS del router está mal, punto 1).
2. En `argos-corte`, **`corte DNS udp a cualquier resolver`** y **`corte DNS tcp a cualquier resolver`** sin `dst-address-list`, antes de `corte portal`. No debe quedar ninguna `argosisp: corte DNS udp` con `dst-address-list=argos-dns` (la versión vieja; el reconciliador la borra sola).
3. `argosisp: corte TCP reset` con `reject-with=tcp-reset`; ninguna regla `argosisp` con `action=drop`.
4. En NAT, los dos `argosisp:top corte NAT …` al inicio de `dstnat` y `argosisp: corte-nat HTTP a /corte` con `to-addresses=<IP del portal>` y `to-ports` = 80 o 8088. En IPv6 lo mismo con `to-address=<IPv6 del portal>/128` (solo si `ROUTERS_SERVICIO_PORTAL_V6` está definida). Con el router en **Identificación por código**, en lugar del dst-nat va `corte-nat HTTP al proxy de corte` (`redirect` al 3346): ver §9.
5. `/ip firewall filter print where comment~"argosisp:top"`: los saltos de corte **antes** de `defconf: fasttrack`.

## 3. Suspender y mirar el router

Suspender el servicio desde el panel (o dejar que el cron lo corte). En `audit.red` debe salir un **Disconnect-ACK** del `coa` (con `COA_SUSPENDER=disconnect`). En el router:

```
/ppp active print where name=<usuario>
/ip firewall address-list print where list=suspendidos
/ipv6 firewall address-list print where list=suspendidos
/interface list member print where list=suspendidos
```

Ver: la sesión reconectó hace segundos; su IPv4 en `suspendidos`; su /64 y su /56 en la lista IPv6; su `<pppoe-…>` en la lista de interfaces. Un WISP (IP fija): su IPv4 y su prefijo IPv6 en `suspendidos` y, en `audit.red`, el `POST /execute` con `connection remove` de su IP.

## 4. Desde un equipo del cliente (laptop en la Wi-Fi del CPE)

```
nslookup connectivitycheck.gstatic.com 8.8.8.8        # responde (DNS a cualquier resolver)
nslookup connectivitycheck.gstatic.com                 # responde (el DNS que dio el CPE)
curl -sI http://connectivitycheck.gstatic.com/generate_204   # 302, Location: …/corte (nunca 204)
curl -sI http://captive.apple.com/hotspot-detect.html        # 302 a /corte
curl -sI http://www.msftconnecttest.com/connecttest.txt      # 302 a /corte
curl -6 -sI http://ipv6.msftconnecttest.com/connecttest.txt  # 302 a /corte (con IPv6 del portal) o reset inmediato
curl -sI https://www.google.com                               # falla al instante (reset), sin esperar
curl -sI http://<IP del portal>:<puerto>/ -H 'Host: example.com'   # 302 a /corte (si no: proxy delante)
```

## 5. Android (en este orden)

1. Ajustes → Red e internet → DNS privado: **Automático** (con un nombre fijo, Android dice «sin internet»: es el límite documentado).
2. Conectar a la Wi-Fi del CPE. En 2–5 s debe salir la notificación **«Iniciar sesión en la red Wi-Fi»** (o «Se requiere acción»), nunca «Conectado, sin internet».
3. Tocarla: abre `/corte` con el nombre parcial y el monto. Probar «Ver datos de depósito», «Subir comprobante» (foto) y «Solicitar promesa».
4. Promesa aprobada: la página pasa a «ya tienes servicio» en < 10 s; la notificación desaparece y la Wi-Fi queda «Conectado».
5. Si sale «sin internet»: volver al punto 1 del diagnóstico. Con `adb`: `adb shell dumpsys connectivity | grep -i captive` muestra la URL que probó y la respuesta.

## 6. iPhone (en este orden)

1. Ajustes → Wi-Fi → (i) de la red del CPE → «Olvidar».
2. Conectar: en 2–5 s se abre sola la **hoja del portal** (Captive Network Assistant) con `/corte`. No debe decir «Sin conexión a internet» bajo el nombre de la red.
3. En la hoja: subir comprobante (cámara o fotos) y pedir promesa; el botón «Listo»/«Cancelar» de arriba queda como «Cancelar» mientras el servicio siga cortado.
4. Al reactivarse, la hoja muestra «ya tienes servicio» y el botón pasa a «Listo».
5. Si no abre la hoja: Safari → `http://captive.apple.com` debe mostrar `/corte` (si muestra «Success», el iPhone salió por otra ruta: revisar IPv6 y el punto 2).

## 7. Windows y macOS (rápido)

- Windows 10/11: al conectar, el icono de red muestra «Acción necesaria» y abre el navegador en `/corte` (`www.msftconnecttest.com/redirect`). `dns.msftncsi.com` debe resolver (`nslookup dns.msftncsi.com` → 131.107.255.255).
- macOS: igual que el iPhone (hoja del portal).

## 8. Reactivar

Pagar o aprobar promesa. `coa` manda Disconnect; la sesión reconecta con el perfil del plan; la IP sale de `suspendidos`; el teléfono revalida y queda con internet sin tocar nada.

## 9. Identificación por código (modo `codigo`, pendiente de laboratorio)

Contrato: `.claude/integration/contratos/corte-identificacion.md` §5 y §5 bis. Lo que sigue **no está probado en un equipo físico**: el manual de RouterOS 7 lo documenta, pero falta verlo. Anota cada resultado en la tabla del final (fecha, RouterOS, quién) y, si algo falla, en `.claude/integration/a6.md`.

Preparar (en un CHR 7.24.5 o el MikroTik del laboratorio, conectado por API):

1. Panel → Routers → editar → **Identificación del cortado: Por código** (o `corte_identificacion: "codigo"` por la API). «Reconciliar ahora».
2. Suspender un servicio PPPoE con IPv4 y /56 delegado, y uno WISP con IP fija.
3. En el router:
   ```routeros
   /ip proxy print
   /ip proxy access print detail
   /ip firewall nat print where comment~"argosisp"
   /ipv6 firewall nat print where comment~"argosisp"
   /ip firewall filter print where comment~"proxy de corte"
   /ipv6 firewall filter print where comment~"proxy de corte"
   ```
   Ver: `enabled=yes port=3346 max-cache-size=none` (o el puerto del operador más `3346`); una regla `argosisp:servicio:<id>` por suspendido (`local-port=3346 src-address=<IPv4>` y, en IPv6, `…:enlace` y `…:delegado` con el prefijo) **antes** de `argosisp: corte proxy sin codigo`; `argosisp: corte-nat HTTP al proxy de corte` con `action=redirect to-ports=3346` en IPv4 e IPv6 (y ya no `corte-nat HTTP a /corte`); `argosisp:top proxy de corte solo redirigido` (`connection-nat-state=!dstnat action=drop`) arriba de `input` y `argosisp: corte-in proxy de corte` antes de `corte-in TCP reset`.

| # | Prueba | Cómo | Esperado |
| --- | --- | --- | --- |
| 9.1 | 307 por IPv4 con `local-port` y `src-address` | Desde la laptop del suspendido: `curl -sI http://example.com/` | `HTTP/1.0 307` (o 1.1) y `Location: <PORTAL_URL_PUBLICA>/corte?c=<13 caracteres>`. El código es del servicio (comparar con `GET /servicios/:id/codigo-corte`: `activo: true`) |
| 9.2 | Regla final sin código | Desde un segundo suspendido cuya regla borraste a mano (`/ip proxy access remove [find comment~"argosisp:servicio:<id>"]`) | `307` a `/corte` **sin** `?c=`; la página identifica por IP o dice el motivo. El reconciliador vuelve a poner la regla en la siguiente pasada |
| 9.3 | 307 por IPv6 | `curl -6 -sI http://ipv6.msftconnecttest.com/connecttest.txt` (y `http://[2001:db8::1]/` a cualquier IPv6) | `307` con `?c=` del mismo servicio: `src-address` IPv6 con prefijo funciona en `/ip proxy access` y el `/ipv6 firewall nat action=redirect` lleva al proxy (que escucha en IPv6). Si no: anotar la respuesta exacta (reset, 403, timeout) |
| 9.4 | HTTPS sigue con reset | `curl -sI https://www.google.com` | Falla al instante (no pasa por el proxy) |
| 9.5 | El 3346 no es un proxy abierto | Desde la WAN: `nc -vz <IP WAN> 3346`. Desde un cliente **activo**: `curl -x http://<gateway>:3346 http://example.com` | Ninguno conecta (drop por `connection-nat-state=!dstnat`); el contador de la regla `proxy de corte solo redirigido` sube |
| 9.6 | Proxy del operador | Antes de pasar a código: `/ip proxy set enabled=yes port=8080` y una regla propia en `/ip proxy access`. Pasar a código y volver a IP | En código: `port=8080,3346`, la regla del operador queda al final y sin cambios. De vuelta en IP: `port=8080`, `enabled=yes`, sin reglas `argosisp` |
| 9.7 | IP reasignada | Reactivar el servicio A y suspender B con la misma IP (o liberar y reasignar) | Solo queda la regla de B para esa `src-address`; la de A desaparece |
| 9.8 | `/tool fetch src-address` con masquerade | En el router: `/tool fetch url="<PORTAL_URL_PUBLICA>/api/v1/portal/eco-ip" src-address=<gateway de clientes> output=user` | El `ip` que responde es la que ve el portal para un cliente (la IP WAN del router si hay masquerade). Debe coincidir con lo que ve un cliente real abriendo la misma URL (`curl -s …/eco-ip` desde la laptop **activa**). Si no coincide, el diagnóstico `portal_ip_cliente` no es fiable: anotarlo para A5 |
| 9.9 | Android | Olvidar la Wi-Fi del CPE, conectar | «Iniciar sesión en la red» en 2–5 s; al tocarla, `/corte` con el nombre parcial y la barra **sin** `?c=` |
| 9.10 | iPhone | Igual que §6 | La hoja del portal abre `/corte` identificada (sigue el 307) |
| 9.11 | Windows 10/11 | Conectar | «Acción necesaria» y el navegador en `/corte` identificada (`www.msftconnecttest.com/redirect` sigue el 307) |
| 9.12 | `url_corte` de la empresa (P3) | Empresa con `url_corte` | `/corte?c=` del portal hace `302` a esa URL; su host está en `argos-walled` |
| 9.13 | Script de conexión | Router de prueba limpio en `codigo`, «incluir configuración de servicio», importar el `.rsc` | Las piezas de arriba quedan creadas sin esperar al reconciliador (excepto las reglas por servicio); la primera reconciliación no cambia nada del corte (`audit.red` sin comandos del corte) |

Resultados:

| Prueba | Fecha | RouterOS | Resultado | Quién |
| --- | --- | --- | --- | --- |
| 9.1 – 9.13 | | | pendiente | |

## 10. Corte por el túnel, servidor en la LAN y nodo de portal (fase 2, pendiente de laboratorio)

Contrato: `.claude/integration/contratos/corte-identificacion.md` §5 ter. Lo cubierto sin equipo: `apps/api/tests/network/corte_tunel.spec.ts` (RouterOS falso), `infra/mikrotik/render.test.mjs` e `infra/wireguard/probar.sh`, donde un cliente detrás de un «router» de prueba llega al puerto del corte con su IP. Falta verlo con un MikroTik.

Preparar: un router en modo **Por IP**, conectado por el túnel, con un PPPoE suspendido.

| # | Prueba | Cómo | Esperado |
| --- | --- | --- | --- |
| 10.1 | Primer salto por el túnel | Desde el suspendido: `curl -sI http://neverssl.com` | `302` a `<PORTAL_URL_PUBLICA>/corte?c=<13 caracteres>`, y la página con su nombre parcial. Sin `PORTAL_URL_PUBLICA`: `302` a `/corte?c=…` en `10.255.0.1:8088` (A′) |
| 10.2 | `connection-nat-state=dstnat` en `srcnat` | `/ip firewall nat print where comment~"tunel"` y sus contadores tras 10.1 | El `accept` cuenta los paquetes de `argos-clientes`; el masquerade de respaldo, 0 |
| 10.3 | Masquerade del operador sin `out-interface` | Agrega `chain=srcnat action=masquerade` al final y repite 10.1 | Sigue identificado: el `accept` de arriba gana |
| 10.4 | Cliente fuera de `argos-clientes` | Un pool del router sin registrar en Argos | Ve la página sin identificar (`ip_de_router`), nunca un timeout |
| 10.5 | `rp_filter` | En el servidor, `net.ipv4.conf.all.rp_filter=1` con `src_valid_mark` en 0 y en 1 | Con 0, 10.1 agota el tiempo y `argosisp estado` lo avisa. Con 1, funciona |
| 10.6 | Túnel caído | `docker stop` del servicio `wireguard` | El suspendido no ve la página (igual que RADIUS: el vigía `aaa.caido` avisa) |
| 10.7 | Servidor en la LAN | Sin túnel: `portal_v4` = IP LAN del servidor, con y sin el masquerade del operador hacia ella | Sin NAT: identificado y `portal_ip_cliente` en verde. Con NAT: rojo, con la regla `accept` que hay que agregar |
| 10.8 | Nodo de portal | `DOMINIO_PORTAL` en un nodo aparte, routers por el túnel del central | El central responde el primer salto y redirige al nodo con `?c=`; el nodo muestra la página identificada |
| 10.9 | Android, iPhone, Windows | Como §6 y §7 | «Iniciar sesión en la red» y la página identificada (el 302 lleva el código) |

