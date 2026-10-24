#!/usr/bin/env bash
# Prueba 1 · Datos del laboratorio, creados por la API (con auditoría y eventos, como un operador):
# el MikroTik físico como router, sus redes IPv4/IPv6, tres planes y cinco servicios PPPoE.
# Idempotente: busca por nombre y solo crea lo que falta. Las contraseñas PPPoE quedan en
# /root/argosisp-lab/credenciales-lab.txt (0600; nunca entran al .tar.gz).
#
#   sudo LAB_NAS_IP=10.255.255.2 LAB_RADIUS_SECRET='<radiusSecret de lab.rsc>' \
#        scripts/laboratorio/01-datos.sh
#
# Obligatorias:
#   LAB_NAS_IP          radiusSrc de lab.rsc (IP con la que el MikroTik habla RADIUS)
#   LAB_RADIUS_SECRET   radiusSecret de lab.rsc
# Opcionales (API REST de RouterOS, para los modos de velocidad y el binding DHCPv6-PD):
#   LAB_API_HOST        apiIp o apiNombre de lab.rsc (por defecto LAB_NAS_IP)
#   LAB_API_PASSWORD    apiPassword de lab.rsc (usuario argosisp-api)
#   LAB_API_CA          ruta de argosisp-ca.crt (se copia del router); sin ella, sin verificar TLS
# Prefijos (cámbialos solo si cambiaste lab.rsc; deben caer en clientesV6 y no chocar con la demo):
#   LAB_RED_V4=10.10.1.0/24  LAB_BLOQUE_V6=2001:db8:300::/40
#   LAB_POOL_ENLACE=2001:db8:300::/48  LAB_POOL_DELEGACION=2001:db8:380::/41
source "$(dirname "$0")/comun.sh"

P=01-datos
: "${LAB_NAS_IP:?Falta LAB_NAS_IP (radiusSrc de lab.rsc)}"
: "${LAB_RADIUS_SECRET:?Falta LAB_RADIUS_SECRET (radiusSecret de lab.rsc)}"
LAB_API_HOST="${LAB_API_HOST:-$LAB_NAS_IP}"
LAB_RED_V4="${LAB_RED_V4:-10.10.1.0/24}"
LAB_BLOQUE_V6="${LAB_BLOQUE_V6:-2001:db8:300::/40}"
LAB_POOL_ENLACE="${LAB_POOL_ENLACE:-2001:db8:300::/48}"
LAB_POOL_DELEGACION="${LAB_POOL_DELEGACION:-2001:db8:380::/41}"
ROUTER_NOMBRE="Laboratorio físico"
D="$(prueba_dir "$P")"

# --- Empresa: la principal (id más bajo activo) ---
empresa="$(api GET /empresas | jq '[.[] | select(.activa)] | min_by(.id) | .id')"

# --- Router ---
router="$(api GET '/routers?limit=200' | jq --arg n "$ROUTER_NOMBRE" '.data[] | select(.nombre == $n)')"
if [ -z "$router" ]; then
    cuerpo="$(jq -n --arg nas "$LAB_NAS_IP" --arg s "$LAB_RADIUS_SECRET" --arg host "$LAB_API_HOST" \
        --arg n "$ROUTER_NOMBRE" --arg u "${LAB_API_PASSWORD:+argosisp-api}" --arg p "${LAB_API_PASSWORD:-}" \
        --arg ca "$([ -n "${LAB_API_CA:-}" ] && cat "$LAB_API_CA")" '{
            nombre: $n, host: $host, nas_ip: $nas, radius_secret: $s, modo_seguridad: "radius",
            control_velocidad: "simple", capacidad_bajada_kbps: 100000, capacidad_subida_kbps: 50000,
            api_url: ("https://" + $host)
        }
        + (if $u != "" then {api_usuario: $u, api_password: $p} else {} end)
        + (if $ca != "" then {api_ca: $ca, api_tls_verificar: true} else {api_tls_verificar: false} end)')"
    router="$(api POST /routers "$cuerpo")"
    ok "router creado: $(jq -r .id <<< "$router")"
else
    aviso "router '$ROUTER_NOMBRE' ya existía (id $(jq -r .id <<< "$router")): no se cambia su secret ni su API"
fi
router_id="$(jq -r .id <<< "$router")"

# --- Redes ---
api GET "/routers/$router_id/redes-ipv4" | jq -e --arg c "$LAB_RED_V4" 'any(.[]; .cidr == $c)' > /dev/null ||
    api POST "/routers/$router_id/redes-ipv4" "$(jq -n --arg c "$LAB_RED_V4" '{cidr: $c, tipo: "estatico"}')" > /dev/null
bloque="$(api GET "/routers/$router_id/ipv6-bloques" | jq --arg p "$LAB_BLOQUE_V6" '.[] | select(.prefijo == $p)')"
[ -n "$bloque" ] || bloque="$(api POST "/routers/$router_id/ipv6-bloques" "$(jq -n --arg p "$LAB_BLOQUE_V6" '{prefijo: $p}')")"
bloque_id="$(jq -r .id <<< "$bloque")"
pools="$(api GET "/ipv6-bloques/$bloque_id/pools")"
jq -e --arg p "$LAB_POOL_ENLACE" 'any(.[]; .prefijo == $p)' <<< "$pools" > /dev/null ||
    api POST "/ipv6-bloques/$bloque_id/pools" "$(jq -n --arg p "$LAB_POOL_ENLACE" \
        '{prefijo: $p, tipo: "enlace", tamano_entrega: 64, nombre_en_router: "argos-v6-enlace"}')" > /dev/null
jq -e --arg p "$LAB_POOL_DELEGACION" 'any(.[]; .prefijo == $p)' <<< "$pools" > /dev/null ||
    api POST "/ipv6-bloques/$bloque_id/pools" "$(jq -n --arg p "$LAB_POOL_DELEGACION" \
        '{prefijo: $p, tipo: "delegacion", tamano_entrega: 56, nombre_en_router: "argos-v6-pd"}')" > /dev/null
ok "redes: $LAB_RED_V4, $LAB_POOL_ENLACE (/64), $LAB_POOL_DELEGACION (/56)"

# --- Planes: [nombre, bajada, subida, reuso] en kbps ---
planes_json='{}'
planes_existentes="$(api GET '/planes?limit=200')"
while read -r nombre bajada subida reuso; do
    plan="$(jq --arg n "Lab $nombre" '.data[] | select(.nombre == $n)' <<< "$planes_existentes")"
    if [ -z "$plan" ]; then
        plan="$(api POST /planes "$(jq -n --arg n "Lab $nombre" --argjson b "$bajada" --argjson s "$subida" --argjson r "$reuso" '{
            nombre: $n, precio: "100.00", tipo: "residencial", reuso: $r, bajada_kbps: $b, subida_kbps: $s,
            bajada_limitada_kbps: 2000, subida_limitada_kbps: 1000, dual_stack: "ambos",
            tamano_prefijo_delegado: 56, global: true
        }')")"
    fi
    plan_id="$(jq -r .id <<< "$plan")"
    api PUT "/planes/$plan_id/routers/$router_id" '{"profile_ppp":"default","pool_ipv6_enlace":"argos-v6-enlace","pool_ipv6_delegacion":"argos-v6-pd"}' > /dev/null
    planes_json="$(jq --arg k "$nombre" --argjson id "$plan_id" '. + {($k): $id}' <<< "$planes_json")"
done << 'EOF'
10M 10000 5000 1
20M 20000 10000 1
reuso4 20000 10000 4
EOF
ok "planes: $(jq -c . <<< "$planes_json")"

# --- Cliente ---
cliente="$(api GET '/clientes?q=Laboratorio%20ArgosIsp&limit=5' | jq '.data[] | select(.nombre == "Laboratorio ArgosIsp")')"
[ -n "$cliente" ] || cliente="$(api POST /clientes '{"nombre":"Laboratorio ArgosIsp","tipo":"persona","nit_cui":"CF","direccion_fiscal":"Ciudad de Guatemala","telefono":"5555-0000","direccion":"Laboratorio"}')"
cliente_id="$(jq -r .id <<< "$cliente")"

# --- Servicios: [user_ppp, plan, estado final] ---
touch "$LAB_CREDENCIALES"
chmod 600 "$LAB_CREDENCIALES"
servicios_json='{}'
while read -r user plan estado; do
    id="$(servicio_id "$user")"
    if [ -z "$id" ]; then
        clave="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 14)"
        id="$(api POST /servicios "$(jq -n --argjson c "$cliente_id" --argjson e "$empresa" --argjson r "$router_id" \
            --argjson p "$(jq ".\"$plan\"" <<< "$planes_json")" --arg u "$user" --arg k "$clave" '{
                cliente_id: $c, empresa_id: $e, router_id: $r, plan_id: $p, plantilla_facturacion_id: null,
                tipo_conexion: "pppoe", user_ppp: $u, pass_ppp: $k, ipv6_modo: "radius_servicio",
                direccion: "Laboratorio"
            }')" | jq -r .id)"
        ok "servicio $user creado (id $id)"
    fi
    grep -q "^$user " "$LAB_CREDENCIALES" 2> /dev/null ||
        printf '%s %s\n' "$user" "$(api GET "/servicios/$id/credenciales" | jq -r .pass_ppp)" >> "$LAB_CREDENCIALES"
    actual="$(api GET "/servicios/$id" | jq -r .estado)"
    if [ "$actual" != "$estado" ]; then
        case "$estado" in
            suspendido) api POST "/servicios/$id/suspender" '{"motivo":"Laboratorio: usuario de prueba suspendido"}' > /dev/null ;;
            limitado) api POST "/servicios/$id/limitar" '{"motivo":"Laboratorio: usuario de prueba limitado"}' > /dev/null ;;
            retirado) api POST "/servicios/$id/retirar" '{"motivo":"Laboratorio: usuario de prueba retirado"}' > /dev/null ;;
        esac
    fi
    servicios_json="$(jq --arg k "$user" --argjson id "$id" '. + {($k): $id}' <<< "$servicios_json")"
done << 'EOF'
lab-cpe1 10M activo
lab-cpe2 10M activo
lab-limitado 10M limitado
lab-suspendido 10M suspendido
lab-retirado 10M retirado
EOF

jq -n --argjson r "$router_id" --argjson e "$empresa" --argjson c "$cliente_id" --argjson p "$planes_json" \
    --argjson s "$servicios_json" --arg nas "$LAB_NAS_IP" \
    '{router_id: $r, empresa_id: $e, cliente_id: $c, nas_ip: $nas, planes: $p, servicios: $s}' > "$D/datos.json"
guardar "$P" servicios sql "select s.id, s.user_ppp, s.estado, p.nombre plan, s.ipv6_modo,
    (select host(ip) from network.ipv4_asignaciones a where a.servicio_id = s.id and a.fin is null) ipv4,
    (select string_agg(prefijo::text || ' ' || tipo, ', ') from network.ipv6_asignaciones a where a.servicio_id = s.id and a.fin is null) ipv6
    from core.servicios s join network.planes p on p.id = s.plan_id where s.router_id = $router_id order by s.id"
guardar "$P" router sql "select id, nombre, host, host(nas_ip) nas_ip, modo_seguridad, control_velocidad, api_url, api_tls_verificar, api_ca is not null tiene_ca, activo from network.routers where id = $router_id"

log "clientes de FreeRADIUS desde network.routers"
guardar "$P" radius-clientes argosisp radius-clientes
ok "listo. Datos en $D/datos.json; contraseñas PPPoE en $LAB_CREDENCIALES (no se envían)"
