# ============================================================================
# C6. Resultado
# ============================================================================
# "listo" solo si el registro respondió OK y el túnel tiene handshake (la gestión quedó restringida).
# Si no, AVISO con lo que falló y cómo reintentar; la gestión se quedó como estaba.
:put ("argosisp: clave pública del router: " . $wgPub)
:if ($restringir) do={
    :put "argosisp: listo. Registrado, túnel con handshake y gestión restringida. En el panel el router pasa a «conectado» en menos de un minuto."
} else={
    :put "argosisp: AVISO la gestión NO se restringió y se queda como estaba (no hay reglas de drop nuevas). Qué falló:"
    :if (!$registrado) do={ :put ("argosisp:   - registro: " . $motivoRegistro) }
    :if (!$tunelOk) do={
        :put ("argosisp:   - túnel: sin handshake con " . $srvEndpoint . ":" . $srvPuerto . "/udp. Revisa en el servidor ARGOSISP_WIREGUARD=1 y argosisp estado, que ese puerto UDP llegue desde el router (NAT, WSL, firewall) y que ArgosIsp tenga la clave pública de arriba.")
    }
    :if ($gestionAntes) do={ :put "argosisp:   La gestión sigue como la dejó la ejecución anterior (reglas argosisp:gestion)." }
    :if (!$registrado && $tunelOk) do={
        :put "argosisp:   El túnel ya tiene handshake: el router ya estaba registrado (o se pegó su clave). Para restringir la gestión, genera un script nuevo en el panel y córrelo."
    }
    :if (!$registrado && !$tunelOk) do={
        :put "argosisp: FALTA un paso: en el panel, ficha del router -> Conexión -> «Pegar clave pública» y pega la clave de arriba (o genera un script nuevo si el token venció)."
    }
    :put "argosisp: para reintentar: corrige lo de arriba, genera un script NUEVO en el panel (el token es de un solo uso) y vuelve a correrlo. Es re-ejecutable."
}
:if (!$registrado) do={
    :if ($apiCertificar && ([:len $caPem] > 0)) do={
        :put "argosisp: www-ssl usa argosisp-www, firmado por la CA de este router, y ArgosIsp todavía no la conoce. Cópiala (de BEGIN a END; también está en Files: argosisp-ca.crt) y pégala en el panel: ficha del router -> Acciones -> Conexión de la API -> CA propia (PEM) -> «Cargar una CA» (o «Reemplazar por otra») -> Guardar conexión."
        :put $caPem
    } else={
        :put "argosisp: www-ssl conserva su certificado: ArgosIsp lo sigue verificando con la CA que ya tiene. Se cambia por argosisp-www cuando el registro funcione."
    }
}
:log info ("argosisp: script de conexión aplicado (router " . $routerId . ", registrado=" . $registrado . ", tunel=" . $tunelOk . ", gestion restringida=" . $restringir . ")")
}
