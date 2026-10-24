#!/usr/bin/env bash
# Prueba 2.1 · Autorización por estado sin CPE: radtest PAP y CHAP desde el contenedor de FreeRADIUS
# para los cinco usuarios de 01-datos.sh, más un inexistente y una clave errónea.
# Guarda las respuestas (sin contraseñas) en $LAB_SALIDA/02-pppoe/radtest.txt.
#
#   sudo scripts/laboratorio/radtest.sh
source "$(dirname "$0")/comun.sh"

P=02-pppoe
[ -s "$LAB_CREDENCIALES" ] || fallar "falta $LAB_CREDENCIALES: corre 01-datos.sh"
f="$(prueba_dir "$P")/radtest.txt"

probar() { # <usuario> <clave> <esperado>
    local metodo salida resultado
    for metodo in pap chap; do
        # radtest imprime la contraseña enviada: se quitan esas líneas antes de guardar.
        salida="$(dc exec -T freeradius radtest -t "$metodo" "$1" "$2" 127.0.0.1 0 "$RADIUS_LOCAL_SECRET" 2>&1 |
            grep -v -E 'User-Password|CHAP-Password|Cleartext' || true)"
        resultado="$(grep -o -E 'Access-(Accept|Reject)' <<< "$salida" | tail -n1)"
        resultado="${resultado:-sin respuesta}"
        {
            printf '\n## %s · %s · esperado %s · obtenido %s %s\n' "$1" "$metodo" "$3" "$resultado" \
                "$([ "$resultado" = "$3" ] && echo OK || echo MAL)"
            sed -n '/Received Access-/,$p' <<< "$salida"
        } | tee -a "$f"
    done
}

printf '# %s · radtest contra FreeRADIUS de producción (cliente localhost)\n' "$(date -u +%FT%TZ)" > "$f"
while read -r usuario clave; do
    case "$usuario" in
        lab-retirado) esperado=Access-Reject ;;
        *) esperado=Access-Accept ;;
    esac
    probar "$usuario" "$clave" "$esperado"
done < "$LAB_CREDENCIALES"
probar lab-no-existe cualquiera-123 Access-Reject
probar lab-cpe1 clave-equivocada Access-Reject

malos="$(grep -c ' MAL$' "$f" || true)"
[ "$malos" = 0 ] && ok "radtest: todo como se esperaba ($f)" || aviso "radtest: $malos resultados distintos de lo esperado ($f)"
