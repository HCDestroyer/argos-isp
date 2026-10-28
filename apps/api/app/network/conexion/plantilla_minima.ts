/**
 * Plantilla mínima del script de conexión, mientras A6 sube la suya (`infra/mikrotik/conexion.rsc`,
 * ver `plantilla.ts`). Mismo formato y mismas variables (`render.ts`, acuerdo en `a6.md`).
 *
 * Requiere RouterOS 7.x. Re-ejecutable: solo borra y recrea lo que lleva comentario `argosisp:`. Los
 * servicios de gestión se restringen al final, porque quien pega el script desde Winbox puede
 * perder la sesión si su IP no está en `argosisp-admin`.
 */
export const PLANTILLA_MINIMA = `# ArgosIsp · Conexión del router "{{router_nombre}}" (id {{router_id}})
# Generado {{generado_en}}. El token de registro vence {{token_vence}}.
#
# ATENCIÓN: este script lleva secretos (la clave del usuario de la API y el secreto RADIUS).
# No lo guardes, no lo envíes por chat y bórralo después de usarlo. Si se filtra, rota la conexión
# desde el panel (Routers → Conexión → Rotar).
#
# Uso: Winbox → New Terminal → pegar todo el texto → Enter. Al final verás la clave pública del router
# y si quedó registrado. Requiere RouterOS 7.
# Solo borra y recrea lo que lleva comentario "argosisp:"; se puede volver a ejecutar.
{
:local wgIf "wg-argos"
:local tunelIp "{{ip_tunel}}"
:local tunelCidr "{{ip_tunel_cidr}}"
:local tunelRed "{{red_tunel}}"
:local servidorIp "{{servidor_ip}}"
:local servidorPub "{{servidor_public_key}}"
:local servidorEndpoint "{{servidor_endpoint}}"
:local servidorPuerto [:tonum "{{servidor_puerto}}"]
:local registroUrl "{{registro_url}}"
:local registroToken "{{registro_token}}"
:local apiUsuario "{{api_usuario}}"
:local apiGrupo "{{api_grupo}}"
:local apiPassword "{{api_password}}"
:local radiusSecret "{{radius_secret}}"
:local adminIps {{lista:admin_ips}}

# 0. RouterOS 7 (WireGuard nativo)
:if ([:pick [/system resource get version] 0 1] != "7") do={
    :error "argosisp: se requiere RouterOS 7.x"
}

# 1. Túnel WireGuard hacia Argos (la clave privada se crea aquí y nunca sale del router)
:put "argosisp: WireGuard"
:if ([:len [/interface wireguard find where name=$wgIf]] = 0) do={
    /interface wireguard add name=$wgIf comment="argosisp: tunel"
}
/interface wireguard peers remove [find where interface=$wgIf comment~"^argosisp"]
/interface wireguard peers add interface=$wgIf public-key=$servidorPub endpoint-address=$servidorEndpoint \\
    endpoint-port=$servidorPuerto allowed-address=($servidorIp . "/32") persistent-keepalive=25s \\
    comment="argosisp: servidor"
/ip address remove [find where comment="argosisp: tunel"]
/ip address add address=$tunelCidr interface=$wgIf comment="argosisp: tunel"
:local clave [/interface wireguard get [find where name=$wgIf] public-key]

# 2. Usuario de la API REST: solo read, write, api y rest-api, y solo desde el servidor por el túnel
:put "argosisp: usuario de la API"
:if ([:len [/user group find where name=$apiGrupo]] = 0) do={
    /user group add name=$apiGrupo policy="read,write,api,rest-api" comment="argosisp: api"
} else={
    /user group set [find where name=$apiGrupo] policy="read,write,api,rest-api"
}
:if ([:len [/user find where name=$apiUsuario]] = 0) do={
    /user add name=$apiUsuario group=$apiGrupo password=$apiPassword address=($servidorIp . "/32") \\
        comment="argosisp: api"
} else={
    /user set [find where name=$apiUsuario] group=$apiGrupo password=$apiPassword \\
        address=($servidorIp . "/32")
}
:if ([:len [/certificate find where name="argosisp-api"]] = 0) do={
    /certificate add name="argosisp-api" common-name=$tunelIp subject-alt-name=("IP:" . $tunelIp) \\
        days-valid=3650 key-size=2048
    /certificate sign "argosisp-api"
}
/ip service set www-ssl certificate="argosisp-api" disabled=no
{{#radius}}
# 3. RADIUS hacia Argos por el túnel, y CoA (3799) solo desde el servidor
:put "argosisp: RADIUS"
/radius remove [find where comment~"^argosisp"]
/radius add service=ppp address=$servidorIp secret=$radiusSecret src-address=$tunelIp timeout=1100ms \\
    comment="argosisp: radius"
/radius incoming set accept=yes port=3799
{{/radius}}
{{#incluir_servicio}}
# 4. Configuración de servicio (PPPoE, perfiles y corte)
# La plantilla mínima no la trae todavía: aplica infra/mikrotik/lab.rsc o espera la plantilla
# completa de ArgosIsp.
:put "argosisp: AVISO: esta versión del script no incluye la configuración de servicio"
{{/incluir_servicio}}

# 5. Registro en Argos (sin internet: pega en el panel la clave pública que sale abajo)
:put ("argosisp: clave publica del router: " . $clave)
:do {
    /tool fetch url=$registroUrl http-method=post check-certificate=yes-without-crl \\
        http-header-field="Content-Type: application/json" \\
        http-data=("{\\"token\\":\\"" . $registroToken . "\\",\\"public_key\\":\\"" . $clave . "\\"}") \\
        output=none
    :put "argosisp: router registrado en Argos"
} on-error={
    :put "argosisp: no se pudo registrar por internet. En el panel: Routers → Conexión → Pegar clave publica"
}

# 6. Puertos de gestión (al final: puede cortar esta sesión si tu IP no está en argosisp-admin)
:put "argosisp: puertos de gestion"
/ip firewall address-list remove [find where list="argosisp-admin" comment~"^argosisp"]
:foreach ip in=$adminIps do={
    /ip firewall address-list add list="argosisp-admin" address=$ip comment="argosisp:gestion admin"
}
/ip firewall filter remove [find where comment~"^argosisp:gestion"]
:local antes [:pick [/ip firewall filter find where chain=input] 0]
:local reglas {
    {"tcp";"443";$servidorIp;"";"argosisp:gestion rest"};
    {"udp";"3799";$servidorIp;"";"argosisp:gestion coa"};
    {"tcp";"8291,22";"";"argosisp-admin";"argosisp:gestion admin"};
    {"tcp";"21,22,23,80,443,8291,8728,8729";"";"";"argosisp:gestion bloquear"};
    {"udp";"3799";"";"";"argosisp:gestion bloquear coa"}
}
:foreach r in=$reglas do={
    :local accion "accept"
    :if ([:pick ($r->4) 0 25] = "argosisp:gestion bloquear") do={ :set accion "drop" }
    :local id [/ip firewall filter add chain=input action=$accion protocol=($r->0) dst-port=($r->1) \\
        comment=($r->4)]
    :if ([:len ($r->2)] > 0) do={ /ip firewall filter set $id src-address=($r->2) in-interface=$wgIf }
    :if ([:len ($r->3)] > 0) do={ /ip firewall filter set $id src-address-list=($r->3) }
    :if ([:len $antes] > 0) do={ /ip firewall filter move $id destination=$antes }
}
/ip service set telnet,ftp,www,api,api-ssl disabled=yes
:local permitidas $tunelRed
:foreach ip in=$adminIps do={ :set permitidas ($permitidas . "," . $ip) }
/ip service set www-ssl,winbox,ssh address=$permitidas
/tool bandwidth-server set enabled=no
/tool romon set enabled=no
/tool mac-server set allowed-interface-list=none
/tool mac-server mac-winbox set allowed-interface-list=none
:put "argosisp: listo"
}
`
