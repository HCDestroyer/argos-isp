# --- Usuario de la API REST ---
:local apiUsuario "argosisp-api"
:local apiPassword "{{api_password}}"
:local apiDesde ($wgServidorIp . "/32")
:local apiNombre "{{api_nombre}}"
:local apiIp $wgIp
:local apiCaNombre "ArgosIsp CA del router {{router_id}}"
# IP con que ArgosIsp llega hoy al router (host de api_url antes del túnel; vacía si no hay): va
# también en el SAN del certificado de www-ssl, que así sirve por los dos caminos mientras se migra.
:local apiIpAnterior "{{api_ip_anterior}}"
# www, api y api-ssl los apaga C4 (solo con el túnel arriba); el certificado se decide tras el
# registro (C3) y www-ssl no cambia su address= hasta C4.
:local apiSoloHttps false
:local apiCertificar false
:local apiWwwDesde ""

# --- Gestión ---
# IPs o redes de los administradores (lista argosisp-admin). Vacío = gestión solo por el túnel, por
# la IP de la sesión que corre el script y por MAC-Winbox en la red local.
:local adminIps [:toarray "{{admin_ips}}"]

# ============================================================================
# C0. Requisitos
# ============================================================================
:local rosVersion [/system resource get version]
:local rosMayor [:tonum [:pick $rosVersion 0 [:find $rosVersion "."]]]
:if ($rosMayor < 7) do={ :error ("argosisp: hace falta RouterOS 7 (este router tiene " . $rosVersion . ")") }
:put ("argosisp: RouterOS " . $rosVersion . ", router " . $routerId . ", script del " . $generadoEn)
:if ([:len $adminIps] = 0) do={
    :put "argosisp: AVISO sin IPs de administración: Winbox y SSH quedarán solo por el túnel, por la IP de esta sesión y por MAC-Winbox en la red local"
}

