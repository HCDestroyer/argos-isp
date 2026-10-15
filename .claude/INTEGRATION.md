# INTEGRATION.md — Dependencias entre agentes

Cada agente anota aquí lo que necesita de otro, con fecha. El PM lo revisa dos veces al día y asigna dueño. Se borra la línea cuando se resuelve.

| Fecha | Quién pide | A quién | Qué | Estado |
| --- | --- | --- | --- | --- |
| 2026-10-15 | Líder FE | A1 | Confirmar nombres de permisos `<recurso>.ver` del menú (`apps/web/app/utils/navegacion.ts`) contra el seed del ACL (`apps/api/database/seeders/acl_seeder.ts`) | A1: coinciden todos salvo `caja.ver` del menú; el permiso es `cajas.ver` → corregir en `navegacion.ts` (Líder FE) |
| 2026-10-15 | Líder FE | A1 | Panel: llamar `POST /auth/logout` (ya existe) al cerrar sesión; hoy solo borra la cookie | Abierto |
| 2026-10-15 | Líder FE | A1, A4 | Exponer `Schema<'Servicio'>` con `estado` en el OpenAPI para reemplazar el tipo local `EstadoServicio` del panel | A1: `Servicio` y `EstadoServicio` ya están en el contrato y `GET /servicios`, `/servicios/:id` son reales (tarea 6) |
| 2026-10-15 | Líder FE | A5 | Reemplazar el tipo local `DatosCorte` de `useCorte.ts` por la respuesta de `GET /portal/quien-soy` del contrato | Abierto |
| 2026-10-15 | PM | A5, A6 | Decidir cómo llega el portal a la API dentro del walled garden: proxy en el mismo origen o CORS con credenciales | Abierto |
| 2026-10-15 | PM | A5 | Servir `/corte` para cualquier Host y ruta en el puerto de corte del MikroTik (`portalCortePuerto` en `lab.rsc`) | Abierto |
| 2026-10-15 | PM | A2 | Reactivar con Disconnect-Request, no con CoA: probado en RouterOS 7.24.5, CoA de reactivación deja IPv6 cortado. Suspender por CoA sí funciona (`Mikrotik-Address-List` + `Filter-Id="argos-corte.in"` + rate-limit). Ver `infra/mikrotik/README.md` | Abierto |
| 2026-10-15 | PM | A2, A5, A6 | Suspendido por IPv6 queda bloqueado pero no redirigido a `/corte` (TCP recibe reset). Falta definir cómo cumplir "aterriza en `/corte` por IPv6" del día 5 | Abierto |
| 2026-10-15 | PM | A2 | El accounting del MikroTik no trae `Delegated-IPv6-Prefix`; afecta el modo `radius_pool` de la semana 2 | Abierto |
| 2026-10-15 | Líder BE | A3 | knex/Lucid no rechaza `commit()` cuando falla una restricción diferida (cuadre del libro): revierte en silencio. `DomainAction` ya hace `SET CONSTRAINTS ALL IMMEDIATE`; fuera de una acción llamar `verificarRestriccionesDiferidas(trx)` | Atendido por A3 (tarea 2): `registrarAsiento` fuerza el cuadre con `SET CONSTRAINTS ledger.asientos_cuadre, ledger.movimientos_cuadre IMMEDIATE` dentro de la acción, también anidada; pruebas en `tests/ledger/registrar_asiento.spec.ts`. Pendiente de revisión del líder |
| 2026-10-15 | Líder BE | A1 | Relay de outbox, CRUD completo del ACL con alcances y tokens de API (tarea 2 y 10 de A1) | Abierto |
| 2026-10-15 | Líder BE | A6 | Cron mensual que llame `audit.crear_particiones` | Abierto |
| 2026-10-15 | Líder BE | A6 | Producción: usuario de Postgres dueño para migraciones y otro miembro de `argosisp_app` para la API; hoy el compose usa el mismo `DB_USER` | Abierto |
| 2026-10-15 | Líder FE | Líder FE | `formato.ts`, `fetchFixtures.ts` y `EstadoServicioBadge` están duplicados en web y portal; decidir si van a un paquete compartido en `packages/` | Abierto |
| 2026-10-15 | A3 | A1 | `// NEEDS(a1)`: agregar a `app/core/permisos.ts` los permisos `libro.registrar_asiento` y `libro.revertir_asiento` (rol `contabilidad`) para exponer ajustes manuales y reversos en `/libro/asientos`. Hoy las acciones existen y se auditan con ese nombre, pero sin endpoint | Abierto |
| 2026-10-15 | A3 | A1 | `// NEEDS(a1)` tarea 11 de A1: campos permitidos en `core.servicios_excepciones.campo`: `dia`, `prorrateo`, `dias_gracia`, `facturas_para_limitar`, `facturas_para_cortar`, `mora_tipo`, `mora_valor`, `mora_recurrente`, `hora_corte`, `certificar_al`, `reglas_promesa` (objeto parcial). No exceptuables: `nombre`, `ciclo`. Antes de guardar llamar `validarExcepcion(campo, valor)` de `#billing/excepciones` (lanza 422 y devuelve el valor normalizado para `valor jsonb`); `obtenerConfiguracionEfectiva(servicio_id)` debe devolver `aplicarExcepciones(plantilla, filas)` (tipo `ConfiguracionFacturacion`). Tabla y formatos en `apps/api/app/billing/README.md` | Abierto |
| 2026-10-15 | A3 | A1 | `// NEEDS(a1)`: para `generarFacturas` (día 3) A3 lee `core.servicios` (estado, plan_id, plantilla_facturacion_id, fecha_instalacion, costo_override) y `network.planes` (precio, bajada_limitada_kbps); confirmar que esas columnas no cambian de nombre, y que `cambiarEstadoServicio(servicio_id, nuevo, motivo)` acepte `{ trx }` para correr anidada en la transacción de `evaluarEstadoServicio` | Abierto |
| 2026-10-15 | Líder BE | A3 | knex/Lucid no rechaza `commit()` cuando falla una restricción diferida (cuadre del libro): revierte en silencio. `DomainAction` ya hace `SET CONSTRAINTS ALL IMMEDIATE`; fuera de una acción llamar `verificarRestriccionesDiferidas(trx)` | Abierto |
| 2026-10-15 | Líder BE | A1 | Relay de outbox, CRUD completo del ACL con alcances y tokens de API (tarea 2 y 10 de A1) | A1: ACL hecho (tarea 2: usuarios, roles, permisos, tokens `atk_`, alcance router/zona/caja en `ctx.alcance`); relay pendiente (tarea 10) |
| 2026-10-15 | Líder BE | A6 | Cron mensual que llame `audit.crear_particiones` | Abierto |
| 2026-10-15 | Líder BE | A6 | Producción: usuario de Postgres dueño para migraciones y otro miembro de `argosisp_app` para la API; hoy el compose usa el mismo `DB_USER` | Abierto |
| 2026-10-15 | Líder FE | Líder FE | `formato.ts`, `fetchFixtures.ts` y `EstadoServicioBadge` están duplicados en web y portal; decidir si van a un paquete compartido en `packages/` | Abierto |
| 2026-10-20 | A2 | A1 | Publicar `aaa:user:<user_ppp>` en Redis y `GET /internal/aaa/servicio?user_ppp=` con el contrato de abajo ("Contrato aaa ← A1"). Mientras no existan, `aaa` corre con `AAA_RESPALDO=fixtures` (`services/aaa/fixtures/servicios.json`) | Abierto |
| 2026-10-20 | A2 | A1, Líder BE | Cifrar `core.servicios.pass_ppp` y `network.routers.radius_secret` con el formato `v1` de abajo y `AAA_PPP_KEY`, no con `encryption` de AdonisJS: `aaa` y `coa` no tienen `APP_KEY` y deben descifrarlos | Abierto |
| 2026-10-20 | A2 | A1 | Al limitar, `aaa` usa `planes.subida_limitada_kbps`/`bajada_limitada_kbps`; hoy pueden ser 0 (default). Con 0 `aaa` entrega la velocidad completa y avisa en el log. Pedir > 0 en el validador del plan | Abierto |
| 2026-10-20 | A2 | A6 | Compose del perfil `lab`, servicio `aaa`: agregar `AAA_RESPALDO: ${AAA_RESPALDO:-fixtures}` (cambiar a `api` cuando A1 publique el endpoint) y documentarla en `infra/.env.example` | Abierto |

## Contrato aaa ← A1 (pedido por A2, 2026-10-20)

Redis `aaa:user:<user_ppp>` (sin TTL) y `GET /internal/aaa/servicio?user_ppp=<user_ppp>` devuelven el mismo JSON. Validador: `services/aaa/src/servicio.ts`.

```json
{
  "servicio_id": 101,
  "version": 3,
  "user_ppp": "cliente-101",
  "pass_ppp": "v1.<iv>.<tag>.<datos>",
  "estado": "activo",
  "router_id": 1,
  "plan": {
    "id": 1,
    "subida_kbps": 5120,
    "bajada_kbps": 20480,
    "subida_limitada_kbps": 1024,
    "bajada_limitada_kbps": 2048,
    "rate_limit_override": null,
    "profile_ppp": null
  },
  "ipv4": { "modo": "estatico", "ip": "10.10.1.10" },
  "ipv6": { "modo": "radius_servicio", "prefijo_enlace": "2001:db8:101:1::/64", "prefijo_delegado": "2001:db8:300:100::/56" }
}
```

- `estado`: `activo` | `limitado` | `suspendido` | `retirado` (`core.servicios.estado` tal cual; `aaa` no decide estados).
- `plan.*`: de `network.planes`; `rate_limit_override` y `profile_ppp` de `network.planes_routers` para el router del servicio (null si no hay fila o no está definido).
- `ipv4`: `{"modo":"estatico","ip":"<ipv4>"}` con la asignación vigente de `network.ipv4_asignaciones`, `{"modo":"pool","pool":"<planes_routers.pool_ipv4>"}`, o `null`.
- `ipv6`: según `core.servicios.ipv6_modo`. `radius_servicio` → `{"modo":"radius_servicio","prefijo_enlace":"<.../64>","prefijo_delegado":"<.../56|/48>"}` (asignaciones vigentes, `null` si falta alguna); `radius_pool` → `{"modo":"radius_pool","pool_enlace":"<planes_routers.pool_ipv6_enlace>","pool_delegacion":"<planes_routers.pool_ipv6_delegacion>"}`; `duid`, `estatico`, `ninguno` → `{"modo":"<modo>"}`. `null` equivale a `ninguno`.
- `pass_ppp`: siempre cifrada, nunca en claro en Redis ni en la respuesta HTTP.
- `version`: `core.servicios.version` (diagnóstico).
- Endpoint: `Authorization: Bearer <AAA_INTERNAL_TOKEN>`; 200 con el JSON; **404 si no existe el `user_ppp`**; un servicio retirado devuelve 200 con `estado: "retirado"`; cualquier otro código lo trata `aaa` como error. Debe responder en < 300 ms.
- Escritura en Redis (A1): **SET con el JSON completo** (write-through) después del commit, en cada cambio que altere cualquier campo (servicio, plan, `planes_routers`, asignaciones, estado). No usar solo `DEL`: `aaa` repuebla con `SET NX` y un `DEL` podría competir con una lectura vieja de la API. Al borrar el servicio o cambiar su `user_ppp`, escribir en la clave vieja una lápida `{"eliminado": true, "user_ppp": "<viejo>"}`.
- Cifrado `v1` (para `pass_ppp` y `network.routers.radius_secret`): AES-256-GCM con la clave `AAA_PPP_KEY` (32 bytes en base64), IV aleatorio de 12 bytes, tag de 16; texto `v1.` + base64url(iv) + `.` + base64url(tag) + `.` + base64url(cifrado), sin relleno. Referencia: `services/aaa/src/cifrado.ts` (`cifrar`/`descifrar`).
| 2026-10-15 | A6 | A1 | Relay del outbox: por cada evento llamar `ConsumidorNotify.procesar({ id, evento, payload, requestId })` (`apps/api/app/notify/consumidor.ts`, ejemplo en `app/notify/README.md`); reintentar si lanza. Si el relay define su propia interfaz de consumidor, mover `ConsumidorEventos`/`EventoEntrante` a `app/shared` | Abierto |
| 2026-10-15 | A6 | A3 | Agregar `comprobante.aprobado` y `comprobante.rechazado` al catálogo (`app/shared/eventos.ts`) con al menos `comprobante_id`, `pago_id`, `cliente_id` y `motivo` (rechazo). notify ya tiene plantillas y los acepta por prefijo | Abierto |
| 2026-10-15 | A6 | PM | Criterio "cliente con Telegram vinculado recibe el mismo aviso": decisión del PM (2026-10-15): por los dos canales, para que llegue por cualquier medio. Implementado en la PR #6 | Resuelto |
| 2026-10-15 | A6 | Líder BE | Tarea 5 toca archivos compartidos (mínimo): `app/core/permisos.ts` (`notificaciones.ver`, `notificaciones.editar`; `ver` en soporte), `start/env.ts` (SMTP_*, TELEGRAM_*, NOTIFY_*, COLAS_PREFIJO), `start/routes/index.ts`, alias `#notify/*` en `package.json`, migraciones `1760910000001_notify_entrega` y `1760910000002_notify_recordatorios` (tarea 6), seeder `notify_plantillas_seeder`, comando `commands/notify_worker.ts` | Abierto |
| 2026-10-15 | A6 | A1 | Vincular Telegram: flujo del bot (`/start <código>`) que llene `core.clientes.telegram_chat_id` por una acción de A1 (`clientes.vincular_telegram`); A6 hace el webhook del bot si A1 expone la acción | Abierto |
| 2026-10-15 | A5 | Líder FE | `DatosCorte` reemplazado por `Schema<'QuienSoy'>` del contrato en `useCorte()` (tarea 1). Puede cerrarse la fila del Líder FE | Resuelto (A5) |
| 2026-10-15 | A5 | A6, PM | Decisión acceso portal → API: **proxy en el mismo origen**. El navegador llama a `/api/v1/portal/**` del portal y Nitro reenvía a `NUXT_API_BASE_INTERNAL` con `X-Forwarded-For` (solo ese prefijo; el resto de la API no se expone). En `infra/docker-compose.yml`: `NUXT_PUBLIC_API_BASE` vacío (hoy toma `API_PUBLIC_URL`), `NUXT_API_BASE_INTERNAL=http://api:3333`. Sin CORS ni API en el walled garden. Ver `apps/portal/README.md` | Abierto (A6: compose) |
| 2026-10-15 | A5 | A6 | Publicar el puerto del portal conservando la IP real del cliente (dst-nat del MikroTik + iptables de Docker; sin `userland-proxy`, que en IPv6 la reemplaza por la del puente, o `network_mode: host`). Sin eso `quien-soy` no identifica a nadie | Abierto |
| 2026-10-15 | A5 | A6 | `/corte` para cualquier Host y ruta ya está en el portal (tarea 2, `server/middleware/portal-cautivo.ts`): pruebas de conectividad de Android/Apple/Windows/Firefox/Linux y Hosts ajenos → 302 a `/corte`. En compose/lab: `NUXT_PORTAL_URL_PUBLICA=http://<portalFqdn>`, `NUXT_PORTAL_HOSTS=<portalV4>,<portalV6>` y `PORTAL_PORT_HOST=<portalCortePuerto>` (80) hacia el 3001 del contenedor. Cierra la fila del PM sobre `portalCortePuerto` | Abierto (A6: compose) |
| 2026-10-15 | A5 | A6 | Walled garden del portal hoy: solo el propio portal (`portalFqdn`, `portalV4`, `portalV6`) y DNS. Sin fuentes, iconos ni CDNs externos (verificado con Playwright: 0 peticiones fuera del host). La pasarela de pago se agrega en la semana 2. Quitar `pagos.argosisp.example` y `pasarela.example` de `walledGarden` en `lab.rsc` hasta entonces | Abierto |
| 2026-10-15 | A5 | A1 | `GET /ip/{ip}`: hoy `portal.quien_soy` (`apps/api/app/portal/actions/identificar_por_ip.ts`) resuelve la IP contra `network.sesiones` activas (ipv4, `prefijo_enlace_v6`/`prefijo_delegado_v6` por contención) y asignaciones vigentes IPv4/IPv6. Cuando A1 publique la acción, el portal la llama y se borra `resolverServicio` | Abierto |
| 2026-10-15 | A5 | Líder BE | Agregar a `apps/api/start/env.ts` y `.env.example`: `PORTAL_PROXIES_CONFIABLES` (IPs/CIDR del portal y proxies delante; vacía = ignora `X-Forwarded-For`) y `PORTAL_CABECERA_IP` (defecto `x-forwarded-for`). Hoy se leen de `process.env` en `app/portal/ip_origen.ts`. Las pruebas viven en `apps/api/tests/portal/` (el glob de Japa solo mira `tests/`) | Abierto |
| 2026-10-15 | A5 | A6 | Compose: `PORTAL_PROXIES_CONFIABLES` de la API = red del contenedor del portal (y del proxy inverso si hay). Sin esa variable `quien-soy` ve la IP del portal y no identifica a nadie | Abierto |
| 2026-10-15 | A5 | A1, Líder BE | `GET /portal/quien-soy` es público y sin límite de tasa; proponer rate limit por IP (middleware compartido) antes del piloto | Abierto |
| 2026-10-20 | A1 | A3 | Alcance por caja: `autorizar` deja `ctx.alcance`; en rutas de cajas aplicar `exigirAlcance(ctx.alcance, { caja: [cajaId] })` y `filtrarPorAlcance(q, ctx.alcance, { caja: (q, ids) => q.whereIn('c.id', ids) })` de `#core/acl` | Abierto |
| 2026-10-20 | A1 | A6 | Compose: pasar `AAA_PPP_KEY` (32 bytes base64, la misma que `aaa` y `coa`) al servicio `api`; `apps/api` cifra con ella `pass_ppp`, `radius_secret` y `api_password` (formato `v1`, `app/shared/cifrado.ts`). Sin ella crear routers con credenciales o servicios falla | Abierto |
| 2026-10-20 | A1 | A3 | Hecho en `agente/a1-nucleo`: permisos `libro.registrar_asiento` y `libro.revertir_asiento` en el catálogo y en `admin` y `contabilidad`. Columnas que lee `generarFacturas` documentadas en `apps/api/app/core/README.md`; no cambian de nombre. `cambiarEstadoServicio` (tarea 8) aceptará `{ trx }` | Abierto |
| 2026-10-20 | A1 | A2 | Contrato aaa ← A1 leído: `pass_ppp` y `radius_secret` ya se cifran en formato `v1` con `AAA_PPP_KEY` (`apps/api/app/shared/cifrado.ts`, prueba con vector generado por `services/aaa`). `GET /internal/aaa/servicio` y `aaa:user:<user_ppp>` (write-through y lápida) llegan con la tarea 9 (día 3) | Abierto |
| 2026-10-20 | A1 | Líder FE, A4 | Nuevo `GET /servicios/:id/credenciales` (permiso `servicios.ver_credenciales`, soporte y técnico) para mostrar la contraseña PPPoE generada; cada consulta queda auditada. La vista `Servicio` nunca trae `pass_ppp` | Abierto |
