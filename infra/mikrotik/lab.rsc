# ArgosIsp · MikroTik del laboratorio (RouterOS 7)
#
# PPPoE dual-stack con RADIUS (FreeRADIUS → aaa), CoA en 3799, perfil "suspendido",
# DHCPv6-PD, firewall de corte IPv4/IPv6 y WireGuard opcional hacia el servidor.
# Documentación y verificación: infra/mikrotik/README.md
#
# Uso:  edita SOLO la cabecera (bloque "Variables"), sube el archivo y ejecuta
#       /import file-name=lab.rsc verbose=yes
# Es re-ejecutable: todo lo que crea lleva comentario "argosisp..." y se reemplaza al reaplicar.
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
# Prefijo de todos los clientes (para NAT de salida en el laboratorio)
:local clientesV4 "10.10.0.0/16"
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
:local portalV6 "2001:db8:ffff::20"
:local portalFqdn "portal.argosisp.example"
# Walled garden: dominios que un suspendido puede alcanzar además del portal (pasarela de pago, etc.).
# A5 los define. Vacío hasta la semana 2: el portal no carga nada externo. Ejemplo con dominios:
#   :local walledGarden {"pagos.argosisp.example";"pasarela.example"}
:local walledGarden [:toarray ""]

# --- DNS ---
# Resolutores que el router usa y que los suspendidos pueden consultar
:local dnsV4 {"192.0.2.53";"198.51.100.53"}
:local dnsV6 {"2001:db8:ffff::53"}

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
/ip firewall filter remove [find where comment~"^argosisp"]
/ip firewall nat remove [find where comment~"^argosisp"]
/ip firewall address-list remove [find where dynamic=no comment~"^argosisp"]
/ipv6 firewall filter remove [find where comment~"^argosisp"]
/ipv6 firewall address-list remove [find where dynamic=no comment~"^argosisp"]
/radius remove [find where comment~"^argosisp"]

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
/ip firewall address-list add list=argos-portal address=$portalV4 comment="argosisp: portal IP"
/ip firewall address-list add list=argos-portal address=$portalFqdn comment="argosisp: portal FQDN"
/ip firewall address-list add list=argos-dns address=$pppLocalV4 comment="argosisp: DNS del router"
:foreach d in=$dnsV4 do={ /ip firewall address-list add list=argos-dns address=$d comment="argosisp: DNS" }
:foreach d in=$walledGarden do={ /ip firewall address-list add list=argos-walled address=$d comment="argosisp: walled garden" }

/ipv6 firewall address-list add list=argos-portal address=$portalV6 comment="argosisp: portal IP"
/ipv6 firewall address-list add list=argos-portal address=$portalFqdn comment="argosisp: portal FQDN"
:foreach d in=$dnsV6 do={ /ipv6 firewall address-list add list=argos-dns address=$d comment="argosisp: DNS" }
:foreach d in=$walledGarden do={ /ipv6 firewall address-list add list=argos-walled address=$d comment="argosisp: walled garden" }

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

# Cadena de corte (tráfico del cliente suspendido hacia fuera). Filter-Id = "argos-corte.in".
add chain=argos-corte protocol=udp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS udp"
add chain=argos-corte protocol=tcp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS tcp"
add chain=argos-corte dst-address-list=argos-portal action=accept comment="argosisp: corte portal"
add chain=argos-corte dst-address-list=argos-walled action=accept comment="argosisp: corte walled garden"
add chain=argos-corte action=drop comment="argosisp: corte drop del resto"

# Hacia el router: DNS e ICMP; nada más.
add chain=argos-corte-in protocol=udp dst-port=53 action=accept comment="argosisp: corte-in DNS udp"
add chain=argos-corte-in protocol=tcp dst-port=53 action=accept comment="argosisp: corte-in DNS tcp"
add chain=argos-corte-in protocol=icmp action=accept comment="argosisp: corte-in ICMP"
add chain=argos-corte-in action=drop comment="argosisp: corte-in drop del resto"

# Cadena neutra para reactivar por CoA (Filter-Id = "argos-activo.in" reemplaza a argos-corte).
add chain=argos-activo action=return comment="argosisp: activo (Filter-Id neutro)"

# NAT: HTTP de los suspendidos → página de corte del portal. Walled garden y portal sin NAT.
/ip firewall nat
add chain=dstnat src-address-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por address-list"
add chain=dstnat in-interface-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por interface-list"
add chain=argos-corte-nat dst-address-list=argos-portal action=return comment="argosisp: corte-nat portal sin NAT"
add chain=argos-corte-nat dst-address-list=argos-walled action=return comment="argosisp: corte-nat walled garden sin NAT"
add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat to-addresses=$portalV4 to-ports=$portalCortePuerto comment="argosisp: corte-nat HTTP a /corte"
add chain=srcnat src-address=$clientesV4 out-interface=$wanIf action=masquerade comment="argosisp: NAT de clientes del laboratorio"

# ============================================================================
# 9. Firewall IPv6 (espejo, sin NAT)
# ============================================================================
# No hay dst-nat: el portal y el walled garden se permiten por dst-address; TCP al resto recibe
# tcp-reset para que el navegador caiga rápido a IPv4 (Happy Eyeballs), donde sí hay redirección.
:put "argosisp: firewall IPv6"
/ipv6 firewall filter
add chain=input src-address-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por address-list"
add chain=input in-interface-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por interface-list"
add chain=forward src-address-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por address-list"
add chain=forward in-interface-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por interface-list"
add chain=forward action=jump jump-target=ppp comment="argosisp:top Filter-Id de RADIUS/CoA"

add chain=argos-corte protocol=udp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS udp"
add chain=argos-corte protocol=tcp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS tcp"
add chain=argos-corte dst-address-list=argos-portal action=accept comment="argosisp: corte portal"
add chain=argos-corte dst-address-list=argos-walled action=accept comment="argosisp: corte walled garden"
add chain=argos-corte protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte TCP reset (cae a IPv4)"
add chain=argos-corte action=drop comment="argosisp: corte drop del resto"

# Hacia el router: ICMPv6 (ND/RA), DHCPv6 (renovación del PD) y DNS.
add chain=argos-corte-in protocol=icmpv6 action=accept comment="argosisp: corte-in ICMPv6"
add chain=argos-corte-in protocol=udp dst-port=547 action=accept comment="argosisp: corte-in DHCPv6"
add chain=argos-corte-in protocol=udp dst-port=53 action=accept comment="argosisp: corte-in DNS udp"
add chain=argos-corte-in protocol=tcp dst-port=53 action=accept comment="argosisp: corte-in DNS tcp"
add chain=argos-corte-in action=drop comment="argosisp: corte-in drop del resto"

add chain=argos-activo action=return comment="argosisp: activo (Filter-Id neutro)"

# ============================================================================
# 10. Reglas "argosisp:top" al inicio de cada tabla (antes de fasttrack y de
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

:log info "argosisp: lab.rsc aplicado"
:put "argosisp: listo. Verificacion en infra/mikrotik/README.md"
}
