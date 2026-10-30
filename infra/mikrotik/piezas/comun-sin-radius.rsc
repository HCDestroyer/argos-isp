# ============================================================================
# 6. Sin RADIUS: /ppp secret locales (contratos/pppoe-local.md)
# ============================================================================
# Router con modo_seguridad = api: ArgosIsp crea un /ppp secret por servicio (comment
# "argosisp:servicio:<id>") y lo corta con profile=suspendido + /ppp active remove. Sin RADIUS no hay
# Access-Request, accounting ni CoA: las sesiones se leen por sondeo de /ppp/active.
# use-radius=no: con yes RouterOS busca primero en /ppp secret y luego en RADIUS; con no, solo en
# los secrets locales (un cliente sin secret no entra). Los /radius de ArgosIsp se quitan; los
# ajenos (sin comentario "argosisp: aaa nodo") quedan.
:put "argosisp: sin RADIUS (/ppp secret locales)"
/radius remove [find where comment~"^argosisp: aaa nodo"]
/ppp aaa set use-radius=no accounting=no
# Sin ningún /radius, nadie debe mandar CoA a 3799
:if ([:len [/radius find]] = 0) do={ /radius incoming set accept=no }

