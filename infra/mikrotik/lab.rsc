# ArgosIsp · MikroTik del laboratorio (RouterOS 7)
#
# PPPoE dual-stack con RADIUS (FreeRADIUS → aaa), CoA en 3799, perfil "suspendido",
# DHCPv6-PD, firewall de corte IPv4/IPv6 y WireGuard opcional hacia el servidor.
# Semana 2: clientes WISP sin PPPoE (ip_estatica, dhcp_fija, amarre IP-MAC), FastTrack excluido
# para clientes con colas, ejemplo de arbol_pcq y usuario de API REST con HTTPS
# (contratos/routeros.md y contratos/velocidad.md).
# Documentación y verificación: infra/mikrotik/README.md
#
# Uso:  edita SOLO la cabecera (bloque "Variables"), sube el archivo y ejecuta
#       /import file-name=lab.rsc verbose=yes
# Es re-ejecutable: todo lo que crea lleva comentario "argosisp: ..." o "argosisp:top ..." y se
# reemplaza al reaplicar. Lo que crea ArgosIsp por la API ("argosisp:servicio:<id>",
# "argosisp:plan:<id>") NO se toca.
# Todo va dentro de un bloque { } para que las variables :local valgan en todo el script.
# Valores de ejemplo: RFC 5737 / RFC 1918 para IPv4, 2001:db8::/32 (RFC 3849) para IPv6 y
# dominios .example (RFC 2606). Sustitúyelos por los reales del laboratorio.

{
# ============================================================================
# Variables (lo único que cambia el PM)
# ============================================================================

# --- Interfaces ---
# Interfaz (o bridge/VLAN) donde se conectan los clientes PPPoE
:local labIf "ether2"
# Interfaz de salida a Internet (NAT de clientes y bloqueo de DNS desde fuera)
:local wanIf "ether1"

# --- PPPoE ---
:local pppoeServicio "argosisp"
# Dirección del router en los enlaces PPP (también DNS para los clientes)
:local pppLocalV4 "10.10.0.1"
# Pool IPv4 dinámico (modo pool). Las IPs estáticas del IPAM (Framed-IP-Address) salen de otro
# rango, p. ej. 10.10.1.0/24, que NO debe solaparse con este pool.
:local poolV4 "argos-v4-pppoe"
:local poolV4Rangos "10.10.0.10-10.10.0.250"
# Prefijo de todos los clientes PPPoE (NAT de salida y exclusión de FastTrack)
:local clientesV4 "10.10.0.0/16"
# Prefijos IPv6 de clientes (pools e IPAM): exclusión de FastTrack en IPv6
:local clientesV6 {"2001:db8:100::/48";"2001:db8:101::/48";"2001:db8:200::/40";"2001:db8:300::/40"}
# Rate-limit del perfil suspendido (rx/tx desde el router = subida/bajada del cliente)
:local suspRateLimit "256k/256k"

# --- IPv6 (nombres que A1 registra en planes_routers) ---
# /64 de enlace por cliente (SLAAC en la interfaz PPP) → remote-ipv6-prefix-pool
:local poolV6Enlace "argos-v6-enlace"
:local poolV6EnlacePrefijo "2001:db8:100::/48"
# /56 delegado por DHCPv6-PD → dhcpv6-pd-pool
:local poolV6Pd "argos-v6-pd"
:local poolV6PdPrefijo "2001:db8:200::/40"
:local poolV6PdLongitud 56
# Los prefijos estáticos del IPAM (Framed-IPv6-Prefix / Delegated-IPv6-Prefix, modo
# radius_servicio) deben salir de rangos distintos a estos pools, p. ej. 2001:db8:101::/48 y
# 2001:db8:300::/40. El router instala la ruta al recibirlos por RADIUS.

# --- RADIUS (servidor ArgosIsp: FreeRADIUS + aaa) ---
# IP del servidor tal como la ve el router (túnel WireGuard o LAN)
:local radiusAddr "10.255.255.1"
# Segundo nodo aaa (vacío = solo uno). Cuando exista, misma secret.
:local radiusAddr2 ""
# IP de origen del router hacia RADIUS (= RADIUS_LAB_NAS_IP en infra/.env)
:local radiusSrc "10.255.255.2"
# = RADIUS_LAB_SECRET en infra/.env. Generar con: openssl rand -hex 16
:local radiusSecret "CAMBIAR-secret-compartido"

# --- Portal y página de corte ---
# IP del servidor del portal y puerto al que se redirige TCP/80 de los suspendidos.
# El portal debe responder cualquier Host/ruta en ese puerto con la página /corte.
:local portalV4 "192.0.2.20"
:local portalCortePuerto 80
# IPv6 del portal: se permite a los suspendidos (argos-portal). Sin NAT IPv6 (decisión del PM): ver
# la alternativa comentada en la sección 9.
:local portalV6 "2001:db8:ffff::20"
:local portalFqdn "portal.argosisp.example"
# Walled garden: dominios que un suspendido puede alcanzar además del portal (pasarela de pago, etc.),
# por FQDN (el router los resuelve, IPv4 e IPv6). El portal no carga nada externo.
# - app.recurrente.com: página de pago de Recurrente (`/checkout-session/<ch_…>`) y su API
#   (`contratos/pago-en-linea.md`, § Recurrente). Con la pasarela falsa no hace falta: su página
#   sale de la API.
# - PENDIENTE de laboratorio (`docs/laboratorio/validacion-fisica.md`, 2.5b): los dominios de recursos
#   que cargue el checkout (CDN, analítica) y los del 3-D Secure del banco emisor; agrégalos aquí.
# El webhook de Recurrente (Svix) llega al servidor, no del cliente: no va aquí.
:local walledGarden {"app.recurrente.com"}

# --- DNS ---
# Resolutores que el router usa y que los suspendidos pueden consultar
:local dnsV4 {"192.0.2.53";"198.51.100.53"}
:local dnsV6 {"2001:db8:ffff::53"}

# --- WISP sin PPPoE (contratos/routeros.md): ip_estatica y dhcp_fija ---
:local wispHabilitar true
# Interfaz (o bridge) de las antenas/CPE sin PPPoE
:local wispIf "ether3"
# Gateway y red de los clientes WISP (= una network.redes_ipv4 del router; el IPAM asigna las IPs)
:local wispGateway "10.20.0.1/24"
:local wispRed "10.20.0.0/24"
# Servidor DHCP de dhcp_fija: SOLO leases estáticos (address-pool=static-only). ArgosIsp crea un
# lease por servicio (mac-address, address, server=wispDhcp); una MAC desconocida no recibe IP.
:local wispDhcp "argos-dhcp-wisp"
:local wispLease "30m"
# IPv6 del segmento WISP (opcional): /64 COMPARTIDO con RA para la WAN de los CPE. El límite por
# cliente en IPv6 va por su /56 delegado (DUID, semana 2), nunca por este /64. Vacío = sin IPv6.
:local wispV6Gateway ""
:local wispV6Red ""
# Amarre IP-MAC opcional (amarre_ip_mac = true): VLAN de ejemplo sobre wispIf con arp=reply-only.
# El router solo responde ARP a las IPs con entrada estática en /ip arp (la crea ArgosIsp) o con
# lease de su DHCP (add-arp=yes). Un equipo con IP clonada pero otra MAC no navega.
:local amarreHabilitar true
:local amarreVlanId 120
:local amarreIf "wisp-amarre"
:local amarreGateway "10.21.0.1/24"
:local amarreRed "10.21.0.0/24"
:local amarreDhcp "argos-dhcp-amarre"

# --- Control de velocidad (contratos/velocidad.md) ---
# Capacidad del enlace en bps (= capacidad_bajada_kbps/subida_kbps × 1000 del router): techo de
# los padres globales del arbol_pcq
:local capBajada 100000000
:local capSubida 50000000
# Ejemplo de arbol_pcq con un plan ficticio (id 0: 20M/10M, reuso 1:4, 4 clientes activos,
# limitado a 2M/1M). En producción ArgosIsp (A2) crea el árbol de cada plan al pasar el router a
# arbol_pcq; el ejemplo usa sus mismos nombres con el id 0, que ningún plan real tiene.
:local arbolEjemplo true
:local arbolPlanId 0
:local arbolMirBajada 20000000
:local arbolMirSubida 10000000
:local arbolLimBajada 2000000
:local arbolLimSubida 1000000
:local arbolReuso 4
:local arbolActivos 4
:local arbolPrioridad 8
# IPv4, /64 y /56 de los clientes de ejemplo (address-list argosisp-plan-<id>)
:local arbolClientes {"10.20.0.101";"10.20.0.102";"10.20.0.103";"10.20.0.104"}
:local arbolClientesV6 {"2001:db8:101:1::/64";"2001:db8:300:100::/56"}

# --- API REST de RouterOS (dispatcher WISP y colas de ArgosIsp) ---
:local apiUsuario "argosisp-api"
# Contraseña del usuario (la misma se guarda cifrada en network.routers.api_password). Generar
# con `openssl rand -base64 24`. Con "CAMBIAR" no se crea el usuario.
:local apiPassword "CAMBIAR"
# Desde dónde se acepta la API (IP del servidor ArgosIsp: túnel WireGuard o LAN)
:local apiDesde "10.255.255.1/32"
# Nombre e IP con que ArgosIsp llega al router (van al certificado: CN y subjectAltName)
:local apiNombre "mikrotik-lab.argosisp.example"
:local apiIp "10.255.255.2"
# Nombre de la CA propia del router (certificado de www-ssl)
:local apiCaNombre "ArgosIsp lab CA"
# Apagar www (HTTP en claro), api (8728) y api-ssl (8729): ArgosIsp solo usa la API REST por www-ssl
:local apiSoloHttps true
# Certificado de www-ssl (comun-certificado.rsc): en el laboratorio siempre, con www-ssl solo desde
# apiDesde. apiIpAnterior: otra IP para el SAN (vacía = solo apiIp).
:local apiCertificar true
:local apiIpAnterior ""
:local apiWwwDesde $apiDesde

# --- WireGuard opcional hacia el servidor (si el servidor no está en la LAN del router) ---
:local wgHabilitar false
:local wgIf "wg-argosisp"
:local wgPuertoLocal 13231
# Dirección del router dentro del túnel (= radiusSrc)
:local wgLocalCidr "10.255.255.2/30"
# Clave pública del servidor (wg pubkey) y su endpoint público
:local wgServidorPub "CAMBIAR-clave-publica-del-servidor="
:local wgServidorEndpoint "203.0.113.10"
:local wgServidorPuerto 51820
# Red alcanzable por el túnel (la IP del servidor en el túnel)
:local wgServidorRed "10.255.255.1/32"

# ============================================================================
# 0. Limpieza de lo aplicado antes por este script
# ============================================================================
:put "argosisp: limpiando configuración anterior"
# Solo lo de este script ("argosisp: " con espacio y "argosisp:top "): las entradas de ArgosIsp
# ("argosisp:servicio:<id>" en suspendidos o argosisp-plan-<id>, colas "argosisp:plan:<id>") quedan.
:local propio "^argosisp(: |:top )"
/ip firewall filter remove [find where comment~$propio]
/ip firewall nat remove [find where comment~$propio]
/ip firewall mangle remove [find where comment~$propio]
/ip firewall address-list remove [find where dynamic=no comment~$propio]
/ipv6 firewall filter remove [find where comment~$propio]
/ipv6 firewall nat remove [find where comment~$propio]
/ipv6 firewall mangle remove [find where comment~$propio]
/ipv6 firewall address-list remove [find where dynamic=no comment~$propio]
/radius remove [find where comment~$propio]
/queue tree remove [find where comment~$propio]
# /queue type no tiene comentario: se borran por nombre solo los del ejemplo
/queue type remove [find where name~("^argosisp-plan-" . $arbolPlanId . "-")]
/system script remove [find where name~"^argosisp-"]

# ============================================================================
# 1. WireGuard (opcional)
# ============================================================================
:if ($wgHabilitar) do={
    :put "argosisp: WireGuard"
    :if ([:len [/interface wireguard find where name=$wgIf]] = 0) do={
        /interface wireguard add name=$wgIf listen-port=$wgPuertoLocal comment="argosisp: tunel al servidor"
    }
    /interface wireguard peers remove [find where comment~"^argosisp"]
    /interface wireguard peers add interface=$wgIf public-key=$wgServidorPub \
        endpoint-address=$wgServidorEndpoint endpoint-port=$wgServidorPuerto \
        allowed-address=$wgServidorRed persistent-keepalive=25s comment="argosisp: servidor"
    /ip address remove [find where comment="argosisp: wireguard"]
    /ip address add address=$wgLocalCidr interface=$wgIf comment="argosisp: wireguard"
    :put ("argosisp: clave publica del router: " . [/interface wireguard get [find where name=$wgIf] public-key])
}

# ============================================================================
# 2. Pools IPv4 / IPv6
# ============================================================================
:put "argosisp: pools"
:if ([:len [/ip pool find where name=$poolV4]] = 0) do={
    /ip pool add name=$poolV4 ranges=$poolV4Rangos comment="argosisp"
} else={
    /ip pool set [find where name=$poolV4] ranges=$poolV4Rangos
}
:if ([:len [/ipv6 pool find where name=$poolV6Enlace]] = 0) do={
    /ipv6 pool add name=$poolV6Enlace prefix=$poolV6EnlacePrefijo prefix-length=64 comment="argosisp: /64 de enlace"
} else={
    /ipv6 pool set [find where name=$poolV6Enlace] prefix=$poolV6EnlacePrefijo prefix-length=64
}
:if ([:len [/ipv6 pool find where name=$poolV6Pd]] = 0) do={
    /ipv6 pool add name=$poolV6Pd prefix=$poolV6PdPrefijo prefix-length=$poolV6PdLongitud comment="argosisp: delegacion DHCPv6-PD"
} else={
    /ipv6 pool set [find where name=$poolV6Pd] prefix=$poolV6PdPrefijo prefix-length=$poolV6PdLongitud
}

# ============================================================================
# 3. DNS del router (los clientes PPP usan pppLocalV4 como DNS)
# ============================================================================
:local dnsServidores ""
:foreach d in=($dnsV4, $dnsV6) do={
    :if ($dnsServidores = "") do={ :set dnsServidores $d } else={ :set dnsServidores ($dnsServidores . "," . $d) }
}
/ip dns set allow-remote-requests=yes servers=$dnsServidores

# ============================================================================
# 4. Lista de interfaces y perfiles PPP
# ============================================================================
:put "argosisp: perfiles PPP"
# Las interfaces PPP de clientes suspendidos entran aquí (sirve para IPv4 e IPv6)
:if ([:len [/interface list find where name="suspendidos"]] = 0) do={
    /interface list add name=suspendidos comment="argosisp: interfaces PPP suspendidas"
}

# Perfil default: IPv4 por pool (o Framed-IP-Address de RADIUS), /64 de enlace y /56 por PD.
# Los atributos RADIUS (Framed-*, Delegated-IPv6-Prefix, Mikrotik-Rate-Limit) tienen prioridad.
# Con dhcpv6-pd-pool, cada sesion crea un servidor DHCPv6 dinamico con el nombre de su interfaz,
# "<pppoe-USUARIO>" (con los < >), y el binding del /56 queda en /ipv6/dhcp-server/binding con
# server = active-server = "<pppoe-USUARIO>", dynamic=yes, prefix-pool=argos-v6-pd. Ambos
# desaparecen al cerrar la sesion. Verificado en CHR 7.24.5 (infra/mikrotik/README.md, "Binding").
/ppp profile set [find where name="default"] local-address=$pppLocalV4 remote-address=$poolV4 \
    remote-ipv6-prefix-pool=$poolV6Enlace dhcpv6-pd-pool=$poolV6Pd use-ipv6=yes \
    dns-server=$pppLocalV4 change-tcp-mss=yes

# Perfil suspendido: rate-limit mínimo, address-list (IPv4) e interface-list (IPv4 + IPv6).
# aaa lo asigna con Mikrotik-Group=suspendido (o con Mikrotik-Address-List=suspendidos).
:if ([:len [/ppp profile find where name="suspendido"]] = 0) do={
    /ppp profile add name=suspendido comment="argosisp: servicio suspendido"
}
/ppp profile set [find where name="suspendido"] local-address=$pppLocalV4 remote-address=$poolV4 \
    remote-ipv6-prefix-pool=$poolV6Enlace dhcpv6-pd-pool=$poolV6Pd use-ipv6=yes \
    dns-server=$pppLocalV4 change-tcp-mss=yes rate-limit=$suspRateLimit \
    address-list=suspendidos interface-list=suspendidos

# ============================================================================
# 5. PPPoE server
# ============================================================================
:put "argosisp: PPPoE server"
:if ([:len [/interface pppoe-server server find where service-name=$pppoeServicio]] = 0) do={
    /interface pppoe-server server add service-name=$pppoeServicio interface=$labIf
}
# Solo PAP/CHAP: aaa valida contra la contraseña en claro (sin hash NT para MS-CHAP).
/interface pppoe-server server set [find where service-name=$pppoeServicio] interface=$labIf \
    default-profile=default authentication=pap,chap one-session-per-host=yes \
    max-mtu=1480 max-mru=1480 keepalive-timeout=30 disabled=no

# ============================================================================
# 6. RADIUS, CoA y AAA de PPP
# ============================================================================
:put "argosisp: RADIUS"
/radius add service=ppp address=$radiusAddr secret=$radiusSecret src-address=$radiusSrc \
    timeout=1s comment="argosisp: aaa nodo 1"
:if ($radiusAddr2 != "") do={
    /radius add service=ppp address=$radiusAddr2 secret=$radiusSecret src-address=$radiusSrc \
        timeout=1s comment="argosisp: aaa nodo 2"
}
# CoA y Disconnect-Request desde coa (solo se aceptan desde las direcciones de /radius)
/radius incoming set accept=yes port=3799
/ppp aaa set use-radius=yes accounting=yes interim-update=5m

# ============================================================================
# 7. Address-lists (IPv4 e IPv6). Las entradas por FQDN las resuelve el router.
# ============================================================================
:put "argosisp: address-lists"
# La lista de suspendidos existe aunque no haya ninguno (la usan los saltos de corte); el reconciliador
# de ArgosIsp deja la misma entrada (contratos/control-velocidad.md §10).
/ip firewall address-list add list=suspendidos address=192.0.2.255 comment="argosisp: corte lista suspendidos"
/ip firewall address-list add list=argos-portal address=$portalV4 comment="argosisp: portal IP"
/ip firewall address-list add list=argos-portal address=$portalFqdn comment="argosisp: portal FQDN"
/ip firewall address-list add list=argos-dns address=$pppLocalV4 comment="argosisp: DNS del router"
:foreach d in=$dnsV4 do={ /ip firewall address-list add list=argos-dns address=$d comment="argosisp: DNS" }
:foreach d in=$walledGarden do={ /ip firewall address-list add list=argos-walled address=$d comment="argosisp: walled garden" }
# Clientes con colas (PPPoE y WISP): NAT de salida del laboratorio y exclusión de FastTrack
/ip firewall address-list add list=argos-clientes address=$clientesV4 comment="argosisp: clientes PPPoE"
:if ($wispHabilitar) do={ /ip firewall address-list add list=argos-clientes address=$wispRed comment="argosisp: clientes WISP" }
:if ($wispHabilitar && $amarreHabilitar) do={ /ip firewall address-list add list=argos-clientes address=$amarreRed comment="argosisp: clientes WISP con amarre" }

/ipv6 firewall address-list add list=argos-portal address=$portalV6 comment="argosisp: portal IP"
/ipv6 firewall address-list add list=argos-portal address=$portalFqdn comment="argosisp: portal FQDN"
:foreach d in=$dnsV6 do={ /ipv6 firewall address-list add list=argos-dns address=$d comment="argosisp: DNS" }
:foreach d in=$walledGarden do={ /ipv6 firewall address-list add list=argos-walled address=$d comment="argosisp: walled garden" }
:foreach d in=$clientesV6 do={ /ipv6 firewall address-list add list=argos-clientes address=$d comment="argosisp: clientes IPv6" }
:if ($wispHabilitar && $wispV6Red != "") do={ /ipv6 firewall address-list add list=argos-clientes address=$wispV6Red comment="argosisp: clientes WISP IPv6" }

# ============================================================================
# 8. Firewall IPv4
# ============================================================================
:put "argosisp: firewall IPv4"
# Reglas "argosisp:top" se mueven al inicio de su tabla al final del script.
/ip firewall filter
add chain=input protocol=udp dst-port=3799 src-address=$radiusAddr action=accept comment="argosisp:top CoA desde aaa nodo 1"
:if ($radiusAddr2 != "") do={
    /ip firewall filter add chain=input protocol=udp dst-port=3799 src-address=$radiusAddr2 action=accept comment="argosisp:top CoA desde aaa nodo 2"
}
:if ($wgHabilitar) do={
    /ip firewall filter add chain=input protocol=udp dst-port=$wgPuertoLocal action=accept comment="argosisp:top WireGuard"
}
/ip firewall filter
add chain=input in-interface=$wanIf protocol=udp dst-port=53 action=drop comment="argosisp:top DNS del router solo interno (udp)"
add chain=input in-interface=$wanIf protocol=tcp dst-port=53 action=drop comment="argosisp:top DNS del router solo interno (tcp)"
add chain=input src-address-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por address-list"
add chain=input in-interface-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por interface-list"
add chain=forward src-address-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por address-list"
add chain=forward in-interface-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por interface-list"
# Reglas dinámicas que RouterOS crea por Filter-Id (RADIUS o CoA) en la cadena "ppp"
add chain=forward action=jump jump-target=ppp comment="argosisp:top Filter-Id de RADIUS/CoA"
# FastTrack excluido para clientes con colas (contratos/velocidad.md): con FastTrack los paquetes
# saltan colas simples, queue tree y mangle. Aceptar aquí lo establecido de los clientes, DESPUÉS
# de los saltos de corte y ANTES de "defconf: fasttrack", deja esas conexiones fuera de FastTrack.
# Verificación: /system script run argosisp-verificar-fasttrack
add chain=forward connection-state=established,related src-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (subida)"
add chain=forward connection-state=established,related dst-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (bajada)"

# Cadena de corte (tráfico del cliente suspendido hacia fuera). Filter-Id = "argos-corte.in".
add chain=argos-corte protocol=udp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS udp"
add chain=argos-corte protocol=tcp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS tcp"
add chain=argos-corte dst-address-list=argos-portal action=accept comment="argosisp: corte portal"
add chain=argos-corte dst-address-list=argos-walled action=accept comment="argosisp: corte walled garden"
# Rechazo explícito en vez de drop: HTTPS y el resto de TCP fallan al instante (sin esperar el
# timeout) y QUIC (UDP/443) cae a TCP; la detección de portal cautivo usa HTTP/80, que va al portal.
add chain=argos-corte protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte TCP reset"
add chain=argos-corte action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte rechazo del resto"

# Hacia el router: DNS e ICMP; nada más.
add chain=argos-corte-in protocol=udp dst-port=53 action=accept comment="argosisp: corte-in DNS udp"
add chain=argos-corte-in protocol=tcp dst-port=53 action=accept comment="argosisp: corte-in DNS tcp"
add chain=argos-corte-in protocol=icmp action=accept comment="argosisp: corte-in ICMP"
add chain=argos-corte-in protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte-in TCP reset"
add chain=argos-corte-in action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte-in rechazo del resto"

# Cadena neutra para reactivar por CoA (Filter-Id = "argos-activo.in" reemplaza a argos-corte).
add chain=argos-activo action=return comment="argosisp: activo (Filter-Id neutro)"

# NAT: HTTP de los suspendidos → página de corte del portal. Walled garden y portal sin NAT.
/ip firewall nat
add chain=dstnat src-address-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por address-list"
add chain=dstnat in-interface-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por interface-list"
add chain=argos-corte-nat dst-address-list=argos-portal action=return comment="argosisp: corte-nat portal sin NAT"
add chain=argos-corte-nat dst-address-list=argos-walled action=return comment="argosisp: corte-nat walled garden sin NAT"
add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat to-addresses=$portalV4 to-ports=$portalCortePuerto comment="argosisp: corte-nat HTTP a /corte"
add chain=srcnat src-address-list=argos-clientes out-interface=$wanIf action=masquerade comment="argosisp: NAT de clientes del laboratorio"

# ============================================================================
# 9. Firewall IPv6 (espejo del IPv4, SIN NAT: decisión del PM, día 4)
# ============================================================================
# Se suspende por CoA sin reconectar (COA_SUSPENDER_CON_IPV6=coa). El cliente siempre tiene IPv4 y
# llega a /corte por ahí: en IPv6 el suspendido solo alcanza DNS (nuestros resolvers y el router), el
# portal y el walled garden, y el resto se RECHAZA al instante (tcp-reset / icmp-admin-prohibited,
# nunca drop) para que Happy Eyeballs caiga a IPv4 sin esperar y la detección de portal cautivo
# funcione. Detalle y verificación en infra/mikrotik/README.md, "Corte por IPv6".
:put "argosisp: firewall IPv6"
#
# Alternativa (solo con COA_SUSPENDER_CON_IPV6=disconnect, que reconecta al suspendido con
# Mikrotik-Group=suspendido y llena las listas IPv6): redirigir TCP/80 por IPv6 al portal con
# /ipv6 firewall nat. No se aplica; para usarla, quita los "#" (la limpieza de la sección 0 y el
# orden de la sección 10 ya cubren /ipv6 firewall nat).
#:if ($portalV6 != "") do={
#    /ipv6 firewall nat add chain=dstnat src-address-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por address-list"
#    /ipv6 firewall nat add chain=dstnat in-interface-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por interface-list"
#    /ipv6 firewall nat add chain=argos-corte-nat dst-address-list=argos-portal action=return comment="argosisp: corte-nat portal sin NAT"
#    /ipv6 firewall nat add chain=argos-corte-nat dst-address-list=argos-walled action=return comment="argosisp: corte-nat walled garden sin NAT"
#    /ipv6 firewall nat add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat to-address=($portalV6 . "/128") to-ports=$portalCortePuerto comment="argosisp: corte-nat HTTP a /corte"
#}
/ipv6 firewall filter
add chain=input src-address-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por address-list"
add chain=input in-interface-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por interface-list"
add chain=forward src-address-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por address-list"
add chain=forward in-interface-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por interface-list"
add chain=forward action=jump jump-target=ppp comment="argosisp:top Filter-Id de RADIUS/CoA"
add chain=forward connection-state=established,related src-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (subida)"
add chain=forward connection-state=established,related dst-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (bajada)"

add chain=argos-corte protocol=udp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS udp"
add chain=argos-corte protocol=tcp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS tcp"
add chain=argos-corte dst-address-list=argos-portal action=accept comment="argosisp: corte portal"
add chain=argos-corte dst-address-list=argos-walled action=accept comment="argosisp: corte walled garden"
# Rechazo explícito, nunca drop: TCP recibe reset y lo demás (QUIC, ICMPv6 de eco) admin-prohibited.
add chain=argos-corte protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte TCP reset"
add chain=argos-corte action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte rechazo del resto"

# Hacia el router: ICMPv6 (ND/RA), DHCPv6 (renovación del PD) y DNS.
add chain=argos-corte-in protocol=icmpv6 action=accept comment="argosisp: corte-in ICMPv6"
add chain=argos-corte-in protocol=udp dst-port=547 action=accept comment="argosisp: corte-in DHCPv6"
add chain=argos-corte-in protocol=udp dst-port=53 action=accept comment="argosisp: corte-in DNS udp"
add chain=argos-corte-in protocol=tcp dst-port=53 action=accept comment="argosisp: corte-in DNS tcp"
add chain=argos-corte-in protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte-in TCP reset"
add chain=argos-corte-in action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte-in rechazo del resto"

add chain=argos-activo action=return comment="argosisp: activo (Filter-Id neutro)"

# ============================================================================
# 10. WISP sin PPPoE: gateway, DHCP de dhcp_fija y amarre IP-MAC (contratos/routeros.md)
# ============================================================================
# ArgosIsp (dispatcher de A2) crea por la API, con comment "argosisp:servicio:<id>": la cola simple
# (target = IPv4/32 y prefijos IPv6), la entrada en suspendidos (solo en suspendido), el lease DHCP
# (dhcp_fija) y el ARP estático (amarre_ip_mac). Este script solo deja el segmento listo.
:if ($wispHabilitar) do={
    :put "argosisp: WISP"
    /ip address remove [find where comment="argosisp: gateway WISP"]
    /ip address add address=$wispGateway interface=$wispIf comment="argosisp: gateway WISP"
    # ip_estatica: la IP va a mano en la antena/CPE (gateway = wispGateway, DNS = el router).
    # dhcp_fija: solo leases estáticos; una MAC sin lease no recibe dirección.
    :local gw [:pick $wispGateway 0 [:find $wispGateway "/"]]
    :if ([:len [/ip dhcp-server find where name=$wispDhcp]] = 0) do={
        /ip dhcp-server add name=$wispDhcp interface=$wispIf address-pool=static-only lease-time=$wispLease comment="argosisp: dhcp_fija (solo leases estaticos)"
    }
    /ip dhcp-server set [find where name=$wispDhcp] interface=$wispIf address-pool=static-only lease-time=$wispLease disabled=no
    /ip dhcp-server network remove [find where comment="argosisp: red WISP"]
    /ip dhcp-server network add address=$wispRed gateway=$gw dns-server=$gw comment="argosisp: red WISP"

    :if ($wispV6Gateway != "") do={
        /ipv6 address remove [find where comment="argosisp: gateway WISP IPv6"]
        /ipv6 address add address=$wispV6Gateway interface=$wispIf advertise=yes comment="argosisp: gateway WISP IPv6"
    }

    # Amarre IP-MAC: interfaz con arp=reply-only. Solo responde a IPs con ARP estático (lo crea
    # ArgosIsp si amarre_ip_mac = true) o con lease de su DHCP (add-arp=yes). Cada servicio de esta
    # interfaz debe tener amarre o lease: sin ninguno, el router no le responde ARP y no navega.
    :if ($amarreHabilitar) do={
        :if ([:len [/interface vlan find where name=$amarreIf]] = 0) do={
            /interface vlan add name=$amarreIf vlan-id=$amarreVlanId interface=$wispIf comment="argosisp: WISP con amarre IP-MAC"
        }
        /interface vlan set [find where name=$amarreIf] vlan-id=$amarreVlanId interface=$wispIf arp=reply-only disabled=no
        /ip address remove [find where comment="argosisp: gateway WISP amarre"]
        /ip address add address=$amarreGateway interface=$amarreIf comment="argosisp: gateway WISP amarre"
        :local gwA [:pick $amarreGateway 0 [:find $amarreGateway "/"]]
        :if ([:len [/ip dhcp-server find where name=$amarreDhcp]] = 0) do={
            /ip dhcp-server add name=$amarreDhcp interface=$amarreIf address-pool=static-only lease-time=$wispLease add-arp=yes comment="argosisp: dhcp_fija con amarre"
        }
        /ip dhcp-server set [find where name=$amarreDhcp] interface=$amarreIf address-pool=static-only lease-time=$wispLease add-arp=yes disabled=no
        /ip dhcp-server network remove [find where comment="argosisp: red WISP amarre"]
        /ip dhcp-server network add address=$amarreRed gateway=$gwA dns-server=$gwA comment="argosisp: red WISP amarre"
    }
}

# ============================================================================
# 11. Ejemplo de arbol_pcq (contratos/velocidad.md, modo arbol_pcq)
# ============================================================================
# Padres globales con la capacidad del enlace; debajo, un hijo por plan (max-limit = MIR × activos /
# reuso, limit-at = CIR × activos, CIR = MIR / reuso) con un PCQ por plan: cada cliente tiene su
# tope (pcq-rate = MIR) y el padre reparte el reuso. IPv6 cuenta por /64 (pcq-*-address6-mask=64),
# no por dirección. Marcado: address-list argosisp-plan-<id> (IPv4, /64 y /56 del cliente) y mangle
# mark-packet sin passthrough. Limitado: lista y PCQ propios (argosisp-plan-<id>-limitado).
:if ($arbolEjemplo) do={
    :put "argosisp: ejemplo arbol_pcq"
    :local plan ("argosisp-plan-" . $arbolPlanId)
    :local maxB ($arbolMirBajada * $arbolActivos / $arbolReuso)
    :local maxS ($arbolMirSubida * $arbolActivos / $arbolReuso)
    :local limB ($arbolMirBajada / $arbolReuso * $arbolActivos)
    :local limS ($arbolMirSubida / $arbolReuso * $arbolActivos)

    /queue type add name=($plan . "-bajada") kind=pcq pcq-rate=$arbolMirBajada pcq-classifier=dst-address pcq-dst-address6-mask=64
    /queue type add name=($plan . "-subida") kind=pcq pcq-rate=$arbolMirSubida pcq-classifier=src-address pcq-src-address6-mask=64
    /queue type add name=($plan . "-limitado-bajada") kind=pcq pcq-rate=$arbolLimBajada pcq-classifier=dst-address pcq-dst-address6-mask=64
    /queue type add name=($plan . "-limitado-subida") kind=pcq pcq-rate=$arbolLimSubida pcq-classifier=src-address pcq-src-address6-mask=64

    /queue tree add name=argosisp-ejemplo-bajada parent=global max-limit=$capBajada comment="argosisp: ejemplo padre global bajada"
    /queue tree add name=argosisp-ejemplo-subida parent=global max-limit=$capSubida comment="argosisp: ejemplo padre global subida"
    /queue tree add name=($plan . "-bajada") parent=argosisp-ejemplo-bajada packet-mark=($plan . "-bajada") queue=($plan . "-bajada") max-limit=$maxB limit-at=$limB priority=$arbolPrioridad comment="argosisp: ejemplo plan bajada"
    /queue tree add name=($plan . "-subida") parent=argosisp-ejemplo-subida packet-mark=($plan . "-subida") queue=($plan . "-subida") max-limit=$maxS limit-at=$limS priority=$arbolPrioridad comment="argosisp: ejemplo plan subida"
    /queue tree add name=($plan . "-limitado-bajada") parent=argosisp-ejemplo-bajada packet-mark=($plan . "-limitado-bajada") queue=($plan . "-limitado-bajada") priority=$arbolPrioridad comment="argosisp: ejemplo plan limitado bajada"
    /queue tree add name=($plan . "-limitado-subida") parent=argosisp-ejemplo-subida packet-mark=($plan . "-limitado-subida") queue=($plan . "-limitado-subida") priority=$arbolPrioridad comment="argosisp: ejemplo plan limitado subida"

    :foreach d in=$arbolClientes do={ /ip firewall address-list add list=$plan address=$d comment="argosisp: ejemplo cliente del plan" }
    :foreach d in=$arbolClientesV6 do={ /ipv6 firewall address-list add list=$plan address=$d comment="argosisp: ejemplo cliente del plan" }

    # Mangle (IPv4 e IPv6 iguales). Bajada = destino en la lista; subida = origen en la lista.
    :foreach lista in=($plan, ($plan . "-limitado")) do={
        /ip firewall mangle add chain=forward dst-address-list=$lista action=mark-packet new-packet-mark=($lista . "-bajada") passthrough=no comment=("argosisp: ejemplo marca " . $lista . " bajada")
        /ip firewall mangle add chain=forward src-address-list=$lista action=mark-packet new-packet-mark=($lista . "-subida") passthrough=no comment=("argosisp: ejemplo marca " . $lista . " subida")
        /ipv6 firewall mangle add chain=forward dst-address-list=$lista action=mark-packet new-packet-mark=($lista . "-bajada") passthrough=no comment=("argosisp: ejemplo marca " . $lista . " bajada")
        /ipv6 firewall mangle add chain=forward src-address-list=$lista action=mark-packet new-packet-mark=($lista . "-subida") passthrough=no comment=("argosisp: ejemplo marca " . $lista . " subida")
    }
}

# ============================================================================
# 12. Usuario de la API REST con permisos mínimos y HTTPS (www-ssl)
# ============================================================================
# Grupo argosisp-api: read, write, api y rest-api, el mínimo probado en CHR 7.24.5. La REST corre
# sobre la API: sin "api" responde "not allowed" y sin "rest-api", 401; el SERVICIO api (8728)
# queda apagado igual. Sin ftp, ssh, telnet, winbox, web, policy, password, sensitive, reboot,
# sniff, test, romon ni local: no puede crear ni cambiar usuarios, reiniciar ni leer secretos, y
# solo entra desde apiDesde (infra/mikrotik/README.md, "Permisos mínimos de la API").
:put "argosisp: usuario de API REST"
:if ([:len [/user group find where name="argosisp-api"]] = 0) do={
    /user group add name=argosisp-api policy=read,write,api,rest-api comment="argosisp: API REST de ArgosIsp"
}
/user group set [find where name="argosisp-api"] policy=read,write,api,rest-api
:if ($apiPassword = "CAMBIAR") do={
    :put "argosisp: AVISO apiPassword sin cambiar: no se crea el usuario de API"
} else={
    :if ([:len [/user find where name=$apiUsuario]] = 0) do={
        /user add name=$apiUsuario group=argosisp-api password=$apiPassword address=$apiDesde comment="argosisp: API REST de ArgosIsp"
    } else={
        /user set [find where name=$apiUsuario] group=argosisp-api password=$apiPassword address=$apiDesde disabled=no
    }
}

# CA propia del router: se crea una vez y se exporta a argosisp-ca.crt para que ArgosIsp verifique el
# certificado de www-ssl (el script de conexión la manda en el registro). El certificado del servidor
# (argosisp-www) y su uso en www-ssl van en comun-certificado.rsc: en el script de conexión, después
# del registro.
:if ([:len [/certificate find where name="argosisp-ca"]] = 0) do={
    /certificate add name=argosisp-ca common-name=$apiCaNombre key-usage=key-cert-sign,crl-sign days-valid=3650 key-size=2048
    /certificate sign argosisp-ca
}
/certificate export-certificate argosisp-ca file-name=argosisp-ca
# ============================================================================
# 12b. Certificado de www-ssl (argosisp-www, firmado por argosisp-ca)
# ============================================================================
# CN = apiNombre y SAN = DNS:apiNombre, IP:apiIp y, si viene, IP:apiIpAnterior: la IP con que
# ArgosIsp llegaba al router antes del túnel (api_url), para que el certificado sirva por los dos
# caminos mientras se migra. Se regenera solo si le falta alguna de esas IP.
# Solo se tocan los certificados llamados argosisp-www y argosisp-www-nuevo (el temporal de la
# regeneración): los demás del router (p. ej. una CA o un certificado propio del administrador) se
# quedan. www-ssl pasa al certificado nuevo antes de borrar el viejo: nunca queda sin certificado.
# apiCertificar: en lab.rsc siempre. En el script de conexión, solo si el registro respondió OK
# (ArgosIsp ya conoce argosisp-ca) o si www-ssl no usaba un certificado ajeno: nunca se cambia el
# certificado que ArgosIsp verifica hoy por uno que no conoce (contratos/conexion-routers.md §6.2).
:if ($apiCertificar) do={
    :local san ("DNS:" . $apiNombre . ",IP:" . $apiIp)
    :local ips [:toarray $apiIp]
    :if ([:len $apiIpAnterior] > 0 && $apiIpAnterior != $apiIp) do={
        :set san ($san . ",IP:" . $apiIpAnterior)
        :set ips ($ips, $apiIpAnterior)
    }
    /certificate remove [find where name="argosisp-www-nuevo"]
    :local wwwCert [/certificate find where name="argosisp-www"]
    :local regenerar ([:len $wwwCert] = 0)
    :if (!$regenerar) do={
        :local sanActual [:tostr [/certificate get $wwwCert subject-alt-name]]
        :foreach ip in=$ips do={
            :if (!($sanActual ~ ("IP:" . $ip . "(,|;|\$)"))) do={ :set regenerar true }
        }
        :if ($regenerar) do={ :put ("argosisp: el certificado de www-ssl no lleva " . $san . ": se regenera (la CA se conserva)") }
    }
    :if ($regenerar) do={
        /certificate add name=argosisp-www-nuevo common-name=$apiNombre subject-alt-name=$san key-usage=digital-signature,key-encipherment,tls-server days-valid=825 key-size=2048
        /certificate sign argosisp-www-nuevo ca=argosisp-ca
        /ip service set www-ssl certificate=argosisp-www-nuevo
        /certificate remove [find where name="argosisp-www"]
        /certificate set [find where name="argosisp-www-nuevo"] name=argosisp-www
    }
    # address= es available-from en RouterOS 7.17+ (acepta los dos nombres; 7.16 y anteriores solo address)
    /ip service set www-ssl certificate=argosisp-www tls-version=only-1.2 disabled=no
    :if ([:len $apiWwwDesde] > 0) do={ /ip service set www-ssl address=$apiWwwDesde }
    :if ($apiSoloHttps) do={
        /ip service set www disabled=yes
        /ip service set api disabled=yes
        /ip service set api-ssl disabled=yes
    }
} else={
    :put ("argosisp: AVISO www-ssl sigue con su certificado (" . [:tostr [/ip service get www-ssl certificate]] . "): ArgosIsp no aprendió la CA del router")
}
# ============================================================================
# 13. Reglas "argosisp:top" al inicio de cada tabla (antes de fasttrack y de
#     "accept established,related", que dejarían pasar al suspendido)
# ============================================================================
:put "argosisp: ordenando reglas"
:local destinoFiltro
:foreach id in=[/ip firewall filter find where dynamic=no] do={
    :if ([:typeof $destinoFiltro] = "nothing" && !([:tostr [/ip firewall filter get $id comment]] ~ "^argosisp:top")) do={ :set destinoFiltro $id }
}
:if ([:typeof $destinoFiltro] != "nothing") do={
    :foreach id in=[/ip firewall filter find where comment~"^argosisp:top"] do={ /ip firewall filter move $id destination=$destinoFiltro }
}

:local destinoNat
:foreach id in=[/ip firewall nat find where dynamic=no] do={
    :if ([:typeof $destinoNat] = "nothing" && !([:tostr [/ip firewall nat get $id comment]] ~ "^argosisp:top")) do={ :set destinoNat $id }
}
:if ([:typeof $destinoNat] != "nothing") do={
    :foreach id in=[/ip firewall nat find where comment~"^argosisp:top"] do={ /ip firewall nat move $id destination=$destinoNat }
}

:local destinoFiltro6
:foreach id in=[/ipv6 firewall filter find where dynamic=no] do={
    :if ([:typeof $destinoFiltro6] = "nothing" && !([:tostr [/ipv6 firewall filter get $id comment]] ~ "^argosisp:top")) do={ :set destinoFiltro6 $id }
}
:if ([:typeof $destinoFiltro6] != "nothing") do={
    :foreach id in=[/ipv6 firewall filter find where comment~"^argosisp:top"] do={ /ipv6 firewall filter move $id destination=$destinoFiltro6 }
}

:local destinoNat6
:foreach id in=[/ipv6 firewall nat find where dynamic=no] do={
    :if ([:typeof $destinoNat6] = "nothing" && !([:tostr [/ipv6 firewall nat get $id comment]] ~ "^argosisp:top")) do={ :set destinoNat6 $id }
}
:if ([:typeof $destinoNat6] != "nothing") do={
    :foreach id in=[/ipv6 firewall nat find where comment~"^argosisp:top"] do={ /ipv6 firewall nat move $id destination=$destinoNat6 }
}

# ============================================================================
# 14. Verificación de FastTrack (también a mano: /system script run argosisp-verificar-fasttrack)
# ============================================================================
# Falla si alguna regla fasttrack-connection de IPv4 o IPv6 queda antes de la exclusión de
# clientes, o si hay conexiones vivas de clientes (argos-clientes, IPv4) en FastTrack.
/system script add name=argosisp-verificar-fasttrack policy=read,test comment="argosisp: verificar FastTrack" source={
    :local errores ""
    :local excl false
    :foreach id in=[/ip firewall filter find where chain=forward && !disabled && dynamic=no] do={
        :if ([:tostr [/ip firewall filter get $id comment]] ~ "^argosisp:top sin fasttrack") do={ :set excl true }
        :if ([/ip firewall filter get $id action] = "fasttrack-connection" && !$excl) do={ :set errores ($errores . " ipv4:fasttrack-antes-de-la-exclusion") }
    }
    :if (!$excl) do={ :set errores ($errores . " ipv4:sin-exclusion") }
    :local excl6 false
    :foreach id in=[/ipv6 firewall filter find where chain=forward && !disabled && dynamic=no] do={
        :if ([:tostr [/ipv6 firewall filter get $id comment]] ~ "^argosisp:top sin fasttrack") do={ :set excl6 true }
        :if ([/ipv6 firewall filter get $id action] = "fasttrack-connection" && !$excl6) do={ :set errores ($errores . " ipv6:fasttrack-antes-de-la-exclusion") }
    }
    :if (!$excl6) do={ :set errores ($errores . " ipv6:sin-exclusion") }
    :local vivas 0
    :foreach cx in=[/ip firewall connection find where fasttrack] do={
        :foreach campo in={"src-address";"dst-address"} do={
            :local txt [:tostr [/ip firewall connection get $cx $campo]]
            :local fin [:find $txt ":"]
            :if ([:typeof $fin] = "nil") do={ :set fin [:len $txt] }
            :local ip [:toip [:pick $txt 0 $fin]]
            :if ([:typeof $ip] = "ip") do={
                :if ([:len [/ip firewall address-list find where list=argos-clientes && $ip in address]] > 0) do={ :set vivas ($vivas + 1) }
            }
        }
    }
    :if ($vivas > 0) do={ :set errores ($errores . " ipv4:" . $vivas . "-conexiones-de-clientes-en-fasttrack") }
    :if ($errores = "") do={
        :put "argosisp: FastTrack OK (excluido para argos-clientes en IPv4 e IPv6)"
    } else={
        :log error ("argosisp: FastTrack MAL:" . $errores)
        :error ("argosisp: FastTrack MAL:" . $errores)
    }
}
/system script run argosisp-verificar-fasttrack

:log info "argosisp: lab.rsc aplicado"
:put "argosisp: listo. Verificacion en infra/mikrotik/README.md"
}
