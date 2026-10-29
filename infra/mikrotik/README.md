# MikroTik: script de conexión y laboratorio

Dos scripts salen de las mismas piezas (`piezas/*.rsc`):

- **Script de conexión** (`plantillas/conexion.rsc.tpl`): lo genera el panel para cada router y lo conecta a ArgosIsp por un túnel WireGuard, con el usuario de la API, RADIUS y los puertos de gestión cerrados. Abajo, «Conectar un router».
- **`lab.rsc`**: el laboratorio completo, que se edita a mano (el resto de este documento).

Las piezas se editan en `piezas/` y se arman con `node infra/mikrotik/armar.mjs` (CI falla si `lab.rsc` o las plantillas no coinciden: `armar.mjs --verificar`). La configuración de servicio (PPPoE, perfiles, corte, FastTrack) es la misma pieza en `lab.rsc` y en `plantillas/conexion-servicio.rsc.tpl` (el script con «incluir configuración de servicio»): no hay copia.

| Pieza | `lab.rsc` | conexión | conexión + servicio |
| --- | :-: | :-: | :-: |
| `lab-cabecera`, `lab-wireguard`, `lab-pie` (variables y túnel manual del laboratorio) | ✓ | | |
| `conexion-cabecera.rsc.tpl`, `-limpieza`, `-tunel`, `-registro`, `-gestion`, `-orden`, `-pie` | | ✓ | ✓ |
| `conexion-servicio.rsc.tpl` (variables de servicio que llena ArgosIsp) | | | ✓ |
| `comun-api-rest` (CA, certificado, grupo y usuario de la API), `comun-radius` | ✓ | ✓ | ✓ |
| `servicio-limpieza`, `-base` (pools, DNS, perfiles, PPPoE), `-firewall` (listas, corte IPv4/IPv6, WISP, árbol), `-orden`, `-fasttrack` | ✓ | | ✓ |

## Conectar un router

**Requisitos:** RouterOS 7 y salida a internet (el router se registra solo). En el servidor, WireGuard activo (`docs/runbooks/instalacion.md`, «Conectar los routers por WireGuard»).

**Pasos (para el técnico):**

1. En el panel: ficha del router → **Script de conexión**. Si administras el router desde una IP fija (tu oficina), escríbela en «IPs de administración»: Winbox y SSH solo quedarán abiertos para esas IPs y para el túnel. Marca «incluir configuración de servicio» solo en un router nuevo que ArgosIsp va a configurar completo (PPPoE, perfiles y corte).
2. Descarga el archivo. **Lleva claves:** no lo guardes ni lo mandes por chat. Vale 24 horas y para un solo registro.
3. En Winbox: **Files** → arrastra el archivo. Luego **New Terminal** y escribe `/import file-name=argosisp-conexion.rsc verbose=yes`. (También puedes copiar todo el texto y pegarlo en New Terminal.)
4. Al final debe decir `argosisp: listo`: registrado, túnel con handshake y gestión restringida. En menos de un minuto el panel muestra el router **conectado**.
5. Si dice `AVISO la gestión NO se restringió`, algo falló y **el router se queda como estaba** (sin reglas de drop nuevas ni `address=` en los servicios). Debajo dice qué falló: el registro (sin internet, token usado o vencido, certificado no verificado, RouterOS viejo) o el túnel (sin handshake: servidor sin `ARGOSISP_WIREGUARD=1`, UDP bloqueado, red NAT de WSL). Corrígelo, genera un script **nuevo** (el token es de un solo uso) y vuelve a correrlo.
6. Si dice `FALTA un paso`, copia la **clave pública** que muestra y en el panel → Conexión → **Pegar clave pública**. Si además muestra la CA (`-----BEGIN CERTIFICATE-----`), pégala en el panel: ficha del router → Acciones → **Conexión de la API** → CA propia (PEM) → «Cargar una CA» (o «Reemplazar por otra») → **Guardar conexión**.

**Nunca te deja fuera:** la gestión (`www-ssl`, Winbox, SSH) solo se restringe si el registro respondió OK **y** el túnel tiene handshake, y aun así se conserva el acceso desde la IP de **las sesiones abiertas** (`/user active`, incluida la que corre el script; RouterOS no marca cuál es la propia, así que se conservan todas las que tienen IP, menos `argosisp-api`). Una sesión de MAC-Winbox o de consola no tiene IP: en ese caso queda MAC-Winbox, que el script nunca apaga. La sesión abierta no se corta. Si aun así quedaste fuera (p. ej. con el script de la 1.3.0), usa el **rescate** de abajo.

Puedes volver a correr el script cuantas veces quieras: solo toca lo que lleva comentario `argosisp:`, conserva la interfaz `wg-argos` y su clave, y la gestión de la ejecución anterior se rehace solo si esta vez el registro y el túnel funcionan (con el token ya usado se queda como estaba).

**Qué hace, en orden:**

| Paso | Qué queda en el router |
| --- | --- |
| C0 | Comprueba RouterOS 7 (si no, se detiene sin tocar nada) |
| C1 | Borra los `/radius` de ArgosIsp de una ejecución anterior. La gestión anterior (reglas `argosisp:gestion`, `argosisp-admin`, `address=`) **no** se toca aquí: la rehace C4 solo si todo funcionó |
| C2 | Interfaz WireGuard `wg-argos` (MTU 1420; la crea una vez y la **clave privada no sale del router**) y la IP `/32` del túnel con ruta solo hacia la `.1` del servidor |
| API | CA `argosisp-ca` (se exporta a `argosisp-ca.crt`), grupo `argosisp-api` y usuario `argosisp-api` que solo entra desde la `.1` |
| C3 | Se registra: `POST /api/v1/routers/conexion/registrar` con el token, su clave pública, la versión de RouterOS y la CA (para que ArgosIsp verifique el certificado). Con la respuesta agrega el peer del servidor (keepalive 25 s). Si el registro falla, usa los datos del servidor que trae el script y dice qué paso falló |
| Cert. | `argosisp-www` (firmado por `argosisp-ca`) con SAN = IP del túnel **y** la IP con que ArgosIsp llegaba antes (`apiIpAnterior`, del `api_url` del router): sirve por los dos caminos mientras se migra. Va a `www-ssl` solo si el registro respondió OK (ArgosIsp ya conoce la CA) o si `www-ssl` no tenía certificado o ya usaba `argosisp-www`. Un certificado ajeno (p. ej. `argos-api` firmado por tu `argos-ca`) se queda en `www-ssl` y **no se borra**: solo se borran `argosisp-www` y su temporal `argosisp-www-nuevo` |
| RADIUS | `/radius` hacia la `.1` con el secreto del router y `src-address` = su IP del túnel; `/radius incoming` en 3799; `/ppp aaa` con RADIUS y accounting |
| C4 | Espera el handshake del túnel (hasta 40 s). **Solo si el registro respondió OK y hay handshake**: apaga `telnet`, `ftp`, `www`, `api`, `api-ssl`, el servidor de bandwidth-test, RoMON y MAC-Telnet; `www-ssl`, `winbox` y `ssh` solo desde la red del túnel, `argosisp-admin` y las IPs de las sesiones abiertas (que también entran en `argosisp-admin`). Si no, no cambia nada |
| C5 | (solo con C4 aplicado) Reglas `argosisp:gestion` al **inicio** de `input`: CoA, REST y ping solo desde la `.1` por el túnel; Winbox, SSH y `www-ssl` desde `argosisp-admin`; el resto de los puertos de gestión y cualquier conexión nueva por el túnel se descartan. Solo conexiones nuevas hacia el propio router: **no toca el tráfico de los clientes** |
| C6 | `listo`, o `AVISO` con qué falló (registro, túnel) y cómo reintentar; con el registro fallido, la CA para pegarla en el panel |

El puerto UDP de WireGuard del router no se abre: el router inicia el túnel y las respuestas del servidor entran como conexión establecida.

**Probado en CHR** (`/import` y pegado por la consola, como en New Terminal):

| RouterOS | Resultado |
| --- | --- |
| 7.24.5 | Registro con verificación del certificado de ArgosIsp (raíces incluidas en RouterOS, `builtin-trust-store`), túnel con handshake, REST por el túnel con `argosisp-api` verificando el certificado del router por IP, CoA aceptado desde la `.1`, `Access-Request` llegando a la `.1:1812`. Pegado en un CHR limpio sin IPs de administración: Winbox, SSH y `www-ssl` dejan de responder desde fuera. Re-ejecutado con el token ya usado: no corta el túnel y avisa que ya estaba conectado. Con «servicio» sobre un router con `lab.rsc`: reglas `argosisp:gestion` primero, luego las `argosisp:top` del corte y FastTrack OK |
| 7.24.5 (#181, sin encierro) | Con un Argos simulado y un segundo CHR como servidor WireGuard, `admin` vacío y un `argos-ca`/`argos-api` propio en `www-ssl`. **Registro 410 y túnel caído:** sin reglas ni `address=`, la LAN sigue llegando a `www-ssl`, SSH y Winbox, `www-ssl` sigue con `argos-api`, AVISO con los dos motivos. **Registro OK y túnel caído:** no restringe; `www-ssl` pasa a `argosisp-www` con SAN `IP:<túnel>,IP:<LAN>` (verificado con `openssl -verify_ip` por las dos IPs con la CA que recibió Argos); `argos-ca` y `argos-api` siguen. **Registro OK y handshake:** restringe; la LAN deja de llegar (timeout), la IP de la sesión SSH que lo corrió (`10.0.2.2`) entra en `argosisp-admin` y sigue entrando, REST desde la `.1` por el túnel OK. **Re-ejecución** con el token usado: se queda como estaba (7 reglas, 1 entrada) y AVISO + CA; con registro OK: rehecho sin duplicados. **Pegado por la consola** con `admin`: restringe a túnel + admins y avisa que no hay sesión con IP. **Rescate** por consola: vuelve el acceso; túnel, RADIUS y certificados siguen. En 7.2x las conexiones abiertas aparecen en `/ip service` como entradas dinámicas con el mismo nombre (`ssh`, `winbox`): por eso el script usa `/ip service set ssh …` y no `[find where name=…]` |
| 7.16.2 | Igual, pero sin `builtin-trust-store`: el registro solo verifica el certificado si la CA de ArgosIsp está importada; si no, cae al paso de pegar la clave |
| 7.12.1 | Sin `:serialize`: el registro falla, el resto se aplica y el script pide pegar la clave (por eso `:serialize`/`:deserialize` se cargan con `:parse`) |

### Si quedaste fuera: rescate de la gestión

`rescate-gestion.rsc` deshace **solo** lo `argosisp:gestion`: las reglas de filtro, la lista `argosisp-admin` y el `address=` (`available-from`) de `www-ssl`, `winbox` y `ssh`. No toca el túnel, RADIUS, el usuario `argosisp-api`, los certificados ni el tráfico de los clientes. Pégalo en una terminal que no dependa de la IP: **Winbox por MAC** (Neighbors → la MAC del router → Connect → New Terminal) o la **consola** (serial, monitor o la del hipervisor):

```
/ip firewall filter remove [find where comment~"^argosisp:gestion"]
/ip firewall address-list remove [find where list="argosisp-admin"]
/ip service set www-ssl address=""
/ip service set winbox address=""
/ip service set ssh address=""
```

Cada línea es independiente (si una falla, las demás se aplican). En 7.17+ RouterOS muestra un aviso `Deprecation warning: address` y lo aplica igual (es `available-from`); `address` funciona en todas las 7.x. Probado por consola serial en CHR 7.24.5 sobre un router restringido: la LAN vuelve a llegar a `www-ssl`, SSH y Winbox, y el túnel, RADIUS y los certificados siguen.

Después, corrige lo que falló y vuelve a correr un script nuevo: ya no restringe si el registro o el túnel fallan.

Las plantillas son ASCII y no llevan comentarios dentro del bloque: el terminal de RouterOS no maneja UTF-8 al pegar y cuenta las llaves de los comentarios (`armar.mjs` las limpia; los comentarios siguen en las piezas).

### Permisos mínimos de la API

Probado en CHR 7.24.5 grupo por grupo contra lo que hace ArgosIsp por REST (`GET /system/resource`; `PUT`/`PATCH`/`DELETE` en colas simples, árbol y tipos de cola, address-lists IPv4 e IPv6, leases DHCP, ARP, mangle, perfiles PPP; `GET` de `/ppp/active` y `/ipv6/dhcp-server/binding`; `PUT` de rutas IPv4/IPv6 y direcciones IPv6 para el prefijo estático):

| Grupo | Resultado |
| --- | --- |
| `read,write,api,rest-api` | Todo lo anterior funciona. **Es el mínimo** |
| `read,write,rest-api` (sin `api`) | `500 not allowed`: la REST corre sobre la API |
| `read,write,api` (sin `rest-api`) | `401` |
| `read,rest-api` | `500 not allowed` en lectura y escritura |

Con el mínimo, `PUT /user` y `PATCH /user` responden `not enough permissions`, `POST /system/reboot` también, y `POST /execute` no logra crear usuarios: no puede escalar. Sí puede cambiar `/ip service` (es `write`); por eso el usuario solo entra desde la `.1` del túnel. No hace falta `web` para la REST por `www-ssl`. El **servicio** `api` (8728) queda apagado aunque el grupo tenga la **política** `api`.

### Datos de «incluir configuración de servicio»

`conexion-servicio.rsc.tpl` necesita el grupo `servicio` de `variables.json`. Argos todavía no los guarda por router: la API los lee de su entorno (`apps/api/app/network/conexion/servicio.ts`). Si falta alguno obligatorio responde 422 `servicio_incompleto` con la lista.

| Variable del script | Entorno de la API | Ejemplo (`lab.rsc`) | Origen |
| --- | --- | --- | --- |
| `pppoe_interfaz` | `interfaz_clientes` del router o `ROUTEROS_INTERFAZ_CLIENTES` | `ether2` | ficha del router |
| `wan_interfaz` | `ROUTERS_SERVICIO_WAN_INTERFAZ` | `ether1` | `.env` |
| `ppp_local_v4` | `ROUTERS_SERVICIO_PPP_LOCAL_V4` | `10.10.0.1` | `.env` |
| `pool_v4_rangos` | `ROUTERS_SERVICIO_POOL_V4_RANGOS` | `10.10.0.10-10.10.0.250` | `.env` |
| `clientes_v4` | `ROUTERS_SERVICIO_CLIENTES_V4` | `10.10.0.0/16` | `.env` |
| `clientes_v6` (puede ir vacía) | `ROUTERS_SERVICIO_CLIENTES_V6` | `2001:db8:100::/48,2001:db8:200::/40` | `.env` |
| `susp_rate_limit` | `ROUTERS_SERVICIO_SUSP_RATE_LIMIT` (los compose le pasan `AAA_SUSPENDIDO_RATE_LIMIT`) | `256k/256k` | derivada |
| `pool_v6_enlace_prefijo` | `ROUTERS_SERVICIO_POOL_V6_ENLACE_PREFIJO` | `2001:db8:100::/48` | `.env` |
| `pool_v6_pd_prefijo` | `ROUTERS_SERVICIO_POOL_V6_PD_PREFIJO` | `2001:db8:200::/40` | `.env` |
| `portal_v4`, `portal_v6` | `ROUTERS_SERVICIO_PORTAL_V4`, `ROUTERS_SERVICIO_PORTAL_V6` | `192.0.2.20`, `2001:db8:ffff::20` | `.env` |
| `portal_fqdn` | `ROUTERS_SERVICIO_PORTAL_FQDN` (en producción, `DOMINIO_PORTAL` por defecto) | `portal.argosisp.example` | derivada |
| `walled_garden` (puede ir vacía) | `ROUTERS_SERVICIO_WALLED_GARDEN` | `app.recurrente.com` | `.env` |
| `dns_v4`, `dns_v6` (`dns_v6` puede ir vacía) | `ROUTERS_SERVICIO_DNS_V4`, `ROUTERS_SERVICIO_DNS_V6` | `192.0.2.53,198.51.100.53` | `.env` |

En **desarrollo** (`infra/docker-compose.yml`) los valores por defecto son los de `lab.rsc` (rangos de documentación, solo para el laboratorio). En **producción** no tienen valor por defecto, salvo los derivados: son datos de la red del ISP. Listas separadas por coma, sin espacios.

### Render (para A1)

`GET /routers/:id/script-conexion` sirve `plantillas/conexion.rsc.tpl` (o `conexion-servicio.rsc.tpl` con `?incluir=servicio`) reemplazando cada `{{variable}}`. Reglas en `render.mjs` (implementación de referencia) y patrones en `variables.json`: todas las variables de la plantilla deben venir y cumplir su patrón, el valor va siempre dentro de una cadena entre comillas y se escapan `\ " $ ?`; un carácter de control es error. Prueba: `node --test infra/mikrotik/render.test.mjs`. Para el laboratorio: `node infra/mikrotik/render.mjs plantillas/conexion.rsc.tpl valores.json > r.rsc`.

## Laboratorio (`lab.rsc`)

`lab.rsc` deja un RouterOS 7 listo para que A2 pruebe RADIUS, accounting y CoA, y para que A5 pruebe la página de corte por IPv4 e IPv6. Desde la semana 2 también prepara los clientes **WISP sin PPPoE** (`contratos/routeros.md`), el **control de velocidad** (`contratos/velocidad.md`) y el usuario de la **API REST** con HTTPS.

## Qué configura

| Bloque              | Configuración                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PPPoE               | Servidor `argosisp` en `labIf`, perfil `default`, solo PAP/CHAP, MTU/MRU 1480, `one-session-per-host`                                                                                                                                     |
| Perfil `default`    | `local-address`, pool IPv4 `argos-v4-pppoe`, `/64` de enlace desde `argos-v6-enlace` (`remote-ipv6-prefix-pool`), `/56` por DHCPv6-PD desde `argos-v6-pd` (`dhcpv6-pd-pool`), DNS = router, `change-tcp-mss`                              |
| Perfil `suspendido` | Igual que `default` más `rate-limit=256k/256k`, `address-list=suspendidos` (el router agrega la IPv4, el /64 y el /56 de la sesión a las listas `suspendidos` de IPv4 e IPv6) e `interface-list=suspendidos`                              |
| RADIUS              | `/radius service=ppp timeout=1s src-address=...` (segunda entrada si `radiusAddr2` no está vacío), `/radius incoming accept=yes port=3799`, `/ppp aaa use-radius=yes accounting=yes interim-update=5m`                                    |
| Corte IPv4          | Cadena `argos-corte`: DNS (`argos-dns`), portal (`argos-portal`), walled garden por FQDN (`argos-walled`), `tcp-reset` al resto de TCP y `icmp-admin-prohibited` a lo demás. NAT `argos-corte-nat`: TCP/80 → `portalV4:portalCortePuerto` |
| Corte IPv6          | Espejo del IPv4 **sin NAT** (decisión del PM): DNS a nuestros resolvers, portal y walled garden; `tcp-reset` y `icmp-admin-prohibited` al resto, nunca `drop`. NAT IPv6 comentado como alternativa. Detalle en "Corte por IPv6"           |
| Filter-Id           | Salto `forward → ppp` en IPv4 e IPv6 para las reglas dinámicas que RouterOS crea con `Filter-Id`; cadena neutra `argos-activo`                                                                                                            |
| Hacia el router     | Suspendidos solo alcanzan DNS, ICMP y, en IPv6, ND/RA y DHCPv6 (renovación del PD)                                                                                                                                                        |
| WireGuard           | Opcional (`wgHabilitar true`): túnel `wg-argosisp` hacia el servidor                                                                                                                                                                      |
| WISP sin PPPoE      | Gateway en `wispIf`, DHCP `argos-dhcp-wisp` **solo con leases estáticos** (`address-pool=static-only`) para `dhcp_fija`, VLAN de ejemplo `wisp-amarre` con `arp=reply-only` y su DHCP con `add-arp=yes` para el amarre IP-MAC. Ver "WISP sin PPPoE" |
| FastTrack           | Excluido para `argos-clientes` (PPPoE y WISP, IPv4 e IPv6) con dos `accept established,related` antes de `defconf: fasttrack`; script `argosisp-verificar-fasttrack` lo comprueba al final del import                                       |
| `arbol_pcq`         | Ejemplo con el plan ficticio `0` (20M/10M, 1:4): padres globales, PCQ por plan con máscara /64 en IPv6, address-list `argosisp-plan-0` y mangle `mark-packet` sin `passthrough`, más el limitado                                         |
| API REST            | Grupo `argosisp-api` (`read,write,api,rest-api`), usuario `argosisp-api` restringido a `apiDesde`, certificado propio en `www-ssl` (TLS 1.2+), `www`, `api` y `api-ssl` apagados                                                                    |

Las reglas de salto (`argosisp:top`) se colocan al inicio de `filter` y `nat` (IPv4 e IPv6), antes de fasttrack y de `accept established,related`, que de otro modo dejarían pasar al suspendido.

**Qué es de quién.** `lab.rsc` solo borra y recrea lo que lleva comentario `argosisp: …` (con espacio) o `argosisp:top …`. Lo que ArgosIsp crea por la API lleva `argosisp:servicio:<id>` o `argosisp:plan:<id>` (sin espacio; `contratos/routeros.md`) y el script **no lo toca** al reaplicarse (antes la limpieza borraba cualquier `argosisp…` de las address-lists, incluidas las entradas de `suspendidos` de los servicios WISP).

### Nombres que A1 registra en `planes_routers`

| Uso                           | Nombre            | Prefijo de ejemplo         | Atributo RADIUS (modo `radius_pool`)                              |
| ----------------------------- | ----------------- | -------------------------- | ----------------------------------------------------------------- |
| Pool IPv4                     | `argos-v4-pppoe`  | `10.10.0.10-10.10.0.250`   | `Framed-Pool`                                                     |
| /64 de enlace                 | `argos-v6-enlace` | `2001:db8:100::/48` en /64 | `Framed-IPv6-Pool`                                                |
| /56 delegado                  | `argos-v6-pd`     | `2001:db8:200::/40` en /56 | `Delegated-IPv6-Pool` (RFC 4818) o `Mikrotik-Delegated-IPv6-Pool` |
| Perfil de corte               | `suspendido`      | —                          | `Mikrotik-Group`                                                  |
| Address-list / interface-list | `suspendidos`     | —                          | `Mikrotik-Address-List`                                           |

### Binding DHCPv6-PD de una sesión PPPoE

Verificado el 16-10-2026 en dos CHR RouterOS **7.24.5** (r1 con `lab.rsc`, r2 como cliente PPPoE con `/ipv6 dhcp-client request=prefix`), usuario `cliente-pd`:

- Cada sesión con `dhcpv6-pd-pool` en su perfil crea un **servidor DHCPv6 dinámico** con el nombre de la interfaz PPP, con los signos `<` y `>` incluidos: `/ipv6/dhcp-server` → `name = interface = <pppoe-cliente-pd>`, `dynamic = true`, `prefix-pool = argos-v6-pd`, `address-pool = static-only`.
- El binding: `/ipv6/dhcp-server/binding` → `server = <pppoe-cliente-pd>`, `active-server = <pppoe-cliente-pd>`, `address = 2001:db8:200::/56`, `ia-type = pd`, `prefix-pool = argos-v6-pd`, `dynamic = true`, `status = bound`, `duid` del CPE. El nombre **sí es `<pppoe-<usuario>>`**, como lo busca `CompletarPrefijoDelegado`.
- Por la API REST el filtro funciona con los signos codificados: `GET /rest/ipv6/dhcp-server/binding?server=%3Cpppoe-cliente-pd%3E` devuelve el binding; `?server=pppoe-cliente-pd` (sin `< >`) devuelve `[]`. Leerlo solo necesita la política `read`.
- La ruta del /56 en `/ipv6/route` es `dst-address = 2001:db8:200::/56`, `gateway = fe80::…%<pppoe-cliente-pd>` (link-local del CPE con la interfaz, no `<pppoe-…>` solo), `dynamic` y `dhcp = true`; el /64 de enlace sí tiene `gateway = <pppoe-cliente-pd>`. Para el /56 conviene el binding, no la ruta.
- Al cerrar la sesión desaparecen el servidor dinámico y el binding; al reconectar el mismo CPE (mismo DUID) recibe el mismo /56 mientras el pool no lo reasigne.
- En la prueba el /56 salió del pool del perfil (`/ppp secret` local, `radius = false`). Con RADIUS en modo `radius_pool` (`Delegated-IPv6-Pool`) el servidor dinámico es el mismo (depende de la interfaz, no del origen del pool); falta confirmarlo con RADIUS en el equipo físico. Con `Delegated-IPv6-Prefix` fijo (`radius_servicio`) no hace falta buscarlo.

Para el modo `radius_servicio` (IP y prefijos fijos por servicio), el IPAM debe usar rangos fuera de esos pools, por ejemplo `10.10.1.0/24`, `2001:db8:101::/48` (enlace) y `2001:db8:300::/40` (delegados). El router instala la ruta al recibir `Framed-IP-Address`, `Framed-IPv6-Prefix` y `Delegated-IPv6-Prefix`.

## Aplicar

1. Edita solo el bloque **Variables** de `lab.rsc`: interfaces, IPs, `radiusSecret` (= `RADIUS_LAB_SECRET`), `radiusSrc` (= `RADIUS_LAB_NAS_IP`), portal, walled garden (trae `app.recurrente.com`, la pasarela real; los dominios de recursos del checkout y del 3-D Secure se confirman en el laboratorio), DNS y prefijos. Los valores de ejemplo son de documentación (RFC 5737, RFC 1918, `2001:db8::/32`, `.example`).
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
    # el /56 delegado al cliente: server = <pppoe-usuario> (servidor dinámico creado por el perfil)
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

## Corte por IPv6: rechazo rápido, `/corte` por IPv4

**Decisión del PM (día 4, opción 1):** se suspende por **CoA sin reconectar** (`COA_SUSPENDER_CON_IPV6=coa`, valor por defecto del compose y el de producción). No hay NAT ni redirección IPv6: el cliente siempre tiene IPv4 y llega a `/corte` por ahí. En IPv6 el router solo tiene que fallar **rápido**, para que el navegador (Happy Eyeballs) y la detección de portal cautivo pasen a IPv4 sin esperar timeouts.

Qué hace `lab.rsc` (sección 9) con el tráfico IPv6 de un suspendido (por `Filter-Id = "argos-corte.in"` del CoA, o por las listas `suspendidos` si entró ya suspendido):

| Tráfico                                                                       | Acción                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------ |
| DNS (UDP/TCP 53) a nuestros resolvers (`dnsV6` → `argos-dns`) y al router     | `accept`                                   |
| Portal (`argos-portal`: `portalV6` y el FQDN) y walled garden por FQDN (AAAA) | `accept`                                   |
| ICMPv6 (ND, RA), DHCPv6 (renovación del PD) hacia el router                   | `accept`                                   |
| Cualquier otro TCP                                                            | `reject reject-with=tcp-reset`             |
| Todo lo demás (QUIC/UDP 443, ICMPv6 de eco hacia fuera, etc.)                 | `reject reject-with=icmp-admin-prohibited` |

Nunca `drop`: con `drop` el navegador espera el timeout de la conexión IPv6 (Happy Eyeballs le da ventaja a IPv6 y algunos sistemas tardan segundos en abandonarla), y las sondas de portal cautivo por IPv6 pueden terminar en "sin Internet". Con `reset` la conexión IPv6 falla en un RTT, el navegador usa IPv4, el dst-nat IPv4 lleva TCP/80 a `/corte` y el sistema muestra "Iniciar sesión en la red". En IPv4 el resto también se rechaza en vez de descartarse, y lo mismo hacia el router (`argos-corte-in`).

**Alternativa no aplicada.** Con `COA_SUSPENDER_CON_IPV6=disconnect` (A2) el suspendido reconecta con `Mikrotik-Group = "suspendido"` y el router mete su /64 y /56 en la address-list IPv6 `suspendidos`; entonces sí se podría redirigir TCP/80 por IPv6 al portal con `/ipv6 firewall nat`. Las reglas quedan **comentadas** en la sección 9 de `lab.rsc` (requieren el portal publicado en `[portalV6]:80`, ver `infra/README.md`). Con CoA no sirven: un CoA no llena listas IPv6 y `Filter-Id` solo crea reglas de filtro, no de NAT.

### Qué verificar en el equipo físico (criterio del día 5)

Con un cliente PPPoE dual-stack activo (IPv4, /64 y /56) y `COA_SUSPENDER_CON_IPV6=coa`:

1. `/import file-name=lab.rsc verbose=yes` sin errores; `/ipv6 firewall filter print where comment~"argosisp"` muestra `corte TCP reset` y `corte rechazo del resto` (`reject`), y ninguna regla `argosisp` con `drop` en `argos-corte`.
2. Suspender el servicio desde la API (`POST /servicios/:id/suspender`): `audit.red` con CoA-ACK, la sesión **no** se reconecta y aparece `chain=ppp ... jump argos-corte` en `/ipv6 firewall filter print dynamic`.
3. Desde el cliente: `curl -6 -m 3 -v https://example.com/` y `curl -6 -m 3 -v http://example.com/` fallan **de inmediato** con "Connection reset" (no por timeout); `ping -6 -c 2 2606:4700:4700::1111` recibe "Administratively prohibited".
4. `dig AAAA example.com @<dnsV6>` y la consulta al DNS del router responden; el portal por IPv6 (`curl -6 http://[portalV6]/`) carga.
5. `curl -4 -v http://example.com/` devuelve la página de corte (dst-nat IPv4) y `/corte` identifica al cliente por su IPv4.
6. **Teléfono dual-stack suspendido** (Android o iPhone tras el CPE, Wi-Fi recién conectado): muestra "Iniciar sesión en la red" y abre `/corte` en **menos de 3 s**. Medir también abriendo `http://example.com` en el navegador del teléfono: la página de corte en menos de 3 s.
7. QUIC: en Chrome (`chrome://net-internals/#events`), UDP/443 por IPv6 falla al instante y no hay esperas.
8. Reactivar (Disconnect): la sesión nueva navega por IPv4 e IPv6 sin reglas residuales.

### Anexo: propuesta de A2 para redirigir IPv6 (alternativa `disconnect`, no aplicada)

> Se conserva como referencia. La decisión vigente es la de arriba (opción 1, CoA sin reconectar); las reglas NAT de esta propuesta están comentadas en la sección 9 de `lab.rsc`.

Problema (PM, `lideres.md`): un suspendido por IPv6 queda bloqueado pero no llega a `/corte`, porque la cadena `argos-corte` de IPv6 responde `tcp-reset` y no hay redirección. RouterOS 7 sí tiene `/ipv6 firewall nat` con `dst-nat`, pero necesita en `dstnat` algo que identifique al suspendido, y eso depende de cómo se suspendió:

| Cómo entró al corte                                                               | Qué deja en el router (verificado arriba)                                                                                     | ¿Se puede hacer dst-nat IPv6?                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Login con el servicio ya suspendido (`aaa` manda `Mikrotik-Group = "suspendido"`) | IPv4, /64 y /56 en la address-list `suspendidos` de IPv4 **e IPv6**, interfaz en la interface-list `suspendidos`, `Filter-Id` | Sí: `src-address-list=suspendidos` o `in-interface-list=suspendidos` |
| CoA sobre la sesión viva (`Mikrotik-Address-List` + `Filter-Id`)                  | IPv4 en `suspendidos` (solo IPv4) y la regla dinámica `chain=ppp` de `Filter-Id` (solo en `filter`)                           | No: nada que `dstnat` pueda ver para IPv6                            |

No existe un atributo RADIUS de MikroTik para una address-list IPv6 (el diccionario solo trae `Mikrotik-Address-List`, que en CoA aplica solo a IPv4), así que no se inventa un `Mikrotik-Address-List6`.

**Qué mandan `aaa` y `coa`:**

- `aaa`, Access-Accept de un suspendido (sin cambios): `Mikrotik-Group = "suspendido"`, `Mikrotik-Rate-Limit = "256k/256k"`, `Mikrotik-Address-List = "suspendidos"`, `Filter-Id = "argos-corte.in"`, más su `Framed-IP-Address`, `Framed-IPv6-Prefix` (/64) y `Delegated-IPv6-Prefix` (/56) de siempre (A5 identifica al cliente por esas IPs).
- `coa`, al suspender una sesión viva:
    - `COA_SUSPENDER_CON_IPV6=coa` (por defecto, comportamiento del día 3): CoA con `Mikrotik-Rate-Limit`, `Mikrotik-Address-List` y `Filter-Id`. IPv4 aterriza en `/corte` sin reconectar; IPv6 queda bloqueado con reset.
    - `COA_SUSPENDER_CON_IPV6=disconnect`: si la sesión tiene /64 o /56 en `network.sesiones`, Disconnect-Request; el CPE reconecta en segundos y entra por la primera fila de la tabla (perfil `suspendido` completo en IPv4 e IPv6). Las sesiones solo IPv4 siguen por CoA. Queda en `audit.red` como `disconnect` con `razon` = `suspender: … (sesión con IPv6: reconecta con el perfil suspendido)`.
- Reactivar sigue siendo Disconnect (la sesión nueva sale sin listas ni reglas).

**NAT IPv6 (comentado en `lab.rsc`):** espejo IPv6 del NAT de corte IPv4, con las mismas listas:

```
/ipv6 firewall nat
add chain=dstnat src-address-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT IPv6 por address-list"
add chain=dstnat in-interface-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT IPv6 por interface-list"
add chain=argos-corte-nat dst-address-list=argos-portal action=return comment="argosisp: corte-nat portal sin NAT"
add chain=argos-corte-nat dst-address-list=argos-walled action=return comment="argosisp: corte-nat walled garden sin NAT"
add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat to-address=$portalV6 to-ports=$portalCortePuerto comment="argosisp: corte-nat HTTP IPv6 a /corte"
```

En IPv6 el parámetro es `to-address` (en IPv4 es `to-addresses`); confirmar la sintaxis en 7.24.5. Después del dst-nat el destino es `portalV6`, que está en `argos-portal`, así que la regla `corte portal` de la cadena `argos-corte` de IPv6 lo acepta; el `tcp-reset` queda para el resto (HTTPS no se puede redirigir, igual que en IPv4). Las reglas `argosisp:top` de NAT IPv6 se mueven al inicio igual que las de IPv4. El portal debe escuchar en `[portalV6]:portalCortePuerto` y responder `/corte` para cualquier `Host` (A5).

**Verificar en el CHR (A6):** con `COA_SUSPENDER_CON_IPV6=disconnect`, suspender desde la API → `audit.red` con Disconnect-ACK → el cliente reconecta → `/ipv6 firewall address-list print where list=suspendidos` muestra el /64 y el /56 → `curl -6 http://example.com` desde el cliente devuelve la página de corte. Con `coa`, el mismo `curl -6` sigue en reset (comportamiento esperado de ese modo).

Si el PM quiere el redirect IPv6 **sin** reconectar, la alternativa es que `coa`, tras el CoA-ACK, agregue el /64 y el /56 de la sesión a `/ipv6/firewall/address-list list=suspendidos` por la API REST de RouterOS (fila `routeros` en `audit.red`) y los quite al reactivar. Más piezas que pueden fallar (credenciales de API, entradas huérfanas si falla el borrado); queda para la semana 2 si se decide.

## WISP sin PPPoE (`ip_estatica`, `dhcp_fija`)

Contrato: `.claude/integration/contratos/routeros.md`. Estos servicios no pasan por RADIUS: ArgosIsp (dispatcher de A2) escribe en el router por la API REST. `lab.rsc` solo deja listo el segmento; **los objetos de cada servicio los crea ArgosIsp** con `comment = "argosisp:servicio:<id>"`.

| Pieza | Lo hace `lab.rsc` | Lo hace ArgosIsp por la API |
| --- | --- | --- |
| Gateway | `wispGateway` en `wispIf` (y `wispV6Gateway` con RA si se define) | — |
| `ip_estatica` | nada más: la IP va a mano en la antena (gateway `wispGateway`, DNS el router) | cola simple `target=<ipv4>/32` |
| `dhcp_fija` | servidor `argos-dhcp-wisp` con `address-pool=static-only` (una MAC sin lease no recibe IP) y su `network` | `/ip/dhcp-server/lease` (`mac-address`, `address`, `server=argos-dhcp-wisp`) + cola |
| Amarre IP-MAC | VLAN `wisp-amarre` (id `amarreVlanId`) con `arp=reply-only` y DHCP `argos-dhcp-amarre` con `add-arp=yes` | `/ip/arp` estático (`address`, `mac-address`, `interface=wisp-amarre`) si `amarre_ip_mac = true` |
| Corte | la misma `suspendidos`, el mismo NAT a `/corte` y el mismo rechazo que PPPoE | `/ip/firewall/address-list` `list=suspendidos` (solo en `suspendido`) |
| NAT y FastTrack | `wispRed` y `amarreRed` en `argos-clientes` | — |

**Amarre (`arp=reply-only`).** El router solo contesta ARP a las IPs que tienen entrada estática en `/ip arp` o lease de su DHCP (`add-arp=yes`). Un equipo que clona la IP pero tiene otra MAC no recibe respuesta ARP y no navega. Por eso **todos** los servicios de una interfaz `reply-only` necesitan amarre o lease: un `ip_estatica` sin `amarre_ip_mac` en esa interfaz se queda sin servicio. La VLAN de ejemplo separa los clientes con amarre de los demás; en un despliegue real se activa en la interfaz (o VLAN) de la antena sectorial que se quiera proteger.

**IPv6 en WISP.** `wispV6Gateway` publica un /64 **compartido** con RA para la WAN de los CPE. No sirve para limitar por cliente (todos comparten el /64): el límite por cliente en IPv6 va por su /56 delegado con binding DHCPv6 estático por DUID (tarea de la semana 2). El `target` de la cola WISP no debe llevar el /64 del segmento.

**Verificado el 16-10-2026** en dos CHR RouterOS **7.24.5** (r1 con `lab.rsc`, r2 como CPE en `wispIf`), todo por la API REST con el usuario `argosisp-api` sobre HTTPS verificando el certificado con `argosisp-ca.crt`:

| Prueba | Resultado |
| --- | --- |
| CPE en DHCP sin lease | `searching...`: no recibe IP (`static-only`) |
| `PUT /rest/ip/dhcp-server/lease` con su MAC | el CPE queda `bound` con `10.20.0.50` |
| `PUT /rest/queue/simple` `max-limit=128k/256k` | bandwidth-test hacia el CPE: ~244 kbps de bajada |
| `PUT /rest/ip/firewall/address-list` `list=suspendidos` | TCP del CPE al router rechazado al instante (`corte-in TCP reset`); al quitar la entrada vuelve a conectar |
| VLAN `wisp-amarre` (`arp=reply-only`) sin ARP estático | ping al gateway: 100 % perdido |
| `PUT /rest/ip/arp` con IP y MAC del CPE | ping al gateway responde; otra IP sin amarre en el mismo equipo no responde |
| Reaplicar `lab.rsc` con entradas `argosisp:servicio:999` en `suspendidos` y `/queue simple` | quedan intactas |

Llamadas que hace el dispatcher (para probar a mano con el usuario de API, ver abajo):

```
# lease de dhcp_fija
curl --cacert argosisp-ca.crt -u argosisp-api:$CLAVE -X PUT https://<apiNombre>/rest/ip/dhcp-server/lease \
  -H 'content-type: application/json' \
  -d '{"address":"10.20.0.50","mac-address":"AA:BB:CC:00:00:50","server":"argos-dhcp-wisp","comment":"argosisp:servicio:123"}'
# cola simple (velocidad del plan; formato completo de velocidad.ts)
curl --cacert argosisp-ca.crt -u argosisp-api:$CLAVE -X PUT https://<apiNombre>/rest/queue/simple \
  -H 'content-type: application/json' \
  -d '{"name":"argosisp-servicio-123","target":"10.20.0.50/32","max-limit":"10M/20M","comment":"argosisp:servicio:123"}'
# corte
curl --cacert argosisp-ca.crt -u argosisp-api:$CLAVE -X PUT https://<apiNombre>/rest/ip/firewall/address-list \
  -H 'content-type: application/json' -d '{"list":"suspendidos","address":"10.20.0.50","comment":"argosisp:servicio:123"}'
# amarre
curl --cacert argosisp-ca.crt -u argosisp-api:$CLAVE -X PUT https://<apiNombre>/rest/ip/arp \
  -H 'content-type: application/json' \
  -d '{"address":"10.21.0.50","mac-address":"AA:BB:CC:00:00:51","interface":"wisp-amarre","comment":"argosisp:servicio:124"}'
```

## Control de velocidad (`simple` y `arbol_pcq`)

Contrato: `.claude/integration/contratos/velocidad.md`.

### FastTrack excluido para clientes con colas

Con FastTrack los paquetes saltan colas simples, queue tree y mangle: el cliente navega sin límite. `lab.rsc` no apaga FastTrack para el resto del tráfico del router; agrega dos reglas `argosisp:top sin fasttrack` (subida y bajada) que aceptan lo `established,related` de `argos-clientes` **antes** de `defconf: fasttrack` y **después** de los saltos de corte (un suspendido sigue cayendo en `argos-corte`). Igual en IPv6 (RouterOS 7 también tiene FastTrack IPv6).

`argos-clientes` = `clientesV4`, `wispRed`, `amarreRed` en IPv4 y `clientesV6`, `wispV6Red` en IPv6. Si se agrega una red de clientes, va a esas variables y se reaplica.

**Verificación (un comando):**

```
/system script run argosisp-verificar-fasttrack
# argosisp: FastTrack OK (excluido para argos-clientes en IPv4 e IPv6)
```

Verificado en CHR 7.24.5 con reglas tipo defconf (`defconf: fasttrack` y `accept established,related` en IPv4 e IPv6, antes del import): las reglas `sin fasttrack` quedan antes de FastTrack y el script responde OK; moviendo `defconf: fasttrack` al inicio responde `FastTrack MAL: ipv4:fasttrack-antes-de-la-exclusion`.

Falla (y deja `argosisp: FastTrack MAL: …` en `/log`) si alguna regla `fasttrack-connection` activa de IPv4 o IPv6 queda antes de la exclusión, si falta la exclusión o si hay conexiones vivas de clientes (IPv4) marcadas como FastTrack. `lab.rsc` lo corre al final del import, así que un import que deja FastTrack mal termina con error. Con tráfico real, también: `/ip firewall connection print count-only where fasttrack` (de clientes debe ser 0) y los contadores de `/ip firewall filter print stats where comment~"sin fasttrack"` suben.

### Modo `simple`

Una cola simple por servicio: la dinámica de PPPoE (`Mikrotik-Rate-Limit` desde `aaa`) o la estática que crea ArgosIsp para WISP. El reuso va con una cola padre por plan y router (`comment = argosisp:plan:<id>`). `lab.rsc` no crea colas simples. Buenas prácticas que verifica el monitoreo:

- **Más de ~1000 colas simples en un router** es la alerta `RouterDemasiadasColasSimples` (`infra/monitoring/reglas.yml`): pasar ese router a `arbol_pcq`.
- `/queue simple print count-only where !(comment~"^argosisp:")` y `!dynamic` debe dar 0: ArgosIsp no deja colas sueltas.

### Ejemplo de `arbol_pcq`

`arbolEjemplo true` crea, con el plan ficticio `0` (ningún plan real tiene id 0) y los mismos nombres que usará ArgosIsp:

```
/queue type   argosisp-plan-0-bajada   pcq-rate=20M pcq-classifier=dst-address pcq-dst-address6-mask=64
              argosisp-plan-0-subida   pcq-rate=10M pcq-classifier=src-address pcq-src-address6-mask=64
              argosisp-plan-0-limitado-{bajada,subida}  (2M / 1M)
/queue tree   argosisp-ejemplo-bajada  parent=global max-limit=capBajada
              └ argosisp-plan-0-bajada packet-mark=argosisp-plan-0-bajada queue=argosisp-plan-0-bajada
                                       max-limit=20M (MIR × 4 activos / reuso 4) limit-at=20M (CIR 5M × 4) priority=8
              └ argosisp-plan-0-limitado-bajada
              argosisp-ejemplo-subida  (igual, con 10M)
/ip firewall address-list  argosisp-plan-0: 10.20.0.101 … 10.20.0.104
/ipv6 firewall address-list argosisp-plan-0: 2001:db8:101:1::/64, 2001:db8:300:100::/56
/ip|ipv6 firewall mangle   forward dst-address-list=argosisp-plan-0 → mark-packet argosisp-plan-0-bajada passthrough=no
                           forward src-address-list=argosisp-plan-0 → mark-packet argosisp-plan-0-subida passthrough=no
```

- Cada cliente tiene su tope (`pcq-rate` = MIR) y el padre del plan reparte el reuso: con 4 clientes del plan 1:4 de 20 Mbps, los 4 juntos comparten 20 Mbps y uno solo alcanza 20 Mbps.
- `pcq-dst-address6-mask=64` / `pcq-src-address6-mask=64`: en IPv6 cada /64 es un cliente (un teléfono con varias direcciones de privacidad no multiplica su cuota).
- Un servicio limitado pasa a la lista `argosisp-plan-<id>-limitado`; nunca se edita el PCQ del plan para un cliente.
- `/queue type` no tiene comentario, así que el script borra por nombre solo los `argosisp-plan-<arbolPlanId>-*` del ejemplo.
- En un router que ArgosIsp maneja en `arbol_pcq`, pon `arbolEjemplo false`: ArgosIsp crea sus padres y planes con la acción `routers.cambiar_control_velocidad` (A2).

## Usuario de la API REST y HTTPS

ArgosIsp habla con el router por la API REST (`/rest/...` sobre `www-ssl`). `lab.rsc` crea:

- **Grupo `argosisp-api`** con `policy=read,write,api,rest-api` y nada más: sin `ftp`, `ssh`, `telnet`, `winbox`, `web`, `policy`, `password`, `sensitive`, `reboot`, `sniff`, `test`, `romon` ni `local`. Es el mínimo probado (arriba, «Permisos mínimos de la API»): con ese grupo la API REST lee y escribe y **no** puede cambiar usuarios (`/user/set` responde `not enough permissions`).
- **Usuario `argosisp-api`** con `address=apiDesde` (solo desde el servidor ArgosIsp). Solo si cambias `apiPassword` (con `CAMBIAR` el import avisa y no lo crea). Genera la clave con `openssl rand -base64 24` y regístrala en el router de ArgosIsp (`api_usuario`, `api_password`; se guarda cifrada).
- **Certificado**: CA propia `argosisp-ca` (nombre `apiCaNombre`) y `argosisp-www` con CN = `apiNombre` y SAN `DNS:apiNombre,IP:apiIp`, en `www-ssl` con `tls-version=only-1.2` y `address=apiDesde` (RouterOS 7.17+ lo muestra como `available-from`; 7.16 y anteriores solo aceptan `address`). Se crean una sola vez; si `apiIp` cambió, el script regenera el certificado del servidor (la CA se conserva).
- `apiSoloHttps true` apaga `www` (HTTP en claro), `api` (8728) y `api-ssl` (8729): ArgosIsp solo usa la API REST. WebFig sigue por HTTPS desde `apiDesde`; para administrar desde otra IP, usa Winbox o SSH.

Verificación desde el servidor:

```
# descargar la CA que exporta el script (archivo argosisp-ca.crt del router)
scp admin@<router>:argosisp-ca.crt infra/mikrotik/argosisp-ca.crt   # no se commitea
curl --cacert infra/mikrotik/argosisp-ca.crt -u argosisp-api:$CLAVE https://<apiNombre o apiIp>/rest/system/identity
# {"name":"..."}  (con verificación de certificado, sin -k)
curl --cacert infra/mikrotik/argosisp-ca.crt -u argosisp-api:$CLAVE -X POST https://<apiIp>/rest/user/set \
  -H 'content-type: application/json' -d '{".id":"argosisp-api","group":"full"}'
# {"detail":"not enough permissions (9)", ...}
curl -m 3 http://<apiIp>/rest/system/identity     # falla: www apagado
```

En el router: `/user group print detail where name=argosisp-api` (solo `read;write;api;rest-api` sin `!`), `/ip service print where name~"www|api"`.

## Lista de verificación en el equipo físico (semana 2)

Con ArgosIsp levantado (`docker compose ... up -d`), el dispatcher WISP de A2 y el router dado de alta con su usuario de API. Anotar resultado y fecha en `.claude/STATUS.md`.

**0. Base.** `/import file-name=lab.rsc verbose=yes` termina con `argosisp: FastTrack OK` y `lab.rsc aplicado`; reaplicarlo no borra entradas `argosisp:servicio:*` (`/ip firewall address-list print where comment~"argosisp:servicio"` igual antes y después).

**1. Cliente con IP estática** (antena con `10.20.0.50/24`, gateway `10.20.0.1`):

1. Alta en ArgosIsp con `tipo_conexion = ip_estatica` y esa IP: aparece `/queue simple` con `target=10.20.0.50/32` y `comment=argosisp:servicio:<id>`; `audit.red` registra la llamada.
2. Navega a la velocidad del plan (speedtest); `/queue simple print stats` cuenta bytes (si no cuenta, revisa FastTrack).
3. Limitar → la cola cambia a la velocidad limitada en menos de 30 s.
4. Suspender → la IP entra en `suspendidos`; `http://example.com` muestra `/corte` y el portal identifica al cliente por la IP; HTTPS falla al instante (reset).
5. Reactivar → sale de `suspendidos` en menos de 30 s y navega.
6. Borrar a mano la cola y la entrada de `suspendidos`: el reconciliador las vuelve a crear (y lo audita).

**2. Cliente con DHCP fija** (CPE en DHCP, MAC conocida):

1. Alta con `tipo_conexion = dhcp_fija` y `mac`: `/ip dhcp-server lease print where server=argos-dhcp-wisp` muestra el lease estático y el CPE recibe esa IP (`/ip dhcp-server lease print` → `bound`).
2. Un CPE con otra MAC en el mismo segmento **no** recibe IP (`static-only`).
3. Repetir limitar, suspender y reactivar como el punto 1.
4. Amarre: en `wisp-amarre`, con `amarre_ip_mac = true`, aparece la entrada en `/ip arp` (no dinámica). Cambiar la MAC del CPE (clonar la IP en otro equipo): el otro equipo no navega (`/ip arp print` no lo aprende, ping al gateway sin respuesta).

**3. Reuso 1:4** (plan de 20 Mbps, reuso 4, router en `simple` o el ejemplo `arbol_pcq`):

1. Cuatro clientes del plan activos (PPPoE o WISP). Uno solo en speedtest (los otros en reposo): alcanza ~20 Mbps.
2. Los cuatro en speedtest a la vez: la suma ronda 20 Mbps (cada uno ~5 Mbps, el CIR) y ninguno queda en 0.
3. `simple`: la cola padre `argosisp:plan:<id>` tiene `max-limit = 20M × 4 / 4`; suspender uno recalcula el padre a `20M × 3 / 4` sin esperar (por evento).
4. `arbol_pcq`: `/queue tree print stats` muestra el tráfico en `argosisp-plan-<id>-bajada`, y `/queue type print where name~"argosisp-plan"` la máscara /64.

**4. Límite por IPv6** (cliente PPPoE dual-stack con /64 y /56):

1. Speedtest solo por IPv6 (`speedtest --ip=...` o un servidor IPv6, o `iperf3 -6`): la velocidad queda en el MIR del plan, igual que por IPv4.
2. `simple`: el `target` de la cola del servicio incluye la IPv4, el /64 y el /56. `arbol_pcq`: el /64 y el /56 están en `argosisp-plan-<id>` de `/ipv6 firewall address-list` y `/ipv6 firewall mangle print stats` cuenta paquetes.
3. Dos dispositivos detrás del CPE con direcciones IPv6 distintas del mismo /56: entre los dos no pasan del MIR.
4. `/system script run argosisp-verificar-fasttrack` sigue en OK con el tráfico corriendo.

## Seguridad

- `radiusSecret` largo y aleatorio (`openssl rand -hex 16`), distinto por router. Nunca en el repo: va en `infra/.env` del servidor y en el router.
- RouterOS 7.15+ exige `Message-Authenticator` en las respuestas (`require-message-auth=yes-for-request-resp`, mitigación de Blast-RADIUS); FreeRADIUS 3.2.10 lo envía y `clients.conf` lo exige al router.
- `allow-remote-requests=yes` del DNS se limita con las reglas `argosisp:top DNS del router solo interno` sobre `wanIf`.
- Las reglas de este script no sustituyen el firewall base del router (input desde WAN, gestión solo por IPs de administración); aplícalo antes.
- La API REST va solo por HTTPS con verificación del certificado (CA del router o una pública); el usuario `argosisp-api` tiene los permisos mínimos y solo entra desde `apiDesde`. `apiPassword` no se commitea: se edita en el router al importar.

## Documentación consultada

- PPP AAA (perfil y `/ppp aaa`): https://manual.mikrotik.com/docs/authentication-authorization-accounting/ppp-aaa/
- Referencia CLI `/ppp` (RouterOS 7.24): https://manual.mikrotik.com/docs/7.24/cli-reference/ppp/
- RADIUS cliente, `/radius incoming` y atributos de CoA: https://manual.mikrotik.com/docs/authentication-authorization-accounting/radius/
- PPPoE server: https://manual.mikrotik.com/docs/cli-reference/interface/pppoe-server/server
- Colas (simple, tree, PCQ) y FastTrack: https://help.mikrotik.com/docs/spaces/ROS/pages/328088/Queues y https://help.mikrotik.com/docs/spaces/ROS/pages/328158/Packet+Flow+in+RouterOS
- DHCP server (`static-only`, `add-arp`) y ARP `reply-only`: https://help.mikrotik.com/docs/spaces/ROS/pages/24805500/DHCP y https://help.mikrotik.com/docs/spaces/ROS/pages/328092/ARP
- REST API y usuarios/grupos: https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST+API y https://help.mikrotik.com/docs/spaces/ROS/pages/8978504/User
- RFC 3162 (RADIUS e IPv6), RFC 4818 (Delegated-IPv6-Prefix), RFC 5176 (CoA/Disconnect), RFC 3849 y RFC 5737 (prefijos de documentación)
