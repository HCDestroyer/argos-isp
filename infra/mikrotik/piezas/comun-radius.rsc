# ============================================================================
# 6. RADIUS, CoA y AAA de PPP
# ============================================================================
:put "argosisp: RADIUS"
/radius add service=ppp address=$radiusAddr secret=$radiusSecret src-address=$radiusSrc \
    timeout=1s comment="argosisp: aaa nodo 1"
:if ($radiusAddr2 != "") do={
    /radius add service=ppp address=$radiusAddr2 secret=$radiusSecret src-address=$radiusSrc \
        timeout=1s comment="argosisp: aaa nodo 2"
}
# CoA y Disconnect-Request desde coa (solo se aceptan desde las direcciones de /radius)
/radius incoming set accept=yes port=3799
/ppp aaa set use-radius=yes accounting=yes interim-update=5m

