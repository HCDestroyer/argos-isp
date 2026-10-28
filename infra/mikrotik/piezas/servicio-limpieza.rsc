# ============================================================================
# 0. Limpieza de lo aplicado antes por este script
# ============================================================================
:put "argosisp: limpiando configuración anterior"
# Solo lo de este script ("argosisp: " con espacio y "argosisp:top "): las entradas de ArgosIsp
# ("argosisp:servicio:<id>" en suspendidos o argosisp-plan-<id>, colas "argosisp:plan:<id>") quedan.
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
# /queue type no tiene comentario: se borran por nombre solo los del ejemplo
/queue type remove [find where name~("^argosisp-plan-" . $arbolPlanId . "-")]
/system script remove [find where name~"^argosisp-"]

