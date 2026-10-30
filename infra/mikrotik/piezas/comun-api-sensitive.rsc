# ============================================================================
# 12b. Sin RADIUS: el grupo argosisp-api también lleva "sensitive"
# ============================================================================
# Sin "sensitive" la API REST no devuelve el password de /ppp secret y el reconciliador no ve un
# cambio de contraseña hecho a mano (contratos/pppoe-local.md §2). Con ella, quien tenga la clave
# del usuario argosisp-api puede leer los secretos del router (contraseñas PPP, claves privadas de
# WireGuard o IPsec): por eso el usuario solo entra desde apiDesde (o el túnel) y su clave es
# aleatoria y de un solo router. Sigue sin policy, password, reboot ni ssh/winbox/ftp: no puede crear
# usuarios ni cambiar permisos. Un router que vuelve a RADIUS corre el script con RADIUS, que deja el
# grupo otra vez en read,write,api,rest-api.
/user group set [find where name="argosisp-api"] policy=read,write,api,rest-api,sensitive

