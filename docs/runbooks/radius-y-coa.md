# Runbook · Diagnóstico de RADIUS y CoA

Para el técnico o el administrador del servidor cuando soporte escala un caso de acceso: un cliente no conecta, la suspensión no corta, la reactivación no llega o un CoA falla. Si lo que está caído es el servicio `aaa` completo (alerta «RADIUS (aaa) caído», muchos clientes a la vez), sigue [RADIUS caído](aaa-caido.md). Cómo funciona por dentro: [RADIUS, accounting y CoA](../desarrolladores/radius.md).

## Comandos que vas a usar

En el servidor de producción (`argosisp` envuelve el `docker compose` de la versión instalada):

```sh
sudo argosisp estado                                   # ¿todo sano?
sudo argosisp logs aaa freeradius coa sesiones-worker  # registros en vivo (Ctrl+C para salir)
sudo argosisp compose logs --tail 200 aaa | grep '"usuario":"cliente-101"'   # todo lo de un usuario
sudo argosisp compose logs --tail 500 coa | grep '"servicio_id":101'         # CoA de un servicio
```

Probar un usuario como lo haría el router, con `radtest` desde el contenedor de FreeRADIUS (cliente `localhost`). Necesitas la contraseña PPPoE del cliente (panel → ficha del servicio → **Credenciales PPPoE**, permiso `servicios.ver_credenciales`):

```sh
sudo argosisp compose exec freeradius sh -c \
  'radtest -t chap cliente-101 "<clave>" 127.0.0.1 0 "$RADIUS_LOCAL_SECRET"'
```

Esperado: `Access-Accept` con `Mikrotik-Rate-Limit`, la IPv4 (`Framed-IP-Address` o `Framed-Pool`), los prefijos IPv6 y `Acct-Interim-Interval = 300`. Un suspendido además trae `Mikrotik-Group = "suspendido"`, `Mikrotik-Address-List = "suspendidos"` y `Filter-Id = "argos-corte.in"`. No uses `curl` contra `/aaa/authorize`: la respuesta trae la contraseña en claro.

En el MikroTik (terminal o Winbox → New Terminal):

```
/log print where topics~"radius"
/radius print detail
/radius monitor 0                      # timeouts debe quedarse en 0
/radius incoming print                 # accept=yes port=3799
/ppp active print detail where name="cliente-101"
/ip firewall address-list print where list=suspendidos
/ipv6 firewall address-list print where list=suspendidos
/queue simple print where name~"cliente-101"
```

Para ver cada paquete RADIUS en el log del router, activa temporalmente `/system logging add topics=radius,debug action=memory` y quítalo al terminar.

Eventos de red (cada CoA y Disconnect con la respuesta del router) desde la API, con un token que tenga `red.ver`:

```sh
curl -s -H "Authorization: Bearer $TOKEN" \
  'https://<dominio-api>/api/v1/red/eventos?servicio_id=101&limit=20' | jq
```

En el panel, la pantalla **Operación → Migración de router** muestra los fallos de red de un router.

## Un cliente no conecta

Síntoma: en la ficha del servicio, «Sesión activa» dice **Desconectada** y el equipo del cliente marca error de autenticación o se queda conectando.

1. **Estado del servicio.** Pendiente de instalación o retirado: el rechazo es lo correcto. Activar la instalación o revisar si se retiró por error.
2. **¿El router es sin RADIUS?** En la ficha del router, «RADIUS y CoA» dice «Sin RADIUS». Salta a [Routers sin RADIUS](#routers-sin-radius).
3. **Prueba con `radtest`** (arriba) con la contraseña del panel.
    - `Access-Accept`: Argos sí lo deja entrar. El problema está entre el router y FreeRADIUS, o en el equipo del cliente (contraseña distinta configurada en el CPE, sin señal).
    - `Access-Reject`: busca la línea `authorize` y la `post-auth` del mismo `request_id` en `sudo argosisp logs aaa`. El campo `resultado` y la `causa` dicen por qué: clave errónea, retirado, inexistente.
4. **¿La petición llega a `aaa`?** Si en el log del router hay rechazos o timeouts pero en `aaa` no hay ninguna línea `authorize` de ese usuario, FreeRADIUS no reconoce al router:
    - `sudo argosisp logs freeradius` mostrará un cliente desconocido o un secret que no cuadra.
    - En el panel, la ficha del router debe tener IP del NAS y secreto RADIUS («Falta el secreto RADIUS» si no).
    - Regenera los clientes: `sudo argosisp radius-clientes` (reinicia FreeRADIUS; unos segundos sin RADIUS).
    - En el MikroTik, `/radius print detail` debe apuntar a la IP del servidor con el mismo secret, y `src-address` debe ser la IP con la que el router figura como NAS.
5. **Todos los usuarios salen como inexistentes** (`notfound` en el log): `API_INTERNAL_URL` no termina en `/api/v1/`, o Redis está vacío y la API no responde. **Todos dan error** con `authorize: pass_ppp` en el log: la `AAA_PPP_KEY` de `aaa` no es la misma que la de la API.
6. **Datos viejos en la caché.** Si `radtest` acepta con un estado o una velocidad que no es la del panel, compara Redis con la API:

    ```sh
    sudo argosisp compose exec redis redis-cli GET 'aaa:user:cliente-101' | jq 'del(.pass_ppp)'
    ```

    Si difiere, borra solo esa clave: la próxima autorización la vuelve a leer de la API.

    ```sh
    sudo argosisp compose exec redis redis-cli DEL 'aaa:user:cliente-101'
    ```

    No borres `aaa:user:*` en masa con Redis sano. Para rehacer todo: `sudo argosisp compose exec api node ace.js aaa:repoblar`.

## La suspensión no corta

Síntoma: el servicio está **Suspendido** en el panel pero el cliente sigue navegando, o no ve la página de corte.

1. **¿Tenía sesión abierta?** Sin sesión, Argos no manda nada; al conectarse entra cortado. Si «Sesión activa» sigue mostrando la sesión de antes del corte (mira «Conectado desde»), el Disconnect o el CoA no llegó: sigue con el paso 3.
2. **¿Qué modo de suspensión está configurado?** **Configuración → Portal de corte → Al suspender un servicio**. Con «Mantener la sesión y cambiar velocidad (CoA)», las conexiones ya abiertas pueden seguir funcionando: es lo esperado de ese modo. El cambio de modo no se aplica a los ya suspendidos; para ellos usa «Desconectar sesión».
3. **¿Qué respondió el router?** Busca el envío en los eventos de red del servicio (arriba) o en `sudo argosisp logs coa`:
    - `ack`: el router aceptó. Sigue con el paso 4.
    - `nak` con `Error-Cause = Session-Context-Not-Found`: el router ya no tiene esa sesión (el cliente se reconectó). Al volver a entrar recibe el perfil de corte.
    - `timeout`: el router no contestó en ninguno de los 4 intentos. Revisa `/radius incoming print` (`accept=yes port=3799`) y que el servidor llegue al router por UDP 3799. El router solo acepta CoA desde la IP de una de sus entradas `/radius`; con `topics=radius,debug` el log muestra `received remote request from <ip> with unknown address, dropping` si llega desde otra.
    - `sin_secret`: el router no tiene secreto RADIUS en Argos.
    - `sin_rate_limit`: no se pudo leer la velocidad del servicio (Redis y API); `coa` no mandó nada.
    - No hay ningún envío: revisa `sudo argosisp logs coa` (consumidor detenido, error de Postgres). `coa` no confirma un evento que falló por Postgres y lo reintenta.
4. **El router aceptó pero no corta.** En el MikroTik, la IPv4 (y el /64 y /56 si reconectó) debe aparecer en `suspendidos`. Si está y aun así navega, el problema son las reglas de corte del router: usa «Probar conexión» en la ficha del router (chequeo de corte) y «Reconciliar ahora» si lo ofrece. Revisa también que FastTrack no esté acelerando el tráfico de los clientes (`infra/mikrotik/README.md`).
5. **Solución inmediata:** «Desconectar sesión» en la ficha del servicio. El equipo vuelve a entrar ya con el perfil de corte.

## La reactivación no llega

Síntoma: el cliente pagó y sigue en la página de corte.

1. **Estado en el panel.** Si sigue **Suspendido**, no es un problema de red: tiene otras facturas vencidas o una suspensión manual («Suspendido manualmente»; un pago no la quita, hace falta «Reactivar»). Esto lo revisa cobros o el administrador.
2. **Si ya está Activo o Limitado**, la reactivación siempre va por Disconnect. Mira «Conectado desde» en «Sesión activa»: si la sesión es anterior a la reactivación, el Disconnect no llegó. Revisa la respuesta en los eventos de red como en el paso 3 de la sección anterior.
3. **Si la sesión es nueva y sigue cortado**, el router le dio el perfil de corte al reconectar: prueba con `radtest`. Si `radtest` todavía devuelve `Mikrotik-Group = "suspendido"`, la caché tiene el dato viejo (paso 6 de [Un cliente no conecta](#un-cliente-no-conecta)).
4. **Solución inmediata:** «Desconectar sesión». Si al reconectar sigue cortado, revisa la caché.

Si `aaa` estuvo caído o en modo degradado, los cambios hechos durante la caída llegan por evento a `coa` y se aplican a las sesiones vivas; un cliente que se reconectó en ese rato entró con el último perfil conocido.

## El CoA falla

Síntoma: llega al chat del equipo «ALERTA · CoA sin respuesta del router `<ip>`» o «ALERTA · Disconnect sin respuesta del router `<ip>`». Los siguientes fallos del mismo router durante 30 minutos no se repiten en el chat, pero quedan en los eventos de red.

1. **¿Un servicio o todo el router?** Filtra los eventos de red por router con `resultado=error`:

    ```sh
    curl -s -H "Authorization: Bearer $TOKEN" \
      'https://<dominio-api>/api/v1/red/eventos?router_id=3&resultado=error&limit=50' | jq
    ```

2. **Un NAK aislado** suele ser una sesión que ya no existe en el router: no hace falta nada.
3. **Timeouts en todo el router:** el router no recibe o no acepta los paquetes. Comprueba:
    - El router responde (la ficha del router dice **En línea**; «Probar conexión»).
    - `/radius incoming print` con `accept=yes port=3799`.
    - La IP de origen del servidor es la de una entrada `/radius` del router (con túnel WireGuard, la del túnel). `COA_ORIGEN_IP` la fija si el servidor tiene varias.
    - Ningún firewall entre el servidor y el router bloquea UDP 3799.
    - El secreto RADIUS del router en Argos es el mismo del router.
4. **Después de arreglarlo:** los servicios cuyo CoA falló quedaron con la sesión vieja. Usa «Desconectar sesión» en cada uno o pide al cliente que reinicie su equipo; al reconectar reciben el perfil correcto.

## Routers sin RADIUS

En un router «Sin RADIUS» no intervienen FreeRADIUS, `aaa` ni `coa`. Argos guarda un `/ppp secret` por servicio en el router y, en cada cambio, quita la sesión (`/ppp active remove`).

- Las sesiones se leen cada minuto: un cliente recién conectado puede tardar hasta un minuto en verse **En línea**.
- Si un cambio no se aplicó, llega la alerta «El router … no aceptó cambios por la API REST». Revisa la conexión del router (túnel y API en la ficha) y usa «Sincronizar con el router» en la ficha del servicio o espera al reconciliador (cada 15 minutos).
- En el router: `/ppp secret print where comment~"argosisp:servicio"` muestra el perfil de cada servicio (`plan-<id>`, `plan-<id>-limitado` o `suspendido`).
- Un secret sin el comentario de Argos (puesto a mano) nunca se toca: si tiene el mismo nombre que un servicio, el alta falla. Bórralo o renómbralo.

Más detalle: [laboratorio sin RADIUS](../laboratorio/sin-radius-y-qos.md).

## Caídas repetidas

Un servicio con muchas sesiones cortas seguidas (5 en 2 horas, sin contar los cortes de Argos ni los reinicios del router) se reporta a Iris. Casi siempre es enlace o equipo del cliente: revisa en el historial de sesiones la causa de fin (`Lost-Carrier` = se perdió la señal del CPE) y el horario. No lo corrige nada de RADIUS.

## Relacionado

- [RADIUS caído](aaa-caido.md): qué hacer cuando `aaa` no responde.
- [Cómo Argos deja navegar a un cliente](../guia/control-de-acceso.md): la explicación para soporte.
- [Runbook técnico de `aaa`](../../services/aaa/RUNBOOK.md): métricas, logs, modo degradado y verificación de un router antes de migrarlo.
- [Validación física](../laboratorio/validacion-fisica.md).
