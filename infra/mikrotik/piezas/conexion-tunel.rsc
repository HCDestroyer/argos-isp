# ============================================================================
# C2. Interfaz WireGuard (la clave privada se crea aquí y no sale del router)
# ============================================================================
:put "argosisp: túnel WireGuard"
:if ([:len [/interface wireguard find where name=$wgIf]] = 0) do={
    /interface wireguard add name=$wgIf listen-port=$wgPuertoLocal mtu=$wgMtu comment="argosisp:conexion tunel a ArgosIsp"
}
/interface wireguard set [find where name=$wgIf] mtu=$wgMtu disabled=no
:local wgPub [/interface wireguard get [find where name=$wgIf] public-key]
# Dirección /32 punto a punto: crea la ruta solo hacia la IP del servidor
:local wgDir [/ip address find where comment="argosisp:conexion tunel"]
:if ([:len $wgDir] = 0) do={
    /ip address add address=($wgIp . "/32") network=$wgServidorIp interface=$wgIf comment="argosisp:conexion tunel"
} else={
    /ip address set $wgDir address=($wgIp . "/32") network=$wgServidorIp interface=$wgIf disabled=no
}

