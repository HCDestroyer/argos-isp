# ArgosIsp - rescate de la gestion del router (RouterOS 7)
#
# Deshace SOLO lo "argosisp:gestion" del script de conexion: las reglas de filtro argosisp:gestion,
# la lista argosisp-admin y el address= (available-from) de www-ssl, winbox y ssh. No toca el
# tunel wg-argos, RADIUS, el usuario argosisp-api, los certificados ni el trafico de los clientes.
#
# Pegalo en una terminal que no dependa de la IP: Winbox por MAC (Neighbors -> la MAC del router ->
# Connect -> New Terminal) o la consola (serial, monitor o la consola del hipervisor). Tambien:
#   /import file-name=rescate-gestion.rsc verbose=yes
# Cada linea es independiente: si una falla, las demas se aplican igual al pegarlas.
/ip firewall filter remove [find where comment~"^argosisp:gestion"]
/ip firewall address-list remove [find where list="argosisp-admin"]
/ip service set www-ssl address=""
/ip service set winbox address=""
/ip service set ssh address=""
:put "argosisp: rescate aplicado: sin reglas argosisp:gestion y www-ssl, winbox y ssh aceptan desde cualquier IP"
