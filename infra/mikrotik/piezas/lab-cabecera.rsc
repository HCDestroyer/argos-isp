# ArgosIsp · MikroTik del laboratorio (RouterOS 7)
#
# PPPoE dual-stack con RADIUS (FreeRADIUS → aaa), CoA en 3799, perfil "suspendido",
# DHCPv6-PD, firewall de corte IPv4/IPv6 y WireGuard opcional hacia el servidor.
# Semana 2: clientes WISP sin PPPoE (ip_estatica, dhcp_fija, amarre IP-MAC), FastTrack excluido
# para clientes con colas, ejemplo de arbol_pcq y usuario de API REST con HTTPS
# (contratos/routeros.md y contratos/velocidad.md).
# Documentación y verificación: infra/mikrotik/README.md
#
# Uso:  edita SOLO la cabecera (bloque "Variables"), sube el archivo y ejecuta
#       /import file-name=lab.rsc verbose=yes
# Es re-ejecutable: todo lo que crea lleva comentario "argosisp: ..." o "argosisp:top ..." y se
# reemplaza al reaplicar. Lo que crea ArgosIsp por la API ("argosisp:servicio:<id>",
# "argosisp:plan:<id>") NO se toca.
# Todo va dentro de un bloque { } para que las variables :local valgan en todo el script.
# Valores de ejemplo: RFC 5737 / RFC 1918 para IPv4, 2001:db8::/32 (RFC 3849) para IPv6 y
# dominios .example (RFC 2606). Sustitúyelos por los reales del laboratorio.

{
# ============================================================================
# Variables (lo único que cambia el PM)
# ============================================================================

# --- Interfaces ---
# Interfaz (o bridge/VLAN) donde se conectan los clientes PPPoE
:local labIf "ether2"
# Interfaz de salida a Internet (NAT de clientes y bloqueo de DNS desde fuera)
:local wanIf "ether1"

# --- PPPoE ---
:local pppoeServicio "argosisp"
# Dirección del router en los enlaces PPP (también DNS para los clientes)
:local pppLocalV4 "10.10.0.1"
# Pool IPv4 dinámico (modo pool). Las IPs estáticas del IPAM (Framed-IP-Address) salen de otro
# rango, p. ej. 10.10.1.0/24, que NO debe solaparse con este pool.
:local poolV4 "argos-v4-pppoe"
:local poolV4Rangos "10.10.0.10-10.10.0.250"
# Prefijo de todos los clientes PPPoE (NAT de salida y exclusión de FastTrack)
:local clientesV4 "10.10.0.0/16"
# Prefijos IPv6 de clientes (pools e IPAM): exclusión de FastTrack en IPv6
:local clientesV6 {"2001:db8:100::/48";"2001:db8:101::/48";"2001:db8:200::/40";"2001:db8:300::/40"}
# Rate-limit del perfil suspendido (rx/tx desde el router = subida/bajada del cliente)
:local suspRateLimit "256k/256k"

# --- IPv6 (nombres que A1 registra en planes_routers) ---
# /64 de enlace por cliente (SLAAC en la interfaz PPP) → remote-ipv6-prefix-pool
:local poolV6Enlace "argos-v6-enlace"
:local poolV6EnlacePrefijo "2001:db8:100::/48"
# /56 delegado por DHCPv6-PD → dhcpv6-pd-pool
:local poolV6Pd "argos-v6-pd"
:local poolV6PdPrefijo "2001:db8:200::/40"
:local poolV6PdLongitud 56
# Los prefijos estáticos del IPAM (Framed-IPv6-Prefix / Delegated-IPv6-Prefix, modo
# radius_servicio) deben salir de rangos distintos a estos pools, p. ej. 2001:db8:101::/48 y
# 2001:db8:300::/40. El router instala la ruta al recibirlos por RADIUS.

# --- RADIUS (servidor ArgosIsp: FreeRADIUS + aaa) ---
# IP del servidor tal como la ve el router (túnel WireGuard o LAN)
:local radiusAddr "10.255.255.1"
# Segundo nodo aaa (vacío = solo uno). Cuando exista, misma secret.
:local radiusAddr2 ""
# IP de origen del router hacia RADIUS (= RADIUS_LAB_NAS_IP en infra/.env)
:local radiusSrc "10.255.255.2"
# = RADIUS_LAB_SECRET en infra/.env. Generar con: openssl rand -hex 16
:local radiusSecret "CAMBIAR-secret-compartido"

# --- Portal y página de corte ---
# IP del servidor del portal y puerto al que se redirige TCP/80 de los suspendidos.
# El portal debe responder cualquier Host/ruta en ese puerto con la página /corte.
:local portalV4 "192.0.2.20"
:local portalCortePuerto 80
# IPv6 del portal: se permite a los suspendidos (argos-portal). Sin NAT IPv6 (decisión del PM): ver
# la alternativa comentada en la sección 9.
:local portalV6 "2001:db8:ffff::20"
:local portalFqdn "portal.argosisp.example"
# Walled garden: dominios que un suspendido puede alcanzar además del portal (pasarela de pago, etc.),
# por FQDN (el router los resuelve, IPv4 e IPv6). El portal no carga nada externo.
# - app.recurrente.com: página de pago de Recurrente (`/checkout-session/<ch_…>`) y su API
#   (`contratos/pago-en-linea.md`, § Recurrente). Con la pasarela falsa no hace falta: su página
#   sale de la API.
# - PENDIENTE de laboratorio (`docs/laboratorio/validacion-fisica.md`, 2.5b): los dominios de recursos
#   que cargue el checkout (CDN, analítica) y los del 3-D Secure del banco emisor; agrégalos aquí.
# El webhook de Recurrente (Svix) llega al servidor, no del cliente: no va aquí.
:local walledGarden {"app.recurrente.com"}

# --- DNS ---
# Resolutores que el router usa y que los suspendidos pueden consultar
:local dnsV4 {"192.0.2.53";"198.51.100.53"}
:local dnsV6 {"2001:db8:ffff::53"}

# --- WISP sin PPPoE (contratos/routeros.md): ip_estatica y dhcp_fija ---
:local wispHabilitar true
# Interfaz (o bridge) de las antenas/CPE sin PPPoE
:local wispIf "ether3"
# Gateway y red de los clientes WISP (= una network.redes_ipv4 del router; el IPAM asigna las IPs)
:local wispGateway "10.20.0.1/24"
:local wispRed "10.20.0.0/24"
# Servidor DHCP de dhcp_fija: SOLO leases estáticos (address-pool=static-only). ArgosIsp crea un
# lease por servicio (mac-address, address, server=wispDhcp); una MAC desconocida no recibe IP.
:local wispDhcp "argos-dhcp-wisp"
:local wispLease "30m"
# IPv6 del segmento WISP (opcional): /64 COMPARTIDO con RA para la WAN de los CPE. El límite por
# cliente en IPv6 va por su /56 delegado (DUID, semana 2), nunca por este /64. Vacío = sin IPv6.
:local wispV6Gateway ""
:local wispV6Red ""
# Amarre IP-MAC opcional (amarre_ip_mac = true): VLAN de ejemplo sobre wispIf con arp=reply-only.
# El router solo responde ARP a las IPs con entrada estática en /ip arp (la crea ArgosIsp) o con
# lease de su DHCP (add-arp=yes). Un equipo con IP clonada pero otra MAC no navega.
:local amarreHabilitar true
:local amarreVlanId 120
:local amarreIf "wisp-amarre"
:local amarreGateway "10.21.0.1/24"
:local amarreRed "10.21.0.0/24"
:local amarreDhcp "argos-dhcp-amarre"

# --- Control de velocidad (contratos/velocidad.md) ---
# Capacidad del enlace en bps (= capacidad_bajada_kbps/subida_kbps × 1000 del router): techo de
# los padres globales del arbol_pcq
:local capBajada 100000000
:local capSubida 50000000
# Ejemplo de arbol_pcq con un plan ficticio (id 0: 20M/10M, reuso 1:4, 4 clientes activos,
# limitado a 2M/1M). En producción ArgosIsp (A2) crea el árbol de cada plan al pasar el router a
# arbol_pcq; el ejemplo usa sus mismos nombres con el id 0, que ningún plan real tiene.
:local arbolEjemplo true
:local arbolPlanId 0
:local arbolMirBajada 20000000
:local arbolMirSubida 10000000
:local arbolLimBajada 2000000
:local arbolLimSubida 1000000
:local arbolReuso 4
:local arbolActivos 4
:local arbolPrioridad 8
# IPv4, /64 y /56 de los clientes de ejemplo (address-list argosisp-plan-<id>)
:local arbolClientes {"10.20.0.101";"10.20.0.102";"10.20.0.103";"10.20.0.104"}
:local arbolClientesV6 {"2001:db8:101:1::/64";"2001:db8:300:100::/56"}

# --- API REST de RouterOS (dispatcher WISP y colas de ArgosIsp) ---
:local apiUsuario "argosisp-api"
# Contraseña del usuario (la misma se guarda cifrada en network.routers.api_password). Generar
# con `openssl rand -base64 24`. Con "CAMBIAR" no se crea el usuario.
:local apiPassword "CAMBIAR"
# Desde dónde se acepta la API (IP del servidor ArgosIsp: túnel WireGuard o LAN)
:local apiDesde "10.255.255.1/32"
# Nombre e IP con que ArgosIsp llega al router (van al certificado: CN y subjectAltName)
:local apiNombre "mikrotik-lab.argosisp.example"
:local apiIp "10.255.255.2"
# Nombre de la CA propia del router (certificado de www-ssl)
:local apiCaNombre "ArgosIsp lab CA"
# Apagar www (HTTP en claro), api (8728) y api-ssl (8729): ArgosIsp solo usa la API REST por www-ssl
:local apiSoloHttps true
# Certificado de www-ssl (comun-certificado.rsc): en el laboratorio siempre, con www-ssl solo desde
# apiDesde. apiIpAnterior: otra IP para el SAN (vacía = solo apiIp).
:local apiCertificar true
:local apiIpAnterior ""
:local apiWwwDesde $apiDesde

# --- WireGuard opcional hacia el servidor (si el servidor no está en la LAN del router) ---
:local wgHabilitar false
:local wgIf "wg-argosisp"
:local wgPuertoLocal 13231
# Dirección del router dentro del túnel (= radiusSrc)
:local wgLocalCidr "10.255.255.2/30"
# Clave pública del servidor (wg pubkey) y su endpoint público
:local wgServidorPub "CAMBIAR-clave-publica-del-servidor="
:local wgServidorEndpoint "203.0.113.10"
:local wgServidorPuerto 51820
# Red alcanzable por el túnel (la IP del servidor en el túnel)
:local wgServidorRed "10.255.255.1/32"

