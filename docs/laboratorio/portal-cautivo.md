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
4. En NAT, los dos `argosisp:top corte NAT …` al inicio de `dstnat` y `argosisp: corte-nat HTTP a /corte` con `to-addresses=<IP del portal>` y `to-ports` = 80 o 8088. En IPv6 lo mismo con `to-address=<IPv6 del portal>/128` (solo si `ROUTERS_SERVICIO_PORTAL_V6` está definida).
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
