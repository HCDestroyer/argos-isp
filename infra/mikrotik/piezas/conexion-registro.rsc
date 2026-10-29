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
:do {
    :local aJson [:parse ":return [:serialize to=json value=\$1]"]
    :local deJson [:parse ":return [:deserialize from=json value=\$1]"]
    :local cuerpo [$aJson ({"token"=$token; "public_key"=$wgPub; "routeros_version"=$rosVersion; "api_ca"=$caPem})]
    :local r [/tool fetch url=($argosUrl . "/api/v1/routers/conexion/registrar") http-method=post \
        http-header-field="Content-Type: application/json,Accept: application/json" http-data=$cuerpo \
        output=user as-value check-certificate=$fetchVerificar]
    :local d [$deJson ($r->"data")]
    :local s ($d->"servidor")
    :if ([:len ($s->"public_key")] != 44) do={ :error "respuesta sin servidor.public_key" }
    :if (($d->"ip_tunel") != $wgIp) do={ :error ("ArgosIsp asignó " . ($d->"ip_tunel") . " y el script trae " . $wgIp . ": genera el script de nuevo") }
    :set srvPub ($s->"public_key")
    :set srvEndpoint ($s->"endpoint")
    :set srvPuerto [:tonum ($s->"puerto")]
    :set registrado true
    :put "argosisp: registrado en ArgosIsp"
} on-error={
    :put "argosisp: AVISO no se pudo registrar (sin internet, token usado o vencido, certificado no verificado o RouterOS sin :deserialize). Se usan los datos del servidor que trae el script."
}

:local wgPeer [/interface wireguard peers find where interface=$wgIf comment~"^argosisp:conexion"]
:if ([:len $wgPeer] = 0) do={
    /interface wireguard peers add interface=$wgIf public-key=$srvPub endpoint-address=$srvEndpoint \
        endpoint-port=$srvPuerto allowed-address=($wgServidorIp . "/32") persistent-keepalive=25s \
        comment="argosisp:conexion servidor ArgosIsp"
} else={
    /interface wireguard peers set $wgPeer public-key=$srvPub endpoint-address=$srvEndpoint \
        endpoint-port=$srvPuerto allowed-address=($wgServidorIp . "/32") persistent-keepalive=25s disabled=no
}

