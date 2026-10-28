# ============================================================================
# 1. WireGuard (opcional)
# ============================================================================
:if ($wgHabilitar) do={
    :put "argosisp: WireGuard"
    :if ([:len [/interface wireguard find where name=$wgIf]] = 0) do={
        /interface wireguard add name=$wgIf listen-port=$wgPuertoLocal comment="argosisp: tunel al servidor"
    }
    /interface wireguard peers remove [find where comment~"^argosisp"]
    /interface wireguard peers add interface=$wgIf public-key=$wgServidorPub \
        endpoint-address=$wgServidorEndpoint endpoint-port=$wgServidorPuerto \
        allowed-address=$wgServidorRed persistent-keepalive=25s comment="argosisp: servidor"
    /ip address remove [find where comment="argosisp: wireguard"]
    /ip address add address=$wgLocalCidr interface=$wgIf comment="argosisp: wireguard"
    :put ("argosisp: clave publica del router: " . [/interface wireguard get [find where name=$wgIf] public-key])
}

