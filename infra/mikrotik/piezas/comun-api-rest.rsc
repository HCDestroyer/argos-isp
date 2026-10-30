# ============================================================================
# 12. Usuario de la API REST con permisos mínimos y HTTPS (www-ssl)
# ============================================================================
# Grupo argosisp-api: read, write, api y rest-api, el mínimo probado en CHR 7.24.5. La REST corre
# sobre la API: sin "api" responde "not allowed" y sin "rest-api", 401; el SERVICIO api (8728)
# queda apagado igual. Sin ftp, ssh, telnet, winbox, web, policy, password, sensitive, reboot,
# sniff, test, romon ni local: no puede crear ni cambiar usuarios, reiniciar ni leer secretos, y
# solo entra desde apiDesde (infra/mikrotik/README.md, "Permisos mínimos de la API").
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

# Certificado: CA propia del laboratorio y certificado del servidor con CN = apiNombre y SAN =
# DNS:apiNombre, IP:apiIp. Se crean una vez (para regenerarlos, bórralos y reaplica). La CA se
# exporta a argosisp-ca.crt para que ArgosIsp verifique el certificado del router.
:if ([:len [/certificate find where name="argosisp-ca"]] = 0) do={
    /certificate add name=argosisp-ca common-name=$apiCaNombre key-usage=key-cert-sign,crl-sign days-valid=3650 key-size=2048
    /certificate sign argosisp-ca
}
# Si el certificado ya existe con otra IP (p. ej. el router pasó de la LAN al túnel), se regenera.
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
# address= es available-from en RouterOS 7.17+ (acepta los dos nombres; 7.16 y anteriores solo address)
/ip service set www-ssl certificate=argosisp-www tls-version=only-1.2 address=$apiDesde disabled=no
:if ($apiSoloHttps) do={
    /ip service set www disabled=yes
    /ip service set api disabled=yes
    /ip service set api-ssl disabled=yes
}

