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

# CA propia del router: se crea una vez y se exporta a argosisp-ca.crt para que ArgosIsp verifique el
# certificado de www-ssl (el script de conexión la manda en el registro). El certificado del servidor
# (argosisp-www) y su uso en www-ssl van en comun-certificado.rsc: en el script de conexión, después
# del registro.
:if ([:len [/certificate find where name="argosisp-ca"]] = 0) do={
    /certificate add name=argosisp-ca common-name=$apiCaNombre key-usage=key-cert-sign,crl-sign days-valid=3650 key-size=2048
    /certificate sign argosisp-ca
}
/certificate export-certificate argosisp-ca file-name=argosisp-ca
