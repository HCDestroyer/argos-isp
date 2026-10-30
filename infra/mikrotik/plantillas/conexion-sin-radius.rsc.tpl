# ArgosIsp - script de conexion de un router SIN RADIUS (RouterOS 7, modo_seguridad = api)
#
# AVISO: este archivo lleva secretos (la clave del usuario de la API). Usalo,
# no lo guardes ni lo mandes por chat. El token de registro vale 24 h y una sola vez.
#
# Que hace (contratos/conexion-routers.md):
#   1. Comprueba RouterOS 7, crea la interfaz WireGuard "wg-argos" y lee su clave publica (la
#      privada nunca sale del router).
#   2. Crea la CA y el certificado de www-ssl, el grupo "argosisp-api" (read, write, api, rest-api y
#      sensitive: el reconciliador lee la contrasena de cada /ppp secret, contratos/pppoe-local.md,
#      seccion 2) y el usuario "argosisp-api", que solo entra desde ArgosIsp.
#   3. Se registra en ArgosIsp con el token y agrega el servidor como peer del tunel. Solo si el
#      registro responde OK pone en www-ssl el certificado firmado por argosisp-ca (si falla, muestra
#      la CA para pegarla en el panel y deja el certificado que ArgosIsp ya conoce).
#   4. Sin RADIUS: quita los /radius de ArgosIsp y deja /ppp aaa use-radius=no. Los clientes PPPoE
#      son /ppp secret locales que ArgosIsp crea, cambia y borra por la API REST
#      (contratos/pppoe-local.md); el corte es el perfil "suspendido" del secret.
#   5. Solo si el registro respondio OK y el tunel tiene handshake: apaga los servicios que no se
#      usan y deja la gestion (www-ssl, Winbox, SSH) solo por el tunel, desde las IPs de
#      administracion y desde la IP de la sesion que corre el script. Si algo fallo, la gestion se
#      queda como estaba y el script dice que fallo y como reintentar. No toca a los clientes.
#
# Si aun asi quedaste fuera: infra/mikrotik/rescate-gestion.rsc (por MAC-Winbox o por consola).
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
:local radiusAddr ""
:local radiusAddr2 ""
:local radiusSrc ""
:local apiUsuario "argosisp-api"
:local apiPassword "{{api_password}}"
:local apiDesde ($wgServidorIp . "/32")
:local apiNombre "{{api_nombre}}"
:local apiIp $wgIp
:local apiCaNombre "ArgosIsp CA del router {{router_id}}"
:local apiIpAnterior "{{api_ip_anterior}}"
:local apiSoloHttps false
:local apiCertificar false
:local apiWwwDesde ""
:local adminIps [:toarray "{{admin_ips}}"]
:local rosVersion [/system resource get version]
:local rosMayor [:tonum [:pick $rosVersion 0 [:find $rosVersion "."]]]
:if ($rosMayor < 7) do={ :error ("argosisp: hace falta RouterOS 7 (este router tiene " . $rosVersion . ")") }
:put ("argosisp: RouterOS " . $rosVersion . ", router " . $routerId . ", script del " . $generadoEn)
:if ([:len $adminIps] = 0) do={
    :put "argosisp: AVISO sin IPs de administracion: Winbox y SSH quedaran solo por el tunel, por la IP de esta sesion y por MAC-Winbox en la red local"
}
:put "argosisp: limpiando la conexion anterior"
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
/certificate export-certificate argosisp-ca file-name=argosisp-ca
/user group set [find where name="argosisp-api"] policy=read,write,api,rest-api,sensitive
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
:local motivoRegistro ""
:do {
    :set motivoRegistro "este RouterOS no tiene :serialize/:deserialize (RouterOS viejo, p. ej. 7.12)"
    :local aJson [:parse ":return [:serialize to=json value=\$1]"]
    :local deJson [:parse ":return [:deserialize from=json value=\$1]"]
    :local cuerpo [$aJson ({"token"=$token; "public_key"=$wgPub; "routeros_version"=$rosVersion; "api_ca"=$caPem})]
    :set motivoRegistro ("ArgosIsp no respondio OK en " . $argosUrl . " (sin internet o DNS, token ya usado o vencido: 410, o su certificado no se pudo verificar)")
    :local r [/tool fetch url=($argosUrl . "/api/v1/routers/conexion/registrar") http-method=post \
        http-header-field="Content-Type: application/json,Accept: application/json" http-data=$cuerpo \
        output=user as-value check-certificate=$fetchVerificar]
    :set motivoRegistro "la respuesta de ArgosIsp no es la esperada"
    :local d [$deJson ($r->"data")]
    :local s ($d->"servidor")
    :if ([:len ($s->"public_key")] != 44) do={ :error "respuesta sin servidor.public_key" }
    :if (($d->"ip_tunel") != $wgIp) do={
        :set motivoRegistro ("ArgosIsp asigno " . ($d->"ip_tunel") . " y el script trae " . $wgIp . ": genera el script de nuevo")
        :error "ip_tunel distinta"
    }
    :set srvPub ($s->"public_key")
    :set srvEndpoint ($s->"endpoint")
    :set srvPuerto [:tonum ($s->"puerto")]
    :set registrado true
    :set motivoRegistro ""
    :put "argosisp: registrado en ArgosIsp"
} on-error={
    :put ("argosisp: AVISO no se pudo registrar: " . $motivoRegistro . ". Se usan los datos del servidor que trae el script; la gestion y el certificado de www-ssl no se cambian.")
}
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
:if ($apiCertificar) do={
    :local san ("DNS:" . $apiNombre . ",IP:" . $apiIp)
    :local ips [:toarray $apiIp]
    :if ([:len $apiIpAnterior] > 0 && $apiIpAnterior != $apiIp) do={
        :set san ($san . ",IP:" . $apiIpAnterior)
        :set ips ($ips, $apiIpAnterior)
    }
    /certificate remove [find where name="argosisp-www-nuevo"]
    :local wwwCert [/certificate find where name="argosisp-www"]
    :local regenerar ([:len $wwwCert] = 0)
    :if (!$regenerar) do={
        :local sanActual [:tostr [/certificate get $wwwCert subject-alt-name]]
        :foreach ip in=$ips do={
            :if (!($sanActual ~ ("IP:" . $ip . "(,|;|\$)"))) do={ :set regenerar true }
        }
        :if ($regenerar) do={ :put ("argosisp: el certificado de www-ssl no lleva " . $san . ": se regenera (la CA se conserva)") }
    }
    :if ($regenerar) do={
        /certificate add name=argosisp-www-nuevo common-name=$apiNombre subject-alt-name=$san key-usage=digital-signature,key-encipherment,tls-server days-valid=825 key-size=2048
        /certificate sign argosisp-www-nuevo ca=argosisp-ca
        /ip service set www-ssl certificate=argosisp-www-nuevo
        /certificate remove [find where name="argosisp-www"]
        /certificate set [find where name="argosisp-www-nuevo"] name=argosisp-www
    }
    /ip service set www-ssl certificate=argosisp-www tls-version=only-1.2 disabled=no
    :if ([:len $apiWwwDesde] > 0) do={ /ip service set www-ssl address=$apiWwwDesde }
    :if ($apiSoloHttps) do={
        /ip service set www disabled=yes
        /ip service set api disabled=yes
        /ip service set api-ssl disabled=yes
    }
} else={
    :put ("argosisp: AVISO www-ssl sigue con su certificado (" . [:tostr [/ip service get www-ssl certificate]] . "): ArgosIsp no aprendio la CA del router")
}
:put "argosisp: sin RADIUS (/ppp secret locales)"
/radius remove [find where comment~"^argosisp: aaa nodo"]
/ppp aaa set use-radius=no accounting=no
:if ([:len [/radius find]] = 0) do={ /radius incoming set accept=no }
:put "argosisp: servicios y puertos de gestion"
:local sesionV4 [:toarray ""]
:local sesionV6 [:toarray ""]
:foreach u in=[/user active find where name!=$apiUsuario] do={
    :local a [:tostr [/user active get $u address]]
    :if ([:typeof [:toip $a]] = "ip" && [:len [:find $sesionV4 $a]] = 0) do={ :set sesionV4 ($sesionV4, $a) }
    :if ([:typeof [:toip6 $a]] = "ip6" && [:len [:find $sesionV6 $a]] = 0) do={ :set sesionV6 ($sesionV6, $a) }
}
:local tunelOk false
:local intentos 20
:if (!$registrado) do={ :set intentos 5 }
:put "argosisp: esperando el handshake del tunel"
:for i from=1 to=$intentos do={
    :if (!$tunelOk) do={
        :local hs [/interface wireguard peers get [find where interface=$wgIf comment~"^argosisp:conexion"] last-handshake]
        :if ([:typeof $hs] = "time" && $hs < 3m) do={ :set tunelOk true } else={ :delay 2s }
    }
}
:local restringir ($registrado && $tunelOk)
:local gestionAntes ([:len [/ip firewall filter find where comment~"^argosisp:gestion"]] > 0)
:if ($restringir) do={
    /ip firewall filter remove [find where comment~"^argosisp:gestion"]
    /ip firewall address-list remove [find where dynamic=no comment~"^argosisp:gestion"]
    :local gestionDesde $wgRed
    :foreach a in=$adminIps do={
        :set gestionDesde ($gestionDesde . "," . $a)
        :if (!($a ~ ":") && [:len [/ip firewall address-list find where list=argosisp-admin address=$a]] = 0) do={
            /ip firewall address-list add list=argosisp-admin address=$a comment="argosisp:gestion administrador"
        }
    }
    :foreach a in=$sesionV4 do={
        :if ([:len [/ip firewall address-list find where list=argosisp-admin address=$a]] = 0) do={
            /ip firewall address-list add list=argosisp-admin address=$a comment="argosisp:gestion sesion que corrio el script"
            :set gestionDesde ($gestionDesde . "," . $a)
        }
    }
    :foreach a in=$sesionV6 do={ :set gestionDesde ($gestionDesde . "," . $a) }
    :foreach s in={"telnet";"ftp";"www";"api";"api-ssl"} do={ /ip service set $s disabled=yes }
    :foreach s in={"www-ssl";"winbox";"ssh"} do={ /ip service set $s address=$gestionDesde }
    /tool bandwidth-server set enabled=no
    /tool romon set enabled=no
    /tool mac-server set allowed-interface-list=none
    :local pWww [/ip service get www-ssl port]
    :local pWinbox [/ip service get winbox port]
    :local pSsh [/ip service get ssh port]
    :local pGestion ""
    :foreach s in={"telnet";"ftp";"www";"ssh";"www-ssl";"api";"api-ssl";"winbox"} do={
        :local p [/ip service get $s port]
        :if ($pGestion = "") do={ :set pGestion $p } else={ :if (!([:tostr $pGestion] ~ ("(^|,)" . $p . "(,|\$)"))) do={ :set pGestion ($pGestion . "," . $p) } }
    }
    :if ($radiusAddr != "") do={
        /ip firewall filter add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=udp dst-port=3799 action=accept comment="argosisp:gestion CoA desde ArgosIsp"
    }
    /ip firewall filter add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=tcp dst-port=$pWww action=accept comment="argosisp:gestion API REST desde ArgosIsp"
    /ip firewall filter add chain=input in-interface=$wgIf src-address=$wgServidorIp protocol=icmp action=accept comment="argosisp:gestion ping desde ArgosIsp"
    /ip firewall filter add chain=input src-address-list=argosisp-admin protocol=tcp dst-port=($pWww . "," . $pWinbox . "," . $pSsh) action=accept comment="argosisp:gestion administradores"
    /ip firewall filter add chain=input connection-state=new protocol=tcp dst-port=$pGestion action=drop comment="argosisp:gestion resto de la gestion"
    /ip firewall filter add chain=input connection-state=new protocol=udp dst-port=3799 action=drop comment="argosisp:gestion CoA de otro origen"
    /ip firewall filter add chain=input in-interface=$wgIf connection-state=new action=drop comment="argosisp:gestion nada mas por el tunel"
    :put ("argosisp: gestion restringida al tunel y a " . $gestionDesde)
} else={
    :if ($gestionAntes) do={
        :foreach a in=$sesionV4 do={
            :if ([:len [/ip firewall address-list find where list=argosisp-admin address=$a]] = 0) do={
                /ip firewall address-list add list=argosisp-admin address=$a comment="argosisp:gestion sesion que corrio el script"
            }
        }
    }
}
:if (([:len $sesionV4] + [:len $sesionV6]) = 0) do={
    :put "argosisp: AVISO no hay sesiones con IP (consola o MAC-Winbox): la gestion por IP queda solo para el tunel y argosisp-admin"
} else={
    :put ("argosisp: se conserva el acceso desde las sesiones abiertas: " . [:tostr ($sesionV4, $sesionV6)])
}
:local destinoGestion
:foreach id in=[/ip firewall filter find where dynamic=no] do={
    :if ([:typeof $destinoGestion] = "nothing" && !([:tostr [/ip firewall filter get $id comment]] ~ "^argosisp:gestion")) do={ :set destinoGestion $id }
}
:if ([:typeof $destinoGestion] != "nothing") do={
    :foreach id in=[/ip firewall filter find where comment~"^argosisp:gestion"] do={ /ip firewall filter move $id destination=$destinoGestion }
}
:put ("argosisp: clave publica del router: " . $wgPub)
:if ($restringir) do={
    :put "argosisp: listo. Registrado, tunel con handshake y gestion restringida. En el panel el router pasa a 'conectado' en menos de un minuto."
} else={
    :put "argosisp: AVISO la gestion NO se restringio y se queda como estaba (no hay reglas de drop nuevas). Que fallo:"
    :if (!$registrado) do={ :put ("argosisp:   - registro: " . $motivoRegistro) }
    :if (!$tunelOk) do={
        :put ("argosisp:   - tunel: sin handshake con " . $srvEndpoint . ":" . $srvPuerto . "/udp. Revisa en el servidor ARGOSISP_WIREGUARD=1 y argosisp estado, que ese puerto UDP llegue desde el router (NAT, WSL, firewall) y que ArgosIsp tenga la clave publica de arriba.")
    }
    :if ($gestionAntes) do={ :put "argosisp:   La gestion sigue como la dejo la ejecucion anterior (reglas argosisp:gestion)." }
    :if (!$registrado && $tunelOk) do={
        :put "argosisp:   El tunel ya tiene handshake: el router ya estaba registrado (o se pego su clave). Para restringir la gestion, genera un script nuevo en el panel y correlo."
    }
    :if (!$registrado && !$tunelOk) do={
        :put "argosisp: FALTA un paso: en el panel, ficha del router -> Conexion -> 'Pegar clave publica' y pega la clave de arriba (o genera un script nuevo si el token vencio)."
    }
    :put "argosisp: para reintentar: corrige lo de arriba, genera un script NUEVO en el panel (el token es de un solo uso) y vuelve a correrlo. Es re-ejecutable."
}
:if (!$registrado) do={
    :if ($apiCertificar && ([:len $caPem] > 0)) do={
        :put "argosisp: www-ssl usa argosisp-www, firmado por la CA de este router, y ArgosIsp todavia no la conoce. Copiala (de BEGIN a END; tambien esta en Files: argosisp-ca.crt) y pegala en el panel: ficha del router -> Acciones -> Conexion de la API -> CA propia (PEM) -> 'Cargar una CA' (o 'Reemplazar por otra') -> Guardar conexion."
        :put $caPem
    } else={
        :put "argosisp: www-ssl conserva su certificado: ArgosIsp lo sigue verificando con la CA que ya tiene. Se cambia por argosisp-www cuando el registro funcione."
    }
}
:log info ("argosisp: script de conexion aplicado (router " . $routerId . ", registrado=" . $registrado . ", tunel=" . $tunelOk . ", gestion restringida=" . $restringir . ")")
}