# ArgosIsp · script de conexión del router (RouterOS 7)
#
# AVISO: este archivo lleva secretos (la clave del usuario de la API y el secreto RADIUS). Úsalo,
# no lo guardes ni lo mandes por chat. El token de registro vale 24 h y una sola vez.
#
# Qué hace (contratos/conexion-routers.md):
#   1. Comprueba RouterOS 7, crea la interfaz WireGuard "wg-argos" y lee su clave pública (la
#      privada nunca sale del router).
#   2. Crea la CA y el certificado de www-ssl, el grupo "argosisp-api" con el mínimo de permisos
#      (read, write, api, rest-api) y el usuario "argosisp-api", que solo entra desde ArgosIsp.
#   3. Se registra en ArgosIsp con el token y agrega el servidor como peer del túnel. Solo si el
#      registro responde OK pone en www-ssl el certificado firmado por argosisp-ca (si falla, muestra
#      la CA para pegarla en el panel y deja el certificado que ArgosIsp ya conoce).
#   4. Configura RADIUS y CoA hacia ArgosIsp por el túnel.
#   5. Solo si el registro respondió OK y el túnel tiene handshake: apaga los servicios que no se
#      usan y deja la gestión (www-ssl, Winbox, SSH) solo por el túnel, desde las IPs de
#      administración y desde la IP de la sesión que corre el script. Si algo falló, la gestión se
#      queda como estaba y el script dice qué falló y cómo reintentar. No toca a los clientes.
#
# Si aun así quedaste fuera: infra/mikrotik/rescate-gestion.rsc (por MAC-Winbox o por consola).
#
# Cómo usarlo: Winbox → Files → arrastra el archivo; luego New Terminal y
#   /import file-name=argosisp-conexion.rsc verbose=yes
# (o pega el contenido completo en New Terminal). Es re-ejecutable: solo borra y recrea lo que lleva
# comentario "argosisp:"; la interfaz wg-argos y su clave se conservan.
# Generado por ArgosIsp desde infra/mikrotik/piezas (no editar a mano: infra/mikrotik/armar.mjs).

