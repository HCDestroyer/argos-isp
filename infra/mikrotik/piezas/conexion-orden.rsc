# ============================================================================
# C5. Reglas "argosisp:gestion" al inicio de input (antes de "accept established" y de las demás)
# ============================================================================
:local destinoGestion
:foreach id in=[/ip firewall filter find where dynamic=no] do={
    :if ([:typeof $destinoGestion] = "nothing" && !([:tostr [/ip firewall filter get $id comment]] ~ "^argosisp:gestion")) do={ :set destinoGestion $id }
}
:if ([:typeof $destinoGestion] != "nothing") do={
    :foreach id in=[/ip firewall filter find where comment~"^argosisp:gestion"] do={ /ip firewall filter move $id destination=$destinoGestion }
}

