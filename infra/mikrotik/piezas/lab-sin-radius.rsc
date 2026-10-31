# ============================================================================
# Variante SIN RADIUS del laboratorio (lab-sin-radius.rsc, contratos/pppoe-local.md)
# ============================================================================
# Misma cabecera que lab.rsc; aquí se anulan RADIUS y CoA. El router se da de alta en ArgosIsp con
# modo_seguridad = api y credenciales de la API: ArgosIsp crea los /ppp secret por la API REST.
:set radiusAddr ""
:set radiusAddr2 ""
:set radiusSrc ""
:put "argosisp: variante SIN RADIUS (/ppp secret locales)"

