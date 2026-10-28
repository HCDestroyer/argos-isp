# ============================================================================
# C4. Puertos de gestión (contratos/conexion-routers.md §2)
# ============================================================================
# Al inicio de input (sección C5): CoA, REST y ping solo desde el servidor por el túnel; Winbox, SSH y
# www-ssl también desde argosisp-admin; el resto de los puertos de gestión se descarta. Solo
# conexiones nuevas hacia el propio router: no toca el tráfico de los clientes ni la sesión de
# Winbox abierta. Por el túnel no se acepta nada más (el router inicia el túnel: no hace falta abrir
# su puerto UDP de WireGuard hacia internet).
:put "argosisp: servicios y puertos de gestión"
:foreach a in=$adminIps do={
    /ip firewall address-list add list=argosisp-admin address=$a comment="argosisp:gestion administrador"
}
:local gestionDesde $wgRed
:foreach a in=$adminIps do={ :set gestionDesde ($gestionDesde . "," . $a) }

# Servicios: apagados los que ArgosIsp no usa; www-ssl, winbox y ssh solo desde el túnel y los admins.
# address= (desde 7.17 RouterOS lo muestra como available-from y acepta los dos nombres).
:foreach s in={"telnet";"ftp";"www";"api";"api-ssl"} do={ /ip service set [find where name=$s] disabled=yes }
:foreach s in={"www-ssl";"winbox";"ssh"} do={ /ip service set [find where name=$s] address=$gestionDesde }
/tool bandwidth-server set enabled=no
/tool romon set enabled=no
# MAC-Telnet apagado; MAC-Winbox se deja (solo funciona en la red local y evita quedarse fuera)
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

