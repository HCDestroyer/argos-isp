# ArgosIsp - script de conexion del router (RouterOS 7)
#
# AVISO: este archivo lleva secretos (la clave del usuario de la API y el secreto RADIUS). Usalo,
# no lo guardes ni lo mandes por chat. El token de registro vale 24 h y una sola vez.
#
# Que hace (contratos/conexion-routers.md):
#   1. Comprueba RouterOS 7, crea la interfaz WireGuard "wg-argos" y lee su clave publica (la
#      privada nunca sale del router).
#   2. Crea la CA y el certificado de www-ssl, el grupo "argosisp-api" con el minimo de permisos
#      (read, write, api, rest-api) y el usuario "argosisp-api", que solo entra desde ArgosIsp.
#   3. Se registra en ArgosIsp con el token y agrega el servidor como peer del tunel.
#   4. Configura RADIUS y CoA hacia ArgosIsp por el tunel.
#   5. Apaga los servicios que no se usan y deja la gestion (www-ssl, Winbox, SSH) solo por el tunel
#      y desde las IPs de administracion. No toca el trafico de los clientes.
#
# Como usarlo: Winbox -> Files -> arrastra el archivo; luego New Terminal y
#   /import file-name=argosisp-conexion.rsc verbose=yes
# (o pega el contenido completo en New Terminal). Es re-ejecutable: solo borra y recrea lo que lleva
# comentario "argosisp:"; la interfaz wg-argos y su clave se conservan.
# Generado por ArgosIsp desde infra/mikrotik/piezas (no editar a mano: infra/mikrotik/armar.mjs).

{
:local routerId "{{router_id}}"
:local generadoEn "{{generado_en}}"
:local argosUrl "{{argos_url}}"
:local token "{{token}}"
:local fetchVerificar "yes-without-crl"
:local wgIf "wg-argos"
:local wgPuertoLocal 13231
:local wgMtu 1420
:local wgIp "{{wg_ip}}"
:local wgServidorIp "{{wg_servidor_ip}}"
:local wgRed "{{wg_red}}"
:local wgServidorPub "{{wg_servidor_public_key}}"
:local wgServidorEndpoint "{{wg_servidor_endpoint}}"
:local wgServidorPuerto [:tonum "{{wg_servidor_puerto}}"]
:local radiusAddr $wgServidorIp
:local radiusAddr2 ""
:local radiusSrc $wgIp
:local radiusSecret "{{radius_secret}}"
:local apiUsuario "argosisp-api"
:local apiPassword "{{api_password}}"
:local apiDesde ($wgServidorIp . "/32")
:local apiNombre "{{api_nombre}}"
:local apiIp $wgIp
:local apiCaNombre "ArgosIsp CA del router {{router_id}}"
:local apiSoloHttps true
:local adminIps [:toarray "{{admin_ips}}"]
:local rosVersion [/system resource get version]
:local rosMayor [:tonum [:pick $rosVersion 0 [:find $rosVersion "."]]]
:if ($rosMayor < 7) do={ :error ("argosisp: hace falta RouterOS 7 (este router tiene " . $rosVersion . ")") }
:put ("argosisp: RouterOS " . $rosVersion . ", router " . $routerId . ", script del " . $generadoEn)
:if ([:len $adminIps] = 0) do={
    :put "argosisp: AVISO sin IPs de administracion: Winbox y SSH quedaran solo por el tunel y por MAC-Winbox en la red local"
}
:local labIf "{{pppoe_interfaz}}"
:local wanIf "{{wan_interfaz}}"
:local pppoeServicio "argosisp"
:local pppLocalV4 "{{ppp_local_v4}}"
:local poolV4 "argos-v4-pppoe"
:local poolV4Rangos "{{pool_v4_rangos}}"
:local clientesV4 "{{clientes_v4}}"
:local clientesV6 [:toarray "{{clientes_v6}}"]
:local suspRateLimit "{{susp_rate_limit}}"
:local poolV6Enlace "argos-v6-enlace"
:local poolV6EnlacePrefijo "{{pool_v6_enlace_prefijo}}"
:local poolV6Pd "argos-v6-pd"
:local poolV6PdPrefijo "{{pool_v6_pd_prefijo}}"
:local poolV6PdLongitud 56
:local portalV4 "{{portal_v4}}"
:local portalCortePuerto 80
:local portalV6 "{{portal_v6}}"
:local portalFqdn "{{portal_fqdn}}"
:local walledGarden [:toarray "{{walled_garden}}"]
:local dnsV4 [:toarray "{{dns_v4}}"]
:local dnsV6 [:toarray "{{dns_v6}}"]
:local wispHabilitar false
:local wispV6Red ""
:local amarreHabilitar false
:local arbolEjemplo false
:local arbolPlanId 0
:local wgHabilitar false
:put "argosisp: limpiando la conexion anterior"
/ip firewall filter remove [find where comment~"^argosisp:gestion"]
/ip firewall address-list remove [find where dynamic=no comment~"^argosisp:gestion"]
/radius remove [find where comment~"^argosisp: aaa nodo"]
:put "argosisp: limpiando configuracion anterior"
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
/queue type remove [find where name~("^argosisp-plan-" . $arbolPlanId . "-")]
/system script remove [find where name~"^argosisp-"]
:put "argosisp: tunel WireGuard"
:if ([:len [/interface wireguard find where name=$wgIf]] = 0) do={
    /interface wireguard add name=$wgIf listen-port=$wgPuertoLocal mtu=$wgMtu comment="argosisp:conexion tunel a ArgosIsp"
}
/interface wireguard set [find where name=$wgIf] mtu=$wgMtu disabled=no
:local wgPub [/interface wireguard get [find where name=$wgIf] public-key]
:local wgDir [/ip address find where comment="argosisp:conexion tunel"]
:if ([:len $wgDir] = 0) do={
    /ip address add address=($wgIp . "/32") network=$wgServidorIp interface=$wgIf comment="argosisp:conexion tunel"
} else={
    /ip address set $wgDir address=($wgIp . "/32") network=$wgServidorIp interface=$wgIf disabled=no
}
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
:if ([:len [/certificate find where name="argosisp-ca"]] = 0) do={
    /certificate add name=argosisp-ca common-name=$apiCaNombre key-usage=key-cert-sign,crl-sign days-valid=3650 key-size=2048
    /certificate sign argosisp-ca
}
:local wwwCert [/certificate find where name="argosisp-www"]
:if ([:len $wwwCert] > 0) do={
    :if (!([:tostr [/certificate get $wwwCert subject-alt-name]] ~ ("IP:" . $apiIp . "(,|\$)"))) do={
        :put "argosisp: el certificado de www-ssl no tiene la IP actual: se regenera"
        /ip service set www-ssl certificate=none
        /certificate remove $wwwCert
    }
}
:if ([:len [/certificate find where name="argosisp-www"]] = 0) do={
    /certificate add name=argosisp-www common-name=$apiNombre subject-alt-name=("DNS:" . $apiNombre . ",IP:" . $apiIp) key-usage=digital-signature,key-encipherment,tls-server days-valid=825 key-size=2048
    /certificate sign argosisp-www ca=argosisp-ca
}
/certificate export-certificate argosisp-ca file-name=argosisp-ca
/ip service set www-ssl certificate=argosisp-www tls-version=only-1.2 address=$apiDesde disabled=no
:if ($apiSoloHttps) do={
    /ip service set www disabled=yes
    /ip service set api disabled=yes
    /ip service set api-ssl disabled=yes
}
:put "argosisp: registrando el router en ArgosIsp"
:local caPem ""
:do {
    :delay 1s
    :set caPem [/file get [find where name="argosisp-ca.crt"] contents]
} on-error={ :put "argosisp: AVISO no pude leer argosisp-ca.crt (ArgosIsp no podra verificar el certificado del router)" }
:local srvPub $wgServidorPub
:local srvEndpoint $wgServidorEndpoint
:local srvPuerto $wgServidorPuerto
:local registrado false
:do {
    :local aJson [:parse ":return [:serialize to=json value=\$1]"]
    :local deJson [:parse ":return [:deserialize from=json value=\$1]"]
    :local cuerpo [$aJson ({"token"=$token; "public_key"=$wgPub; "routeros_version"=$rosVersion; "api_ca"=$caPem})]
    :local r [/tool fetch url=($argosUrl . "/api/v1/routers/conexion/registrar") http-method=post \
        http-header-field="Content-Type: application/json,Accept: application/json" http-data=$cuerpo \
        output=user as-value check-certificate=$fetchVerificar]
    :local d [$deJson ($r->"data")]
    :local s ($d->"servidor")
    :if ([:len ($s->"public_key")] != 44) do={ :error "respuesta sin servidor.public_key" }
    :if (($d->"ip_tunel") != $wgIp) do={ :error ("ArgosIsp asigno " . ($d->"ip_tunel") . " y el script trae " . $wgIp . ": genera el script de nuevo") }
    :set srvPub ($s->"public_key")
    :set srvEndpoint ($s->"endpoint")
    :set srvPuerto [:tonum ($s->"puerto")]
    :set registrado true
    :put "argosisp: registrado en ArgosIsp"
} on-error={
    :put "argosisp: AVISO no se pudo registrar (sin internet, token usado o vencido, certificado no verificado o RouterOS sin :deserialize). Se usan los datos del servidor que trae el script."
}
:local wgPeer [/interface wireguard peers find where interface=$wgIf comment~"^argosisp:conexion"]
:if ([:len $wgPeer] = 0) do={
    /interface wireguard peers add interface=$wgIf public-key=$srvPub endpoint-address=$srvEndpoint \
        endpoint-port=$srvPuerto allowed-address=($wgServidorIp . "/32") persistent-keepalive=25s \
        comment="argosisp:conexion servidor ArgosIsp"
} else={
    /interface wireguard peers set $wgPeer public-key=$srvPub endpoint-address=$srvEndpoint \
        endpoint-port=$srvPuerto allowed-address=($wgServidorIp . "/32") persistent-keepalive=25s disabled=no
}
:put "argosisp: RADIUS"
/radius add service=ppp address=$radiusAddr secret=$radiusSecret src-address=$radiusSrc \
    timeout=1s comment="argosisp: aaa nodo 1"
:if ($radiusAddr2 != "") do={
    /radius add service=ppp address=$radiusAddr2 secret=$radiusSecret src-address=$radiusSrc \
        timeout=1s comment="argosisp: aaa nodo 2"
}
/radius incoming set accept=yes port=3799
/ppp aaa set use-radius=yes accounting=yes interim-update=5m
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
:local dnsServidores ""
:foreach d in=($dnsV4, $dnsV6) do={
    :if ($dnsServidores = "") do={ :set dnsServidores $d } else={ :set dnsServidores ($dnsServidores . "," . $d) }
}
/ip dns set allow-remote-requests=yes servers=$dnsServidores
:put "argosisp: perfiles PPP"
:if ([:len [/interface list find where name="suspendidos"]] = 0) do={
    /interface list add name=suspendidos comment="argosisp: interfaces PPP suspendidas"
}
/ppp profile set [find where name="default"] local-address=$pppLocalV4 remote-address=$poolV4 \
    remote-ipv6-prefix-pool=$poolV6Enlace dhcpv6-pd-pool=$poolV6Pd use-ipv6=yes \
    dns-server=$pppLocalV4 change-tcp-mss=yes
:if ([:len [/ppp profile find where name="suspendido"]] = 0) do={
    /ppp profile add name=suspendido comment="argosisp: servicio suspendido"
}
/ppp profile set [find where name="suspendido"] local-address=$pppLocalV4 remote-address=$poolV4 \
    remote-ipv6-prefix-pool=$poolV6Enlace dhcpv6-pd-pool=$poolV6Pd use-ipv6=yes \
    dns-server=$pppLocalV4 change-tcp-mss=yes rate-limit=$suspRateLimit \
    address-list=suspendidos interface-list=suspendidos
:put "argosisp: PPPoE server"
:if ([:len [/interface pppoe-server server find where service-name=$pppoeServicio]] = 0) do={
    /interface pppoe-server server add service-name=$pppoeServicio interface=$labIf
}
/interface pppoe-server server set [find where service-name=$pppoeServicio] interface=$labIf \
    default-profile=default authentication=pap,chap one-session-per-host=yes \
    max-mtu=1480 max-mru=1480 keepalive-timeout=30 disabled=no
:put "argosisp: address-lists"
/ip firewall address-list add list=argos-portal address=$portalV4 comment="argosisp: portal IP"
/ip firewall address-list add list=argos-portal address=$portalFqdn comment="argosisp: portal FQDN"
/ip firewall address-list add list=argos-dns address=$pppLocalV4 comment="argosisp: DNS del router"
:foreach d in=$dnsV4 do={ /ip firewall address-list add list=argos-dns address=$d comment="argosisp: DNS" }
:foreach d in=$walledGarden do={ /ip firewall address-list add list=argos-walled address=$d comment="argosisp: walled garden" }
/ip firewall address-list add list=argos-clientes address=$clientesV4 comment="argosisp: clientes PPPoE"
:if ($wispHabilitar) do={ /ip firewall address-list add list=argos-clientes address=$wispRed comment="argosisp: clientes WISP" }
:if ($wispHabilitar && $amarreHabilitar) do={ /ip firewall address-list add list=argos-clientes address=$amarreRed comment="argosisp: clientes WISP con amarre" }
/ipv6 firewall address-list add list=argos-portal address=$portalV6 comment="argosisp: portal IP"
/ipv6 firewall address-list add list=argos-portal address=$portalFqdn comment="argosisp: portal FQDN"
:foreach d in=$dnsV6 do={ /ipv6 firewall address-list add list=argos-dns address=$d comment="argosisp: DNS" }
:foreach d in=$walledGarden do={ /ipv6 firewall address-list add list=argos-walled address=$d comment="argosisp: walled garden" }
:foreach d in=$clientesV6 do={ /ipv6 firewall address-list add list=argos-clientes address=$d comment="argosisp: clientes IPv6" }
:if ($wispHabilitar && $wispV6Red != "") do={ /ipv6 firewall address-list add list=argos-clientes address=$wispV6Red comment="argosisp: clientes WISP IPv6" }
:put "argosisp: firewall IPv4"
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
add chain=forward action=jump jump-target=ppp comment="argosisp:top Filter-Id de RADIUS/CoA"
add chain=forward connection-state=established,related src-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (subida)"
add chain=forward connection-state=established,related dst-address-list=argos-clientes action=accept comment="argosisp:top sin fasttrack: clientes con colas (bajada)"
add chain=argos-corte protocol=udp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS udp"
add chain=argos-corte protocol=tcp dst-port=53 dst-address-list=argos-dns action=accept comment="argosisp: corte DNS tcp"
add chain=argos-corte dst-address-list=argos-portal action=accept comment="argosisp: corte portal"
add chain=argos-corte dst-address-list=argos-walled action=accept comment="argosisp: corte walled garden"
add chain=argos-corte protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte TCP reset"
add chain=argos-corte action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte rechazo del resto"
add chain=argos-corte-in protocol=udp dst-port=53 action=accept comment="argosisp: corte-in DNS udp"
add chain=argos-corte-in protocol=tcp dst-port=53 action=accept comment="argosisp: corte-in DNS tcp"
add chain=argos-corte-in protocol=icmp action=accept comment="argosisp: corte-in ICMP"
add chain=argos-corte-in protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte-in TCP reset"
add chain=argos-corte-in action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte-in rechazo del resto"
add chain=argos-activo action=return comment="argosisp: activo (Filter-Id neutro)"
/ip firewall nat
add chain=dstnat src-address-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por address-list"
add chain=dstnat in-interface-list=suspendidos action=jump jump-target=argos-corte-nat comment="argosisp:top corte NAT por interface-list"
add chain=argos-corte-nat dst-address-list=argos-portal action=return comment="argosisp: corte-nat portal sin NAT"
add chain=argos-corte-nat dst-address-list=argos-walled action=return comment="argosisp: corte-nat walled garden sin NAT"
add chain=argos-corte-nat protocol=tcp dst-port=80 action=dst-nat to-addresses=$portalV4 to-ports=$portalCortePuerto comment="argosisp: corte-nat HTTP a /corte"
add chain=srcnat src-address-list=argos-clientes out-interface=$wanIf action=masquerade comment="argosisp: NAT de clientes del laboratorio"
:put "argosisp: firewall IPv6"
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
add chain=argos-corte protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte TCP reset"
add chain=argos-corte action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte rechazo del resto"
add chain=argos-corte-in protocol=icmpv6 action=accept comment="argosisp: corte-in ICMPv6"
add chain=argos-corte-in protocol=udp dst-port=547 action=accept comment="argosisp: corte-in DHCPv6"
add chain=argos-corte-in protocol=udp dst-port=53 action=accept comment="argosisp: corte-in DNS udp"
add chain=argos-corte-in protocol=tcp dst-port=53 action=accept comment="argosisp: corte-in DNS tcp"
add chain=argos-corte-in protocol=tcp action=reject reject-with=tcp-reset comment="argosisp: corte-in TCP reset"
add chain=argos-corte-in action=reject reject-with=icmp-admin-prohibited comment="argosisp: corte-in rechazo del resto"
add chain=argos-activo action=return comment="argosisp: activo (Filter-Id neutro)"
:if ($wispHabilitar) do={
    :put "argosisp: WISP"
    /ip address remove [find where comment="argosisp: gateway WISP"]
    /ip address add address=$wispGateway interface=$wispIf comment="argosisp: gateway WISP"
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
    :foreach lista in=($plan, ($plan . "-limitado")) do={
        /ip firewall mangle add chain=forward dst-address-list=$lista action=mark-packet new-packet-mark=($lista . "-bajada") passthrough=no comment=("argosisp: ejemplo marca " . $lista . " bajada")
        /ip firewall mangle add chain=forward src-address-list=$lista action=mark-packet new-packet-mark=($lista . "-subida") passthrough=no comment=("argosisp: ejemplo marca " . $lista . " subida")
        /ipv6 firewall mangle add chain=forward dst-address-list=$lista action=mark-packet new-packet-mark=($lista . "-bajada") passthrough=no comment=("argosisp: ejemplo marca " . $lista . " bajada")
        /ipv6 firewall mangle add chain=forward src-address-list=$lista action=mark-packet new-packet-mark=($lista . "-subida") passthrough=no comment=("argosisp: ejemplo marca " . $lista . " subida")
    }
}
:put "argosisp: servicios y puertos de gestion"
:foreach a in=$adminIps do={
    /ip firewall address-list add list=argosisp-admin address=$a comment="argosisp:gestion administrador"
}
:local gestionDesde $wgRed
:foreach a in=$adminIps do={ :set gestionDesde ($gestionDesde . "," . $a) }
:foreach s in={"telnet";"ftp";"www";"api";"api-ssl"} do={ /ip service set [find where name=$s] disabled=yes }
:foreach s in={"www-ssl";"winbox";"ssh"} do={ /ip service set [find where name=$s] address=$gestionDesde }
/tool bandwidth-server set enabled=no
/tool romon set enabled=no
/tool mac-server set allowed-interface-list=none
:local pWww [/ip service get [find where name="www-ssl"] port]
:local pWinbox [/ip service get [find where name="winbox"] port]
:local pSsh [/ip service get [find where name="ssh"] port]
:local pGestion ""
:foreach s in={"telnet";"ftp";"www";"ssh";"www-ssl";"api";"api-ssl";"winbox"} do={
    :local p [/ip service get [find where name=$s] port]
    :if ($pGestion = "") do={ :set pGestion $p } else={ :if (!([:tostr $pGestion] ~ ("(^|,)" . $p . "(,|\$)"))) do={ :set pGestion ($pGestion . "," . $p) } }
}
/ip firewall filter
add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=udp dst-port=3799 action=accept comment="argosisp:gestion CoA desde ArgosIsp"
add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=tcp dst-port=$pWww action=accept comment="argosisp:gestion API REST desde ArgosIsp"
add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=icmp action=accept comment="argosisp:gestion ping desde ArgosIsp"
add chain=input src-address-list=argosisp-admin protocol=tcp dst-port=($pWww . "," . $pWinbox . "," . $pSsh) action=accept comment="argosisp:gestion administradores"
add chain=input connection-state=new protocol=tcp dst-port=$pGestion action=drop comment="argosisp:gestion resto de la gestion"
add chain=input connection-state=new protocol=udp dst-port=3799 action=drop comment="argosisp:gestion CoA de otro origen"
add chain=input in-interface=$wgIf connection-state=new action=drop comment="argosisp:gestion nada mas por el tunel"
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
:local destinoGestion
:foreach id in=[/ip firewall filter find where dynamic=no] do={
    :if ([:typeof $destinoGestion] = "nothing" && !([:tostr [/ip firewall filter get $id comment]] ~ "^argosisp:gestion")) do={ :set destinoGestion $id }
}
:if ([:typeof $destinoGestion] != "nothing") do={
    :foreach id in=[/ip firewall filter find where comment~"^argosisp:gestion"] do={ /ip firewall filter move $id destination=$destinoGestion }
}
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
:put ("argosisp: clave publica del router: " . $wgPub)
:if ($registrado) do={
    :put "argosisp: listo. En el panel, el router pasa a 'conectado' cuando ArgosIsp ve el tunel (menos de un minuto)."
} else={
    :delay 5s
    :local hs [/interface wireguard peers get [find where interface=$wgIf comment~"^argosisp:conexion"] last-handshake]
    :if ([:typeof $hs] = "time" && $hs < 3m) do={
        :put "argosisp: listo. El tunel ya estaba registrado y esta conectado."
    } else={
        :put "argosisp: FALTA un paso: en el panel, ficha del router -> Conexion -> 'Pegar clave publica' y pega la clave de arriba (o genera un script nuevo si el token vencio)."
    }
}
:log info ("argosisp: script de conexion aplicado (router " . $routerId . ")")
}