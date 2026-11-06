# Contrato · Tipo de conexión por router

Decisión del PM (5 nov): el tipo de conexión (`pppoe`, `ip_estatica`, `dhcp_fija`) lo define el **router**, uno por router, igual que el modo de velocidad (`control-velocidad.md` §11). Ya no se elige servicio por servicio. Dueño: A1. Manda sobre `routeros.md` donde choquen.

## 1. Router

- `network.routers.tipo_conexion` text NOT NULL DEFAULT `'pppoe'` (CHECK `routers_tipo_conexion`). Sale en el esquema `Router` (`tipo_conexion`, obligatorio).
- Relleno de la migración: cada router existente quedó con el tipo que más usan sus servicios no retirados (empate: `pppoe`, luego `ip_estatica`); sin servicios, `pppoe`.
- `POST /routers` acepta `tipo_conexion` (opcional, `pppoe` por defecto).
- `PUT /routers/:id` acepta `tipo_conexion` **solo si ningún servicio no retirado cambiaría**; si no, 422 `tipo_conexion_con_servicios` con un `errors[]` por servicio (`field: servicios.<id>`, hasta 50). Pasar a `pppoe` un router `api` sin usuario y clave de la API: 422 `pppoe_local_requiere_api`. Emite `router.tipo_conexion_cambiado` con `motivo: 'edicion'`, `servicios: []`.

## 2. Alta y edición de servicio

- `POST /servicios`: `tipo_conexion` es **opcional**; el servicio toma el del router. Si llega distinto: 422, `type` `urn:argosisp:problema:tipo_conexion_del_router`, `errors[0] = { field: 'tipo_conexion', rule: 'tipo_conexion_del_router', message }` con el detalle en español («este router es IP estática…»). Igual al del router: sigue funcionando.
- `PUT /servicios/:id`:
  - con otro `router_id`: adopta el tipo del router destino. `tipo_conexion` distinto del destino → 422 `tipo_conexion_del_router`. Lo que haga falta se valida como siempre: a `dhcp_fija` sin `mac` → 422 en `mac`; a `pppoe` se generan `user_ppp`/`pass_ppp` (o se aceptan los que vengan); sin PPPoE necesita IPv4 de las redes del router (422 `sin_ipv4`); los modos IPv6 por RADIUS pasan a `ninguno`.
  - en el mismo router: `tipo_conexion` solo acepta el actual del servicio o el del router (pasar a él = unificar ese servicio); otro → 422 `tipo_conexion_del_router`.
- Reglas que siguen: PPPoE en un router `api` sin credenciales de la API → 422 `pppoe_local_requiere_api` (`pppoe-local.md`; reemplazó a `pppoe_requiere_radius`).
- `routers.unir` (mismo MikroTik) conserva el tipo de cada servicio.
- Importador (`app/importacion`): los servicios del origen conservan su tipo aunque difieran del router (`conservarTipo`, solo interno); quedan como «difiere del router».

## 3. Cambiar el tipo de un router con servicios

**Vista previa** `GET /api/v1/routers/:id/vista-previa-tipo-conexion?tipo=` (permiso `routers.ver`; no escribe ni habla con el router) → `VistaPreviaTipoConexion`:

```json
{
  "router_id": 4, "router_version": 7,
  "tipo_actual": "pppoe", "tipo": "dhcp_fija",
  "aplicable": false,
  "bloqueos": [],
  "resumen": { "servicios": 2, "cambian": 2, "con_faltantes": 1, "difieren_del_router": 0 },
  "servicios": [
    { "servicio_id": 10, "cliente_id": 3, "cliente_nombre": "Rosa", "user_ppp": "rosa.3", "estado": "activo",
      "tipo_conexion": "pppoe", "difiere_del_router": false, "cambia": true,
      "faltan": ["mac"], "se_completa": ["ipv6_modo"],
      "mensajes": ["DHCP fija necesita la MAC del equipo: complétala en el servicio"] }
  ]
}
```

- Sin `tipo`: el actual del router. Entonces `cambia` = `difiere_del_router` (la vista de «unificar»).
- `faltan` (bloquean): `mac` (a `dhcp_fija` sin MAC), `ipv4` (sin IPv4 y el router sin redes IPv4), `plan` (plan solo IPv6 y sin PPPoE). `mensajes[i]` explica `faltan[i]`.
- `se_completa` (no bloquean): `credenciales` (a `pppoe`: se generan), `ipv4` (se asigna de las redes del router), `ipv6_modo` (`radius_*` → `ninguno`), `amarre_ip_mac` (se quita al pasar a `pppoe`).
- `bloqueos`: `pppoe_local_requiere_api` (a `pppoe` en un router `api` sin credenciales de la API).
- `aplicable` = sin bloqueos y sin faltantes.

**Acción `routers.cambiar_tipo_conexion`** (permiso del mismo nombre, solo `admin`): `POST /api/v1/routers/:id/cambiar-tipo-conexion` `{ version, tipo_conexion, motivo? }`, acepta `Idempotency-Key`.

- 409 si `version` (la del router, `router_version` de la vista previa) cambió.
- 422 `pppoe_local_requiere_api`; 422 `tipo_conexion_servicios_incompletos` con un `errors[]` por falta (`field: servicios.<id>.<mac|ipv4|plan>`); 422 `router_inactivo`. Nada se aplica a medias (una transacción).
- Pone el tipo del router (diff `router`) y pasa **cada** servicio no retirado que no tiene el tipo nuevo con `servicios.editar` anidada: auditoría y diff por fila, nunca un UPDATE masivo. Cada uno emite `servicio.config_cambiada` con `campos` ⊇ `['tipo_conexion']` (más `ips`, `prefijo_v6` si cambiaron), que RouterOS, `aaa-cache` y `coa` ya atienden como cualquier cambio de tipo.
- Con el tipo actual = **unificar**: solo pasan los servicios que difieren.
- Respuesta `ResultadoCambiarTipoConexion { router: Router, de, a, servicios: number[] }`.

## 4. Evento `router.tipo_conexion_cambiado`

| Campo | Valor |
| --- | --- |
| `router_id` | entero |
| `empresa_id` | empresa sugerida del router (null = compartido) |
| `de`, `a` | `pppoe` \| `ip_estatica` \| `dhcp_fija` (iguales con `unificar`) |
| `servicios` | ids que pasaron a `a` (vacío con `edicion`) |
| `motivo` | `cambio` (`routers.cambiar_tipo_conexion` con otro tipo), `unificar` (mismo tipo), `edicion` (`PUT /routers/:id` sin servicios) |

Se emite después de los `servicio.config_cambiada` de sus servicios, en la misma transacción. Es informativo: la red reacciona por los eventos de cada servicio. El motivo del usuario va en la auditoría (`audit.acciones.entrada`).

## 5. Servicios existentes

Los que hoy no coinciden con su router se quedan como están: se siguen editando y funcionando. La vista previa los marca con `difiere_del_router: true` y el panel puede ofrecer «Unificar» (`POST …/cambiar-tipo-conexion` con el tipo actual del router).

## 6. Iris

`contratos/iris.md` §3.2: Iris no manda `tipo_conexion` en `POST /servicios`; el servicio toma el del router. Si algún día lo manda, debe ser el del router (si no, 422 `tipo_conexion_del_router`).
