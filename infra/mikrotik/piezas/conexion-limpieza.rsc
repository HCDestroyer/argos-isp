# ============================================================================
# C1. Limpieza de lo que dejó una ejecución anterior de este script
# ============================================================================
# Solo los /radius de ArgosIsp. El peer y la dirección del túnel se actualizan en sitio (sin cortar
# el túnel) y la interfaz se conserva. Las reglas "argosisp:gestion", la lista argosisp-admin y el
# address= de los servicios NO se tocan aquí: C4 los rehace solo si el túnel y el registro
# funcionaron; si no, la gestión se queda como estaba (contratos/conexion-routers.md §2).
:put "argosisp: limpiando la conexión anterior"
/radius remove [find where comment~"^argosisp: aaa nodo"]
