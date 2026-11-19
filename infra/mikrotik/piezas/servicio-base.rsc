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
# Bug v1.9.0 (5 nov): el script dejaba como DNS del router las IPs de documentacion del ejemplo y el
# router no resolvia nada (el suspendido veia "sin internet"). Ahora se rechazan y el script se detiene.
:foreach d in=($dnsV4, $dnsV6) do={
    :local doc false
    :if ([:typeof [:toip $d]] = "ip") do={
        :if (([:toip $d] in 192.0.2.0/24) || ([:toip $d] in 198.51.100.0/24) || ([:toip $d] in 203.0.113.0/24)) do={ :set doc true }
    }
    :if ([:typeof [:toip6 $d]] = "ip6") do={
        :if ([:toip6 $d] in 2001:db8::/32) do={ :set doc true }
    }
    :if ($doc) do={ :error ("argosisp: " . $d . " es una IP de documentacion, no un DNS real: pon los DNS de tu proveedor en dnsV4/dnsV6 (o dejalos vacios para usar los del router)") }
}
# Con dnsV4 vacio NO se tocan los resolutores del router (servers): se quedan los que ya tiene, mas los
# dinamicos de la WAN (dynamic-servers). allow-remote-requests=yes siempre, porque clientes y corte
# usan el router como DNS; la seccion 8 lo cierra desde la WAN (argosisp:top DNS del router ...).
:put "argosisp: DNS del router"
:if ([:len $dnsV4] > 0) do={
    :local dnsServidores ""
    :foreach d in=($dnsV4, $dnsV6) do={
        :if ($dnsServidores = "") do={ :set dnsServidores $d } else={ :set dnsServidores ($dnsServidores . "," . $d) }
    }
    /ip dns set allow-remote-requests=yes servers=$dnsServidores
} else={
    /ip dns set allow-remote-requests=yes
}
# Resolutores efectivos del router (servers + dynamic-servers): van a argos-dns en la seccion 7.
:local dnsRouterV4 [:toarray ""]
:local dnsRouterV6 [:toarray ""]
:foreach d in=([/ip dns get servers], [/ip dns get dynamic-servers]) do={
    :local s [:tostr $d]
    :if ($s != "") do={
        :if ([:typeof [:find $s ":"]] = "num") do={ :set dnsRouterV6 ($dnsRouterV6, $s) } else={ :set dnsRouterV4 ($dnsRouterV4, $s) }
    }
}
:if (([:len $dnsRouterV4] + [:len $dnsRouterV6]) = 0) do={
    :put "argosisp: AVISO el router no tiene DNS (servers ni dynamic-servers): ni clientes ni la pagina de corte resuelven. Corrige con /ip dns set servers=<tus resolutores> y vuelve a correr el script"
}

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
# Bypass del portal de corte (contratos/control-velocidad.md §10.9, runbook «Bypass del portal de
# corte»): las colas simples se evalúan en orden y el paquete se queda en la primera que coincide.
# Arriba de todo, la cola sin límite argosisp-bypass-portal (solo lo marcado por el mangle de la
# sección 9 ter: tráfico entre un suspendido y argos-bypass-portal); justo debajo, el ancla
# argosisp-suspendidos (target de documentación que nadie tiene). El perfil suspendido inserta la
# cola dinámica de cada sesión antes del ancla, es decir, entre las dos. Se crean solo si faltan: el
# target del bypass lo corrige el reconciliador (redes del router y bloques IPv6) y el script no lo
# pisa; aquí solo se siembra clientesV4. El ancla no se borra nunca: el perfil la nombra.
:put "argosisp: colas del bypass del portal de corte"
:if ([:len [/queue simple find where name="argosisp-suspendidos"]] = 0) do={
    /queue simple add name=argosisp-suspendidos target=192.0.2.255/32 max-limit=0/0 comment="argosisp: ancla colas suspendidos"
}
:if ([:len [/queue simple find where name="argosisp-bypass-portal"]] = 0) do={
    /queue simple add name=argosisp-bypass-portal target=$clientesV4 packet-marks=argosisp-bypass-portal max-limit=0/0 limit-at=0/0 parent=none comment="argosisp: bypass portal de corte"
}
# Primero el ancla y después el bypass al inicio de las estáticas: queda bypass, ancla. Con la lista
# de estáticas vacía (no pasa: el ancla ya existe) "->0" fallaría; mover un elemento antes de sí
# mismo tampoco hace falta. Por eso cada move va en :do on-error y solo si no está ya en su sitio.
:foreach nombreCola in={"argosisp-suspendidos";"argosisp-bypass-portal"} do={
    :do {
        :local cola ([/queue simple find where name=$nombreCola]->0)
        :local primera ([/queue simple find where dynamic=no]->0)
        :if ($cola != $primera) do={ /queue simple move $cola destination=$primera }
    } on-error={ :put ("argosisp: AVISO no se pudo subir la cola " . $nombreCola . " al inicio: revisa /queue simple print") }
}

/ppp profile set [find where name="suspendido"] local-address=$pppLocalV4 remote-address=$poolV4 \
    remote-ipv6-prefix-pool=$poolV6Enlace dhcpv6-pd-pool=$poolV6Pd use-ipv6=yes \
    dns-server=$pppLocalV4 change-tcp-mss=yes rate-limit=$suspRateLimit \
    address-list=suspendidos interface-list=suspendidos insert-queue-before=argosisp-suspendidos

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

