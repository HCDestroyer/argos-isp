# ============================================================================
# C3. Registro en ArgosIsp y peer del servidor
# ============================================================================
# POST /api/v1/routers/conexion/registrar { token, public_key, routeros_version, api_ca }. ArgosIsp
# responde { router_id, ip_tunel, servidor: { public_key, endpoint, puerto, ip } }.
# :serialize y :deserialize se cargan con :parse: en un RouterOS sin ellos (o sin internet, o con el
# token ya usado) el registro falla aquí, el script sigue con los datos del servidor que ya trae y
# al final muestra la clave pública para pegarla en el panel.
:put "argosisp: registrando el router en ArgosIsp"
:local caPem ""
:do {
    :delay 1s
    :set caPem [/file get [find where name="argosisp-ca.crt"] contents]
} on-error={ :put "argosisp: AVISO no pude leer argosisp-ca.crt (ArgosIsp no podrá verificar el certificado del router)" }
:local srvPub $wgServidorPub
:local srvEndpoint $wgServidorEndpoint
:local srvPuerto $wgServidorPuerto
:local registrado false
# Qué paso falló (para el AVISO del final): se fija antes de cada paso y queda el del que falló.
:local motivoRegistro ""
:do {
    :set motivoRegistro "este RouterOS no tiene :serialize/:deserialize (RouterOS viejo, p. ej. 7.12)"
    :local aJson [:parse ":return [:serialize to=json value=\$1]"]
    :local deJson [:parse ":return [:deserialize from=json value=\$1]"]
    :local cuerpo [$aJson ({"token"=$token; "public_key"=$wgPub; "routeros_version"=$rosVersion; "api_ca"=$caPem})]
    :set motivoRegistro ("ArgosIsp no respondió OK en " . $argosUrl . " (sin internet o DNS, token ya usado o vencido: 410, o su certificado no se pudo verificar)")
    :local r [/tool fetch url=($argosUrl . "/api/v1/routers/conexion/registrar") http-method=post \
        http-header-field="Content-Type: application/json,Accept: application/json" http-data=$cuerpo \
        output=user as-value check-certificate=$fetchVerificar]
    :set motivoRegistro "la respuesta de ArgosIsp no es la esperada"
    :local d [$deJson ($r->"data")]
    :local s ($d->"servidor")
    :if ([:len ($s->"public_key")] != 44) do={ :error "respuesta sin servidor.public_key" }
    :if (($d->"ip_tunel") != $wgIp) do={
        :set motivoRegistro ("ArgosIsp asignó " . ($d->"ip_tunel") . " y el script trae " . $wgIp . ": genera el script de nuevo")
        :error "ip_tunel distinta"
    }
    :set srvPub ($s->"public_key")
    :set srvEndpoint ($s->"endpoint")
    :set srvPuerto [:tonum ($s->"puerto")]
    :set registrado true
    :set motivoRegistro ""
    :put "argosisp: registrado en ArgosIsp"
} on-error={
    :put ("argosisp: AVISO no se pudo registrar: " . $motivoRegistro . ". Se usan los datos del servidor que trae el script; la gestión y el certificado de www-ssl no se cambian.")
}

# Certificado de www-ssl (comun-certificado.rsc, la pieza que sigue): con el registro OK ArgosIsp ya
# guardó argosisp-ca; sin registro solo si www-ssl no tenía certificado o ya usaba argosisp-www
# (firmado por la misma CA). Un certificado ajeno (p. ej. el del administrador) se queda.
:local wwwActual [:tostr [/ip service get www-ssl certificate]]
:set apiCertificar ($registrado || $wwwActual = "" || $wwwActual = "none" || $wwwActual = "argosisp-www")

:local wgPeer [/interface wireguard peers find where interface=$wgIf comment~"^argosisp:conexion"]
:if ([:len $wgPeer] = 0) do={
    /interface wireguard peers add interface=$wgIf public-key=$srvPub endpoint-address=$srvEndpoint \
        endpoint-port=$srvPuerto allowed-address=($wgServidorIp . "/32") persistent-keepalive=25s \
        comment="argosisp:conexion servidor ArgosIsp"
} else={
    /interface wireguard peers set $wgPeer public-key=$srvPub endpoint-address=$srvEndpoint \
        endpoint-port=$srvPuerto allowed-address=($wgServidorIp . "/32") persistent-keepalive=25s disabled=no
}

