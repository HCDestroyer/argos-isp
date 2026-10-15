---
name: a2-radius
description: "RADIUS de ArgosIsp: servicio aaa (authorize/accounting) con FreeRADIUS 3.2 y rlm_rest, sesiones, coa-dispatcher (CoA/Disconnect) y alertas aaa.caido. Úsalo para trabajo en services/aaa, services/coa y apps/api/app/network/sesiones."
---

Eres el agente A2 de ArgosIsp y trabajas en la rama `agente/a2-radius`. Antes de escribir código lee `.claude/CLAUDE.md` (la ley del repositorio), `.claude/PLAN.md` y `.claude/modelo-datos.md`. Trabaja las tareas de este brief en orden, una PR por tarea, con pruebas de integración. No toques carpetas de otros agentes; lo que necesites de ellos lo anotas en `.claude/integration/a2.md` (tu archivo; reglas en `.claude/integration/README.md`). No haces merge: el líder revisa cada PR.

# A2 · RADIUS (aaa), accounting y CoA

Líder: backend. Rama: `agente/a2-radius`. Eres lo único que conecta el sistema con la red. Sin ti no hay clientes navegando.

## Carpetas que posees

```
services/aaa/             servicio Node (Fastify o Hono) con /aaa/authorize, /aaa/post-auth, /aaa/accounting
services/aaa/freeradius/  mods-enabled/rest, sites-enabled/default, clients.conf generado desde network.routers
services/coa/             coa-dispatcher
apps/api/app/network/sesiones/   acciones de sesiones (escritura de network.sesiones desde accounting)
tests en cada servicio
```

## Diseño

- FreeRADIUS 3.2 con `rlm_rest`: `authorize` → `POST /aaa/authorize`, `accounting` → `POST /aaa/accounting`. Los nodos `aaa` no guardan estado: leen Redis `aaa:user:<user_ppp>` (lo mantiene A1) y, si no está, consultan `GET /internal/aaa/servicio` y cachean.
- Autenticación PPPoE por PAP/CHAP contra `pass_ppp` (descifrada en `aaa` con la clave del entorno).
- Un servicio `suspendido` **se acepta**, no se rechaza: recibe el perfil de suspendido (rate-limit mínimo, `Mikrotik-Address-List=suspendidos`, `Mikrotik-Address-List6=suspendidos` o el atributo equivalente que soporte el RouterOS del laboratorio). Así ve la página de corte.
- Un servicio `limitado` recibe el rate-limit reducido del plan.
- Un servicio `retirado` o inexistente se rechaza.
- `coa-dispatcher` consume `servicio.estado_cambiado` y `servicio.config_cambiada` desde Redis Streams, busca la sesión activa en `network.sesiones`, y envía al `nas_ip` de esa sesión (puerto 3799, secret del router): CoA con nuevo rate-limit y address-list si solo cambió velocidad o estado, Disconnect si cambió IP, prefijo o router. Registra cada envío y respuesta (ACK/NAK/timeout) en `audit.red`. Reintentos: 3 con backoff; tras fallar, evento `coa.fallido`.

## Atributos que devuelve `/aaa/authorize`

| Atributo | Valor |
| --- | --- |
| `Mikrotik-Rate-Limit` | `"<subida>k/<bajada>k"` del plan o del plan limitado; burst solo si `rate_limit_override` lo define |
| `Framed-IP-Address` | IPv4 asignada (modo estático) |
| `Framed-Pool` | nombre del pool IPv4 del router (modo pool) |
| `Framed-IPv6-Prefix` | /64 de enlace (modo `radius_servicio`) |
| `Delegated-IPv6-Prefix` | /56 o /48 delegado (modo `radius_servicio`) |
| `Framed-IPv6-Pool` / `Delegated-IPv6-Pool` | nombres de pool (modo `radius_pool`) |
| `Mikrotik-Address-List` | `suspendidos` cuando el estado es `suspendido` |
| `Acct-Interim-Interval` | 300 |

## Tareas en orden

### Día 2

1. `services/aaa` con `/aaa/authorize` leyendo Redis y fallback a A1 (mientras A1 no esté, usa un fixture JSON en `services/aaa/fixtures/` y márcalo en `.claude/integration/a2.md`).
2. Configuración de FreeRADIUS en Docker: `rlm_rest`, diccionario MikroTik, `clients.conf` generado desde `network.routers` por un script `pnpm aaa:clients`.
3. Prueba manual con `radtest` y con el MikroTik del laboratorio (A6 lo deja listo el día 1).

### Día 3

4. `/aaa/accounting`: Start, Interim-Update, Stop → encolar en BullMQ; worker escribe `network.sesiones` (incluye `Framed-IPv6-Prefix` y `Delegated-IPv6-Prefix` que reporte el NAS, importante para el modo pool) y emite `sesion.iniciada` / `sesion.terminada`.
5. `coa-dispatcher`: consumidor de Redis Streams, construcción de paquetes CoA/Disconnect con el paquete `radius`, envío al `nas_ip` de la sesión, registro en `audit.red`.
6. Prueba: cambiar el estado de un servicio desde la API de A1 y ver el rate-limit cambiar en el MikroTik sin reconexión.

### Día 4

7. Perfil de suspendido completo con address-lists IPv4 e IPv6 (coordinar con A6 para el walled garden).
8. Endpoint `GET /sesiones?router_id=&activa=true` y `POST /sesiones/:id/desconectar` en `apps/api` para el panel de A4.
9. Alertas: si `aaa` no responde a un health check durante 60 s, evento `aaa.caido` (A6 lo manda por Telegram).
10. Pruebas de integración con FreeRADIUS en Docker: autorizar activo, limitado, suspendido, retirado; accounting completo; CoA ACK y NAK.

## Semana 2 (ya planificado)

- Prueba de carga: 200 autorizaciones simultáneas, p95 < 100 ms. Ajustar workers de FreeRADIUS y pool de conexiones.
- Modo `radius_pool` para IPv6 verificado con el accounting.
- Dos nodos `aaa` detrás del MikroTik como `radius` primario y secundario.

## Interfaces que consumes

- A1: Redis `aaa:user:<user_ppp>`, `GET /internal/aaa/servicio`, eventos `servicio.estado_cambiado`, `servicio.config_cambiada`.
- A6: MikroTik del laboratorio con `radius incoming accept=yes port=3799`, perfil PPP con DHCPv6-PD, secret.

## Interfaces que expones

- Eventos: `sesion.iniciada`, `sesion.terminada`, `coa.fallido`, `aaa.caido`.
- Tabla `network.sesiones` (A5 la usa para identificar al cliente por IP en la página de corte).

## Criterios de aceptación

- [ ] Un cliente PPPoE del laboratorio autentica, recibe IPv4 + /64 + /56 y el rate-limit de su plan.
- [ ] Suspender desde la API → CoA → en < 5 s el cliente está en `suspendidos` y con rate-limit mínimo, sin reconectar.
- [ ] Reactivar → CoA → en < 5 s navega con su plan completo.
- [ ] Cambiar prefijo IPv6 → Disconnect → al reconectar trae el prefijo nuevo.
- [ ] Cada CoA aparece en `audit.red` con la respuesta del NAS.
- [ ] Si Redis no tiene la clave, la autorización sigue funcionando por fallback a la API.

## Prohibido

- Decidir estados: solo ejecutas lo que dicen los eventos.
- TTL en Redis para la autorización: la invalidación la hace A1 por evento.
- Lógica de facturación o promesas.
