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

