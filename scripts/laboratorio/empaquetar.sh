#!/usr/bin/env bash
# Junta todas las salidas del laboratorio en un .tar.gz para enviar al líder.
# Antes de empaquetar tapa con *** las contraseñas PPPoE del laboratorio y los secrets del .env
# que pudieran haber quedado en algún log, y avisa si encuentra algo que parezca una clave.
#
#   sudo scripts/laboratorio/empaquetar.sh
#
# Deja /root/argosisp-lab/argosisp-lab-<fecha>.tar.gz (y su .sha256).
source "$(dirname "$0")/comun.sh"

[ -d "$LAB_SALIDA" ] || fallar "no hay salidas en $LAB_SALIDA"
FECHA="$(date -u +%Y%m%d-%H%M)"
COPIA="$(mktemp -d)"
trap 'rm -rf "$COPIA"' EXIT
cp -a "$LAB_SALIDA" "$COPIA/argosisp-lab-$FECHA"
RAIZ="$COPIA/argosisp-lab-$FECHA"

# Valores a tapar: contraseñas PPPoE del laboratorio y secretos del .env.
secretos=()
[ -f "$LAB_CREDENCIALES" ] && while read -r _ clave; do [ -n "$clave" ] && secretos+=("$clave"); done < "$LAB_CREDENCIALES"
for v in APP_KEY AAA_PPP_KEY AAA_INTERNAL_TOKEN RADIUS_LOCAL_SECRET METRICS_TOKEN DB_PASSWORD DB_OWNER_PASSWORD \
    DB_APP_PASSWORD SEED_ADMIN_PASSWORD TELEGRAM_BOT_TOKEN SMTP_PASSWORD; do
    valor="$(env_de "$v")"
    [ "${#valor}" -ge 6 ] && secretos+=("$valor")
done
[ -n "${LAB_RADIUS_SECRET:-}" ] && secretos+=("$LAB_RADIUS_SECRET")
[ -n "${LAB_API_PASSWORD:-}" ] && secretos+=("$LAB_API_PASSWORD")
tapados=0
while IFS= read -r -d '' f; do
    for s in "${secretos[@]}"; do
        if grep -qF -- "$s" "$f"; then
            # sed con el valor escapado como literal
            esc="$(printf '%s' "$s" | sed -e 's/[]\/$*.^[]/\\&/g')"
            sed -i "s/$esc/***/g" "$f"
            tapados=$((tapados + 1))
        fi
    done
done < <(find "$RAIZ" -type f -print0)
[ "$tapados" = 0 ] || aviso "tapé $tapados apariciones de contraseñas o secretos"
# Lo que pareciera una clave y no estaba en la lista: se avisa (no se borra).
if grep -rIl -E '(User-Password|Cleartext-Password|pass_ppp"?\s*[:=]\s*"[^*v])' "$RAIZ" > "$COPIA/sospechosos" 2> /dev/null; then
    aviso "revisa antes de enviar (pueden tener una clave): $(tr '\n' ' ' < "$COPIA/sospechosos")"
fi

# Índice: qué pruebas hay y cuántos archivos tiene cada una.
{
    printf '# Laboratorio ArgosIsp · %s\n\nArgosIsp %s · %s\n\n' "$FECHA" "$(env_de ARGOSISP_VERSION)" "$(hostname)"
    for d in "$RAIZ"/*/; do printf -- '- %s: %s archivos\n' "$(basename "$d")" "$(find "$d" -type f | wc -l)"; done
    for r in "$RAIZ"/07-carga/*/resumen.md; do [ -f "$r" ] && { echo; cat "$r"; }; done
} > "$RAIZ/INDICE.md"

SALIDA="$LAB_DIR/argosisp-lab-$FECHA.tar.gz"
tar -czf "$SALIDA" -C "$COPIA" "argosisp-lab-$FECHA"
(cd "$LAB_DIR" && sha256sum "$(basename "$SALIDA")" > "$(basename "$SALIDA").sha256")
ok "listo: $SALIDA ($(du -h "$SALIDA" | cut -f1)). Envíalo al líder con su .sha256"
