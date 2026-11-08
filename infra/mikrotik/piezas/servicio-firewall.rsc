# ============================================================================
# 7. Address-lists (IPv4 e IPv6). Las entradas por FQDN las resuelve el router.
# ============================================================================
:put "argosisp: address-lists"
/ip firewall address-list add list=argos-portal address=$portalV4 comment="argosisp: portal IP"
/ip firewall address-list add list=argos-portal address=$portalFqdn comment="argosisp: portal FQDN"
/ip firewall address-list add list=argos-dns address=$pppLocalV4 comment="argosisp: DNS del router"
:foreach d in=$dnsV4 do={ /ip firewall address-list add list=argos-dns address=$d comment="argosisp: DNS" }
# Los resolutores que el router ya usa (seccion 3); si coinciden con dnsV4 la entrada ya existe.
:foreach d in=$dnsRouterV4 do={ :do { /ip firewall address-list add list=argos-dns address=$d comment="argosisp: DNS resolutor del router" } on-error={} }
:foreach d in=$walledGarden do={ /ip firewall address-list add list=argos-walled address=$d comment="argosisp: walled garden" }
# Clientes con colas (PPPoE y WISP): NAT de salida del laboratorio y exclusión de FastTrack
/ip firewall address-list add list=argos-clientes address=$clientesV4 comment="argosisp: clientes PPPoE"
:if ($wispHabilitar) do={ /ip firewall address-list add list=argos-clientes address=$wispRed comment="argosisp: clientes WISP" }
:if ($wispHabilitar && $amarreHabilitar) do={ /ip firewall address-list add list=argos-clientes address=$amarreRed comment="argosisp: clientes WISP con amarre" }

/ipv6 firewall address-list add list=argos-portal address=$portalV6 comment="argosisp: portal IP"
/ipv6 firewall address-list add list=argos-portal address=$portalFqdn comment="argosisp: portal FQDN"
:foreach d in=$dnsV6 do={ /ipv6 firewall address-list add list=argos-dns address=$d comment="argosisp: DNS" }
:foreach d in=$dnsRouterV6 do={ :do { /ipv6 firewall address-list add list=argos-dns address=$d comment="argosisp: DNS resolutor del router" } on-error={} }
:foreach d in=$walledGarden do={ /ipv6 firewall address-list add list=argos-walled address=$d comment="argosisp: walled garden" }
:foreach d in=$clientesV6 do={ /ipv6 firewall address-list add list=argos-clientes address=$d comment="argosisp: clientes IPv6" }
:if ($wispHabilitar && $wispV6Red != "") do={ /ipv6 firewall address-list add list=argos-clientes address=$wispV6Red comment="argosisp: clientes WISP IPv6" }

# ============================================================================
# 8. Firewall IPv4
# ============================================================================
:put "argosisp: firewall IPv4"
# Reglas "argosisp:top" se mueven al inicio de su tabla al final del script.
# Sin RADIUS (router modo_seguridad = api) no hay CoA: radiusAddr y radiusAddr2 vienen vacíos.
:if ($radiusAddr != "") do={
    /ip firewall filter add chain=input protocol=udp dst-port=3799 src-address=$radiusAddr action=accept comment="argosisp:top CoA desde aaa nodo 1"
}
:if ($radiusAddr2 != "") do={
    /ip firewall filter add chain=input protocol=udp dst-port=3799 src-address=$radiusAddr2 action=accept comment="argosisp:top CoA desde aaa nodo 2"
}
:if ($wgHabilitar) do={
    /ip firewall filter add chain=input protocol=udp dst-port=$wgPuertoLocal action=accept comment="argosisp:top WireGuard"
}
# DNS del router (allow-remote-requests=yes): solo desde dentro. Se descarta desde la WAN (wanIf y la
# lista WAN si existe) y se acepta desde los clientes (argos-clientes) y la lista LAN si existe. Solo
# agrega reglas "argosisp:top": las del operador quedan como estan, debajo.
/ip firewall filter
add chain=input in-interface=$wanIf protocol=udp dst-port=53 action=drop comment="argosisp:top DNS del router solo interno (udp)"
add chain=input in-interface=$wanIf protocol=tcp dst-port=53 action=drop comment="argosisp:top DNS del router solo interno (tcp)"
:if ([:len [/interface list find where name="WAN"]] > 0) do={
    /ip firewall filter add chain=input in-interface-list=WAN protocol=udp dst-port=53 action=drop comment="argosisp:top DNS del router no desde lista WAN (udp)"
    /ip firewall filter add chain=input in-interface-list=WAN protocol=tcp dst-port=53 action=drop comment="argosisp:top DNS del router no desde lista WAN (tcp)"
}
/ip firewall filter add chain=input src-address-list=argos-clientes protocol=udp dst-port=53 action=accept comment="argosisp:top DNS del router desde clientes (udp)"
/ip firewall filter add chain=input src-address-list=argos-clientes protocol=tcp dst-port=53 action=accept comment="argosisp:top DNS del router desde clientes (tcp)"
:if ([:len [/interface list find where name="LAN"]] > 0) do={
    /ip firewall filter add chain=input in-interface-list=LAN protocol=udp dst-port=53 action=accept comment="argosisp:top DNS del router desde LAN (udp)"
    /ip firewall filter add chain=input in-interface-list=LAN protocol=tcp dst-port=53 action=accept comment="argosisp:top DNS del router desde LAN (tcp)"
}
/ip firewall filter
add chain=input src-address-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por address-list"
add chain=input in-interface-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por interface-list"
add chain=forward src-address-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por address-list"
add chain=forward in-interface-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por interface-list"
# Reglas dinámicas que RouterOS crea por Filter-Id (RADIUS o CoA) en la cadena "ppp"
add chain=forward action=jump jump-target=ppp comment="argosisp:top Filter-Id de RADIUS/CoA"
# Modo código (corte_identificacion = codigo, contratos/corte-identificacion.md §5 bis): el puerto del
# proxy de corte solo acepta lo que llegó por el redirect de un suspendido. Una conexión directa (desde
# la WAN o de un cliente activo) se descarta: el router nunca es un proxy abierto.
:if ($corteIdentificacion = "codigo") do={
    /ip firewall filter add chain=input protocol=tcp dst-port=$proxyCortePuerto connection-nat-state=!dstnat action=drop comment="argosisp:top proxy de corte solo redirigido"
}
/ip firewall filter
# FastTrack excluido para clientes con colas (contratos/velocidad.md): con FastTrack los paquetes
# saltan colas simples, queue tree y mangle. Aceptar aquí lo establecido de los clientes, DESPUÉS
# de los saltos de corte y ANTES de "defconf: fasttrack", deja esas conexiones fuera de FastTrack.
# Verificación: /system script run argosisp-verificar-fasttrack
add chain=forward connection-state=established,related src-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (subida)"
add chain=forward connection-state=established,related dst-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (bajada)"

# Cadena de corte (tráfico del cliente suspendido hacia fuera). Filter-Id = "argos-corte.in".
# DNS hacia CUALQUIER resolver (el del router, el del perfil PPP o uno fijo como 8.8.8.8), con la
# respuesta real: si el equipo no resuelve, nunca pide el HTTP que va a /corte y dice "sin internet".
# DoT (853) y DoH (443) caen en el tcp-reset y el equipo vuelve al DNS normal.
add chain=argos-corte protocol=udp dst-port=53 action=accept comment="argosisp: corte DNS udp a cualquier resolver"
add chain=argos-corte protocol=tcp dst-port=53 action=accept comment="argosisp: corte DNS tcp a cualquier resolver"
add chain=argos-corte dst-address-list=argos-portal action=accept comment="argosisp: corte portal"
add chain=argos-corte dst-address-list=argos-walled action=accept comment="argosisp: corte walled garden"
# Rechazo explícito en vez de drop: HTTPS y el resto de TCP fallan al instante (sin esperar el
# timeout) y QUIC (UDP/443) cae a TCP; la detección de portal cautivo usa HTTP/80, que va al portal.
add chain=argos-corte protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte TCP reset"
add chain=argos-corte action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte rechazo del resto"

# Hacia el router: DNS e ICMP; nada más.
add chain=argos-corte-in protocol=udp dst-port=53 action=accept comment="argosisp: corte-in DNS udp"
add chain=argos-corte-in protocol=tcp dst-port=53 action=accept comment="argosisp: corte-in DNS tcp"
# Modo código: el suspendido redirigido sí llega al proxy de corte (antes del tcp-reset).
:if ($corteIdentificacion = "codigo") do={
    /ip firewall filter add chain=argos-corte-in protocol=tcp dst-port=$proxyCortePuerto action=accept comment="argosisp: corte-in proxy de corte"
}
/ip firewall filter
add chain=argos-corte-in protocol=icmp action=accept comment="argosisp: corte-in ICMP"
add chain=argos-corte-in protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte-in TCP reset"
add chain=argos-corte-in action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte-in rechazo del resto"

# Cadena neutra para reactivar por CoA (Filter-Id = "argos-activo.in" reemplaza a argos-corte).
add chain=argos-activo action=return comment="argosisp: activo (Filter-Id neutro)"

# NAT: HTTP de los suspendidos → página de corte del portal. Walled garden y portal sin NAT.
# Modo ip: dst-nat al portal (el portal identifica por la IP de origen). Modo código: redirect al proxy
# del propio router (puerto proxyCortePuerto), que responde 307 a /corte?c=<código> según la IP del
# suspendido (/ip proxy access, sección 9 bis); no depende de que el portal vea la IP real.
/ip firewall nat
add chain=dstnat src-address-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por address-list"
add chain=dstnat in-interface-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por interface-list"
add chain=argos-corte-nat dst-address-list=argos-portal action=return comment="argosisp: corte-nat portal sin NAT"
add chain=argos-corte-nat dst-address-list=argos-walled action=return comment="argosisp: corte-nat walled garden sin NAT"
:if ($corteIdentificacion = "codigo") do={
    /ip firewall nat add chain=argos-corte-nat protocol=tcp dst-port=80 action=redirect to-ports=$proxyCortePuerto comment="argosisp: corte-nat HTTP al proxy de corte"
} else={
    /ip firewall nat add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat to-addresses=$portalV4 to-ports=$portalCortePuerto comment="argosisp: corte-nat HTTP a /corte"
}
/ip firewall nat
add chain=srcnat src-address-list=argos-clientes out-interface=$wanIf action=masquerade comment="argosisp: NAT de clientes del laboratorio"

# ============================================================================
# 9. Firewall IPv6 (espejo del IPv4, con NAT de HTTP a /corte si hay IPv6 del portal)
# ============================================================================
# Mismo trato que IPv4 (bug v1.9.0, 5 nov): DNS a cualquier resolver, portal y walled garden, TCP/80
# redirigido al portal por IPv6 y el resto RECHAZADO al instante (tcp-reset / icmp-admin-prohibited,
# nunca drop). El NAT IPv6 coincide con las sesiones que entraron con el perfil suspendido (lista de
# interfaces o address-list IPv6): PPPoE con COA_SUSPENDER_CON_IPV6=disconnect (por defecto), que
# reconecta al suspendido, y WISP por su entrada IPv6 en suspendidos. Sin portalV6 no hay NAT IPv6:
# el HTTP por IPv6 recibe reset y el equipo cae a IPv4. infra/mikrotik/README.md, "Corte por IPv6".
:put "argosisp: firewall IPv6"
# Modo código: el NAT IPv6 va siempre (redirect al proxy del router, que escucha en IPv4 e IPv6) y no
# necesita la IPv6 del portal.
:if ($portalV6 != "" || $corteIdentificacion = "codigo") do={
    /ipv6 firewall nat add chain=dstnat src-address-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por address-list"
    /ipv6 firewall nat add chain=dstnat in-interface-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por interface-list"
    /ipv6 firewall nat add chain=argos-corte-nat dst-address-list=argos-portal action=return comment="argosisp: corte-nat portal sin NAT"
    /ipv6 firewall nat add chain=argos-corte-nat dst-address-list=argos-walled action=return comment="argosisp: corte-nat walled garden sin NAT"
    :if ($corteIdentificacion = "codigo") do={
        /ipv6 firewall nat add chain=argos-corte-nat protocol=tcp dst-port=80 action=redirect to-ports=$proxyCortePuerto comment="argosisp: corte-nat HTTP al proxy de corte"
    } else={
        /ipv6 firewall nat add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat to-address=($portalV6 . "/128") to-ports=$portalCortePuerto comment="argosisp: corte-nat HTTP a /corte"
    }
}
# DNS del router por IPv6: el mismo cierre que en IPv4 (seccion 8).
/ipv6 firewall filter
add chain=input in-interface=$wanIf protocol=udp dst-port=53 action=drop comment="argosisp:top DNS del router solo interno (udp)"
add chain=input in-interface=$wanIf protocol=tcp dst-port=53 action=drop comment="argosisp:top DNS del router solo interno (tcp)"
:if ([:len [/interface list find where name="WAN"]] > 0) do={
    /ipv6 firewall filter add chain=input in-interface-list=WAN protocol=udp dst-port=53 action=drop comment="argosisp:top DNS del router no desde lista WAN (udp)"
    /ipv6 firewall filter add chain=input in-interface-list=WAN protocol=tcp dst-port=53 action=drop comment="argosisp:top DNS del router no desde lista WAN (tcp)"
}
/ipv6 firewall filter add chain=input src-address-list=argos-clientes protocol=udp dst-port=53 action=accept comment="argosisp:top DNS del router desde clientes (udp)"
/ipv6 firewall filter add chain=input src-address-list=argos-clientes protocol=tcp dst-port=53 action=accept comment="argosisp:top DNS del router desde clientes (tcp)"
:if ([:len [/interface list find where name="LAN"]] > 0) do={
    /ipv6 firewall filter add chain=input in-interface-list=LAN protocol=udp dst-port=53 action=accept comment="argosisp:top DNS del router desde LAN (udp)"
    /ipv6 firewall filter add chain=input in-interface-list=LAN protocol=tcp dst-port=53 action=accept comment="argosisp:top DNS del router desde LAN (tcp)"
}
/ipv6 firewall filter
add chain=input src-address-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por address-list"
add chain=input in-interface-list=suspendidos action=jump jump-target=argos-corte-in comment="argosisp:top corte input por interface-list"
add chain=forward src-address-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por address-list"
add chain=forward in-interface-list=suspendidos action=jump jump-target=argos-corte comment="argosisp:top corte por interface-list"
add chain=forward action=jump jump-target=ppp comment="argosisp:top Filter-Id de RADIUS/CoA"
:if ($corteIdentificacion = "codigo") do={
    /ipv6 firewall filter add chain=input protocol=tcp dst-port=$proxyCortePuerto connection-nat-state=!dstnat action=drop comment="argosisp:top proxy de corte solo redirigido"
}
/ipv6 firewall filter
add chain=forward connection-state=established,related src-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (subida)"
add chain=forward connection-state=established,related dst-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (bajada)"

# DNS hacia CUALQUIER resolver (el del router, el del perfil PPP o uno fijo como 8.8.8.8), con la
# respuesta real: si el equipo no resuelve, nunca pide el HTTP que va a /corte y dice "sin internet".
# DoT (853) y DoH (443) caen en el tcp-reset y el equipo vuelve al DNS normal.
add chain=argos-corte protocol=udp dst-port=53 action=accept comment="argosisp: corte DNS udp a cualquier resolver"
add chain=argos-corte protocol=tcp dst-port=53 action=accept comment="argosisp: corte DNS tcp a cualquier resolver"
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
:if ($corteIdentificacion = "codigo") do={
    /ipv6 firewall filter add chain=argos-corte-in protocol=tcp dst-port=$proxyCortePuerto action=accept comment="argosisp: corte-in proxy de corte"
}
/ipv6 firewall filter
add chain=argos-corte-in protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte-in TCP reset"
add chain=argos-corte-in action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte-in rechazo del resto"

add chain=argos-activo action=return comment="argosisp: activo (Filter-Id neutro)"

# ============================================================================
# 9 bis. Web proxy del corte (modo código, contratos/corte-identificacion.md §5 bis)
# ============================================================================
# Lo mismo que el reconciliador de ArgosIsp (ajusteProxy y reglasProxy en corte_router.ts):
# - codigo: la regla final de /ip proxy access (local-port=3346) existe SIEMPRE: redirect a /corte sin
#   código, o deny si no hay URL del portal (corteUrl ni portalV4). Sin regla final el proxy reenviaría
#   a internet el HTTP del suspendido (sale por output, sin pasar por argos-corte). Las reglas del corte
#   (las de servicio, argosisp:servicio:<id>, que escribe ArgosIsp por la API, y la final) van antes que
#   las del operador: un allow suyo sin local-port ganaría en el 3346.
#   El proxy se enciende (o se le agrega el 3346) solo DESPUÉS de la regla final y del drop de input
#   (sección 8): si estaba apagado es solo del corte (enabled=yes port=3346 max-cache-size=none); si el
#   operador ya lo usa, solo se agrega el puerto 3346 y no se toca nada más.
# - ip: se quita el 3346; si era el único puerto, el proxy se apaga y vuelve al 8080 de fábrica.
:put "argosisp: web proxy del corte"
:local proxyCon false
:local proxyResto ""
:foreach p in=[:toarray [/ip proxy get port]] do={
    :if ([:tostr $p] = $proxyCortePuerto) do={
        :set proxyCon true
    } else={
        :if ($proxyResto != "") do={ :set proxyResto ($proxyResto . ",") }
        :set proxyResto ($proxyResto . [:tostr $p])
    }
}
:local proxyEncendido [/ip proxy get enabled]
:if ($corteIdentificacion = "codigo") do={
    # 1. Regla final: redirect a /corte (la URL pública o el destino del NAT) o deny.
    :local urlCorte $corteUrl
    :if ($urlCorte = "" && $portalV4 != "") do={ :set urlCorte ("http://" . $portalV4 . ":" . $portalCortePuerto . "/corte") }
    :local finalProxy
    :if ($urlCorte = "") do={
        :put "argosisp: AVISO modo codigo sin URL de /corte (PORTAL_URL_PUBLICA o IPv4 del portal): el proxy de corte niega (deny) en vez de redirigir"
        :set finalProxy [/ip proxy access add local-port=$proxyCortePuerto action=deny comment="argosisp: corte proxy sin codigo"]
    } else={
        :set finalProxy [/ip proxy access add local-port=$proxyCortePuerto action=redirect action-data=$urlCorte comment="argosisp: corte proxy sin codigo"]
    }
    # 2. Las del corte al inicio: las de servicio y luego la final, antes de la primera del operador.
    :local destinoProxy
    :foreach id in=[/ip proxy access find] do={
        :if ([:typeof $destinoProxy] = "nothing" && $id != $finalProxy && !([:tostr [/ip proxy access get $id comment]] ~ "^argosisp:servicio:")) do={ :set destinoProxy $id }
    }
    :if ([:typeof $destinoProxy] != "nothing") do={
        :foreach id in=[/ip proxy access find where comment~"^argosisp:servicio:"] do={ /ip proxy access move $id destination=$destinoProxy }
        /ip proxy access move $finalProxy destination=$destinoProxy
    }
    # 3. Recién ahora el proxy (la regla final y el drop de input ya existen).
    :if (!$proxyEncendido) do={
        /ip proxy set enabled=yes port=$proxyCortePuerto max-cache-size=none
    } else={
        :if (!$proxyCon) do={
            :if ($proxyResto = "") do={ /ip proxy set port=$proxyCortePuerto } else={ /ip proxy set port=($proxyResto . "," . $proxyCortePuerto) }
        }
    }
} else={
    :if ($proxyCon) do={
        :if ($proxyResto = "") do={
            :if ($proxyEncendido) do={ /ip proxy set enabled=no port=8080 } else={ /ip proxy set port=8080 }
        } else={
            /ip proxy set port=$proxyResto
        }
    }
}

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

