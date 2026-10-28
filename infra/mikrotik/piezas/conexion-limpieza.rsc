# ============================================================================
# C1. Limpieza de lo que dejó una ejecución anterior de este script
# ============================================================================
# Solo "argosisp:gestion ..." (firewall y lista argosisp-admin) y los /radius de ArgosIsp. El peer
# y la dirección del túnel se actualizan en sitio (sin cortar el túnel), y la interfaz se conserva.
:put "argosisp: limpiando la conexión anterior"
/ip firewall filter remove [find where comment~"^argosisp:gestion"]
/ip firewall address-list remove [find where dynamic=no comment~"^argosisp:gestion"]
/radius remove [find where comment~"^argosisp: aaa nodo"]

