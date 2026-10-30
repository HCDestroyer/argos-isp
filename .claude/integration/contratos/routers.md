# Contrato · Routers duplicados y unión de routers

Dueño: A1. Desde 2026-10-29 (pedido del PM: «cuando tengo agregado 2 veces el mismo router ya no sabe cuál es el que se está usando»).

Un mismo MikroTik registrado dos veces (p. ej. para usar dos modos de control de velocidad) rompe tres cosas: el reconciliador de RouterOS de cada registro borra como huérfanos los objetos `argosisp:` del otro, las sesiones RADIUS se atribuyen a uno solo por `nas_ip` y el panel no sabe cuál es el real. Dos modos de control en el mismo equipo se configuran **por plan** dentro de un solo router (A2, `contratos/velocidad.md`), nunca con dos registros.

## 1. Mismo equipo

Dos routers son el mismo equipo si coinciden en alguna clave:

| Clave (`motivo`) | Valor | Fuente |
| --- | --- | --- |
| `api` | `host:puerto` de la API REST: el de `api_url`, o el de `https://<host>` (un `host` con esquema se usa tal cual). Minúsculas; puerto por defecto 443 (`https`) u 80 (`http`) | `extremoApi` de `app/network/routers_duplicados.ts` |
| `nas_ip` | La `nas_ip` (además UNIQUE en la base) | `network.routers.nas_ip` |
| `serial` | `serial-number` de `/system/routerboard` o, en un CHR, `software-id` de `/system/license` (sin distinguir mayúsculas) | `network.routers.serial`, lo escribe el sondeo |

`Router.serial` (texto o null) y `Router.unido_a_id` (id o null) salen en la vista `Router`; opcionales en el OpenAPI hasta que las fixtures del panel los traigan (la API siempre los envía).

**Serial.** `routeros.sondear` (cron cada 5 min, routers con credenciales y sin contacto reciente), cuando el router responde **y** su `serial` es null o vuelve de estar caído (sin contacto más allá del umbral de `en_linea`, `SESIONES_COLGADAS_INTERVALOS` × `AAA_INTERIM_SEGUNDOS`), lee `/system/routerboard` y, si no trae `serial-number`, `/system/license`. Si cambió, lo guarda sin subir `version` y deja el diff (`campo = serial`) en `audit.cambios`; la lectura queda en `audit.red` (`comando.operacion = identificar`, `comando.ruta` = la ruta que respondió). Nunca bloquea: un router que no lo informa queda con `serial` null.

## 2. Impedir y detectar

**Alta y edición.** `POST /routers` y `PUT /routers/:id` responden **409** `router_duplicado` (`type: urn:argosisp:problema:router_duplicado`) si chocan con otro router **activo** por `api` o con **cualquier** router por `nas_ip` (incluidos los desactivados: es UNIQUE):

```json
{
  "type": "urn:argosisp:problema:router_duplicado",
  "title": "Router duplicado",
  "status": 409,
  "detail": "Ese MikroTik ya está registrado como «MK Centro». Para usar dos formas de control de velocidad en el mismo router, configúralas por plan en su ficha.",
  "errors": [
    { "field": "host", "rule": "router_duplicado", "message": "Ya está registrado como «MK Centro» (router 12): misma dirección de la API (10.0.0.1:443)" }
  ]
}
```

- `field` es `host` (o `api_url` si vino), `nas_ip` o `serial`; una entrada por choque, con el nombre y el id del otro router en `message`.
- La edición solo revisa lo que cambia: el extremo de la API, la `nas_ip`, o reactivar un router (`activo: true`), que revisa todo, también el serial. Así dos registros que ya existían se pueden seguir editando hasta unirlos.
- Reactivar un router unido (`unido_a_id` no null) es **422** `router_unido`.
- Un router desactivado con el mismo host no bloquea el alta.

**Detección.** `GET /api/v1/routers/duplicados?router_id=` (permiso `routers.ver`, alcance por router) → lista de grupos de routers **activos** que comparten alguna clave (clausura: si A y B comparten la API y B y C el serial, A, B y C son un grupo):

```json
[{
  "motivos": ["api", "serial"],
  "claves": [{ "motivo": "api", "valor": "10.0.0.1:443" }],
  "routers": [{
    "id": 12, "nombre": "MK Centro", "host": "10.0.0.1", "api_url": null, "nas_ip": "10.0.0.1",
    "serial": "HE1234", "control_velocidad": "simple", "servicios_total": 120, "sesiones_abiertas": 98,
    "servicios": [{ "id": 5, "cliente_id": 9, "user_ppp": "ana.9", "estado": "activo", "tipo_conexion": "pppoe" }],
    "version": 4
  }]
}]
```

`servicios` trae los primeros 50 no retirados (por id). Con `router_id`, solo el grupo de ese router (lista vacía si no tiene duplicados): es lo que usa la ficha para el aviso.

## 3. Unir

`POST /api/v1/routers/:id/unir { absorber_id, version, simular? }` (acción y permiso `routers.unir`, **solo admin**; `Idempotency-Key`). El router `:id` queda y absorbe a `absorber_id`. `version` es la del router `:id` (409 si cambió).

**Secreto RADIUS** (decisión del líder, 29 oct): si los dos registros tienen secretos RADIUS distintos (en claro; dos sin secreto cuentan como iguales), responde **422** `secreto_radius_distinto`: el CoA de las sesiones movidas sale con la `nas_ip` y el secreto del que queda y el equipo daría NAK. Primero se deja el mismo secreto en el MikroTik (`/radius`) y en Argos, y después se une. La simulación no falla: lo devuelve en `bloqueos` con su aviso.

En una transacción, con auditoría:

1. **Planes.** Cada `planes_routers` del absorbido pasa al que queda (diff `plan_router`). Si los dos implementan el mismo plan, **gana la del que queda** y la del absorbido se borra (diff a null; aviso). Cada implementación que llega emite `plan.velocidad_cambiada` (`router_id` = el que queda) si trae campos de cola, y reescribe `aaa:user:*` de los servicios de ese plan en el que queda.
2. **Redes y pools.** Redes IPv4 y bloques IPv6 (sus pools van con el bloque) pasan al que queda (diff `red_ipv4` / `ipv6_bloque`).
3. **Servicios.** Cada servicio no retirado pasa con `servicios.editar` anidada (`mismo_equipo`): diff `router_id`, `servicio.config_cambiada` con `campos: ['router']` y `motivo: 'union_routers'`, write-through de `aaa:user:*` y RouterOS por evento. **Las direcciones no cambian** (sin `asignacion.cambiada`). Si uno no puede pasar, 422 `servicio_no_unible` y no cambia nada. Los retirados quedan en el historial del absorbido (aviso).
4. **Sesiones abiertas** del absorbido pasan al que queda (diff `sesion`). El accounting que siga llegando con la `nas_ip` de un router unido se atribuye al que queda (`coalesce(unido_a_id, id)`).
5. **Absorbido.** Se desactiva con `routers.editar` anidada y queda `unido_a_id` (diff). Los routers que ya estaban unidos al absorbido pasan a apuntar al que queda (diff; `reencadenados`), así `unido_a_id` siempre está a un salto del router vigente. No se elimina (conserva su historial; `routers.eliminar` aún no está en main). Ya no aparece en los duplicados.

RouterOS después de unir (A2):
- El dispatcher (`AplicarRedServicio`) no limpia en un router unido: `routersConHistorial` lo excluye. Limpiar ahí borraría en el mismo equipo lo que se acaba de asegurar en el que queda.
- El reconciliador del que queda ve los servicios como suyos (no son huérfanos); el del absorbido se omite (inactivo).
- Si el absorbido tenía otro control de velocidad, sus servicios quedan con el del que queda (aviso). El objeto del plan del modo anterior lo limpia el control del que queda.

**Simular.** `simular: true` corre todo y lo revierte (`simularEnTransaccion`): ni cambios, ni auditoría, ni eventos. Responde lo mismo con `simulado: true`.

Respuesta (`UnionRouters`):

| Campo | Qué |
| --- | --- |
| `router_id`, `absorbido_id` | Los dos routers |
| `simulado` | true en la simulación |
| `coincidencias` | Claves que comparten (`api`, `nas_ip`, `serial`); vacío = no parecen el mismo equipo (aviso) |
| `servicios[]` | `{ servicio_id, user_ppp, estado, tipo_conexion }` que pasan |
| `redes_ipv4[]`, `ipv6_bloques[]` | Ids que pasan |
| `planes_movidos[]`, `planes_descartados[]` | `plan_id` que pasan y los del absorbido que se descartan por choque |
| `sesiones_abiertas` | Cuántas pasan |
| `bloqueos[]` | Solo en la simulación: lo que hará fallar la unión (`secreto_radius_distinto`); vacío = se puede |
| `reencadenados[]` | Routers que ya estaban unidos al absorbido y ahora apuntan al que queda |
| `avisos[]` | Texto para el operador: no parecen el mismo equipo, control de velocidad distinto, plan implementado en los dos, RADIUS llega con la `nas_ip` del absorbido (une al revés o cambia el NAS en el equipo), bodegas asociadas al absorbido, servicios retirados que quedan, absorbido desactivado |
| `router`, `absorbido` | Vista `Router` de los dos después de unir |

Errores: 422 `secreto_radius_distinto`; 404 si `:id` no existe; 422 `validacion` si `absorber_id` no existe o es el mismo; 422 `router_unido` si alguno ya está unido; 422 `router_inactivo` si el que queda está desactivado; 409 `conflicto_version`; 403 sin `routers.unir` o fuera del alcance de alguno de los dos.

**RADIUS.** El absorbido queda inactivo y deja de ser cliente de FreeRADIUS (`pnpm aaa:clients` solo genera los activos). Debe quedar el registro cuya `nas_ip` y secreto usa el equipo; si no, la simulación lo avisa.
