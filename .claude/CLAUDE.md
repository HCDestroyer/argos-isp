# CLAUDE.md — ArgosIsp

Este archivo lo leen todos los agentes. Es la ley del repositorio. Si una tarea te obliga a romper una regla de aquí, detente y pregunta al líder; no la rompas.

## Qué estamos construyendo

ArgosIsp es el sistema de gestión para un ISP en Guatemala, alternativa a Mikrowisp: clientes, servicios PPPoE (IPv4 + IPv6) controlados por RADIUS, facturación con libro contable de doble partida, cobros, promesas de pago, corte y reactivación automáticos, notificaciones, ACL, auditoría. Integraciones posteriores: FEL (INFILE), SmartOLT, Horus (tráfico), MCP para agentes de IA.

Plan completo en `.claude/PLAN.md`. Tu frente específico está en `.claude/agents/<tu-agente>.md` (`a1-nucleo` … `a6-infra`). El modelo de datos base está en `.claude/modelo-datos.md`. Lee los cuatro antes de escribir código.

## Stack (fijo, no se discute)

| Capa | Tecnología |
| --- | --- |
| Backend | AdonisJS 6 (TypeScript), Lucid ORM, VineJS |
| Base de datos | PostgreSQL 16, un schema por módulo: `core`, `network`, `billing`, `ledger`, `notify`, `audit` |
| Caché, colas, eventos | Redis 7, BullMQ |
| RADIUS | FreeRADIUS 3.2 con `rlm_rest` → servicio `aaa` (Node) |
| CoA / Disconnect | servicio `coa` (Node, paquete `radius`) |
| Router | MikroTik RouterOS 7, API REST para lo que no pasa por RADIUS |
| Frontend | Nuxt 4 + @nuxt/ui v4 + Tailwind CSS, tipos generados desde OpenAPI |
| Infra | Docker Compose (dev y lab), GitHub Actions |
| Node | 22 LTS, pnpm workspaces |

## Estructura del monorepo

```
apps/api         AdonisJS (paquete @argosisp/api): módulos de dominio, API REST, workers y crons (BullMQ)
apps/web         Nuxt: panel de administración (@argosisp/web)
apps/portal      Nuxt: portal del cliente y página de corte (@argosisp/portal)
services/aaa     Endpoints /aaa/authorize y /aaa/accounting para FreeRADIUS + config de FreeRADIUS
services/coa     coa-dispatcher: consume eventos y envía CoA/Disconnect al NAS
packages/contracts  OpenAPI generado desde apps/api y tipos TS para los frontends
infra/           docker-compose, scripts de MikroTik (.rsc), CI, seeds de laboratorio
.claude/         reglas (CLAUDE.md), plan, estado, integración, modelo de datos y agentes (agents/)
```

Cada agente es dueño de las carpetas que indica su brief. No toques carpetas de otro agente; si necesitas algo de otro módulo, pídelo por su interfaz pública (acción, evento o endpoint) y anótalo en tu propio archivo `.claude/integration/<tu-agente>.md` (reglas en `.claude/integration/README.md`; nunca edites el archivo de otro agente).

## Reglas de arquitectura

### 1. Toda la lógica vive en acciones de dominio

- `apps/api/app/<modulo>/actions/<verbo_sustantivo>.ts`. Una acción = una clase con `execute(input, ctx)`.
- Controladores, crons, webhooks, workers y el MCP solo validan entrada y llaman acciones. Cero lógica de negocio fuera de `actions/`.
- Toda acción recibe `ctx` con `actor` (usuario, token, agente, sistema), `canal` y `requestId`.
- Toda acción escribe su registro de auditoría dentro de la misma transacción. La clase base `DomainAction` ya lo hace; extiéndela.

### 2. Acciones explícitas, no PATCH de estados

`POST /servicios/:id/suspender`, `POST /facturas/:id/anular`, `POST /promesas`. Nunca `PATCH { estado: 'suspendido' }`. Cada acción tiene su permiso en el ACL con el mismo nombre (`servicios.suspender`).

### 3. Eventos con outbox

- Cambios de estado y hechos de negocio emiten eventos del catálogo (abajo). El evento se escribe en `audit.outbox` en la **misma transacción** que el cambio. Un relay lo publica a Redis.
- Consumidores idempotentes: un evento puede llegar dos veces.
- Las reactivaciones viajan por evento, nunca esperan al cron.

### 4. Libro contable inmutable

- Todo lo que mueve dinero genera un asiento de doble partida en `ledger`. Debe = Haber siempre; hay una restricción en base de datos que lo verifica.
- Nunca `UPDATE` ni `DELETE` sobre `ledger.*` ni `audit.*`. Errores se corrigen con asiento de reverso o nota de crédito.
- El saldo de un cliente es la suma de su auxiliar; no existe una columna `saldo`.
- Montos en `numeric(14,2)`; en TypeScript usar `decimal.js`. Prohibido `number` para dinero.

### 5. Invalidación explícita, nunca TTL

Cualquier caché (autorización RADIUS en Redis, mapa `ip → servicio_id`, catálogos) se invalida por evento cuando cambia el dato. No se configuran TTL como mecanismo de consistencia.

### 6. Idempotencia y concurrencia

- Toda operación que mueve dinero o estado acepta `Idempotency-Key` (header). Se guarda en `core.idempotency_keys` con la respuesta.
- Los crons procesan "todo lo pendiente hasta ahora", nunca "lo de hoy", con claves únicas (ej. factura = `servicio_id + periodo`).
- Ediciones de entidades llevan `version`; conflicto → 409.
- Cada job repetible de BullMQ corre con lock (solo una instancia).

### 7. API

- Rutas REST bajo `/api/v1`, recursos en español en plural: `/clientes`, `/servicios`, `/facturas`, `/pagos`, `/promesas`.
- Errores en formato RFC 9457 (`application/problem+json`) con `type`, `title`, `status`, `detail`, `errors[]`.
- Listas con paginación por cursor: `?cursor=&limit=`; respuesta `{ data, nextCursor }`.
- Token en `Authorization: Bearer`, nunca en el body.
- Todo endpoint tiene validador VineJS; el OpenAPI se genera de ahí (`pnpm contracts:build`). Si cambias un validador, regenera y commitea `packages/contracts`.

### 8. ACL

- Permiso = nombre de la acción (`facturas.crear`). Roles agrupan permisos. Alcance opcional por router, zona o caja.
- Roles base en seed: `admin`, `cajero`, `soporte`, `tecnico`, `contabilidad`, `lectura`.
- Un token de API o un agente de IA es un usuario con alcances acotados; pasa por el mismo ACL.

### 9. Auditoría

- `audit.acciones`: actor, canal, acción, entidad, entrada, resultado, request_id. Automática por `DomainAction`.
- Excepciones, declaradas con `auditarExito()` en la acción (los errores se auditan siempre):
    - Telemetría de alta frecuencia que no es una acción de nadie: el Interim-Update de accounting (`sesiones.actualizar`) cuando solo actualiza contadores.
    - Evaluaciones sin efecto: `servicios.evaluar_estado` solo deja fila cuando cambió el estado (decisión del PM, día 4). La acción que la llamó (pago, promesa, corte) queda auditada igual, y el corte deja su corrida en `registrar_corrida`.
    - Estado deseado de RouterOS sin cambios: `routeros.aplicar_servicio` y `routeros.reconciliar` solo dejan fila si corrigieron algo, fallaron o la validación de velocidad rechazó la configuración. Cada comando que sí se envía queda igual en `audit.red`.
- `audit.cambios`: diff por campo en clientes, servicios, planes, plantillas, reglas. Datos sensibles (contraseñas PPPoE, credenciales, tokens) se registran como `***`.
- Actualizaciones masivas nunca usan `Model.query().update()`; pasan por una acción que registra cada fila.
- `audit.red`: cada CoA, Disconnect o comando a RouterOS con la respuesta del equipo.

### 10. Frontend

- Solo componentes de Nuxt UI (`UButton`, `UTable`, `UForm`, `UModal`…). Nunca `<button>`, `<input>` o `<table>` crudos.
- Indentación de 4 espacios en `<script>`, `<template>` y objetos `:ui`.
- Tipos y cliente HTTP desde `packages/contracts`; nada de interfaces duplicadas a mano.
- Composables en `composables/`, un recurso por composable (`useClientes`, `useFacturas`).
- Formularios con `UForm` + esquema `valibot` o `zod` espejo del validador del backend.
- Modo claro y oscuro funcionando; revisar en 390px y 1280px.

### 11. Pruebas y Definition of Done

Una tarea está terminada solo si:

- [ ] La acción tiene pruebas de integración (Japa) contra Postgres real en Docker, y pasan en CI
- [ ] El endpoint está en el OpenAPI y `packages/contracts` se regeneró
- [ ] La acción registra auditoría y, si cambia estado, emite su evento por outbox
- [ ] `pnpm lint` y `pnpm typecheck` pasan en todo el workspace
- [ ] Hay un `README.md` corto en el módulo: qué hace, qué eventos emite y consume
- [ ] Actualizaste `.claude/integration/<tu-agente>.md` si dependes de otro agente

Prohibido marcar como terminado algo que "funciona en mi máquina" sin pruebas.

### 12. Trabajo en paralelo

Reglas que salen de los errores reales de los días 1 y 2. Son tan obligatorias como las anteriores.

- **Rama correcta antes de tocar nada.** Empieza siempre con `git fetch origin && git checkout -B agente/<tu-agente> origin/agente/<tu-agente>` y comprueba que existen `.claude/CLAUDE.md` y `apps/api`. Un worktree puede nacer en un commit viejo.
- **Base de datos y puerto propios.** Las pruebas de `apps/api` corren con `DB_DATABASE=argosisp_test_<a1…a6>` y `PORT=34<n>` como variables de entorno (sin commitearlas). Nunca uses `argosisp_test` mientras otros agentes prueban: se borran las tablas entre sí.
- **Archivos generados nunca a mano.** `packages/contracts/*` y `pnpm-lock.yaml` se regeneran (`pnpm install`, `pnpm contracts:build`). Para traer `main` a una rama usa `scripts/integrar.sh <rama>`: mezcla, regenera, corre lint, typecheck y pruebas, y solo sube con `--push`.
- **Una PR se mergea solo con CI en verde contra el `main` actual.** Si `main` cambió, se vuelve a integrar antes de mergear. Las PRs se mergean de una en una.
- **Fixtures fieles a la API.** Se tipan con `Schema<'X'>` de `packages/contracts` y llevan los mismos valores por defecto que devuelve la API. Nunca `{}` para un objeto tipado.
- **Errores visibles, nunca datos inventados.** Si un endpoint falla o responde 501, la pantalla muestra el error con "Reintentar" y no muestra totales, saldos ni estados calculados sobre datos vacíos (nada de "Q 0.00 · Al día" cuando no se pudo leer la cuenta).
- **Permisos con su nombre exacto.** El frontend usa los nombres de `apps/api/app/core/permisos.ts`. `pnpm verificar:permisos` (también en CI) falla si una ruta o menú pide un permiso que no existe.
- **Migraciones con `node ace make:migration`.** El nombre lleva la marca de tiempo real; nunca la inventes a mano (el día 3, A1, A3 y A6 crearon tres migraciones `1761100000001_*` distintas y su orden dependía del nombre).
- **Contratos entre módulos por escrito.** Formatos, nombres de claves y payloads compartidos viven en `.claude/integration/contratos/`. Se cambian en la misma PR que el código que los cumple.
- **Datos de demostración por la API.** `pnpm demo:datos` carga clientes, routers, planes y servicios pasando por las acciones (auditoría y eventos incluidos). Úsalo para probar pantallas contra el backend real antes de entregar.

### 13. Multiempresa

- Una instalación atiende varias empresas (NIT). Contrato completo: `.claude/integration/contratos/multiempresa.md`.
- Todo lo de un servicio y todo lo financiero lleva `empresa_id`; un asiento, un pago o una caja nunca mezclan empresas.
- Las consultas se filtran por la empresa activa (`ctx.empresaId`, cabecera `X-Empresa-Id`) y el alcance del usuario; el consolidado solo con alcance global.
- Con una sola empresa el sistema se comporta igual que antes: ninguna prueba ni pantalla cambia.

## Catálogo de eventos (nombre, payload mínimo)

| Evento | Emite | Payload |
| --- | --- | --- |
| `servicio.creado` | núcleo | servicio_id, empresa_id, cliente_id, router_id, plan_id |
| `servicio.estado_cambiado` | núcleo | servicio_id, empresa_id, de, a, motivo |
| `servicio.config_cambiada` | núcleo | servicio_id, empresa_id, campos (plan, ips, prefijo_v6, router, tipo_conexion, mac, amarre_ip_mac, empresa), empresa_anterior_id (solo con `empresa`); motivo y plan_temporal_id (opcionales, solo con un plan temporal) |
| `asignacion.cambiada` | núcleo/IPAM | servicio_id, empresa_id, ipv4[], prefijo_enlace_v6, prefijo_delegado_v6, inicio, fin |
| `servicio.adicional_agregado` / `servicio.adicional_cambiado` / `servicio.adicional_quitado` | núcleo | servicio_id, cliente_id, empresa_id, adicional_id, asignacion_id, modalidad; agregado: origen; cambiado: campos[], modalidad_anterior; quitado: origen, motivo. Nunca la credencial (`contratos/adicionales.md`) |
| `sesion.iniciada` / `sesion.terminada` | aaa | servicio_id, nas_ip, acct_session_id, ipv4, prefijos_v6; `sesion.terminada` además motivo (causa de fin) |
| `factura.emitida` / `factura.vencida` / `factura.anulada` | billing | factura_id, empresa_id, servicio_id, cliente_id, total, vence |
| `pago.registrado` / `pago.anulado` | billing | pago_id, empresa_id, cobro_id (o null), cliente_id (pagador), monto, metodo, facturas[], clientes[] (pagador y dueños de las facturas) |
| `nota_credito.emitida` | billing | nota_credito_id, empresa_id, factura_id, servicio_id (o null), cliente_id, monto, motivo |
| `nota_credito.anulada` | billing | nota_credito_id, empresa_id, factura_id, cliente_id, monto, motivo |
| `promesa.creada` / `promesa.cumplida` / `promesa.incumplida` | billing | promesa_id, empresa_id, servicio_id, vence, monto |
| `caja.cerrada` | ledger | caja_id, empresa_id, cajero_id, esperado, contado, diferencia |
| `notificacion.enviada` | notify | cliente_id, canal, evento_origen, estado |
| `notificaciones.config_cambiada` | notify | configuracion_id, empresa_id (null = global), campos[] |
| `sesion.desconexion_solicitada` | network | sesion_id, servicio_id, nas_ip, acct_session_id, user_ppp, motivo |
| `coa.fallido` | coa | servicio_id (o null), nas_ip, tipo (coa/disconnect), error |
| `aaa.caido` / `aaa.recuperado` | network (vigía) | nodo, desde, hasta (recuperado), ultimo_error |
| `comprobante.recibido` / `comprobante.aprobado` / `comprobante.rechazado` | billing | comprobante_id, empresa_id, cliente_id, pago_id, motivo |
| `plan.velocidad_cambiada` | núcleo | plan_id, router_id (null = todos), campos[] |
| `router.control_cambiado` | núcleo | router_id, de, a, capacidad_bajada_kbps, capacidad_subida_kbps, campos[], motivo |
| `routeros.fallido` | network (RouterOS) | servicio_id (o null), router_id, operacion, error |
| `fiscal.localizacion_instalada` | fiscal | empresa_id, pais, codigo, de_codigo |
| `fiscal.parametros_cambiados` | fiscal | empresa_id (null = global), claves[], vigente_desde |
| `fiscal.config_cambiada` | fiscal | empresa_id, campos[] (regimen, fel_modo, proveedor, credenciales, establecimientos, frases); nunca valores secretos |
| `libro.integridad_rota` | ledger (sellador) | empresa_id, sello, asiento_id, esperado, obtenido |
| `dte.certificado` / `dte.rechazado` / `dte.anulado` | fiscal (FEL) | dte_id, empresa_id, documento_tipo, documento_id; certificado: tipo_dte, autorizacion, serie, numero, contingencia; rechazado: error, definitivo; anulado: motivo |
| `fel.contingencia_cambiada` | fiscal (FEL) | empresa_id, activa, motivo |
| `factura.sustituida` | billing | factura_id, nueva_factura_id, empresa_id, servicio_id, cliente_id, motivo |
| `cobros.liquidados` | ledger | liquidacion_id, empresa_id, proveedor, bruto, comision, neto, pagos[] |
| `caja.depositada` | ledger | deposito_id, empresa_id, caja_id, cuenta_bancaria_id, cuenta_id, monto |
| `banco.extracto_importado` / `banco.conciliado` | ledger | extracto_id o conciliacion_id, empresa_id, cuenta_bancaria_id, cuenta_id, lineas, monto; conciliado: linea_id |
| `cartera.castigada` | ledger | castigo_id, empresa_id, cliente_id, facturas[], monto |
| `compra.registrada` / `compra.anulada` | ledger | compra_id, empresa_id, proveedor_id, total, iva, periodo_iva |
| `activo.dado_de_baja` | ledger | activo_id, empresa_id, motivo, valor_libros |
| `lealtad.programa_cambiado` | lealtad | programa_id, empresa_id, campos[] |
| `lealtad.puntos_acumulados` | lealtad | movimiento_id, empresa_id, cliente_id, servicio_id, regla_id, puntos, vence_en |
| `lealtad.puntos_revertidos` | lealtad | movimiento_id, empresa_id, cliente_id, puntos, origen_tipo, origen_id |
| `lealtad.puntos_por_vencer` / `lealtad.puntos_vencidos` | lealtad (cron) | empresa_id, cliente_id, puntos; por vencer: vence_en, lote_id; vencidos: movimiento_id |
| `lealtad.referido_calificado` | lealtad | referido_id, empresa_id, referidor_id, cliente_id |
| `lealtad.canje_reservado` / `lealtad.canje_aplicado` / `lealtad.canje_revertido` | lealtad | canje_id, empresa_id, cliente_id, servicio_id, premio_id, tipo, puntos, factura_id |
| `cliente.actualizado` | núcleo | cliente_id, campos[] (nombre, tipo, codigo) |
| `horus.config_cambiada` | integraciones (Horus) | activo, campos[] (nunca valores ni secretos) |
| `horus.hallazgo_abierto` / `horus.hallazgo_resuelto` | integraciones (Horus) | webhook_id, servicio_id, cliente_id, empresa_id, ip, hallazgo |
| `horus.estado_seguridad_cambiado` | integraciones (Horus) | webhook_id, servicio_id, cliente_id, empresa_id, ip, estado, estado_anterior, hallazgos_abiertos |
| `horus.router_estado_cambiado` | integraciones (Horus) | webhook_id, router (id, nombre, estado, estado_anterior, motivo) |
| `horus.servicio_infra_cambiado` | integraciones (Horus) | webhook_id, servicio_infra (id, nombre, estado, estado_anterior, motivo) |

El detalle de cada payload vive en `.claude/integration/contratos/eventos.md`.

## Estados del servicio

`activo` → `limitado` → `suspendido` → `retirado`, más `promesa_activa` como bandera, no como estado. La función `evaluarEstadoServicio(servicio_id)` en `billing/actions` es la **única** que decide el estado a partir de facturas vencidas, reglas de la plantilla y promesas. La llaman el cron de corte, `registrarPago`, `crearPromesaPago` e `incumplirPromesa`.

## Convenciones generales

- Código, nombres de tablas, rutas y mensajes en español; identificadores de código en `camelCase`/`PascalCase`, tablas y columnas en `snake_case`.
- Commits: `feat(billing): generar facturas por periodo` (Conventional Commits, alcance = módulo).
- Una PR por tarea del brief, con el número de tarea en el título. PR pequeñas.
- Variables de entorno documentadas en `.env.example` de cada app; nunca secretos en el repo.
- Fecha y hora en UTC en base de datos; zona `America/Guatemala` solo al mostrar.
- No instales dependencias nuevas sin anotarlas en la PR con el motivo.
