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
# Bug v1.9.0 (5 nov): el script dejaba como DNS del router las IPs de documentación del ejemplo y el
# router no resolvía nada (el suspendido veía "sin internet"). Ahora: los DNS dados, o los que ya
# tiene el router; nunca IPs de documentación; y si no hay ninguno, se detiene.
:local dnsServidores ""
:foreach d in=($dnsV4, $dnsV6) do={
    :local doc false
    :if ([:typeof [:toip $d]] = "ip") do={
        :if (([:toip $d] in 192.0.2.0/24) || ([:toip $d] in 198.51.100.0/24) || ([:toip $d] in 203.0.113.0/24)) do={ :set doc true }
    }
    :if ([:typeof [:toip6 $d]] = "ip6") do={
        :if ([:toip6 $d] in 2001:db8::/32) do={ :set doc true }
    }
    :if ($doc) do={ :error ("argosisp: " . $d . " es una IP de documentacion, no un DNS real: pon los DNS de tu proveedor en dnsV4/dnsV6 (o dejalos vacios para usar los del router)") }
    :if ($dnsServidores = "") do={ :set dnsServidores $d } else={ :set dnsServidores ($dnsServidores . "," . $d) }
}
:if ($dnsServidores = "") do={
    :if (([:len [/ip dns get servers]] = 0) && ([:len [/ip dns get dynamic-servers]] = 0)) do={
        :error "argosisp: el router no tiene DNS (/ip dns servers vacio): define dnsV4 con los DNS de tu proveedor, p. ej. {\"1.1.1.1\";\"8.8.8.8\"}"
    }
    :put "argosisp: DNS del router sin cambios (los que ya tenia)"
    /ip dns set allow-remote-requests=yes
} else={
    /ip dns set allow-remote-requests=yes servers=$dnsServidores
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

