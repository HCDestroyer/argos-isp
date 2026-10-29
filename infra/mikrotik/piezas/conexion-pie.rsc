# ============================================================================
# C6. Resultado
# ============================================================================
:put ("argosisp: clave pública del router: " . $wgPub)
:if ($registrado) do={
    :put "argosisp: listo. En el panel, el router pasa a «conectado» cuando ArgosIsp ve el túnel (menos de un minuto)."
} else={
    # Re-ejecución con el token ya usado: si el túnel tiene handshake reciente, ya está registrado
    :delay 5s
    :local hs [/interface wireguard peers get [find where interface=$wgIf comment~"^argosisp:conexion"] last-handshake]
    :if ([:typeof $hs] = "time" && $hs < 3m) do={
        :put "argosisp: listo. El túnel ya estaba registrado y está conectado."
    } else={
        :put "argosisp: FALTA un paso: en el panel, ficha del router → Conexión → «Pegar clave pública» y pega la clave de arriba (o genera un script nuevo si el token venció)."
    }
}
:log info ("argosisp: script de conexión aplicado (router " . $routerId . ")")
}
