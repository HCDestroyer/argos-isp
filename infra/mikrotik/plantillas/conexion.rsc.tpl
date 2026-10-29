# ArgosIsp - script de conexion del router (RouterOS 7)
#
# AVISO: este archivo lleva secretos (la clave del usuario de la API y el secreto RADIUS). Usalo,
# no lo guardes ni lo mandes por chat. El token de registro vale 24 h y una sola vez.
#
# Que hace (contratos/conexion-routers.md):
#   1. Comprueba RouterOS 7, crea la interfaz WireGuard "wg-argos" y lee su clave publica (la
#      privada nunca sale del router).
#   2. Crea la CA y el certificado de www-ssl, el grupo "argosisp-api" con el minimo de permisos
#      (read, write, api, rest-api) y el usuario "argosisp-api", que solo entra desde ArgosIsp.
#   3. Se registra en ArgosIsp con el token y agrega el servidor como peer del tunel.
#   4. Configura RADIUS y CoA hacia ArgosIsp por el tunel.
#   5. Apaga los servicios que no se usan y deja la gestion (www-ssl, Winbox, SSH) solo por el tunel
#      y desde las IPs de administracion. No toca el trafico de los clientes.
#
# Como usarlo: Winbox -> Files -> arrastra el archivo; luego New Terminal y
#   /import file-name=argosisp-conexion.rsc verbose=yes
# (o pega el contenido completo en New Terminal). Es re-ejecutable: solo borra y recrea lo que lleva
# comentario "argosisp:"; la interfaz wg-argos y su clave se conservan.
# Generado por ArgosIsp desde infra/mikrotik/piezas (no editar a mano: infra/mikrotik/armar.mjs).

{
:local routerId "{{router_id}}"
:local generadoEn "{{generado_en}}"
:local argosUrl "{{argos_url}}"
:local token "{{token}}"
:local fetchVerificar "yes-without-crl"
:local wgIf "wg-argos"
:local wgPuertoLocal 13231
:local wgMtu 1420
:local wgIp "{{wg_ip}}"
:local wgServidorIp "{{wg_servidor_ip}}"
:local wgRed "{{wg_red}}"
:local wgServidorPub "{{wg_servidor_public_key}}"
:local wgServidorEndpoint "{{wg_servidor_endpoint}}"
:local wgServidorPuerto [:tonum "{{wg_servidor_puerto}}"]
:local radiusAddr $wgServidorIp
:local radiusAddr2 ""
:local radiusSrc $wgIp
:local radiusSecret "{{radius_secret}}"
:local apiUsuario "argosisp-api"
:local apiPassword "{{api_password}}"
:local apiDesde ($wgServidorIp . "/32")
:local apiNombre "{{api_nombre}}"
:local apiIp $wgIp
:local apiCaNombre "ArgosIsp CA del router {{router_id}}"
:local apiSoloHttps true
:local adminIps [:toarray "{{admin_ips}}"]
:local rosVersion [/system resource get version]
:local rosMayor [:tonum [:pick $rosVersion 0 [:find $rosVersion "."]]]
:if ($rosMayor < 7) do={ :error ("argosisp: hace falta RouterOS 7 (este router tiene " . $rosVersion . ")") }
:put ("argosisp: RouterOS " . $rosVersion . ", router " . $routerId . ", script del " . $generadoEn)
:if ([:len $adminIps] = 0) do={
    :put "argosisp: AVISO sin IPs de administracion: Winbox y SSH quedaran solo por el tunel y por MAC-Winbox en la red local"
}
:put "argosisp: limpiando la conexion anterior"
/ip firewall filter remove [find where comment~"^argosisp:gestion"]
/ip firewall address-list remove [find where dynamic=no comment~"^argosisp:gestion"]
/radius remove [find where comment~"^argosisp: aaa nodo"]
:put "argosisp: tunel WireGuard"
:if ([:len [/interface wireguard find where name=$wgIf]] = 0) do={
    /interface wireguard add name=$wgIf listen-port=$wgPuertoLocal mtu=$wgMtu comment="argosisp:conexion tunel a ArgosIsp"
}
/interface wireguard set [find where name=$wgIf] mtu=$wgMtu disabled=no
:local wgPub [/interface wireguard get [find where name=$wgIf] public-key]
:local wgDir [/ip address find where comment="argosisp:conexion tunel"]
:if ([:len $wgDir] = 0) do={
    /ip address add address=($wgIp . "/32") network=$wgServidorIp interface=$wgIf comment="argosisp:conexion tunel"
} else={
    /ip address set $wgDir address=($wgIp . "/32") network=$wgServidorIp interface=$wgIf disabled=no
}
:put "argosisp: usuario de API REST"
:if ([:len [/user group find where name="argosisp-api"]] = 0) do={
    /user group add name=argosisp-api policy=read,write,api,rest-api comment="argosisp: API REST de ArgosIsp"
}
/user group set [find where name="argosisp-api"] policy=read,write,api,rest-api
:if ($apiPassword = "CAMBIAR") do={
    :put "argosisp: AVISO apiPassword sin cambiar: no se crea el usuario de API"
} else={
    :if ([:len [/user find where name=$apiUsuario]] = 0) do={
        /user add name=$apiUsuario group=argosisp-api password=$apiPassword address=$apiDesde comment="argosisp: API REST de ArgosIsp"
    } else={
        /user set [find where name=$apiUsuario] group=argosisp-api password=$apiPassword address=$apiDesde disabled=no
    }
}
:if ([:len [/certificate find where name="argosisp-ca"]] = 0) do={
    /certificate add name=argosisp-ca common-name=$apiCaNombre key-usage=key-cert-sign,crl-sign days-valid=3650 key-size=2048
    /certificate sign argosisp-ca
}
:local wwwCert [/certificate find where name="argosisp-www"]
:if ([:len $wwwCert] > 0) do={
    :if (!([:tostr [/certificate get $wwwCert subject-alt-name]] ~ ("IP:" . $apiIp . "(,|\$)"))) do={
        :put "argosisp: el certificado de www-ssl no tiene la IP actual: se regenera"
        /ip service set www-ssl certificate=none
        /certificate remove $wwwCert
    }
}
:if ([:len [/certificate find where name="argosisp-www"]] = 0) do={
    /certificate add name=argosisp-www common-name=$apiNombre subject-alt-name=("DNS:" . $apiNombre . ",IP:" . $apiIp) key-usage=digital-signature,key-encipherment,tls-server days-valid=825 key-size=2048
    /certificate sign argosisp-www ca=argosisp-ca
}
/certificate export-certificate argosisp-ca file-name=argosisp-ca
/ip service set www-ssl certificate=argosisp-www tls-version=only-1.2 address=$apiDesde disabled=no
:if ($apiSoloHttps) do={
    /ip service set www disabled=yes
    /ip service set api disabled=yes
    /ip service set api-ssl disabled=yes
}
:put "argosisp: registrando el router en ArgosIsp"
:local caPem ""
:do {
    :delay 1s
    :set caPem [/file get [find where name="argosisp-ca.crt"] contents]
} on-error={ :put "argosisp: AVISO no pude leer argosisp-ca.crt (ArgosIsp no podra verificar el certificado del router)" }
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
    :if (($d->"ip_tunel") != $wgIp) do={ :error ("ArgosIsp asigno " . ($d->"ip_tunel") . " y el script trae " . $wgIp . ": genera el script de nuevo") }
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
:put "argosisp: RADIUS"
/radius add service=ppp address=$radiusAddr secret=$radiusSecret src-address=$radiusSrc \
    timeout=1s comment="argosisp: aaa nodo 1"
:if ($radiusAddr2 != "") do={
    /radius add service=ppp address=$radiusAddr2 secret=$radiusSecret src-address=$radiusSrc \
        timeout=1s comment="argosisp: aaa nodo 2"
}
/radius incoming set accept=yes port=3799
/ppp aaa set use-radius=yes accounting=yes interim-update=5m
:put "argosisp: servicios y puertos de gestion"
:foreach a in=$adminIps do={
    /ip firewall address-list add list=argosisp-admin address=$a comment="argosisp:gestion administrador"
}
:local gestionDesde $wgRed
:foreach a in=$adminIps do={ :set gestionDesde ($gestionDesde . "," . $a) }
:foreach s in={"telnet";"ftp";"www";"api";"api-ssl"} do={ /ip service set [find where name=$s] disabled=yes }
:foreach s in={"www-ssl";"winbox";"ssh"} do={ /ip service set [find where name=$s] address=$gestionDesde }
/tool bandwidth-server set enabled=no
/tool romon set enabled=no
/tool mac-server set allowed-interface-list=none
:local pWww [/ip service get [find where name="www-ssl"] port]
:local pWinbox [/ip service get [find where name="winbox"] port]
:local pSsh [/ip service get [find where name="ssh"] port]
:local pGestion ""
:foreach s in={"telnet";"ftp";"www";"ssh";"www-ssl";"api";"api-ssl";"winbox"} do={
    :local p [/ip service get [find where name=$s] port]
    :if ($pGestion = "") do={ :set pGestion $p } else={ :if (!([:tostr $pGestion] ~ ("(^|,)" . $p . "(,|\$)"))) do={ :set pGestion ($pGestion . "," . $p) } }
}
/ip firewall filter
add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=udp dst-port=3799 action=accept comment="argosisp:gestion CoA desde ArgosIsp"
add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=tcp dst-port=$pWww action=accept comment="argosisp:gestion API REST desde ArgosIsp"
add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=icmp action=accept comment="argosisp:gestion ping desde ArgosIsp"
add chain=input src-address-list=argosisp-admin protocol=tcp dst-port=($pWww . "," . $pWinbox . "," . $pSsh) action=accept comment="argosisp:gestion administradores"
add chain=input connection-state=new protocol=tcp dst-port=$pGestion action=drop comment="argosisp:gestion resto de la gestion"
add chain=input connection-state=new protocol=udp dst-port=3799 action=drop comment="argosisp:gestion CoA de otro origen"
add chain=input in-interface=$wgIf connection-state=new action=drop comment="argosisp:gestion nada mas por el tunel"
:local destinoGestion
:foreach id in=[/ip firewall filter find where dynamic=no] do={
    :if ([:typeof $destinoGestion] = "nothing" && !([:tostr [/ip firewall filter get $id comment]] ~ "^argosisp:gestion")) do={ :set destinoGestion $id }
}
:if ([:typeof $destinoGestion] != "nothing") do={
    :foreach id in=[/ip firewall filter find where comment~"^argosisp:gestion"] do={ /ip firewall filter move $id destination=$destinoGestion }
}
:put ("argosisp: clave publica del router: " . $wgPub)
:if ($registrado) do={
    :put "argosisp: listo. En el panel, el router pasa a 'conectado' cuando ArgosIsp ve el tunel (menos de un minuto)."
} else={
    :delay 5s
    :local hs [/interface wireguard peers get [find where interface=$wgIf comment~"^argosisp:conexion"] last-handshake]
    :if ([:typeof $hs] = "time" && $hs < 3m) do={
        :put "argosisp: listo. El tunel ya estaba registrado y esta conectado."
    } else={
        :put "argosisp: FALTA un paso: en el panel, ficha del router -> Conexion -> 'Pegar clave publica' y pega la clave de arriba (o genera un script nuevo si el token vencio)."
    }
}
:log info ("argosisp: script de conexion aplicado (router " . $routerId . ")")
}