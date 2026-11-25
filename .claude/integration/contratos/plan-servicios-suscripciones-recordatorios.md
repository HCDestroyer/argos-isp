# Plan: tipos de servicio, suscripciones y recordatorios por lugar (ArgosIsp)

Leí el worktree `/home/user/wt-plan-servicios` (rama `lider/plan-servicios-suscripciones`) sin modificar nada. Todo lo de abajo sale de lectura de código y contratos; no ejecuté pruebas. Donde algo no lo verifiqué, lo digo.

## 0. Lo esencial

- **Tipos de servicio:** hoy no existe el concepto. Todo servicio exige router y plan con velocidad. Propongo `tipo_servicio` (internet, tv, mixto, telefonia, otro) con una tabla de capacidades en código. El lote caro es permitir servicios sin router.
- **Suscripciones:** ya existen casi completas con el nombre «adicionales». Recomiendo evolucionarlos, no crear un módulo paralelo.
- **Recordatorios:** hoy son 3 filas globales fijas, solo relativas al vencimiento de la factura, con plantillas globales. Faltan «corte próximo», «promesa por vencer», canales por regla y cualquier personalización por lugar.
- **Lugar:** la zona vive en el cliente (`core.clientes.zona_id`), no en el servicio. Recomiendo zona > empresa > global.
- **Tres ambigüedades del pedido** que cambian el alcance: qué quiso decir el PM con «suscripciones» (P1), qué es «lugar» (P7) y si lo de «por lugar» incluye precios (P8).

## 1. Diagnóstico

### 1.1 Tipos de servicio

- `core.servicios` (`apps/api/database/migrations/1760900000005_crear_servicios.ts`): `router_id` y `plan_id` son `NOT NULL`. `user_ppp` y `pass_ppp` ya son anulables (migración `1792161790085_create_core_servicios_tipo_conexions_table.ts`).
- `network.planes`: `bajada_kbps integer NOT NULL CHECK (> 0)`. `network.planes.tipo` existe pero es comercial (`residencial`, `empresarial`, `dedicado`; `apps/api/app/network/tipos_plan.ts`), no es tipo de servicio.
- `apps/api/app/core/actions/crear_servicio.ts` y `crearServicioValidator` (`apps/api/app/core/validators.ts:396`) exigen `router_id` y `plan_id`. El tipo de conexión se toma del router.
- Acoplamiento al router: 156 archivos de `apps/api/app` mencionan `router_id` y hay unas 134 referencias a `s.router_id` o `servicio.router_id`. Conté alrededor de 10 joins internos a `network.routers` y 11 a `network.planes`. El alcance del ACL por router filtra por `s.router_id` (`apps/api/app/core/consultas/servicios.ts:206`).
- Facturación: el concepto está escrito a mano como «Servicio de internet …» en `apps/api/app/billing/actions/emitir_factura.ts` (línea ~186). La cuenta de ingreso de la línea `servicio` es `4.1.01 INGRESOS_INTERNET` (`cuentaIngresoDeLinea` en `apps/api/app/billing/facturas.ts:75`). `billing.facturas_lineas.cuenta_codigo` ya existe y manda sobre el tipo de línea; eso permite cuentas por tipo sin tocar el esquema de líneas.
- Corte: `apps/api/app/billing/actions/evaluar_estado_servicio.ts` decide y `apps/api/app/core/actions/cambiar_estado_servicio.ts` aplica. Si el plan no es «limitable», ya se queda `activo` hasta cortar. La ejecución real del corte es solo de red (aaa, coa, routeros por `servicio.estado_cambiado`).
- Lo que ya sirve para TV: los adicionales tipo IPTV con identificador, credencial y bloqueo al suspender (`.claude/integration/contratos/adicionales.md`), los adicionales incluidos por plan (`network.planes_adicionales`) y el comodato de equipos por servicio (`apps/api/app/inventario`).
- Contratos: no hay ninguno sobre tipos de servicio. `contratos/instalacion.md` asume PPPoE e IP al activar.

### 1.2 Suscripciones

- Adicionales (`apps/api/app/core/adicionales.ts`, acciones `*adicional*` en `apps/api/app/core/actions/`, contrato `adicionales.md`):
  - catálogo por empresa (`core.adicionales`, con `tipo` `general` | `ip_publica`);
  - asignación por servicio con modalidad `incluido`, `cortesia` o `cobrado`, precio, alta y baja con fecha;
  - `primer_periodo` `prorrateado` | `sin_costo` y `cobrado_desde`;
  - bloqueo al suspender, con historial y eventos `servicio.adicional_*` y `adicional.bloqueado/desbloqueado`.
- Cobro ya implementado: `lineasAdicionales` en `emitir_factura.ts` genera una línea por asignación y periodo, idempotente, tipo `otro`, que hoy cae en `4.1.03`. Entra en la factura mensual del servicio, así que FEL y libro ya la cubren.
- Lo que falta para llamarlo suscripción: pausa de una suscripción (solo existe la pausa del servicio entero, `apps/api/app/billing/pausas.ts`), baja programada a fin de periodo, ciclo distinto del mensual, categoría, cuenta de ingreso propia y una vista de todas las suscripciones.
- Hay un tercer mecanismo recurrente: `billing.conceptos_recurrentes`. `emitir_factura.ts:195` lo lee, pero no encontré ninguna acción ni ruta que lo escriba (solo lo citan `core/eliminacion.ts` y `billing/panel/indicadores.ts`). Parece heredado.
- No se puede cobrar algo recurrente a un cliente sin servicio: la factura se identifica por `servicio_id + periodo`.
- Pantallas: `apps/web/app/pages/adicionales/index.vue`, `motivos.vue` y los modales `Adicional*.vue`. En el portal no encontré los adicionales en `cuenta.vue` ni `index.vue`.

### 1.3 Recordatorios

- `notify.recordatorios` (`1760910000002_notify_recordatorios.ts`): `orden` 1 a 3 único, `dias` de −60 a 60 respecto a `vence_en`, `hora`, `activo`. Es global: `EditarRecordatorio` hace `t.fijarEmpresa(null)`. No tiene canales ni ámbito.
- Cron: `apps/api/app/notify/recordatorios.ts` y `actions/programar_recordatorios.ts`. Procesa todo lo pendiente, con origen único `recordatorio:<orden>:factura:<id>`. Solo cubre facturas.
- Plantillas: `notify.plantillas` con `UNIQUE (evento, canal)` y sin `empresa_id`, es decir, globales. Eventos `recordatorio.1` a `.3`.
- WhatsApp: el cuerpo es el código de Iris. Los tres recordatorios usan `factura_por_vencer` o `factura_vencida` (`apps/api/app/notify/plantillas_base.ts:393`).
- Canales: salen por todos los que el cliente tenga. Lo único por empresa son los interruptores y credenciales de `notify.configuracion_canales` (patrón `hereda`, `apps/api/app/notify/configuracion.ts`).
- No existen recordatorios de «corte próximo» ni de «promesa por vencer» (lo busqué en el código).
- Iris §6.3 no tiene códigos para esos dos avisos. A52 (leer las plantillas de WhatsApp de Iris, §6.7) está «acordado; pendiente en Argos» (`iris.md:1352`; `apps/api/app/integraciones/iris/README.md:497`).
- Reglas de Iris que limitan el diseño: máximo 3 avisos automáticos por cliente y día, y silencio de 21:00 a 07:00 (§6.5).
- Pantallas: `apps/web/app/pages/notificaciones/index.vue` y `configuracion/notificaciones.vue`. Tablero: `OperConfigNotificaciones.dc.html`.

### 1.4 Por lugar

- La zona está en el cliente; el servicio no tiene zona. Zonas y routers tienen `empresa_sugerida_id`.
- Precio: `planes.precio` global o `costo_override` por servicio. No hay precio por zona.
- Reglas de cobro: plantilla de facturación por servicio, más excepciones por servicio (`core.servicios_excepciones`). Hay una sola plantilla por defecto global (`apps/api/app/core/plantilla_por_defecto.ts`).

## 2. Modelo propuesto

### 2.1 Tipos de servicio

**Tablas y columnas**
- `network.planes.tipo_servicio text NOT NULL DEFAULT 'internet'` con CHECK (`internet`, `tv`, `mixto`, `telefonia`, `otro`).
- `network.planes.precio_tv numeric(14,2) NULL`: solo en `mixto`, es la parte de TV dentro del precio, para desglosar la factura.
- Velocidades anulables, con CHECK: obligatorias cuando el tipo lleva internet.
- `core.servicios.tipo_servicio`, mismo CHECK y `DEFAULT 'internet'`. Un trigger exige que coincida con el del plan.
- `router_id` anulable, con CHECK: obligatorio en `internet` y `mixto`.
- `core.servicios.puntos smallint NULL`: número de televisores o líneas.
- `core.cortes_campo`: `empresa_id`, `servicio_id`, `tipo` (`corte` | `reconexion`), `estado` (`pendiente` | `ejecutado` | `cancelado`), `motivo`, `solicitado_en`, `ejecutado_en`, `ejecutado_por`, `nota`, `version`. Índice único parcial: un solo pendiente por servicio y tipo.
- Cuenta nueva de ingresos por TV (y por telefonía, si entra). El código de cuenta va en una versión nueva del paquete fiscal, a confirmar con el contador.

**Capacidades** (archivo nuevo `apps/api/app/core/tipos_servicio.ts`, en código, no en base)

| Tipo | Router, IP, RADIUS | Velocidad y «limitado» | Cómo se corta | OLT/ONU y planta | Equipos en comodato |
| --- | --- | --- | --- | --- | --- |
| internet | sí | sí | red (como hoy) | sí | sí |
| tv | no | no | tarea en campo | solo `planta` como referencia | sí (decodificador) |
| mixto | sí | sí (parte internet) | red + tarea en campo para la TV | sí | sí |
| telefonia | no | no | tarea en campo | no | sí |
| otro (membresía, servicio sin red) | no | no | ninguno; solo cambia el estado | no | opcional |

**Migración.** Todos los planes y servicios existentes quedan `internet`. Ninguna prueba ni pantalla actual cambia.

**Eventos**
- `servicio.creado` suma `tipo_servicio`; `router_id` puede ser null.
- `servicio.config_cambiada` admite `tipo_servicio` en `campos`.
- Nuevos: `servicio.corte_campo_solicitado`, `servicio.corte_campo_ejecutado` y `servicio.corte_campo_cancelado`, con `corte_campo_id`, `servicio_id`, `empresa_id`, `cliente_id`, `tipo`, `motivo`.
- Los consumidores de red (`consumidor_aaa`, routeros, coa) ignoran los tipos sin red.

**Permisos:** `cortes_campo.ver` y `cortes_campo.ejecutar` (admin, soporte, tecnico), `cortes_campo.cancelar` (admin).

**Endpoints**
- `POST /servicios` acepta el tipo que deriva del plan.
- `GET /servicios?tipo_servicio=` y `GET /planes?tipo_servicio=`.
- `GET /cortes-campo`, `POST /cortes-campo/:id/ejecutar`, `POST /cortes-campo/:id/cancelar`.

**Pantallas**
- Alta: se elige el tipo antes que el router. En tv, telefonia y otro se ocultan router, IP, PPPoE e IPv6.
- Formulario de plan por tipo.
- Ficha del servicio sin los bloques de red.
- Filtro por tipo en la lista de servicios.
- Cola nueva «Cortes en campo».
- Portal: etiqueta del tipo, sin velocidad.

### 2.2 Suscripciones (evolución de los adicionales)

Los nombres de tablas y eventos siguen siendo «adicional». En el panel y el portal se llama «Suscripciones».

**Columnas en `core.adicionales`**
- `categoria` (`streaming`, `canales_premium`, `ip_publica`, `seguro_equipo`, `membresia`, `otro`).
- `cuenta_codigo text NULL`: cuenta de ingreso; null significa `4.1.03` como hoy.
- `ciclo_meses smallint DEFAULT 1` (opcional, lote S4).

**Columnas en `core.servicios_adicionales`:** `baja_programada date NULL`.

**Tabla nueva `core.servicios_adicionales_pausas`:** `asignacion_id`, `empresa_id`, `desde`, `hasta`, `motivo`, `estado`, `terminada_en`, `version`. Misma regla que la pausa del servicio.

**Eventos nuevos:** `servicio.adicional_pausado` y `servicio.adicional_reanudado`. `servicio.adicional_cambiado` suma `baja_programada` en `campos`.

**Permisos:** `servicios.pausar_adicional` y `servicios.reanudar_adicional` (admin, soporte). El resto son los actuales.

**Endpoints**
- `POST /servicios/:id/adicionales/:asignacionId/pausar` y `/reanudar`.
- `baja_programada` en el `quitar` existente (`efectiva: "ahora" | "fin_periodo"`).
- `GET /suscripciones?categoria=&estado=&empresas=`: lista de todas las asignaciones `cobrado`, con el total mensual.

**Membresía sin servicio de red:** se resuelve con un servicio de tipo `otro` (2.1). No hace falta otro camino de facturación.

**`billing.conceptos_recurrentes`:** se deja como está y se congela. Convertirlo es opcional.

### 2.3 Recordatorios

**Tabla `notify.recordatorios`, ampliada** (misma tabla; se quita el `UNIQUE` y el CHECK de `orden`)
- `empresa_id NULL`, `zona_id NULL` (el ámbito sale de estas dos columnas).
- `disparador` (`factura_por_vencer`, `factura_vencida`, `corte_proximo`, `promesa_por_vencer`).
- `dias` (con signo, respecto al ancla del disparador), `hora`.
- `canales text[]` (vacío = todos los disponibles).
- `nombre`, `evento_plantilla`, `clave_origen`, `activo`, `version`.

**Tabla `notify.recordatorios_ambitos`:** `empresa_id`, `zona_id`, `personalizado bool`. Marca que un ámbito no hereda.

**Plantillas:** se reusa `notify.plantillas` sin cambiar su esquema. Cada regla nueva usa el evento `recordatorio.r<id>`, con una plantilla por canal. En WhatsApp el cuerpo sigue siendo un código de Iris.

**Migración**
- Las 3 filas actuales quedan como reglas globales. `disparador` se asigna por el signo de `dias`.
- `evento_plantilla` sigue siendo `recordatorio.<orden>` y `clave_origen = <orden>`.
- Así el origen `recordatorio:<orden>:factura:<id>` no cambia y nada ya enviado se repite.

**Evento:** `notificaciones.config_cambiada` con `campos: ['recordatorios']` y `zona_id`. No hace falta caché: el cron lee de la base.

**Permisos:** los actuales `notificaciones.ver` y `notificaciones.editar`. Las acciones nuevas `notificaciones.crear_recordatorio` y `notificaciones.eliminar_recordatorio` van con su permiso (regla 2).

**Endpoints**
- `GET /notificaciones/recordatorios?empresa_id=&zona_id=` devuelve el conjunto efectivo y de quién hereda.
- `POST /notificaciones/recordatorios`, `PUT /:id`, `POST /:id/desactivar`.
- `POST /notificaciones/recordatorios/personalizar`: copia el conjunto del padre al ámbito.
- `POST /notificaciones/recordatorios/restablecer`: vuelve a heredar.
- `GET /notificaciones/plantillas-whatsapp`: lectura de Iris (A52).

**Pedido a Iris (contrato 0.15.0):** códigos `corte_proximo` (`monto`, `moneda`, `fecha_corte`) y `promesa_por_vencer` (`monto`, `moneda`, `vence_en`).

### 2.4 Por lugar

**Jerarquía recomendada:** zona (del cliente) > empresa > global.
- Un ámbito marcado «personalizado» sustituye entero el conjunto del padre; no se mezclan reglas.
- Por servicio solo hay exclusión («no enviar recordatorios»). Es opcional y se guarda como excepción en `core.servicios_excepciones`.

**Qué se personaliza en este alcance:** el conjunto de recordatorios (días, hora, canales, texto de correo y Telegram, código de Iris).

**Opcional, fuera del alcance base:** plantilla de facturación por defecto por zona o empresa, y precio de plan por zona.

## 3. Reglas de negocio e impacto

### 3.1 Tipos de servicio

- **Facturación**
  - Misma plantilla, mismo ciclo e IVA incluido.
  - El concepto sale del tipo: «Servicio de televisión por cable …», y así con cada uno.
  - El mixto emite dos líneas: internet (precio − `precio_tv`, cuenta 4.1.01) y TV (`precio_tv`, cuenta de TV). El prorrateo y los descuentos de lealtad se aplican a la línea de internet, como hoy.
  - Sin `precio_tv` sale una sola línea, como hoy.
- **Corte**
  - `evaluarEstadoServicio` sigue siendo la única que decide el estado.
  - En tv y telefonia nunca hay «limitado» (hoy ya ocurre así cuando el plan no es limitable).
  - Al pasar a `suspendido`, `CambiarEstadoServicio` crea en la misma transacción un `cortes_campo` pendiente y emite el evento. No hay CoA.
- **Reactivación**
  - Si el corte en campo seguía `pendiente`, se cancela solo: el cliente nunca quedó sin señal.
  - Si estaba `ejecutado`, se crea una tarea de `reconexion`.
  - Viaja por evento, no por cron.
- **Mixto con deuda**
  - Una sola factura y una sola deuda. Se corta todo: internet por red al instante y TV por tarea en campo.
  - La variante «solo internet» queda como pregunta al PM (P4).
- **Alta**
  - En los tipos sin red no hay router, IP ni PPPoE.
  - `pendiente_instalacion` y `activar-instalacion` funcionan igual, sin IPAM.
  - Los decodificadores se asignan con el comodato actual.
- **FEL:** misma certificación; solo cambia la descripción del ítem. Si la TV o la telefonía llevan otro tratamiento fiscal, hay que confirmarlo con el contador; no lo verifiqué.
- **Libro:** asiento igual, con la cuenta de ingreso por línea. El auditor suma el invariante «ingresos por cuenta = líneas por cuenta».
- **Iris:** el campo `tipo_servicio` en la ficha y los webhooks es aditivo (0.15.0). Sin ese contrato, Iris no ve diferencia. Que Iris convierta los cortes en campo en órdenes es opcional.
- **Portal:** un servicio sin red no muestra velocidad ni sesión. La página de corte por red no le aplica.
- **ACL:** un usuario con alcance por router no ve servicios sin router. Hay que documentarlo; el alcance por zona sí funciona.

### 3.2 Suscripciones

- **Alta:** como hoy. `primer_periodo` es prorrateado por defecto, o sin costo.
- **Pausa:** el periodo cuyo inicio cae dentro de la pausa no se cobra (misma regla que `pausas.ts`). Tope: el de `ajustes_cobro.pausa_tope_dias`.
- **Baja**
  - Inmediata, como hoy: el periodo ya facturado no se devuelve.
  - Programada: sigue activa hasta `baja_programada`. Un job repetible, con lock, la da de baja mediante la acción existente `quitar`.
- **Servicio suspendido:** como hoy, la suscripción se bloquea y no se cobra el periodo que empieza bloqueada.
- **Impuestos y FEL:** línea gravable con IVA incluido, como hoy, dentro de la factura del servicio. No hay documento aparte.
- **Libro:** `cuenta_codigo` del catálogo en la línea; sin ella, `4.1.03`.
- **Ciclo de varios meses (opcional):** se cobra cuando toca según `cobrado_desde`. El ingreso anual cobrado por adelantado debería diferirse (existe `registrar_diferimiento`); confirmar con el contador.

### 3.3 Recordatorios

- **Anclas**
  - Factura: `vence_en`, como hoy.
  - Promesa: `billing.promesas.vence_en`, con estado `activa`.
  - Corte próximo: el día en que la siguiente factura por vencer llevaría las vencidas a `facturas_para_cortar`, con vencimiento efectivo y `corte_desde`. Lo calcula una función pública nueva de billing; notify no reimplementa la regla.
- **Exclusiones:** servicio `pendiente_instalacion`, suspendido manual, sin plantilla o ya suspendido. En corte próximo, también promesa activa.
- **Idempotencia:** origen único `recordatorio:<clave_origen>:<factura|promesa>:<id>`. Si el cron se detuvo, manda solo el último que toca por disparador (como hoy).
- **Canales:** la intersección de `canales` de la regla con los disponibles del cliente y los interruptores de la empresa.
- **WhatsApp**
  - El texto no se edita en Argos. Por lugar solo se elige el código.
  - Sin plantilla aprobada, el envío queda `omitido` (`canal_no_disponible`) y sale por correo o Telegram.
  - El panel avisa si un ámbito supera 3 recordatorios el mismo día o si la hora cae en el silencio de Iris.
- **Multiempresa:** con una sola empresa y sin ámbitos personalizados, el comportamiento es idéntico al actual.

## 4. Lotes ordenados

Tres carriles independientes (T, S, R) después del lote 0. Las migraciones se fusionan de una en una.

### Lote 0 · Contratos y decisiones (líder)
- **Archivos:** nuevo `.claude/integration/contratos/tipos-servicio.md`; nuevo `.claude/integration/contratos/recordatorios.md`; `adicionales.md`; `eventos.md`; catálogo de `CLAUDE.md`; `modelo-datos.md`; solicitudes en `iris.md` §5.2.
- **Complejidad:** baja. **Dependencias:** respuestas del PM (P1 a P8). **Tablero:** no.

### T1 · Modelo de tipo de servicio (A1)
- **Archivos:** migración nueva; `apps/api/app/core/tipos_servicio.ts` (nuevo); `core/validators.ts`; `core/esquemas.ts`; `core/consultas/servicios.ts`; `network/consultas/planes.ts`; `network/validators.ts`; acciones de plan; `shared/eventos.ts`; `packages/contracts` regenerado.
- **Cambios:** columnas, trigger, filtros y evento. Solo `internet` y `mixto`, ambos con router.
- **Pruebas**
  - Tras la migración, todos los planes y servicios son `internet`.
  - Un servicio con tipo distinto al de su plan da 422.
  - Los filtros de lista funcionan.
  - Un plan mixto con `precio_tv` ≥ precio da 422.
  - La suite existente no cambia.
- **Complejidad:** media. **Dependencias:** L0. **Tablero:** no.

### T2 · Servicios sin red: tv, telefonia, otro (A1 + A2)
- **Archivos:** migración (`router_id` anulable y sus CHECK); `core/actions/crear_servicio.ts`; `editar_servicio.ts`; `activar_instalacion_servicio.ts`; `core/asignaciones_servicio.ts`; `core/aaa.ts`; `core/consumidor_aaa.ts`; `network/routeros/*`; `network/sesiones/*`; `services/coa`; `core/acl.ts`; todas las consultas con join a routers.
- **Cambios:** crear y editar sin router ni IP; los consumidores de red ignoran estos tipos; joins a `LEFT`.
- **Pruebas**
  - Crear un servicio tv sin router devuelve 201, sin clave AAA en Redis y sin comandos en `audit.red`.
  - Aparece en `GET /servicios`, en la ficha del cliente, en reportes y en la exportación a Iris.
  - Un servicio internet sin router da 422.
  - Activar la instalación de un tv no pide IP.
  - Un usuario con alcance por router no lo ve; uno con alcance por zona sí.
  - `eliminar` y `retirar` funcionan.
- **Complejidad:** alta. **Dependencias:** T1. **Tablero:** no.

### T3 · Corte en campo (A1)
- **Archivos:** migración `core.cortes_campo`; `core/actions/cambiar_estado_servicio.ts`; acciones nuevas `ejecutar_corte_campo.ts` y `cancelar_corte_campo.ts`; `core/permisos.ts`; rutas nuevas.
- **Pruebas**
  - Un tv que pasa a suspendido crea un pendiente y su evento en la misma transacción.
  - Suspender dos veces no duplica.
  - Pagar con el corte pendiente lo cancela y no crea reconexión.
  - Pagar con el corte ejecutado crea la reconexión.
  - Un mixto hace CoA y además crea la tarea.
  - Un internet no crea nada.
  - Ejecutar con `version` vieja da 409.
- **Complejidad:** media. **Dependencias:** T2. **Tablero:** no.

### T4 · Facturación, libro y FEL por tipo (A3 + auditor)
- **Archivos:** `billing/actions/emitir_factura.ts`; `billing/facturas.ts`; `billing/configuracion.ts` (`leerServicio`); `ledger/plan_cuentas.ts`; paquete fiscal (versión nueva); `fiscal` (descripción del ítem); `billing/reportes/*`; `apps/api/tests/contabilidad/`.
- **Pruebas**
  - La factura de un tv lleva el concepto de TV y la cuenta de TV.
  - El mixto emite dos líneas que suman el precio, cada una con su IVA.
  - Mixto prorrateado y mixto con descuento de lealtad.
  - Instalar el paquete fiscal dos veces no agrega nada.
  - La factura de un servicio internet queda idéntica byte a byte a la actual.
  - Los invariantes del auditor pasan.
- **Complejidad:** alta. **Dependencias:** T1 (el mixto), T2 (el tv). **Tablero:** no.

### T5 · Panel y portal (A4 + A5)
- **Archivos:** `apps/web/app/pages/servicios/nuevo.vue` y el asistente de alta; `servicios/[id]/index.vue`; `servicios/index.vue`; `planes/nuevo.vue`; `planes/[id]`; página nueva `cortes-campo`; `apps/portal/app/pages/index.vue` y `cuenta.vue`.
- **Pruebas**
  - El alta de un tv no muestra router ni IP.
  - La ficha no tiene bloques de red.
  - La cola de cortes ejecuta con su permiso.
  - 390 y 1280 px, claro y oscuro.
  - Errores con «Reintentar».
  - `pnpm verificar:permisos` pasa.
- **Complejidad:** media. **Dependencias:** T2, T3. **Tablero:** sí, antes de empezar (variantes de `FlujoAlta`, `NuevoAltaCliente` y `OperServicioFicha`; tablero nuevo de «Cortes en campo»).

### T6 · Bordes (A6)
- **Archivos:** `notify/variables.ts` y `plantillas_base.ts` (textos sin «internet» fijo; aviso de corte de TV); `importacion/origenes/mikrowisp.ts` (todo se importa como internet); datos de demostración.
- **Pruebas:** el aviso de corte de un tv no menciona velocidad; la importación no cambia.
- **Complejidad:** baja. **Dependencias:** T2.

### S1 · Catálogo de suscripciones (A1 + A3)
- **Archivos:** migración; `core/adicionales.ts`; `crear_adicional.ts`; `editar_adicional.ts`; validadores; `lineasAdicionales` en `emitir_factura.ts`; contrato `adicionales.md`.
- **Pruebas**
  - Un adicional con `cuenta_codigo` genera la línea con esa cuenta y el asiento cuadra.
  - Sin cuenta va a `4.1.03`, como hoy.
  - Una cuenta inexistente o de otro tipo da 422.
  - Los existentes quedan con categoría `otro`, o `ip_publica` si lo eran.
- **Complejidad:** media. **Dependencias:** L0. **Tablero:** no.

### S2 · Pausa y baja programada (A1 + A3)
- **Archivos:** migración; acciones `pausar_adicional_servicio.ts` y `reanudar_adicional_servicio.ts`; `quitar_adicional_servicio.ts`; job en `core/jobs.ts`; `emitir_factura.ts`.
- **Pruebas**
  - Un periodo que empieza en pausa no cobra; el siguiente sí.
  - Pausar un `incluido` da 422.
  - Una pausa mayor al tope da 422.
  - La baja programada cobra el periodo en curso y no el siguiente.
  - Correr el job dos veces no duplica.
  - Retirar el servicio termina la pausa.
- **Complejidad:** media. **Dependencias:** S1.

### S3 · Panel y portal de suscripciones (A1, A4, A5)
- **Archivos:** `GET /suscripciones` (consulta en `core`); `apps/web/app/pages/adicionales/index.vue`; página nueva de lista; `AdicionalServicioModal.vue`; portal «Mis suscripciones» (nunca la credencial).
- **Pruebas**
  - La lista se filtra por empresa, categoría y estado.
  - El total mensual coincide con la suma de precios activos.
  - Pausar desde la ficha funciona.
  - El portal no expone la credencial.
- **Complejidad:** media. **Dependencias:** S2. **Tablero:** sí (lista de suscripciones y modal ampliado).

### S4 · Opcional: ciclo de varios meses y conversión de `conceptos_recurrentes`
- **Complejidad:** alta (diferimiento). **Dependencias:** S2 y el contador.

### R1 · Modelo de reglas y resolución por ámbito (A6)
- **Archivos:** migración; `notify/actions/programar_recordatorios.ts`; `editar_recordatorio.ts`; acciones nuevas (crear, desactivar, personalizar, restablecer); `notify/consultas.ts`; `notify/validators.ts`; `notify/esquemas.ts`; `notify/catalogo.ts` (variables por disparador para eventos `recordatorio.r<id>`); `start/routes/notify.ts`; `notify/README.md`.
- **Pruebas**
  - Tras migrar, las mismas facturas reciben los mismos recordatorios y ninguno ya enviado se repite.
  - Una zona personalizada usa su conjunto; otra zona hereda de la empresa; una empresa sin conjunto usa el global.
  - Una regla con `canales=['correo']` no crea envío por Telegram.
  - Correr el cron dos veces no duplica.
  - Con dos reglas atrasadas, manda solo la última.
  - Un servicio pendiente queda excluido.
  - Con una sola empresa, nada cambia.
- **Complejidad:** alta. **Dependencias:** L0. **Tablero:** no.

### R2 · Disparadores corte próximo y promesa por vencer (A3 + A6)
- **Archivos:** función nueva en `billing/cortes.ts` o `billing/vencimiento.ts` (interfaz pública); `programar_recordatorios.ts`; `notify/variables.ts`; `plantillas_base.ts`.
- **Pruebas**
  - Con `cortar=2`, una vencida y otra que vence en 3 días, el aviso «−3» sale.
  - Con promesa activa no sale.
  - Con suspensión manual no sale.
  - Con `corte_desde` futuro, el ancla se mueve.
  - Una promesa activa que vence mañana recibe su aviso «−1»; una cumplida no.
  - Sin código de Iris, el envío de WhatsApp queda `omitido` y los demás canales salen.
- **Complejidad:** alta. **Dependencias:** R1.

### R3 · Plantillas de WhatsApp de Iris, A52 (A6 + integraciones)
- **Archivos:** `integraciones/iris/*` (cliente del GET de §6.7 y `configuracion.ts`); ruta `GET /notificaciones/plantillas-whatsapp`; validación del código al guardar una regla.
- **Pruebas**
  - Conector apagado: lista vacía con el motivo, nunca un error 500.
  - Empresa fuera del alcance: 403 visible.
  - Un código sin plantilla aprobada muestra una advertencia y no bloquea.
- **Complejidad:** media. **Dependencias:** R1; los códigos nuevos dependen de Iris.

### R4 · Panel de recordatorios (A4)
- **Archivos:** `apps/web/app/pages/notificaciones/index.vue`; `configuracion/notificaciones.vue`; componentes nuevos (selector de ámbito, editor de regla, vista previa).
- **Pruebas**
  - Cambiar de ámbito muestra de quién hereda.
  - Personalizar copia el conjunto; restablecer pide confirmación.
  - La vista previa funciona por canal.
  - Aparece el aviso de límite y de silencio de Iris.
  - 390 y 1280 px, claro y oscuro.
- **Complejidad:** media. **Dependencias:** R1 a R3. **Tablero:** sí (actualizar `OperConfigNotificaciones`).

### R5 · Opcional: más cosas por lugar
- Plantilla de facturación por defecto por zona o empresa: media.
- Precio de plan por zona: alta, porque toca `leerServicio` y todo lo que lee el precio.
- Exclusión de recordatorios por servicio: baja.

**Orden sugerido:** L0 → (T1, S1, R1 en paralelo) → (T2, S2, R2) → (T3, T4, S3, R3) → (T5, T6, R4). Para ejecutores: modelo alto en T2, T4, R1 y R2; medio en el resto; bajo en L0 y T6.

**Riesgos principales**
- T2: regresiones silenciosas por joins a routers.
- T4: cuenta nueva en el paquete fiscal y revisión del auditor.
- R1: no repetir envíos al migrar.
- Dependencia externa: códigos nuevos de Iris.

## 5. Preguntas para el PM

1. **¿Qué es «módulo de suscripciones»?** (a) Cobros recurrentes extra dentro de la factura mensual, como canales premium, IP pública o seguro. (b) Cobro automático con tarjeta, el débito automático de Recurrente, que está en fase 2. (c) Ambos. *Recomendado: (a) ahora; (b) aparte.*
2. **¿Los adicionales actuales pasan a llamarse «Suscripciones» y se amplían, en vez de crear un módulo nuevo?** *Recomendado: sí.*
3. **¿Qué tipos entran ahora?** *Recomendado: internet, TV por cable, mixto y «otro»; telefonía solo si ya se vende.*
4. **Mixto con deuda: ¿se corta todo o solo internet?** *Recomendado: todo; internet al instante y TV por tarea en campo.*
5. **Corte de TV: ¿lista de tareas en el panel de Argos, u orden de trabajo en Iris?** *Recomendado: lista en Argos ahora; Iris después.*
6. **Baja de una suscripción a mitad de mes: ¿se devuelve algo?** *Recomendado: no; sigue activa hasta fin de periodo o se corta sin reembolso.*
7. **«Lugar»: ¿zona del cliente, router o empresa?** *Recomendado: zona > empresa > global; el router no.*
8. **¿Por lugar solo recordatorios, o también precios y reglas de cobro?** *Recomendado: solo recordatorios ahora; plantilla por defecto por zona como opcional; precios por zona no.*
9. **Recordatorio de promesa por vencer cuando la promesa nació en Iris: ¿lo manda Argos?** *Recomendado: sí, por correo y Telegram; por WhatsApp solo cuando Iris tenga la plantilla.*
10. **¿La TV y las suscripciones van a cuentas de ingreso propias?** *Recomendado: sí, con códigos confirmados por el contador.*
11. **¿Suscripciones con ciclo trimestral o anual?** *Recomendado: solo mensual ahora.*

### Critical Files for Implementation
- /home/user/wt-plan-servicios/apps/api/app/core/actions/crear_servicio.ts
- /home/user/wt-plan-servicios/apps/api/app/core/actions/cambiar_estado_servicio.ts
- /home/user/wt-plan-servicios/apps/api/app/billing/actions/emitir_factura.ts
- /home/user/wt-plan-servicios/apps/api/app/core/adicionales.ts
- /home/user/wt-plan-servicios/apps/api/app/notify/actions/programar_recordatorios.ts