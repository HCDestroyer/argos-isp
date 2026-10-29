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

