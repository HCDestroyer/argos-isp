# ============================================================================
# C4. Puertos de gestión (contratos/conexion-routers.md §2): nunca dejar fuera al administrador
# ============================================================================
# 1. IPs de las sesiones abiertas (/user active, menos argosisp-api): la que corre el script está
#    entre ellas. RouterOS no marca cuál es la sesión actual, así que se conservan todas las que
#    tienen IP (una de MAC-Winbox o de consola no tiene: esas no pasan por la IP).
# 2. Espera el handshake del túnel (hasta 40 s; 10 s si el registro falló).
# 3. Solo si el registro respondió OK Y el túnel tiene handshake se rehace la gestión: servicios
#    apagados, address= de www-ssl/winbox/ssh y reglas "argosisp:gestion" (las de drop incluidas).
#    Si algo falló no se toca nada: la gestión se queda como estaba (abierta en un router nuevo, o
#    como la dejó la ejecución anterior) y el resultado (C6) dice qué falló y cómo reintentar.
# Las reglas solo tocan conexiones nuevas hacia el propio router: no tocan el tráfico de los
# clientes ni la sesión de Winbox abierta. Por el túnel no se acepta nada más (el router inicia el
# túnel: no hace falta abrir su puerto UDP de WireGuard hacia internet).
:put "argosisp: servicios y puertos de gestión"
:local sesionV4 [:toarray ""]
:local sesionV6 [:toarray ""]
:foreach u in=[/user active find where name!=$apiUsuario] do={
    :local a [:tostr [/user active get $u address]]
    :if ([:typeof [:toip $a]] = "ip" && [:len [:find $sesionV4 $a]] = 0) do={ :set sesionV4 ($sesionV4, $a) }
    :if ([:typeof [:toip6 $a]] = "ip6" && [:len [:find $sesionV6 $a]] = 0) do={ :set sesionV6 ($sesionV6, $a) }
}

:local tunelOk false
:local intentos 20
:if (!$registrado) do={ :set intentos 5 }
:put "argosisp: esperando el handshake del túnel"
:for i from=1 to=$intentos do={
    :if (!$tunelOk) do={
        :local hs [/interface wireguard peers get [find where interface=$wgIf comment~"^argosisp:conexion"] last-handshake]
        :if ([:typeof $hs] = "time" && $hs < 3m) do={ :set tunelOk true } else={ :delay 2s }
    }
}

:local restringir ($registrado && $tunelOk)
:local gestionAntes ([:len [/ip firewall filter find where comment~"^argosisp:gestion"]] > 0)
:if ($restringir) do={
    # Se borra lo de la ejecución anterior y se rehace (sin drop en medio: primero se borra todo)
    /ip firewall filter remove [find where comment~"^argosisp:gestion"]
    /ip firewall address-list remove [find where dynamic=no comment~"^argosisp:gestion"]
    :local gestionDesde $wgRed
    :foreach a in=$adminIps do={
        :set gestionDesde ($gestionDesde . "," . $a)
        :if (!($a ~ ":") && [:len [/ip firewall address-list find where list=argosisp-admin address=$a]] = 0) do={
            /ip firewall address-list add list=argosisp-admin address=$a comment="argosisp:gestion administrador"
        }
    }
    :foreach a in=$sesionV4 do={
        :if ([:len [/ip firewall address-list find where list=argosisp-admin address=$a]] = 0) do={
            /ip firewall address-list add list=argosisp-admin address=$a comment="argosisp:gestion sesion que corrio el script"
            :set gestionDesde ($gestionDesde . "," . $a)
        }
    }
    :foreach a in=$sesionV6 do={ :set gestionDesde ($gestionDesde . "," . $a) }

    # Servicios: apagados los que ArgosIsp no usa; www-ssl, winbox y ssh solo desde el túnel, los
    # admins y las sesiones abiertas. address= (desde 7.17 RouterOS lo muestra como available-from y
    # acepta los dos nombres).
    :foreach s in={"telnet";"ftp";"www";"api";"api-ssl"} do={ /ip service set $s disabled=yes }
    :foreach s in={"www-ssl";"winbox";"ssh"} do={ /ip service set $s address=$gestionDesde }
    /tool bandwidth-server set enabled=no
    /tool romon set enabled=no
    # MAC-Telnet apagado; MAC-Winbox se deja (solo funciona en la red local y evita quedarse fuera)
    /tool mac-server set allowed-interface-list=none

    :local pWww [/ip service get www-ssl port]
    :local pWinbox [/ip service get winbox port]
    :local pSsh [/ip service get ssh port]
    :local pGestion ""
    :foreach s in={"telnet";"ftp";"www";"ssh";"www-ssl";"api";"api-ssl";"winbox"} do={
        :local p [/ip service get $s port]
        :if ($pGestion = "") do={ :set pGestion $p } else={ :if (!([:tostr $pGestion] ~ ("(^|,)" . $p . "(,|\$)"))) do={ :set pGestion ($pGestion . "," . $p) } }
    }

    /ip firewall filter add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=udp dst-port=3799 action=accept comment="argosisp:gestion CoA desde ArgosIsp"
    /ip firewall filter add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=tcp dst-port=$pWww action=accept comment="argosisp:gestion API REST desde ArgosIsp"
    /ip firewall filter add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=icmp action=accept comment="argosisp:gestion ping desde ArgosIsp"
    /ip firewall filter add chain=input src-address-list=argosisp-admin protocol=tcp dst-port=($pWww . "," . $pWinbox . "," . $pSsh) action=accept comment="argosisp:gestion administradores"
    /ip firewall filter add chain=input connection-state=new protocol=tcp dst-port=$pGestion action=drop comment="argosisp:gestion resto de la gestion"
    /ip firewall filter add chain=input connection-state=new protocol=udp dst-port=3799 action=drop comment="argosisp:gestion CoA de otro origen"
    /ip firewall filter add chain=input in-interface=$wgIf connection-state=new action=drop comment="argosisp:gestion nada mas por el tunel"
    :put ("argosisp: gestión restringida al túnel y a " . $gestionDesde)
} else={
    # Sin restringir: no se cambia nada. Si una ejecución anterior ya había restringido, la IP de
    # esta sesión se suma a argosisp-admin (solo abre, nunca cierra).
    :if ($gestionAntes) do={
        :foreach a in=$sesionV4 do={
            :if ([:len [/ip firewall address-list find where list=argosisp-admin address=$a]] = 0) do={
                /ip firewall address-list add list=argosisp-admin address=$a comment="argosisp:gestion sesion que corrio el script"
            }
        }
    }
}
:if (([:len $sesionV4] + [:len $sesionV6]) = 0) do={
    :put "argosisp: AVISO no hay sesiones con IP (consola o MAC-Winbox): la gestión por IP queda solo para el túnel y argosisp-admin"
} else={
    :put ("argosisp: se conserva el acceso desde las sesiones abiertas: " . [:tostr ($sesionV4, $sesionV6)])
}
