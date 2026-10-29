# ArgosIsp · script de conexión del router (RouterOS 7)
#
# AVISO: este archivo lleva secretos (la clave del usuario de la API y el secreto RADIUS). Úsalo,
# no lo guardes ni lo mandes por chat. El token de registro vale 24 h y una sola vez.
#
# Qué hace (contratos/conexion-routers.md):
#   1. Comprueba RouterOS 7, crea la interfaz WireGuard "wg-argos" y lee su clave pública (la
#      privada nunca sale del router).
#   2. Crea la CA y el certificado de www-ssl, el grupo "argosisp-api" con el mínimo de permisos
#      (read, write, api, rest-api) y el usuario "argosisp-api", que solo entra desde ArgosIsp.
#   3. Se registra en ArgosIsp con el token y agrega el servidor como peer del túnel.
#   4. Configura RADIUS y CoA hacia ArgosIsp por el túnel.
#   5. Apaga los servicios que no se usan y deja la gestión (www-ssl, Winbox, SSH) solo por el túnel
#      y desde las IPs de administración. No toca el tráfico de los clientes.
#
# Cómo usarlo: Winbox → Files → arrastra el archivo; luego New Terminal y
#   /import file-name=argosisp-conexion.rsc verbose=yes
# (o pega el contenido completo en New Terminal). Es re-ejecutable: solo borra y recrea lo que lleva
# comentario "argosisp:"; la interfaz wg-argos y su clave se conservan.
# Generado por ArgosIsp desde infra/mikrotik/piezas (no editar a mano: infra/mikrotik/armar.mjs).

{
# ============================================================================
# Variables (las llena ArgosIsp al generar el script)
# ============================================================================
:local routerId "{{router_id}}"
:local generadoEn "{{generado_en}}"
# URL pública de la API de ArgosIsp y token de registro (un solo uso, 24 h)
:local argosUrl "{{argos_url}}"
:local token "{{token}}"
# Verificación del certificado de ArgosIsp al registrarse: "yes-without-crl" usa los certificados
# raíz incluidos en RouterOS (7.19 o superior). En versiones anteriores, importa la CA de ArgosIsp
# o pega la clave a mano (el script lo explica si el registro falla).
:local fetchVerificar "yes-without-crl"

# --- Túnel WireGuard ---
:local wgIf "wg-argos"
:local wgPuertoLocal 13231
:local wgMtu 1420
# IP de este router en el túnel (una /32 fija) y del servidor ArgosIsp (la .1 de la red)
:local wgIp "{{wg_ip}}"
:local wgServidorIp "{{wg_servidor_ip}}"
:local wgRed "{{wg_red}}"
# Datos del servidor por si el registro no responde (los mismos que devuelve el registro)
:local wgServidorPub "{{wg_servidor_public_key}}"
:local wgServidorEndpoint "{{wg_servidor_endpoint}}"
:local wgServidorPuerto [:tonum "{{wg_servidor_puerto}}"]

# --- RADIUS y CoA (por el túnel) ---
:local radiusAddr $wgServidorIp
:local radiusAddr2 ""
:local radiusSrc $wgIp
:local radiusSecret "{{radius_secret}}"

# --- Usuario de la API REST ---
:local apiUsuario "argosisp-api"
:local apiPassword "{{api_password}}"
:local apiDesde ($wgServidorIp . "/32")
:local apiNombre "{{api_nombre}}"
:local apiIp $wgIp
:local apiCaNombre "ArgosIsp CA del router {{router_id}}"
:local apiSoloHttps true

# --- Gestión ---
# IPs o redes de los administradores (lista argosisp-admin). Vacío = gestión solo por el túnel
# (y MAC-Winbox en la red local).
:local adminIps [:toarray "{{admin_ips}}"]

# ============================================================================
# C0. Requisitos
# ============================================================================
:local rosVersion [/system resource get version]
:local rosMayor [:tonum [:pick $rosVersion 0 [:find $rosVersion "."]]]
:if ($rosMayor < 7) do={ :error ("argosisp: hace falta RouterOS 7 (este router tiene " . $rosVersion . ")") }
:put ("argosisp: RouterOS " . $rosVersion . ", router " . $routerId . ", script del " . $generadoEn)
:if ([:len $adminIps] = 0) do={
    :put "argosisp: AVISO sin IPs de administración: Winbox y SSH quedarán solo por el túnel y por MAC-Winbox en la red local"
}

