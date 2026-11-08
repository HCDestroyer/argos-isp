# ============================================================================
# 0. Limpieza de lo aplicado antes por este script
# ============================================================================
:put "argosisp: limpiando configuración anterior"
# Solo lo de este script ("argosisp: " con espacio y "argosisp:top "): las entradas de ArgosIsp
# ("argosisp:servicio:<id>" en suspendidos o argosisp-plan-<id>, colas "argosisp:plan:<id>") quedan.
:local propio "^argosisp(: |:top )"
# El drop del 3346 en input y la regla final del proxy de corte NO se borran aquí: si el proxy ya está
# encendido con el 3346 (router en modo codigo), borrarlos dejaría el 3346 abierto sin regla final
# hasta la sección 9 bis. Las secciones 8, 9 y 9 bis los actualizan en su lugar; en modo ip, la 9 bis
# primero quita el 3346 del proxy y recién después los borra.
:local reglaProxyDrop "argosisp:top proxy de corte solo redirigido"
:local reglaProxyFinal "argosisp: corte proxy sin codigo"
/ip firewall filter remove [find where comment~$propio and comment!=$reglaProxyDrop]
/ip firewall nat remove [find where comment~$propio]
/ip firewall mangle remove [find where comment~$propio]
/ip firewall address-list remove [find where dynamic=no comment~$propio]
/ipv6 firewall filter remove [find where comment~$propio and comment!=$reglaProxyDrop]
/ipv6 firewall nat remove [find where comment~$propio]
/ipv6 firewall mangle remove [find where comment~$propio]
/ipv6 firewall address-list remove [find where dynamic=no comment~$propio]
/radius remove [find where comment~$propio]
# Lo nuestro de /ip proxy access salvo la regla final; las de servicio (argosisp:servicio:<id>) quedan.
/ip proxy access remove [find where comment~$propio and comment!=$reglaProxyFinal]
/queue tree remove [find where comment~$propio]
# /queue type no tiene comentario: se borran por nombre solo los del ejemplo
/queue type remove [find where name~("^argosisp-plan-" . $arbolPlanId . "-")]
/system script remove [find where name~"^argosisp-"]

