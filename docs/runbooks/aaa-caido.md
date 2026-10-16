# Runbook · RADIUS (`aaa`) caído

Para el turno de operación: qué pasa cuando el servicio `aaa` no responde, cómo nos enteramos, cómo se recupera y qué revisar después. Lo técnico (camino de una autorización, métricas, logs, `radtest`, modo degradado por dentro, verificar un router antes de migrarlo) está en el runbook de A2: [`services/aaa/RUNBOOK.md`](../../services/aaa/RUNBOOK.md).

> **Pendiente de laboratorio** marca lo que no se pudo probar sin el MikroTik físico (RouterOS 7.24.5). Al probarlo, quita la marca y anota la fecha.

## Cómo funciona normalmente

```
Cliente PPPoE → MikroTik → FreeRADIUS (UDP 1812/1813) → aaa (HTTP, 0,8 s) → Redis / API
```

- El MikroTik pregunta a FreeRADIUS con `timeout=1s` y prueba la segunda entrada `/radius` si hay dos nodos (`infra/mikrotik/README.md`).
- FreeRADIUS no decide nada: llama a `aaa` (`rlm_rest`, `services/aaa/freeradius/`). Si `aaa` no contesta en 0,8 s o responde 5xx, el módulo devuelve `fail` y FreeRADIUS **rechaza** (`Access-Reject`).
- `aaa` lee el perfil del cliente en Redis; si no está, en la API; si fallan los dos, usa el **último perfil conocido** (modo degradado, A2). Solo si no tiene nada, responde 503 → Reject.

## Qué pasa cuando `aaa` no responde

| Quién | Qué ve | Por qué |
| --- | --- | --- |
| Cliente ya conectado | Nada: sigue navegando | El MikroTik no corta sesiones activas porque RADIUS no responda. Los Interim-Update (cada 5 min) se pierden; el consumo de ese rato no queda en `network.sesiones` |
| Cliente que se reconecta (corte de luz, reinicio del router del cliente) | Sin internet. Su router muestra "error de autenticación" o se queda "conectando" | FreeRADIUS responde Reject (o no responde) y el MikroTik niega la sesión |
| Cliente suspendido que paga en ese rato | Sigue en corte hasta que `aaa` vuelve | La reactivación viaja por evento a `coa` (CoA a la sesión viva) y sí llega; pero si se reconecta, entra con lo que diga RADIUS cuando vuelva |
| Panel, caja, portal | Normal | No dependen de `aaa` |
| Corte automático y CoA | Siguen funcionando | `coa` habla con el MikroTik directo (puerto 3799), no pasa por `aaa` |

Con **modo degradado** (A2): si lo caído es Redis y la API, pero el proceso `aaa` vive, los clientes que se reconectan **sí entran** con su último perfil conocido (un suspendido sigue suspendido). Lo grave es cuando el proceso `aaa` o FreeRADIUS no responden.

## Cómo nos enteramos

| Aviso | Llega por | Cuándo |
| --- | --- | --- |
| **"ALERTA · RADIUS (aaa) caído · Nodo …"** | Telegram del equipo (notify) | El vigía (`aaa-vigia`) no recibe `/health` de un nodo durante 60 s (`AAA_CAIDO_TRAS_MS`). Una alerta por caída; al volver, "RESUELTO · RADIUS (aaa) recuperado" con la duración |
| **`ServicioSinMetricas`** (job `aaa`) | Telegram (Alertmanager) | Prometheus no puede leer `aaa:3100/metrics` durante 2 min |
| **`AaaSinRedis`** | Telegram (Alertmanager) | `aaa` sin Redis 1 min: autoriza por la API (más lento, sigue funcionando) |
| **`AaaDegradado`** (crítica) | Telegram (Alertmanager) | `aaa` sin Redis **ni** API 1 min: autoriza con el último perfil conocido |
| **`AaaEspejoViejo`** | Telegram (Alertmanager) | El espejo del último perfil conocido tiene más de 30 min: si mañana cae Redis y la API, el modo degradado tendría datos viejos |
| **`AaaLatenciaAlta`** | Telegram (Alertmanager) | p95 de autorización > 100 ms durante 10 min |
| Llamadas de clientes "no tengo internet" que acaban de reiniciar su router | Soporte | Síntoma típico: los conectados no notan nada |

El vigía usa `/health`, que sigue en 200 en modo degradado: en ese caso avisa `AaaDegradado`, no "aaa caído".

## Qué hacer

`dc` = `docker compose -f infra/docker-compose.yml` en el servidor (perfil `lab`/producción con `COMPOSE_PROFILES`).

### 1. Ver qué está caído (2 min)

```sh
dc ps aaa freeradius redis api              # ¿healthy?
curl -s localhost:3100/health               # aaa: {"redis":"ok|caido","modo":"normal|degradado",...}
dc logs --tail 50 aaa                       # "modo degradado: inicio", errores de Redis o de la API
dc logs --tail 50 freeradius
```

### 2. Reiniciar lo que no responde

```sh
dc restart aaa                  # el proceso aaa (arranca en segundos; carga el último perfil conocido del volumen aaa-datos)
dc restart freeradius           # si FreeRADIUS no responde (healthcheck Status-Server)
dc up -d redis                  # si Redis está detenido; aaa vuelve solo a Redis al recuperarse
```

Si el contenedor no arranca (error de configuración tras un cambio): `dc logs aaa`, volver a la imagen anterior (`IMAGE_TAG=<anterior> dc up -d aaa`) y avisar a quien hizo el cambio.

Con **dos nodos** (`radiusAddr2` en el MikroTik): si un nodo cae, el MikroTik usa el otro sin intervención. Reiniciar el caído con calma.

### 3. Si no vuelve en 15 minutos: secrets locales en el MikroTik (último recurso)

**Pendiente de laboratorio.** Con `/ppp aaa use-radius=yes`, RouterOS busca primero en `/ppp secret` y solo después pregunta a RADIUS. Cargar los clientes como secrets locales los deja entrar sin `aaa`, **pero sin los controles de ArgosIsp**: no hay corte por mora, ni IPs/prefijos asignados por el sistema, ni accounting. Por eso es temporal y se quita en cuanto `aaa` vuelve.

1. Exportar los secrets del router afectado (`user_ppp`, clave y perfil). El script de exportación por router está **pendiente** (pedido a A2/A1: comando que lea `core.servicios` del router y genere un `.rsc` con `/ppp secret add ... comment=argosisp-emergencia`). Mientras no exista, no hacer este paso a mano con miles de clientes: priorizar levantar `aaa`.
2. Importar el `.rsc` en el MikroTik (`/import file=argos-emergencia.rsc`).
3. Al volver `aaa`: `/ppp secret remove [find comment=argosisp-emergencia]` y desconectar esas sesiones por grupos para que vuelvan a autenticar por RADIUS.

### 4. Avisar

- Al equipo (el chat ya recibió la alerta): quién atiende y qué se está haciendo.
- A soporte: "clientes que reinicien su router pueden quedar sin internet hasta las HH:MM; no hace falta visita técnica".

## Después de que vuelve

1. **Alertas resueltas**: "RESUELTO · RADIUS (aaa) recuperado" en Telegram y `ServicioSinMetricas`/`AaaDegradado` resueltas en Alertmanager.
2. **Clientes que quedaron fuera**: los que intentaron conectarse durante la caída reintentan solos (el router del cliente reintenta cada pocos segundos). Revisar en el panel que las sesiones activas del router vuelven al número de antes (o `select count(*) from network.sesiones where fin is null and router_id = …`). **Pendiente de laboratorio**: medir cuánto tarda un CPE típico en reintentar.
3. **Cambios hechos durante la caída** (pagos, cortes, cambios de plan): llegan por evento a `coa` y se aplican a las sesiones vivas; los que se reconecten entran con el perfil nuevo. Si hubo modo degradado, revisar en `audit.red` los CoA de ese rato.
4. **Accounting perdido**: el consumo de la ventana sin Interim-Update no se recupera. Una sesión que terminó durante la caída puede quedar abierta en `network.sesiones` (su `Stop` no llegó): se cierra con el `Accounting-On` del NAS al reiniciar el router o a mano. Hoy no hay cierre automático por inactividad (pendiente, A2). No afecta facturación (no se cobra por consumo).
5. **Redis**: si se perdió, `aaa` repuebla las claves al autorizar (o `node ace aaa:repoblar` cuando A1 lo publique). Ver "Forzar el repoblado de Redis" en el runbook técnico.
6. **Bitácora**: anotar en `.claude/STATUS.md` (bitácora del piloto) hora de inicio y fin, causa, clientes afectados y si se usaron secrets locales.

## Probado y pendiente

| Qué | Estado |
| --- | --- |
| Alerta "aaa caído" a Telegram desde el vigía | Probado en pruebas de integración (`tests/notify/alertas.spec.ts`) |
| Alertas de Prometheus a Telegram en < 1 min | Probado (`infra/monitoring/probar-alertas.sh`: 32 s) |
| FreeRADIUS rechaza si `aaa` no responde (0,8 s) | Configuración validada (`radiusd -XC` en CI); prueba con `radclient` en `tests/network/freeradius.spec.ts` |
| El MikroTik mantiene las sesiones activas sin RADIUS | **Pendiente de laboratorio** |
| Failover a la segunda entrada `/radius` con dos nodos | **Pendiente de laboratorio** |
| Secrets locales de emergencia (export, import, retiro) | **Pendiente de laboratorio** y del script de exportación |
| Tiempo de reintento de los CPE tras la caída | **Pendiente de laboratorio** |
