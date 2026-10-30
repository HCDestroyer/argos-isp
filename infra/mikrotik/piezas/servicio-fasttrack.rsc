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

