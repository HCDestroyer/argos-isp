# ============================================================================
# Variables de la configuración de servicio (?incluir=servicio): PPPoE, perfiles y corte. Las llena
# ArgosIsp con los datos del router; las mismas piezas que infra/mikrotik/lab.rsc.
# ============================================================================
:local labIf "{{pppoe_interfaz}}"
:local wanIf "{{wan_interfaz}}"
:local pppoeServicio "argosisp"
:local pppLocalV4 "{{ppp_local_v4}}"
:local poolV4 "argos-v4-pppoe"
:local poolV4Rangos "{{pool_v4_rangos}}"
:local clientesV4 "{{clientes_v4}}"
:local clientesV6 [:toarray "{{clientes_v6}}"]
:local suspRateLimit "{{susp_rate_limit}}"
:local poolV6Enlace "argos-v6-enlace"
:local poolV6EnlacePrefijo "{{pool_v6_enlace_prefijo}}"
:local poolV6Pd "argos-v6-pd"
:local poolV6PdPrefijo "{{pool_v6_pd_prefijo}}"
:local poolV6PdLongitud 56
:local portalV4 "{{portal_v4}}"
:local portalCortePuerto 80
:local portalV6 "{{portal_v6}}"
:local portalFqdn "{{portal_fqdn}}"
:local walledGarden [:toarray "{{walled_garden}}"]
:local dnsV4 [:toarray "{{dns_v4}}"]
:local dnsV6 [:toarray "{{dns_v6}}"]
# El script de conexión no trae los ejemplos del laboratorio (WISP, amarre, arbol_pcq): esos
# segmentos se configuran por router; ArgosIsp crea lo de cada servicio por la API.
:local wispHabilitar false
:local wispV6Red ""
:local amarreHabilitar false
:local arbolEjemplo false
:local arbolPlanId 0
# El túnel lo crea la sección C2; el WireGuard del laboratorio no se usa aquí
:local wgHabilitar false

