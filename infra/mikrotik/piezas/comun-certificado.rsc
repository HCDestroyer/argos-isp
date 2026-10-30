# ============================================================================
# 12b. Certificado de www-ssl (argosisp-www, firmado por argosisp-ca)
# ============================================================================
# CN = apiNombre y SAN = DNS:apiNombre, IP:apiIp y, si viene, IP:apiIpAnterior: la IP con que
# ArgosIsp llegaba al router antes del túnel (api_url), para que el certificado sirva por los dos
# caminos mientras se migra. Se regenera solo si le falta alguna de esas IP.
# Solo se tocan los certificados llamados argosisp-www y argosisp-www-nuevo (el temporal de la
# regeneración): los demás del router (p. ej. una CA o un certificado propio del administrador) se
# quedan. www-ssl pasa al certificado nuevo antes de borrar el viejo: nunca queda sin certificado.
# apiCertificar: en lab.rsc siempre. En el script de conexión, solo si el registro respondió OK
# (ArgosIsp ya conoce argosisp-ca) o si www-ssl no usaba un certificado ajeno: nunca se cambia el
# certificado que ArgosIsp verifica hoy por uno que no conoce (contratos/conexion-routers.md §6.2).
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
    # address= es available-from en RouterOS 7.17+ (acepta los dos nombres; 7.16 y anteriores solo address)
    /ip service set www-ssl certificate=argosisp-www tls-version=only-1.2 disabled=no
    :if ([:len $apiWwwDesde] > 0) do={ /ip service set www-ssl address=$apiWwwDesde }
    :if ($apiSoloHttps) do={
        /ip service set www disabled=yes
        /ip service set api disabled=yes
        /ip service set api-ssl disabled=yes
    }
} else={
    :put ("argosisp: AVISO www-ssl sigue con su certificado (" . [:tostr [/ip service get www-ssl certificate]] . "): ArgosIsp no aprendió la CA del router")
}
