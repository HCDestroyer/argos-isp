---
orden: 7
---

# Runbook · MikroTik: qué configura ArgosIsp

Para el administrador de red. Qué deja ArgosIsp en cada MikroTik, cómo se conecta un router, cómo funcionan RADIUS, el túnel WireGuard, el corte y el control de velocidad, y qué hacer si algo sale mal. Necesita RouterOS 7.

El detalle técnico completo (cada pieza del script, pruebas en CHR, verificación en el equipo físico) está en [`infra/mikrotik/README.md`](../../infra/mikrotik/README.md).

## Los scripts

| Archivo                                                                                                                                                                                                                             | Para qué                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Script de conexión ([`plantillas/conexion.rsc.tpl`](../../infra/mikrotik/plantillas/conexion.rsc.tpl))                                                                                                                              | Lo genera el panel para cada router. Une el router al servidor por WireGuard, crea el usuario de la API, configura RADIUS y cierra los puertos de gestión |
| Con «incluir configuración de servicio» ([`plantillas/conexion-servicio.rsc.tpl`](../../infra/mikrotik/plantillas/conexion-servicio.rsc.tpl))                                                                                       | Lo mismo y además todo el servicio a clientes: servidor PPPoE, perfiles, pools, corte y FastTrack. Para un router nuevo que ArgosIsp configura completo   |
| Variantes sin RADIUS ([`conexion-sin-radius.rsc.tpl`](../../infra/mikrotik/plantillas/conexion-sin-radius.rsc.tpl), [`conexion-servicio-sin-radius.rsc.tpl`](../../infra/mikrotik/plantillas/conexion-servicio-sin-radius.rsc.tpl)) | Para un router con seguridad «api»: los PPPoE van como `/ppp secret` locales que ArgosIsp mantiene por la API. El panel elige la variante según el router |
| [`lab.rsc`](../../infra/mikrotik/lab.rsc) y [`lab-sin-radius.rsc`](../../infra/mikrotik/lab-sin-radius.rsc)                                                                                                                         | El laboratorio completo, para editar a mano (variables al inicio)                                                                                         |
| [`rescate-gestion.rsc`](../../infra/mikrotik/rescate-gestion.rsc)                                                                                                                                                                   | Devuelve el acceso de gestión si quedaste fuera                                                                                                           |

Todos salen de las mismas piezas ([`infra/mikrotik/piezas/`](../../infra/mikrotik/piezas/)): lo que hace el laboratorio es lo mismo que hace el script de un router real.

**Qué es de ArgosIsp en el router:** todo lo que lleva comentario `argosisp: …`, `argosisp:top …` o `argosisp:gestion …` (lo pone el script) y `argosisp:servicio:<id>`, `argosisp:plan:<id>` o `argosisp:router` (lo pone ArgosIsp por la API). El script solo borra y recrea lo suyo; tus reglas y configuraciones quedan como estaban.

## Antes de conectar

- RouterOS 7 y salida a internet desde el router.
- En el servidor, WireGuard activo (`ARGOSISP_WIREGUARD=1`, la pregunta del instalador): [Instalar](./instalacion.md#conectar-los-routers-por-wireguard).
- Para «incluir configuración de servicio», los datos de tu red en el `.env` del servidor (`ROUTERS_SERVICIO_*`: interfaz de internet, pool PPPoE, redes IPv4 e IPv6 de clientes, DNS). ArgosIsp no inventa rangos: mientras falten, el panel y `sudo argosisp estado` dicen cuáles.
- El portal de corte (IP y puerto a donde va un suspendido, y si se suspende desconectando o por CoA) se configura en el panel, **Configuración → Portal de corte**.
- Un respaldo del router: `/system backup save name=antes-argosisp` (se vuelve con `/system backup load name=antes-argosisp`).

## Conectar un router

1. En el panel, ficha del router → **Script de conexión**. Si administras el router desde una IP fija (tu oficina), escríbela en «IPs de administración». Marca «incluir configuración de servicio» solo en un router nuevo.
2. Descarga el archivo. **Lleva claves:** no lo guardes ni lo mandes por chat. Vale 24 horas y para un solo registro.
3. En Winbox: **Files** → arrastra el archivo. Luego **New Terminal**:

    ```
    /import file-name=argosisp-conexion.rsc verbose=yes
    ```

    (También puedes pegar todo el texto en New Terminal.)

4. Al final debe decir `argosisp: listo`. En menos de un minuto el panel muestra el router **conectado**.
5. Si dice `AVISO la gestión NO se restringió`: algo falló (registro o túnel) y **el router se queda como estaba**. Debajo dice qué falló. Corrígelo, genera un script **nuevo** (el anterior ya se usó) y vuelve a correrlo.
6. Si dice `FALTA un paso`: copia la clave pública que muestra y pégala en el panel con «Pegar clave pública». Si además muestra un certificado (`-----BEGIN CERTIFICATE-----`), pégalo en la ficha del router → **Conexión de la API** → CA propia.

Puedes volver a correr el script cuantas veces quieras: solo toca lo suyo y conserva el túnel y su clave.

### Qué hace el script

| Paso     | Qué queda en el router                                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Versión  | Comprueba RouterOS 7; si no, se detiene sin tocar nada                                                                                                                                                                                                                                                              |
| Túnel    | Interfaz WireGuard `wg-argos` con su IP `/32` y ruta solo hacia el servidor. La clave privada se genera en el router y **nunca sale de él**                                                                                                                                                                         |
| API      | CA `argosisp-ca`, certificado `argosisp-www` en `www-ssl`, grupo y usuario `argosisp-api` que solo entra desde el servidor por el túnel                                                                                                                                                                             |
| Registro | El router se presenta al servidor con su token, su clave pública, su versión y su CA; con la respuesta agrega al servidor como par del túnel                                                                                                                                                                        |
| RADIUS   | `/radius` hacia el servidor por el túnel, con el secreto del router; `/radius incoming` en el 3799 (CoA); `/ppp aaa` con RADIUS y accounting                                                                                                                                                                        |
| Gestión  | **Solo si el registro respondió y el túnel tiene handshake:** apaga `telnet`, `ftp`, `www`, `api`, `api-ssl`, bandwidth-test, RoMON y MAC-Telnet; deja `www-ssl`, Winbox y SSH solo desde el túnel, tus IPs de administración y las IPs de las sesiones abiertas en ese momento. No toca el tráfico de los clientes |

El script **nunca te deja fuera**: si algo falla no restringe nada, y conserva el acceso desde las sesiones abiertas (también la que corre el script). MAC-Winbox nunca se apaga.

### Si quedaste fuera

Entra por **Winbox por MAC** (Neighbors → la MAC del router → Connect → New Terminal) o por la consola, y pega [`rescate-gestion.rsc`](../../infra/mikrotik/rescate-gestion.rsc):

```
/ip firewall filter remove [find where comment~"^argosisp:gestion"]
/ip firewall address-list remove [find where list="argosisp-admin"]
/ip service set www-ssl address=""
/ip service set winbox address=""
/ip service set ssh address=""
```

Solo deshace la restricción de gestión; el túnel, RADIUS, el usuario de la API y el tráfico de clientes siguen igual.

## RADIUS

- Cada PPPoE se autentica contra el servidor: FreeRADIUS consulta a ArgosIsp, que responde con la velocidad del plan, las IPs y el prefijo IPv6 del servicio, o con el perfil de corte si está suspendido.
- El router pregunta con `timeout=1s`. Con dos nodos de RADIUS hay dos entradas `/radius` y el router usa la segunda si la primera no responde.
- Accounting con Interim-Update cada 5 min: así ArgosIsp sabe qué sesiones están abiertas.
- **CoA (puerto 3799):** ArgosIsp cambia la velocidad o desconecta una sesión viva sin esperar a que el cliente se reconecte. El router solo acepta CoA desde la dirección de su `/radius`.
- Si el router nuevo recibe rechazos porque FreeRADIUS no lo conoce: `sudo argosisp radius-clientes` en el servidor.
- Si RADIUS cae: [RADIUS (`aaa`) caído](./aaa-caido.md).

**Router sin RADIUS** (seguridad «api» en el panel): `/ppp aaa use-radius=no`. ArgosIsp crea un `/ppp secret` por servicio (comentario `argosisp:servicio:<id>`), lo corta cambiándolo al perfil `suspendido` y cerrando la sesión, y lee las sesiones consultando `/ppp active`. El grupo `argosisp-api` lleva además el permiso `sensitive`, para que ArgosIsp vea si alguien cambió una contraseña a mano.

## WireGuard

- El router inicia el túnel hacia el servidor; en el router no se abre ningún puerto. En el servidor solo se abre un UDP (51820 por defecto).
- Red del túnel: `10.255.0.0/16`; el servidor es la `10.255.0.1` y cada router recibe su `/32`.
- RADIUS, CoA y la API REST del router viajan por el túnel. En el servidor, RADIUS escucha solo en la IP del túnel.
- Si el dominio de la API pasa por Cloudflare u otro proxy, el router no llega por UDP a ese nombre: pon `ARGOSISP_WG_ENDPOINT=<IP pública del servidor>` en el `.env` y `sudo argosisp levantar`.
- Detalle del servidor: [`infra/wireguard/README.md`](../../infra/wireguard/README.md).

## Corte

Un servicio suspendido entra con el perfil `suspendido`: velocidad mínima y su IPv4, su `/64` y su `/56` en las listas `suspendidos` (IPv4 e IPv6). Para esas direcciones, la cadena `argos-corte` solo deja pasar:

- DNS (`argos-dns`: el router y los resolutores que usa),
- el portal (`argos-portal`),
- los dominios del walled garden (`argos-walled`, por ejemplo la pasarela de pago),

y responde con rechazo a todo lo demás (nunca un descarte silencioso, para que el navegador no se quede esperando). El HTTP (TCP/80) del suspendido va a la página de corte (`/corte`).

Cómo sabe la página de corte qué cliente es (se elige por router, en el panel):

- **Por IP** (por defecto): el router hace `dst-nat` del TCP/80 al portal y el portal identifica por la IP de origen. Con WireGuard, el router lo manda a la IP del servidor en el túnel, sin NAT, para que el portal vea la IP real del cliente.
- **Por código** (necesita la API del router): el TCP/80 va al web proxy del propio router (puerto 3346, cerrado desde la WAN), que responde con una redirección a `/corte?c=<código>`. Sirve aunque haya NAT o proxies en medio. En RouterOS 7.17+ necesita el proxy permitido en el device-mode (ver [`failure: invalid local port`](#failure-invalid-local-port)). Argos lo arma en este orden: el bloqueo del 3346 desde fuera, el puerto en el proxy (sin encenderlo), la regla final, el NAT y al final enciende el proxy.

Revisa cada router con **Probar conexión → Corte** en su ficha. Pasar un router de un modo a otro: [Actualizar y revertir](./actualizacion.md#identificacion-del-cortado-desde-la-1-13-0).

ArgosIsp mantiene estas reglas en cada router con API (el reconciliador): si alguien las borra, las vuelve a poner. «Reconciliar ahora» en la ficha del router lo hace en el momento, con vista previa, y muestra el resultado: en espera, en curso, completada (con los comandos que escribió y los que el router rechazó) o fallida (el router no respondió). Un comando rechazado no detiene lo demás.

### `failure: invalid local port`

Sale al importar el script, en «Reconciliar ahora» (en `errores`, operación `proxy_corte` o `/ip/proxy/access …`), en «Sincronizar con el router» o en `routeros.fallido` cuando el router está en el corte **por código**, en un comando como `/ip proxy access add local-port=3346 …`.

**Causa más común (RouterOS 7.17 o más nuevo): el device-mode no permite el proxy web.** El proxy aparece encendido con el puerto 3346, pero no escucha y RouterOS rechaza cualquier `local-port`. Se ve así:

```
/ip proxy print
;;; inactivated, not allowed by device-mode
  enabled: yes
     port: 3346
```

Argos lo detecta (lee `/system/device-mode`): no intenta las reglas del proxy, lo avisa en «Reconciliar ahora», en «Sincronizar con el router» y en **Probar conexión → Corte** (chequeo «device-mode»), y mientras tanto **corta ese router como en «Identificación por IP»** (el HTTP del suspendido va al portal sin código). El corte sigue funcionando; solo falta el código.

Arreglo (solo se puede desde el router, ArgosIsp no puede hacerlo por la API):

1. En la terminal del router: `/system/device-mode/print` (mira `proxy`: debe decir `yes`).
2. `/system/device-mode/update proxy=yes`
3. **Dentro de 5 minutos**, confírmalo en el equipo: presiona el botón (reset/mode) o apágalo y enciéndelo. Si no, RouterOS descarta el cambio. En un CHR o una VM, reiniciarla desde el hipervisor (un apagado «en frío»).
4. Cuando vuelva, `/ip proxy print` ya no dice `inactivated`. Usa «Reconciliar ahora»: Argos arma el corte por código (reglas del proxy y NAT al 3346).

**Otra causa (ArgosIsp 1.16.0 o anterior):** RouterOS solo acepta una regla de `/ip proxy access` con un `local-port` que ya está en `/ip proxy port`, y esas versiones creaban la regla antes de agregar el 3346. Actualiza ArgosIsp (el script y el reconciliador agregan el puerto primero) o agrégalo a mano, sin encender el proxy, y vuelve a correr el script o «Reconciliar ahora»:

- si no usas el web proxy del router: `/ip proxy set port=3346 max-cache-size=none`;
- si ya lo usas: `/ip proxy set port=<tus puertos>,3346` (por ejemplo `port=8080,3346`).

Orden con que Argos arma el corte por código: el `drop` del 3346 en `input`, el puerto en el proxy (sin encenderlo), la regla `argosisp: corte proxy sin codigo`, el NAT al 3346 y al final enciende el proxy. Si un paso falla, no sigue con lo que depende de él (nunca un NAT al 3346 sin la regla final) y sí con lo demás.

### La redirección sale como `http://https//…` o tarda en llegar a `/corte`

En el corte por código, `action-data` de `/ip proxy access` va **sin esquema**: `portal.miisp.gt/corte?c=<código>`. RouterOS lo lee como `host[:puerto]/ruta` y le antepone `http://`; con la URL completa (`https://…`, ArgosIsp 1.19.0 o anterior) el navegador recibía `http://https//portal.miisp.gt/corte`, buscaba un host llamado «https» y nunca llegaba a la página. En las versiones posteriores a 1.19.0, Argos y el script escriben la URL sin esquema y «Reconciliar ahora» corrige las reglas viejas (Probar conexión → Corte, chequeo «proxy de corte», las marca en rojo mientras tanto).

El 307 siempre lleva a `http://<dominio del portal>/corte`: el router no sabe redirigir a `https://`. Caddy de Argos sirve `/corte` por HTTP en el 80. Si delante hay Nginx Proxy Manager con «Force SSL» en el host del portal, o el navegador tiene HSTS del dominio, el salto a HTTPS es uno más y conserva `?c=`; no hay que quitarlo.

Cómo medir cuánto tarda, de punta a punta (desde un cliente suspendido, con la hora de cada paso):

1. **El router redirige bien y rápido.** Desde una PC detrás del cliente suspendido: `curl -s -o /dev/null -w '%{http_code} %{redirect_url} %{time_total}s\n' http://neverssl.com/`. Debe dar `307 http://portal.miisp.gt/corte?c=… 0.0xs`. Si `redirect_url` empieza con `http://https//`, el router tiene reglas viejas: «Reconciliar ahora». En el router: `/ip proxy access print where comment~"argosisp"` (ninguna `action-data` con `://`).
2. **La página carga.** `curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' "<la redirect_url del paso 1>"`: 200 (o 301/308 a HTTPS si hay NPM con «Force SSL») en menos de un segundo.
3. **Cuándo llegó la suspensión al router.** En la base, con el `servicio_id`:

   ```sql
   SELECT evento, created_at, publicado_en FROM audit.outbox
    WHERE payload->>'servicio_id' = '<id>' ORDER BY id DESC LIMIT 5;      -- relay: publicado_en − created_at < 1 s
   SELECT tipo, comando->>'ruta' AS ruta, ok, created_at FROM audit.red
    WHERE servicio_id = <id> ORDER BY id DESC LIMIT 10;                   -- Disconnect/CoA y la regla del proxy
   SELECT inicio, fin, causa_fin FROM network.sesiones
    WHERE servicio_id = <id> ORDER BY id DESC LIMIT 3;                    -- cuándo reconectó el CPE
   ```

   Entre `servicio.estado_cambiado` y la fila de `audit.red` deben pasar segundos. Con «Modo de suspensión: desconectar» (el de fábrica), el cliente queda sin internet desde el Disconnect hasta que su CPE vuelve a marcar: la diferencia entre el `fin` de la sesión vieja y el `inicio` de la nueva es tiempo del CPE, no de Argos (hay equipos que esperan 30 a 60 s o más para volver a marcar).
4. **El teléfono.** Android e iOS solo abren «Iniciar sesión en la red» cuando vuelven a probar la conexión (al reconectar el Wi-Fi o tras varios fallos); un sitio HTTPS escrito a mano recibe `tcp-reset` y muestra error, no la página. Para probar, abre una página `http://` (por ejemplo `http://neverssl.com`) o apaga y enciende el Wi-Fi del teléfono.

### DNS del router

Los clientes y los suspendidos usan al router como DNS. Si `ROUTERS_SERVICIO_DNS_V4` está vacía (lo normal), el script no toca los DNS del router. Nunca pongas IPs de documentación (`192.0.2.x`, `198.51.100.x`, `203.0.113.x`, `2001:db8::`): la API se niega a generar el script con ellas. Las reglas del script cierran el puerto 53 desde la WAN en IPv4 e IPv6.

## Control de velocidad (QoS)

Cada router (y cada plan, si hace falta) usa una forma de aplicar la velocidad. Todo lo crea ArgosIsp por la API con comentario `argosisp:…`:

| Estrategia            | Qué hay en el router                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Rate-limit por RADIUS | Nada propio: RouterOS crea la cola dinámica de la sesión PPPoE con la velocidad que manda RADIUS            |
| Perfil PPP            | Un perfil `plan-<id>` con su `rate-limit`                                                                   |
| Cola simple           | Una cola `argosisp-servicio-<id>` por servicio sin PPPoE                                                    |
| PCQ por plan          | Tipos de cola y una cola simple por plan con los clientes en el `target`                                    |
| Árbol PCQ             | Tipos PCQ por plan (cada `/64` de IPv6 es un cliente), árbol de colas, mangle y listas `argosisp-plan-<id>` |

Además, un padre por router o jerárquico, y tipos de cola `sfq`, `fq_codel` o `cake`.

- **FastTrack:** con FastTrack los paquetes se saltan las colas y el cliente navega sin límite. El script excluye a los clientes (`argos-clientes`, IPv4 e IPv6) de FastTrack sin apagarlo para el resto. Compruébalo con `/system script run argosisp-verificar-fasttrack`: debe responder `argosisp: FastTrack OK`.
- **Más de unas 1000 colas simples** en un router dispara la alerta `RouterDemasiadasColasSimples`: pasa ese router a árbol PCQ.
- Un cambio de estrategia no desconecta a nadie: la sesión recibe la velocidad nueva por CoA y toma la estructura nueva al reconectar.

## Clientes sin PPPoE (WISP)

Para IP estática o DHCP con lease fijo, ArgosIsp crea por la API el lease, la cola simple, el amarre IP-MAC (ARP estático, si lo pides) y la entrada en `suspendidos` del corte. El servidor DHCP del laboratorio solo entrega leases estáticos. Ver «WISP sin PPPoE» en [`infra/mikrotik/README.md`](../../infra/mikrotik/README.md).

## Usuario de la API

Grupo `argosisp-api` con `read,write,api,rest-api` y nada más: es el mínimo con el que ArgosIsp funciona. Con él la API **no** puede cambiar usuarios ni reiniciar el router. El usuario solo entra desde el servidor por el túnel y su clave es aleatoria por router. La API REST va por HTTPS (`www-ssl`) con el certificado que crea el script; el servicio `api` (8728) queda apagado.

## Verificar en el router

```
/interface wireguard peers print     # el servidor, con last-handshake reciente
/radius print detail                 # entradas "argosisp: aaa nodo …"
/radius monitor 0                    # accepts suben, timeouts en 0
/ppp active print                    # sesiones PPPoE
/ip firewall address-list print where list=suspendidos
/system script run argosisp-verificar-fasttrack
```

## Relacionado

- [Red](../manual/red/) en el manual del panel
- [Laboratorio](../laboratorio/)
- [RADIUS caído](./aaa-caido.md)
