# Plan v3: tipos de servicio (internet, cable, IPTV, mixto), suscripciones, débito automático por cualquier pasarela y recordatorios por plantilla (ArgosIsp)

Versión 3 (26 nov 2026), completa y autosuficiente: reemplaza a la v2 de este mismo archivo (sha 04b5ea8e, con las respuestas del sha 223644da). Incorpora las respuestas del PM del 25 y del 26 nov 2026 (§6). Solo leí código, contratos y documentación pública; no ejecuté pruebas ni edité código de la aplicación. Cada afirmación sobre «lo que ya existe» se comprobó contra `apps/api` en esta rama; lo que no se pudo comprobar está marcado como **supuesto**.

## 0. Lo esencial

- **Qué cambió respecto a la v2:**
  - Los tipos de servicio son cuatro: `internet`, `cable` (CATV por fibra, con ONU), `iptv` (sobre IP) y `mixto` (combinación de los anteriores). Desaparece el tipo `tv`.
  - No existe TV por coaxial. Todo cable tiene ONU y se corta por SmartOLT. El aviso a Iris queda solo de respaldo.
  - La IPTV se corta como datos (RADIUS, CoA, RouterOS): no necesita nada nuevo en el corte.
  - La suscripción es una sola entidad que puede ir sin servicio o ligada a un servicio. El adicional sigue siendo la línea dentro de la factura del servicio.
  - El débito automático no depende de la pasarela: interfaz común, un adaptador por proveedor y una cuenta de pasarela por empresa y proveedor (lote nuevo D0).
  - Política de cobro decidida: al emitir, un reintento a los 3 días, desactivación tras 3 rechazos seguidos y aviso al cliente.
  - El carril R arranca: plantillas de recordatorio con nombre, asignadas por servicio o suscripción, con una por defecto por empresa y excepción personalizada por servicio. Nada por zona. Argos decide qué y cuándo; Iris entrega.
- **Hallazgos de la verificación que cambian el diseño:**
  - `billing.plantillas_facturacion` **no tiene `empresa_id`**: las plantillas de facturación son globales y `por_defecto` es única en toda la instalación. La v2 pedía un trigger «plantilla de la misma empresa» que no puede existir. Las plantillas de recordatorio sí nacen con `empresa_id`.
  - La pasarela se configura hoy por variables de entorno (`PASARELA_PROVEEDOR`, `RECURRENTE_*`): un solo proveedor y una sola llave por instalación. Pero `ledger.proveedores_cobro` ya es por empresa (`empresa_id`, `metodo`, `codigo`, cuenta puente). La cuenta de pasarela se cuelga de ahí.
  - `4.1.05` y `4.1.06` ya están ocupadas por lealtad en la localización de Guatemala. Las cuentas de ingreso de cable e IPTV necesitan otros códigos.
  - A52 (leer las plantillas de WhatsApp de Iris) no está implementado en Argos: no hay ninguna llamada a `plantillas-whatsapp` en `apps/api/app`.
  - NeoNet no publica documentación para desarrolladores. Su sitio anuncia cobros mensuales programados (NeoPagos) y tokenización con Cybersource, sin detalle técnico. El adaptador de NeoNet queda como lote bloqueado (D4) con sus supuestos escritos.
- **Contrato con Iris:** hace falta la **0.15.0** (minor, aditiva sobre la 0.14.3 vigente), en tres bloques que se activan por separado: tipo de servicio, corte manual de respaldo y recordatorios por plantilla con entrega por Iris (§2.7).
- **Dependencias externas que bloquean lotes:**
  - fusión de la rama `agente/a6-olt-acs` a `main` (T3b); hoy no está fusionada;
  - contrato Iris 0.15.0 acordado y con PR enlazada en los dos repos (T3a, R3);
  - cuenta y Sandbox de Recurrente con «cobros únicos» habilitados (verificación real de D1 y D2);
  - documentación y credenciales de prueba de NeoNet (D4);
  - cuentas contables de cable e IPTV confirmadas por el contador (T4).

## 1. Diagnóstico

### 1.1 Tipos de servicio
- `core.servicios` (`apps/api/database/migrations/1760900000005_crear_servicios.ts`): `router_id` y `plan_id` son `NOT NULL`. `user_ppp` y `pass_ppp` nacieron `NOT NULL` y ya son anulables (migración `1792161790085_create_core_servicios_tipo_conexions_table.ts`).
- `network.planes`: `bajada_kbps NOT NULL CHECK (> 0)`. `planes.tipo` es comercial (`residencial`, `empresarial`, `dedicado`; `apps/api/app/network/tipos_plan.ts`), no tipo de servicio.
- `apps/api/app/core/actions/crear_servicio.ts` y `crearServicioValidator` (`apps/api/app/core/validators.ts`) exigen router y plan.
- Acoplamiento al router: 165 archivos de `apps/api/app` mencionan `router_id`. El alcance ACL por router filtra por `s.router_id` (`apps/api/app/core/consultas/servicios.ts`).
- Facturación: concepto fijo «Servicio de internet …» (`apps/api/app/billing/actions/emitir_factura.ts`, líneas 186 y 406). Cuenta `4.1.01` para la línea `servicio`, `4.1.02` mora y `4.1.03` el resto (`apps/api/app/billing/facturas.ts`, `apps/api/app/ledger/plan_cuentas.ts`). `4.1.04` es sobrantes de caja; `4.1.05` y `4.1.06` son de lealtad (`apps/api/app/fiscal/l10n/gt/cuentas.ts`).
- Corte: decide `apps/api/app/billing/actions/evaluar_estado_servicio.ts`; aplica `apps/api/app/core/actions/cambiar_estado_servicio.ts`. La ejecución es solo de red (aaa, coa, routeros).

### 1.2 SmartOLT y CATV
- En esta rama y en `origin/main`, la integración está en `apps/api/app/integraciones/equipos/` (`smartolt.ts`, `equipos.ts`, `cola.ts`, `capacidades.ts`, `configuracion.ts`): una sola configuración por empresa. No hay ninguna llamada de CATV ni de VoIP (búsqueda de `catv` y `voip` sin resultados).
- En `origin/agente/a6-olt-acs` (último commit 7ccf8415, 25 nov 2026; **no fusionada a `main`**), contrato `.claude/integration/contratos/equipos-olt-acs.md`, lotes 1 a 5 marcados «Hecho» en esa rama:
  - `integraciones.smartolt_instancias` (subdominio, token cifrado, `activo`, `prueba_ok`; «operativa» = activa y probada);
  - `integraciones.smartolt_olts` (ligada a `network.olts`);
  - `equipos_servicio.smartolt_instancia_id` junto a `smartolt_external_id`;
  - regla §4.2 para elegir la instancia de un servicio;
  - evento `equipos.config_cambiada`.
- API de SmartOLT. Fuente: especificación oficial OpenAPI «SmartOLT API 1.0», <https://www.smartolt.com/openapi.json>, leída el 25 nov 2026; documentación para personas en <https://api.smartolt.com/>.

| Operación | Endpoint | Lo que dice la especificación |
| --- | --- | --- |
| Cortar CATV de una ONU | `POST /api/onu/disable_catv/{onu_external_id}` | 200 `{ status: true, response: "CATV disabled" }`. 400 si no hay ONU con ese id, si «CATV not supported by ONU-Type» o si la OLT no pudo. Restricción literal: no usar para «repeteadly disabling the same ONTs multiple times per week» |
| Reconectar CATV | `POST /api/onu/enable_catv/{onu_external_id}` | 200 `"CATV enabled"`; mismos 400 |
| Modo asíncrono | cuerpo `async=1` en ambos | Responde `"queued": true`: aceptado, no ejecutado. El resultado se lee con `check_bulk_task_status`. Si la ONU ya tiene acciones en cola, una petición sin `async` también se encola. 409 `onu_busy` si otra petición cambia la ONU a la vez |
| Por lotes | `POST /api/onu/bulk_disable_catv` y `bulk_enable_catv` (`onus_external_ids` separados por coma) | Máximo 50 ids, o 10 000 con `async=1`. 400 si ya hay otra llamada al mismo método en curso. Cada ONU omitida trae su motivo |
| Estado | `GET /api/onu/get_onus_catv_statuses?olt_id=&board=&port=&zone=` | Por ONU: `unique_external_id`, `sn`, `catv_status` = `Enabled`, `Disabled` o `CATV not supported by ONU-Type` |
| Límites (del contrato `equipos-olt-acs.md` §2) | por cuenta | 1 000 llamadas por hora y 15 por segundo; las asíncronas tienen presupuesto aparte |

- Los nombres `disable_onu_catv` / `enable_onu_catv` no existen en la especificación.
- También existen `enable_onu_voip_port` y `disable_onu_voip_port`; sirven a telefonía si entra más adelante (P-N6).

### 1.3 Suscripciones y adicionales
- Adicionales (`apps/api/app/core/adicionales.ts`, contrato `adicionales.md`):
  - `core.adicionales`: catálogo por empresa (`empresa_id`, `codigo`, `nombre`, `precio_sugerido`, `activo`, `tipo` = `general` | `ip_publica`).
  - `core.servicios_adicionales`: asignación por servicio (`incluido`, `cortesia`, `cobrado`), `primer_periodo` (`prorrateado` | `sin_costo`), `bloqueo` al suspender, eventos.
  - Cobro en `lineasAdicionales` de `emitir_factura.ts` (línea tipo `otro`, cuenta `4.1.03`).
- Falta: pausa por asignación, baja programada, categoría, cuenta propia y vista general.
- `billing.conceptos_recurrentes` (`servicio_id NOT NULL`): se lee en `emitir_factura.ts`, `panel/indicadores.ts` y `core/eliminacion.ts`, pero no encontré ninguna acción que lo escriba. No se reutiliza.
- No existe ninguna entidad recurrente propia, ni sin servicio ni ligada a uno.
- Facturas sin servicio ya existen: `apps/api/app/billing/actions/emitir_cargo_unico.ts` emite con `servicio_id` opcional y `clave_unica = cargo-<uuid>`. `billing.facturas.servicio_id` es anulable y `clave_unica` es `text UNIQUE` (`1760900000008_crear_billing.ts`).
- `billing.promesas.servicio_id` es `NOT NULL`, con un índice único de promesa activa por servicio: hoy no hay promesa sin servicio.
- Plantillas de facturación (`apps/api/app/billing/plantillas.ts`): globales, con `nombre`, `por_defecto` (índice único global), `retirada_en`. Las excepciones por servicio viven en `core.servicios_excepciones` y se validan en `apps/api/app/billing/excepciones.ts`. La asignación masiva está en `apps/api/app/billing/asignacion_plantilla.ts`.

### 1.4 Cobro con tarjeta
- Contrato `.claude/integration/contratos/pago-en-linea.md`; código en `apps/api/app/billing/pasarelas/` (`pasarela.ts` interfaz, `recurrente.ts`, `falsa.ts`, `cobros.ts`) y acciones `crear_cobro_pasarela.ts`, `procesar_webhook_pasarela.ts`, `conciliar_pasarela.ts`.
- Lo que existe:
  - interfaz `Pasarela` con tres operaciones (`crearCobro`, `verificarWebhook`, `consultar`) y un registro de adaptadores por nombre (`falsa`, `recurrente`);
  - checkout de pago único en Recurrente, webhook con firma Svix e idempotente (`billing.pasarela_eventos`, único por proveedor e id de evento), pago con asiento y comisión, retención de IVA de la emisora, reembolsos, contracargos, conciliación diaria;
  - webhook público en `POST /pasarela/webhook/:proveedor`;
  - `billing.pasarela_cobros` ya lleva `empresa_id` y `proveedor`, y `crear_cobro_pasarela.ts` rechaza mezclar empresas (`pago_de_varias_empresas`);
  - `ledger.proveedores_cobro` por empresa (`metodo` = `pasarela` | `agente` | `debito`, `codigo`, cuenta puente `1.1.10.NN`, cuenta de liquidación) y `billing.pagos.proveedor_cobro_id`;
  - `billing.pagos.metodo` admite `debito` desde el modelo base, y `ledger/cobros_liquidar.ts` ya lo liquida.
- Lo que no existe:
  - tokenización, método guardado, cliente en la pasarela ni cargo sin presencia del cliente;
  - credenciales por empresa: `configRecurrente()` lee `RECURRENTE_SECRET_KEY` y `RECURRENTE_WEBHOOK_SECRETO` del entorno, y `proveedorConfigurado()` devuelve un solo proveedor para toda la instalación (incumple la regla 14 en cuanto haya dos NIT o dos pasarelas).
- **Recurrente.** Guía «Guardar y reutilizar métodos de pago» (<https://docs.recurrente.com/guias-espanol/guias/guardar-y-reutilizar-metodos-de-pago.md>, releída el 26 nov 2026):
  - `POST /api/customers` (`email`, `full_name`) devuelve `id` (`cus_…`).
  - `POST /api/checkouts` con `mode: "setup"`, `customer_id`, `success_url`, `cancel_url` y `metadata` tokeniza sin cobrar (autorización de monto cero). La tarjeta se escribe solo en la página de Recurrente.
  - Resultado: webhook `setup_intent.succeeded` con `data.checkout.payment_method.id` (`pay_m_…`) y `data.customer.id`, o `setup_intent.cancelled`. Alternativa: `GET /api/checkouts/{id}`.
  - `GET /api/customers/{id}/payment_methods` y `GET /api/payment_methods/{id}` devuelven `card.last4`, `card.network`, `card.expiration_month`, `card.expiration_year`, `card.issuer_name` y `status`.
  - Cobro: `POST /api/one_time_payments` con `customer_id`, `payment_method_id`, `items[]` (`name`, `amount_in_cents`, `currency`, `quantity`) y cabecera `Idempotency-Key`; responde `{ object: "one_time_payment", id, status: "paid" }`.
  - Si el banco rechaza, no se reusa la misma `Idempotency-Key`: un intento nuevo lleva clave nueva.
  - Requiere «cobros únicos» habilitados en la cuenta.
  - «Los webhooks reales solo se envían para eventos de producción»: la tokenización completa se valida con llave LIVE.
  - Cabecera `X-ACCOUNT-ID` para cuentas conectadas (plataformas).
  - **No documentado:** endpoint para revocar un método, códigos de rechazo del banco y comportamiento con 3-D Secure (solo dice que guardar la tarjeta «no sustituye la autenticación que pueda necesitar un pago posterior»).
  - Recurrente también ofrece suscripciones propias; no se usan, porque el monto de Argos varía y la factura la certifica Argos.
- **NeoNet** (antes VisaNet Guatemala). Fuente: <https://www.neonet.com.gt/> y sus páginas de producto, leídas el 26 nov 2026. No encontré portal ni documentación para desarrolladores.

| Producto | Lo que dice el sitio (literal) | Qué no dice |
| --- | --- | --- |
| NeoPagos | «Realiza cobros mensuales programados a tus clientes de modo automatizado»; se manejan «en una plataforma segura de NeoNet» | Si hay API o es un portal; cómo se registra la tarjeta; si el monto puede variar de un mes a otro |
| Cybersource | «La plataforma global de Visa para que aceptes pagos en línea de forma segura»; «Almacena los datos sensibles de tus clientes con Tokenización»; 3D Secure 2.0, prevención de fraude, quetzales y dólares | Si el contrato con NeoNet incluye cargos iniciados por el comercio con token; credenciales, ambiente de pruebas y formato de notificaciones |
| NeoPay | «Acepta los pagos de tus ventas en línea desde tu página web»; se puede incorporar a sitios y aplicaciones | API, tokenización, cargos recurrentes |
| NeoLink | «Cobra tus ventas a distancia de forma ágil y simple» (cobro por enlace) | Tokenización, cargos recurrentes |

  - Conclusión: NeoNet anuncia las dos piezas (tokenización y cobro programado), pero no se puede confirmar con documentación pública que exista un cargo de monto variable con token por API. Los supuestos están en §3.5 y el lote D4 queda bloqueado hasta tener la documentación.

### 1.5 Recordatorios, plantillas y entrega
- **Recordatorios de hoy** (`apps/api/app/notify/recordatorios.ts`, `actions/programar_recordatorios.ts`, `actions/editar_recordatorio.ts`):
  - `notify.recordatorios`: tres filas globales fijas (`orden` 1 a 3, `UNIQUE`), con `dias` respecto a `vence_en` (−60 a 60), `hora` y `activo`. Sin `empresa_id`, sin nombre y sin asignación.
  - Cron cada minuto en la cola `notify-cron`, concurrencia 1. Procesa todo lo pendiente hasta ahora, en lotes de 200, con una ventana de 7 días.
  - Para cada factura cobrable toma el recordatorio activo más reciente cuyo momento ya pasó (no manda tres atrasados).
  - Idempotencia: origen `recordatorio:<orden>:factura:<id>`, único con `(origen, cliente_id, canal)` en `notify.envios`.
  - No recuerda facturas `por_certificar`, sustituidas ni de un servicio `pendiente_instalacion`.
  - No hay disparadores de «corte próximo» ni «promesa por vencer».
- **Plantillas de texto** (`notify.plantillas`): globales, `UNIQUE (evento, canal)`, con eventos `recordatorio.1` a `recordatorio.3` (`apps/api/app/notify/plantillas_base.ts`, `catalogo.ts`, `variables.ts`).
- **Canales.** `notify.configuracion_canales` es global o por empresa, con herencia (`hereda`) y el interruptor `whatsapp_activo`. `ProgramarNotificacion` crea un envío por cada canal que sirva, con `canal_preferido` del cliente primero.
- **WhatsApp por Iris** (`apps/api/app/notify/whatsapp.ts`, `canales/whatsapp.ts`; contrato Iris §6):
  - Argos llama `POST <iris>/api/v1/mensajeria/avisos` con `Idempotency-Key = argos:aviso:<plantilla>:<envio_id>`, sin número, con `canal_preferido: "whatsapp"`.
  - La plantilla `whatsapp` de Argos guarda el código de Iris. Los recordatorios usan `factura_por_vencer`.
  - Códigos que conoce Argos (`VARIABLES_IRIS`): `factura_por_vencer`, `factura_vencida`, `pago_recibido`, `corte_por_falta_de_pago`, `servicio_reactivado`, `bienvenida`, `bienvenida_servicio`.
  - Iris aplica permiso, baja, límite de 3 avisos por día y silencio de 21:00 a 07:00 (§6.5). Devuelve `aviso.entregado` o `aviso.fallido`.
  - Hoy correo y Telegram salen de Argos, y el contrato dice que Argos solo pide avisos con `canal_preferido: "whatsapp"` (§6.1).
- **Contactos.** `apps/api/app/notify/contactos.ts` ya copia los avisos de cobro a los contactos con `permisos.avisos` del servicio.
- **Contrato con Iris.** `CONTRATO_IRIS = '0.14.3'` (`apps/api/app/integraciones/iris/configuracion.ts`). Los eventos a Iris se filtran por versión con listas `EVENTOS_DESDE_<versión>` en `apps/api/app/integraciones/iris/envios.ts`. A52 (§6.7, leer las plantillas de WhatsApp) sigue «pendiente en Argos».
- La zona vive en el cliente. No hay reglas por zona, y no se agregan.

## 2. Modelo propuesto

### 2.1 Tipos de servicio

- `network.planes.tipo_servicio` y `core.servicios.tipo_servicio`: `internet` (por defecto), `cable`, `iptv`, `mixto`. Un trigger exige que el del servicio coincida con el del plan.
- `network.planes.componentes text[]`: en los tipos simples es el mismo tipo; en `mixto`, dos o tres de `internet`, `cable`, `iptv`. `core.servicios` no la duplica: se lee del plan.
- `network.planes.precio_cable` y `precio_iptv` (`numeric(14,2) NULL`): solo en `mixto`, para desglosar la factura. La línea de internet es el precio del plan menos esas dos. En un mixto sin internet (cable + IPTV), `precio_iptv` es el resto.
- `network.planes.bajada_kbps` y `subida_kbps` anulables solo en `cable`.
- `core.servicios.router_id` anulable, con CHECK: obligatorio en todo tipo salvo `cable`.
- `core.servicios.puntos smallint NULL` (televisores o decodificadores, informativo).
- Capacidades en código (`apps/api/app/core/tipos_servicio.ts`, nuevo), única fuente para validadores, facturación, corte y pantallas:

| Tipo | Router, IP, RADIUS | Velocidad | Estado `limitado` | Cómo se corta |
| --- | --- | --- | --- | --- |
| internet | sí | sí | sí | red (aaa, coa, routeros), como hoy |
| iptv | sí | sí, la del perfil de IPTV (supuesto, P-N10) | no (P-N10) | red, igual que internet |
| cable | no | no | no | SmartOLT `disable_catv` / `enable_catv`; respaldo: aviso a Iris |
| mixto | sí (siempre tiene internet o IPTV) | sí | solo si incluye internet | cada componente por su vía: lo que va sobre IP por red, el cable por SmartOLT |

- Migración: todo lo existente queda `internet`, con `componentes = {internet}`.
- Eventos: `servicio.creado` suma `tipo_servicio` y `componentes[]` (`router_id` puede ser null). `servicio.config_cambiada` admite `tipo_servicio` en `campos`. `catalogo.cambiado` de plan admite `tipo_servicio` y `componentes` en `campos[]`.
- Un servicio de cable necesita su ONU registrada (`integraciones.equipos_servicio` con `smartolt_external_id`). El alta no se bloquea si aún no la tiene; la ficha lo advierte.

### 2.2 Corte del cable

**Por SmartOLT (camino normal; sobre el modelo de `equipos-olt-acs.md`)**
- `integraciones.catv_ordenes`: `empresa_id`, `servicio_id`, `smartolt_instancia_id`, `accion` (`cortar` | `reconectar`), `estado` (`pendiente`, `en_curso`, `aplicado`, `fallido`, `cancelada`, `derivada`), `origen_outbox_id` único, `intentos`, `error`, `tarea_smartolt`, `aplicado_en`, `version`.
- `integraciones.equipos_servicio.catv_estado` (`habilitado` | `deshabilitado` | `no_soportado` | null): lo último que confirmó SmartOLT. Se borra cuando cambia el equipo del servicio, por evento y sin TTL.
- **CATV gestionable** = el servicio tiene `smartolt_external_id`, su instancia está operativa y `catv_estado` no es `no_soportado`.
- Eventos nuevos: `catv.estado_cambiado` (`servicio_id`, `empresa_id`, `cliente_id`, `de`, `a`, `orden_id`) y `catv.fallido` (`servicio_id`, `empresa_id`, `orden_id`, `accion`, `error`).
- Permisos: `servicios.ver_equipo` (existe en la rama `a6-olt-acs`) para ver el estado; `catv.reintentar` (admin, soporte) para reintentar una orden fallida.
- Endpoints: `GET /servicios/:id/catv` (estado, última orden y solicitud de respaldo) y `POST /servicios/:id/catv/reintentar`.

**Respaldo: aviso a Iris (aditivo, contrato 0.15.0, bloque B)**

Solo en tres casos: el servicio de cable no tiene ONU registrada, su instancia de SmartOLT no está operativa, o la orden agotó sus reintentos (incluye «CATV not supported by ONU-Type»).

- `integraciones.cortes_manuales`: `empresa_id`, `servicio_id`, `catv_orden_id` (o null si no hubo orden), `componente` (`cable`), `accion` (`corte` | `reconexion`), `causa` (`sin_onu` | `instancia_no_operativa` | `smartolt_fallo` | `catv_no_soportado`), `estado` (`solicitada`, `en_curso`, `resuelta`, `cancelada`, `sin_iris`), `iris_ticket_numero`, `resuelta_en`, `version`. Único parcial: una abierta por servicio y acción. Es un registro de estado; no hay pantalla de cola.
- Webhooks Argos → Iris (solo a conectores ≥ 0.15.0), ambos con `solicitud_id`, `servicio_id`, `empresa_id`, `cliente_id`, `componente`, `accion`, `causa` y sin datos personales:
  - `servicio.corte_manual_solicitado`;
  - `servicio.corte_manual_cancelado`.
- Webhook Iris → Argos, por el receptor existente `/integraciones/iris/webhook`: `corte_manual.estado_cambiado` (`solicitud_id`, `empresa_id`, `estado` = `en_curso` | `resuelta` | `cancelada`, `ticket_numero`, `ocurrido_en`). Se deduplica por `X-Webhook-Id`.
- Sin conector de Iris o con contrato anterior: la solicitud queda `sin_iris`, se ve en la ficha del servicio y sale una alerta interna de notify.

### 2.3 Adicional o suscripción: cuándo conviene cada uno

Un solo catálogo de productos (`core.adicionales`) y dos formas de venderlos. No se duplica el modelo: la suscripción no copia modalidades, bloqueos ni credenciales del adicional, y el adicional no gana factura ni estado propios.

| | Adicional (`core.servicios_adicionales`) | Suscripción (`billing.suscripciones`) |
| --- | --- | --- |
| Dónde se cobra | Una línea en la factura del servicio | Su propia factura |
| Ciclo y vencimiento | Los del servicio | Los suyos: plantilla de facturación y `ciclo_meses` propios |
| Necesita servicio | Sí, siempre | No. Puede ir sin servicio o ligada a uno |
| Qué pasa con deuda | Sigue al servicio: se bloquea cuando el servicio se suspende | Se suspende por su propia deuda; no corta al servicio ni el servicio a ella |
| Modalidades | `incluido`, `cortesia`, `cobrado` | Solo cobrada |
| Débito automático y recordatorios | Los del servicio | Los suyos |
| Conviene cuando | Es parte del paquete: IP pública, canales premium sobre el cable, seguro del equipo, algo incluido en el plan | Se vende aparte o a otro ritmo: streaming anual, membresía, un producto que el cliente quiere pagar y cancelar por separado, o un cliente sin servicio de red |

Regla práctica para el operador: si el cliente debe ver **una sola factura** y perder el extra cuando le cortan el servicio, es un adicional. Si el extra tiene **su propia factura y su propia suerte**, es una suscripción; ligarla a un servicio solo dice dónde se usa.

**Cambios al catálogo y a los adicionales**
- `core.adicionales`: `categoria` (`streaming`, `canales_premium`, `ip_publica`, `seguro_equipo`, `membresia`, `otro`), `cuenta_codigo text NULL` (null = `4.1.03`) y `admite_suscripcion boolean DEFAULT false`. La columna `tipo` (`general` | `ip_publica`) que ya existe no cambia.
- `core.servicios_adicionales.baja_programada date NULL`.
- `core.servicios_adicionales_pausas`: `asignacion_id`, `empresa_id`, `desde`, `hasta`, `motivo`, `estado`, `terminada_en`, `version`.
- Eventos: `servicio.adicional_pausado` y `servicio.adicional_reanudado`.
- Permisos: `servicios.pausar_adicional` y `servicios.reanudar_adicional`.
- Endpoints: `POST /servicios/:id/adicionales/:asignacionId/pausar` y `/reanudar`; `efectiva: "ahora" | "fin_periodo"` en `quitar`; `GET /adicionales/asignaciones` (lista general).

### 2.4 Suscripciones (entidad propia, con o sin servicio)

**Tablas (schema `billing`, dueño A3)**
- `billing.suscripciones`:
  - `empresa_id NOT NULL`, `cliente_id NOT NULL`, `codigo` (lo pone la base);
  - `servicio_id bigint NULL → core.servicios`: null = independiente; con valor = ligada a ese servicio (de cualquier tipo);
  - `producto_id NULL → core.adicionales` (catálogo con `admite_suscripcion`);
  - `descripcion`, `precio numeric(14,2) > 0`, `cantidad`, `ciclo_meses` (1, 3, 6 o 12; por defecto 1);
  - `plantilla_facturacion_id NOT NULL` (da día, gracia, mora, `facturas_para_cortar` y `certificar_al`). Las plantillas de facturación son globales: no hay comprobación de empresa;
  - `inicio date`, `primer_periodo` (`prorrateado` | `completo` | `sin_costo`);
  - `estado` (`activa`, `pausada`, `suspendida`, `cancelada`), `suspension_manual bool`;
  - `baja_programada date NULL`, `cancelada_en`, `motivo_cancelacion`, `identificador`, `notas`, `version`.
  - Un trigger exige que el producto sea de la misma empresa y, si hay `servicio_id`, que el servicio sea de la misma empresa y del mismo cliente.
- `billing.suscripciones_pausas`: `suscripcion_id`, `desde`, `hasta`, `motivo`, `estado`, `terminada_en`, `version`.
- `billing.facturas.suscripcion_id bigint NULL`. `facturas.tipo` suma `suscripcion`.
  - En una factura de suscripción, `suscripcion_id` va siempre.
  - `servicio_id` va **null** aunque la suscripción esté ligada a un servicio: así la factura no cuenta para el corte de ese servicio, no entra en sus promesas ni en su estado de cuenta por servicio. El vínculo con el servicio se lee por la suscripción.
  - CHECK: nunca `servicio_id` y `suscripcion_id` a la vez.

**Idempotencia.** `clave_unica = 'sus-<suscripcion_id>-<YYYY-MM-DD del periodo>'`. No choca con `<servicio_id>-<periodo>` (empieza con dígito) ni con `cargo-<uuid>`. Se inserta con `ON CONFLICT DO NOTHING`, igual que hoy.

**Eventos**
- `suscripcion.creada` (`suscripcion_id`, `empresa_id`, `cliente_id`, `servicio_id` o null, `producto_id`).
- `suscripcion.cambiada` (`campos[]`; incluye `servicio` cuando se liga, se desliga o cambia de servicio, y `cliente` cuando sigue un cambio de titular).
- `suscripcion.estado_cambiada` (`de`, `a`, `motivo`).
- `factura.*`, `pago.*` y `nota_credito.*` suman `suscripcion_id` (null en las demás).

**Permisos:** `suscripciones.ver`, `.crear`, `.editar`, `.pausar`, `.reanudar`, `.suspender`, `.reactivar`, `.cancelar`, `.emitir`. Admin, todos. Soporte: ver, crear, pausar, reanudar. Cajero y contabilidad: ver. Lectura: ver.

**Endpoints**
- `GET /suscripciones` (filtros `servicio_id`, `cliente_id`, `estado`, `independiente`), `POST /suscripciones`, `GET /suscripciones/:id`, `PUT /suscripciones/:id`.
- `POST /suscripciones/:id/pausar | reanudar | suspender | reactivar | cancelar`.
- `POST /suscripciones/generar` (manual del cron).
- `GET /clientes/:id/suscripciones` y `GET /servicios/:id/suscripciones`.

### 2.5 Débito automático independiente de la pasarela

**Cuentas de pasarela por empresa y proveedor (regla 14)**
- `billing.pasarela_cuentas`:
  - `empresa_id NOT NULL`, `proveedor` (nombre del adaptador: `recurrente`, `neonet`, `falsa`), `alias`;
  - `proveedor_cobro_id → ledger.proveedores_cobro` (ya da la cuenta puente y la de liquidación de esa empresa);
  - `credenciales_cifradas` (JSON cifrado con `#shared/cifrado`; cada adaptador declara qué claves pide) y `webhook_secreto_cifrado`; en auditoría, `***`;
  - `clave_publica` (identificador sin secreto que va en la URL del webhook);
  - `modo` (`pruebas` | `produccion`), `usos text[]` (`pago_en_linea`, `debito`), `activa`, `prueba_ok`, `probada_en`, `version`.
  - `UNIQUE (empresa_id, proveedor)`. Un índice parcial deja una sola cuenta predeterminada por empresa y uso.
- `billing.pasarela_cobros.pasarela_cuenta_id NULL` y `billing.pasarela_eventos.pasarela_cuenta_id NULL`.
- Webhook: `POST /pasarela/webhook/:proveedor/:clave_publica`. La firma se verifica con el secreto de esa cuenta. La ruta actual `POST /pasarela/webhook/:proveedor` sigue valiendo para la cuenta sembrada desde el entorno.
- Compatibilidad: una acción de siembra crea la cuenta de la empresa principal a partir de `PASARELA_PROVEEDOR` y `RECURRENTE_*` (como ya hace `sembrar_configuracion_canales.ts` en notify). Sin cuentas en la base, todo se comporta como hoy.
- Evento `pasarela.config_cambiada` (`pasarela_cuenta_id`, `empresa_id`, `proveedor`, `campos[]`; nunca valores).
- Permisos: `pasarelas.ver`, `pasarelas.configurar`, `pasarelas.probar` (admin; contabilidad solo ver).
- Endpoints: `GET /pasarelas/cuentas`, `POST /pasarelas/cuentas`, `PUT /pasarelas/cuentas/:id`, `POST /pasarelas/cuentas/:id/probar | activar | desactivar`, `GET /pasarelas/proveedores` (adaptadores disponibles y sus capacidades).

**Interfaz común** (`apps/api/app/billing/pasarelas/pasarela.ts`). El adaptador se construye con la configuración de una cuenta (ya no lee el entorno) y declara lo que sabe hacer:

```ts
interface CapacidadesPasarela {
    pago_en_linea: boolean
    /** cómo guarda la tarjeta: página del proveedor, o no la guarda */
    tokenizacion: 'checkout_alojado' | 'ninguna'
    /** cargo sin el cliente presente, con monto libre */
    cargo_con_token: boolean
    revocar_metodo: boolean
    /** avisa por webhook el resultado de la tokenización y del cargo */
    webhooks: { tokenizacion: boolean; cargo: boolean }
    minimo: string // "5.00"
}

interface Pasarela {
    readonly nombre: string
    readonly capacidades: CapacidadesPasarela
    // lo que ya existe
    crearCobro(entrada): Promise<CobroCreado>
    verificarWebhook(entrada): NotificacionPasarela
    consultar(idProveedor): Promise<EstadoEnProveedor>
    // nuevo, opcional según capacidades
    iniciarTokenizacion?(entrada): Promise<{ id_proveedor: string; url: string; expira_en: Date | null }>
    consultarTokenizacion?(idProveedor): Promise<ResultadoTokenizacion>
    cobrarMetodoGuardado?(entrada): Promise<ResultadoCargo>
    consultarCargo?(idProveedor | claveIdempotencia): Promise<ResultadoCargo>
    consultarMetodo?(token): Promise<DatosMetodo>
    revocarMetodo?(token): Promise<void>
}
```

- `ResultadoTokenizacion`: `estado` (`pendiente` | `guardado` | `cancelado`), `token`, `cliente_proveedor`, `marca`, `ultimos4`, `vence_mes`, `vence_anio`.
- `ResultadoCargo`: `estado` (`pagado` | `rechazado` | `pendiente` | `requiere_autenticacion`), `id_proveedor`, `monto`, `comision`, `retenido_iva`, `codigo_rechazo` (normalizado: `fondos`, `tarjeta_vencida`, `tarjeta_invalida`, `rechazo_banco`, `autenticacion`, `otro`), `definitivo` (true = no reintentar con ese método).
- `NotificacionPasarela` suma el tipo `tokenizacion` (éxito o cancelación) junto a los estados de cobro que ya existen.
- El resto del sistema solo mira `capacidades`: una cuenta cuyo adaptador no tiene `cargo_con_token` no se ofrece para débito, y pedirlo responde 422 `debito_no_soportado`. Ningún `if (proveedor === 'recurrente')` fuera del adaptador.
- El adaptador nuevo de un proveedor es un archivo en `pasarelas/` y una línea en el registro; no toca tablas ni acciones.

**Tablas del débito**
- `billing.pasarela_clientes`: `empresa_id`, `cliente_id`, `pasarela_cuenta_id`, `id_proveedor` (el `cus_…` en Recurrente); único por cuenta y cliente.
- `billing.metodos_pago`:
  - `empresa_id`, `cliente_id`, `pasarela_cuenta_id`, `token_cifrado` (con `#shared/cifrado`; en auditoría `***`);
  - `marca`, `ultimos4`, `vence_mes`, `vence_anio`;
  - `estado` (`pendiente`, `activo`, `revocado`, `vencido`), `tokenizacion_id`;
  - `consentimiento_en`, `consentimiento_version`, `consentimiento_canal`, `version`.
  - Nunca el número, el CVV ni el nombre impreso.
- `billing.debitos_automaticos`: `empresa_id`, `cliente_id`, `metodo_pago_id`, `alcance` (`cliente` | `servicio` | `suscripcion`), `servicio_id`, `suscripcion_id`, `activo`, `rechazos_seguidos smallint DEFAULT 0`, `desactivado_motivo`, `desactivado_en`, `version`. Único parcial: un débito activo por alcance.
- `billing.debito_intentos` (solo inserción más cambio de estado): `factura_id`, `debito_id`, `metodo_pago_id`, `cobro_id → billing.pasarela_cobros`, `intento_n` (1 o 2), `clave_idempotencia`, `estado` (`pendiente`, `pagado`, `rechazado`, `error`), `codigo_rechazo`, `proximo_intento_en`. `UNIQUE (factura_id, intento_n)`.

**Eventos**
- `metodo_pago.guardado` y `metodo_pago.revocado` (`metodo_pago_id`, `empresa_id`, `cliente_id`, `proveedor`, `marca`, `ultimos4`).
- `debito.activado` y `debito.desactivado` (`debito_id`, `empresa_id`, `cliente_id`, `alcance`, `servicio_id`, `suscripcion_id`; desactivado: `motivo` = `cliente` | `operador` | `rechazos` | `metodo_revocado` | `contracargo` | `tarjeta_vencida`).
- `debito.fallido` (`debito_id`, `factura_id`, `empresa_id`, `cliente_id`, `intento_n`, `codigo_rechazo`, `reintenta`, `proximo_intento_en`, `rechazos_seguidos`).
- El éxito sale como el `pago.registrado` de siempre, con `metodo: debito`.

**Permisos:** `debitos.ver`, `debitos.enviar_enlace`, `debitos.desactivar`, `debitos.reintentar` (admin, cajero, soporte). Activar es solo del cliente, desde el portal.

**Endpoints**
- Portal: `POST /portal/metodos-pago/iniciar`, `GET /portal/metodos-pago`, `POST /portal/metodos-pago/:id/quitar`, `POST /portal/debito/activar | desactivar`.
- Panel: `GET /clientes/:id/debito`, `POST /clientes/:id/debito/enviar-enlace`, `POST /debitos/:id/desactivar`, `POST /facturas/:id/debito/reintentar`.

### 2.6 Recordatorios por plantilla

Mismo patrón que las plantillas de facturación (nombre, una por defecto, se retiran en vez de borrarse, excepción por servicio), pero dentro de `notify` y por empresa.

**Tablas (schema `notify`, dueño A6)**
- `notify.plantillas_recordatorio`:
  - `empresa_id NOT NULL`, `nombre`, `descripcion`;
  - `por_defecto boolean` (índice único parcial: una por empresa);
  - `servicio_id bigint NULL`: con valor, es la plantilla **personalizada** de ese servicio (única por servicio, no aparece en la lista general ni se asigna a otros);
  - `retirada_en`, `retirada_por`, `motivo_retiro`, `version`.
  - `UNIQUE (empresa_id, nombre)` entre las que no son personalizadas.
- `notify.plantillas_recordatorio_pasos` (hasta 8 por plantilla):
  - `plantilla_id`, `orden`;
  - `disparador`: `vencimiento` (días antes o después de `vence_en`), `corte_proximo` (días antes del corte previsto), `promesa_por_vencer` (días antes de que venza la promesa);
  - `dias integer` (negativo antes, positivo después; −60 a 60), `hora time` (hora de Guatemala);
  - `aviso`: código del aviso que se pide a Iris (`factura_por_vencer`, `factura_vencida`, `corte_proximo`, `promesa_por_vencer`);
  - `evento_plantilla`: texto local de respaldo en `notify.plantillas` (`recordatorio.1` a `recordatorio.3` y los nuevos `recordatorio.corte_proximo`, `recordatorio.promesa_por_vencer`);
  - `canales text[]` (`whatsapp`, `correo`, `telegram`; vacío = el que elija Iris según su configuración);
  - `activo`, `version`. `UNIQUE (plantilla_id, orden)`.
- `notify.recordatorios_asignaciones`: `empresa_id`, `plantilla_id`, `servicio_id NULL`, `suscripcion_id NULL`, `asignada_por`, `version`. CHECK: exactamente uno de los dos. Único por servicio y único por suscripción. Vive en `notify`: no agrega columnas a `core.servicios` ni a `billing.suscripciones`.

**Qué plantilla aplica a una factura** (función única `plantillaRecordatorioEfectiva`, en `apps/api/app/notify/plantillas_recordatorio.ts`):
1. La personalizada del servicio de la factura, si existe.
2. La asignada a ese servicio o a esa suscripción.
3. La por defecto de la empresa de la factura.

Una factura sin servicio ni suscripción (cargo único suelto) usa la por defecto de su empresa. No hay nivel de zona ni nivel global.

**Migración.** Por cada empresa se crea la plantilla «Estándar», por defecto, con los tres recordatorios actuales como pasos de `vencimiento` (mismos `dias`, `hora` y `activo`). `notify.recordatorios` queda de solo lectura hasta retirarla en un lote posterior. El origen de los envíos no cambia de forma, así que nada ya enviado se repite.

**Idempotencia.** Origen `recordatorio:<orden>:factura:<id>` para `vencimiento` (el de hoy), `recordatorio:corte:<orden>:factura:<id>` y `recordatorio:promesa:<orden>:promesa:<id>`. Depende del paso y del documento, no de la plantilla: cambiar de plantilla a mitad de mes no reenvía el paso que ya salió.

**Eventos:** `recordatorios.plantilla_cambiada` (`plantilla_id`, `empresa_id`, `campos[]`, `pasos` bool) y `recordatorios.asignacion_cambiada` (`empresa_id`, `servicio_id` o `suscripcion_id`, `plantilla_id` o null, `personalizada` bool).

**Permisos:** `recordatorios.ver`, `recordatorios.crear`, `recordatorios.editar`, `recordatorios.retirar`, `recordatorios.asignar`, `recordatorios.personalizar` (admin, todos; soporte: ver, asignar, personalizar; lectura: ver). `notificaciones.editar` sigue cubriendo los textos de `notify.plantillas`.

**Endpoints**
- `GET /plantillas-recordatorio`, `POST /plantillas-recordatorio`, `GET /plantillas-recordatorio/:id`, `PUT /plantillas-recordatorio/:id` (con sus pasos y `version`).
- `POST /plantillas-recordatorio/:id/retirar | fijar-por-defecto`.
- `GET /plantillas-recordatorio/:id/vista-previa?factura_id=` (qué saldría y cuándo, sin enviar nada).
- `POST /servicios/:id/recordatorios/asignar` (`plantilla_id` o null para volver a la por defecto) y `POST /suscripciones/:id/recordatorios/asignar`.
- `PUT /servicios/:id/recordatorios/personalizados` y `POST /servicios/:id/recordatorios/quitar-personalizados`.
- `GET /servicios/:id/recordatorios` y `GET /suscripciones/:id/recordatorios` (plantilla efectiva, de dónde sale y los próximos envíos).
- `POST /plantillas-recordatorio/:id/asignar-masivo` (a los servicios de un filtro, como `asignar_plantilla_sin_plantilla.ts`; pasa por una acción que registra cada fila).

### 2.7 Contrato con Iris: versión 0.15.0

Minor y aditiva sobre la 0.14.3. Tres bloques con su marca en `capacidades`, para que cada lado los implemente por separado. Un conector que informa una versión menor no recibe nada nuevo y todo sigue como hoy.

| Bloque | Pedido | Qué agrega | Lo usa |
| --- | --- | --- | --- |
| A · Tipo de servicio | A53 / B33 | `tipo_servicio` y `componentes[]` en `GET /servicios/:id`, en la lista del cliente y en los webhooks `servicio.creado` y `servicio.config_cambiada`. `router_id` puede ser null en un servicio de cable | T1, T2 |
| B · Corte manual de respaldo | A54 / B34 | `servicio.corte_manual_solicitado`, `servicio.corte_manual_cancelado` (Argos → Iris) y `corte_manual.estado_cambiado` (Iris → Argos), §2.2 | T3a |
| C · Recordatorios por plantilla, entregados por Iris | A55 / B35 | Lo de abajo | R3 |

**Bloque C, detalle propuesto** (cambia §6.1 a §6.3 del contrato):
- **Iris entrega por el canal que tenga configurado.** `POST /mensajeria/avisos` acepta `canal_preferido: "auto"` y `canales_permitidos[]` (`whatsapp`, `correo`, `telegram`; vacío = todos). Iris elige según su configuración de comunicación de esa empresa y sus respaldos. Con `auto`, Argos **no** manda ese aviso por su propio correo ni Telegram: así no sale dos veces. Deroga, solo para los avisos con `auto`, la frase de §6.1 «Argos solo pide avisos con `canal_preferido: "whatsapp"`».
- **Códigos nuevos** en §6.3:

| Código | Variables | Cuándo, en Argos |
| --- | --- | --- |
| `corte_proximo` | `monto`, `moneda`, `fecha_corte` | Paso con disparador `corte_proximo` |
| `promesa_por_vencer` | `monto`, `moneda`, `vence_en` | Paso con disparador `promesa_por_vencer` |
| `debito_fallido` | `monto`, `moneda`, `reintenta_el` (o vacío) | `debito.fallido` |
| `debito_desactivado` | (ninguna) | `debito.desactivado` por rechazos, contracargo o tarjeta vencida |
| `suscripcion_suspendida` / `suscripcion_reactivada` | `concepto` | `suscripcion.estado_cambiada` |

- `factura_por_vencer` y `factura_vencida` suman la variable opcional `concepto` (nombre del producto, de lista cerrada del catálogo; nunca texto libre de una persona) para las facturas de suscripción.
- El cuerpo del aviso suma `suscripcion_id` (opcional) y `recordatorio: { disparador, orden }` (opcional, solo informativo para la bandeja de Iris). La `Idempotency-Key` no cambia: `argos:aviso:<plantilla>:<envio_id>`.
- `aviso.entregado` ya trae `canal`; con `auto` puede ser `whatsapp`, `correo` o `telegram`.
- Iris informa en `capacidades.mensajeria` (por empresa): `entrega_auto` (bool), `canales[]` y `codigos[]` aprobados. Argos lo combina con A52 (§6.7) para mostrar en el panel qué pasos pueden salir.
- Las reglas contra spam de §6.5 no cambian y las sigue aplicando Iris. Un paso que cae en silencio sale al terminar; si ya no tiene sentido, Iris lo descarta con `aviso.fallido` y `motivo = vencido`, como hoy.
- Sin datos personales nuevos: Argos sigue sin mandar el número ni el correo.

**Gobierno.** Se cambia con PR enlazada en los dos repos. La copia local de Iris de este contrato (`.claude/integration/contratos/argosisp.md` en el repo de Iris) que vi está en una versión anterior (0.7.0, borrador): el líder debe confirmar cuál es el espejo vigente antes de proponer la 0.15.0.

## 3. Reglas de negocio e impacto

### 3.1 Tipos de servicio y corte
- **Facturación.** Misma plantilla y mismo IVA. El concepto sale del tipo («Servicio de internet …», «Servicio de cable …», «Servicio de IPTV …»). El mixto emite una línea por componente (internet con `4.1.01`; cable e IPTV con cuentas nuevas a confirmar con el contador, P-N14). Prorrateo y descuentos de lealtad van proporcionales a cada línea; la suma de las líneas es el precio del plan.
- **Decisión de estado.** `evaluarEstadoServicio` sigue siendo la única. Lee las capacidades del tipo: en `cable` e `iptv` no existe «limitado», y `facturas_para_limitar` se ignora.
- **Mixto con deuda (decisión del PM): se corta todo.** Al pasar a `suspendido`:
  - lo que va sobre IP (internet, IPTV) se corta por red, como hoy;
  - el cable se corta por SmartOLT.
  - En `limitado` no se toca el CATV, lo que respeta la restricción de SmartOLT de no deshabilitar la misma ONT varias veces por semana.
- **IPTV.** No hay código nuevo de corte: es un servicio con router, y aaa, coa y routeros lo tratan igual que a un internet. Lo único nuevo es el tipo, el concepto de la factura y que no se limita.
- **Flujo del corte de cable.** Un consumidor de `servicio.estado_cambiado` en `integraciones/equipos`, idempotente por id de outbox, crea la orden si el servicio tiene el componente `cable`. El worker existente la ejecuta con lock por pedido.
  - Gestionable: llama a `disable_catv` o `enable_catv`.
  - 409 `onu_busy` o `queued: true`: no se da por hecho; se confirma con `check_bulk_task_status` o con `get_onus_catv_statuses`.
  - 400 «CATV not supported»: marca `no_soportado`, deja la orden `derivada` y crea la solicitud de respaldo a Iris.
  - Reintentos agotados, instancia no operativa o servicio sin ONU: orden `derivada` (o ninguna orden) y solicitud de respaldo.
- **Corridas masivas.** El worker agrupa por instancia y usa `bulk_disable_catv` con `async=1` para no agotar las 1 000 llamadas por hora.
- **Reactivación.** Viaja por evento. Una orden de corte aún pendiente se cancela: nunca hubo corte. Una aplicada genera la reconexión. Lo mismo con la solicitud a Iris (`servicio.corte_manual_cancelado`).
- **Alta.** El cable va sin router, IP ni PPPoE. `pendiente_instalacion` y `activar-instalacion` funcionan igual, sin IPAM; la ONU la registra la instalación por el flujo de equipos que ya existe. IPTV y mixto se dan de alta como un internet.
- **FEL y libro.** Sin cambios de mecanismo; solo descripción y cuenta por línea. Cualquier tratamiento fiscal distinto para la TV debe confirmarlo el contador (no lo verifiqué).
- **ACL.** Un usuario con alcance por router no ve servicios de cable (no tienen router). Por zona y por empresa sí. Hay que documentarlo en `core/README.md`.
- **Iris.** `tipo_servicio` en la ficha y en los webhooks es aditivo (0.15.0, bloque A).

### 3.2 Adicionales
- Pausa: no se cobra el periodo que empieza en pausa. Tope: `ajustes_cobro.pausa_tope_dias`.
- Baja inmediata sin reembolso, o programada a fin de periodo.
- Bloqueo al suspender el servicio (ya existe).
- Cuenta de ingreso por línea (`cuenta_codigo` del producto o `4.1.03`).

### 3.3 Suscripciones
- **Emisión.** El cron `suscripciones.generar` procesa todo lo pendiente hasta ahora, por lotes y con lock. Una factura por suscripción y periodo de `ciclo_meses`, con una línea «<nombre> del … al …», tipo `otro` y la cuenta del producto. Reusa `emitirDocumento`, igual que el cargo único sin servicio.
- **Qué no se emite.** Periodos en pausa, anteriores a `inicio`, posteriores a la cancelación, con la suscripción `suspendida` (recomendado, P-N2) o de monto cero (bonificación, nunca factura de Q0).
- **Vencimiento y mora.** `vence_en = periodo + dias_gracia` de la plantilla. Hoy `vencer_factura.ts` toma la configuración por servicio; hay que darle el camino por suscripción.
- **FEL.** La regla de `certificar_al` de su plantilla y los datos fiscales del cliente. Sin cambios en `fiscal`.
- **Libro.** CxC del cliente contra ingreso (cuenta del producto) más IVA; `empresa_id` de la suscripción. Los anticipos del cliente en esa empresa se aplican como hoy.
- **Qué se suspende si no paga: cada una por su propia deuda** (recomendado en la v2; el PM no lo contradijo).
  - `suscripciones.evaluar_estado` es la única que decide: con facturas vencidas de esa suscripción ≥ `facturas_para_cortar` pasa a `suspendida` y emite `suscripcion.estado_cambiada`.
  - La llaman el cron de corte, `registrarPago` y `anularPago`. El pago la reactiva en la misma transacción.
  - La suspensión manual solo se quita con `reactivar`.
  - La deuda de una suscripción no corta ningún servicio, ni siquiera el servicio al que está ligada. La deuda de un servicio no suspende sus suscripciones.
  - Quien presta el producto actúa con el evento. No hay nada de red que cortar.
- **Ligada a un servicio: qué hereda y qué no.**
  - Hereda cliente y empresa del servicio (trigger). Se muestra en la ficha del servicio.
  - `servicio.titular_cambiado`: la suscripción pasa al titular nuevo, por una acción auditada; las facturas ya emitidas quedan con el titular anterior.
  - Servicio `retirado` o eliminado: la suscripción se cancela con baja programada a fin del periodo ya facturado (`motivo = servicio_retirado`). Un consumidor idempotente de `servicio.estado_cambiado` llama a la acción.
  - Servicio `suspendido` o `limitado`: la suscripción no cambia.
  - Servicio que cambia de empresa (`servicio.config_cambiada` con `empresa`): la suscripción ligada no se mueve sola; queda marcada para revisión y sale una alerta interna. El catálogo es por empresa y el producto puede no existir en la otra.
- **Promesas.** No aplican en esta ronda: `billing.promesas.servicio_id` es obligatorio.
- **Baja.** Inmediata o programada a fin de periodo; sin reembolso del periodo ya facturado (nota de crédito manual si hace falta).
- **Portal.** «Mis suscripciones» (nombre, precio, ciclo, estado, próximo cobro, servicio al que está ligada) y sus facturas en la cuenta. Se pagan con el pago en línea existente (`{ facturas: [ids] }`). Ni alta ni baja desde el portal; nunca credenciales.
- **Notify.** `factura.emitida` y `factura.vencida` con `servicio_id` null ya ocurren con cargos únicos. Hay que agregar la variable `suscripcion.*` y el aviso de `suscripcion.estado_cambiada`.

### 3.4 Débito automático
- **Sin datos de tarjeta en Argos.** El cliente escribe la tarjeta solo en la página alojada del proveedor. Argos guarda el token cifrado, la marca, los últimos 4 y el vencimiento. El panel nunca captura tarjetas: solo envía el enlace. Un proveedor que solo tokenice con campos dentro de la página del comercio no se integra (`tokenizacion: 'ninguna'`): cambiaría el alcance PCI.
- **Qué pasarela se usa.** La cuenta de la empresa de la factura marcada como predeterminada para `debito`. El método guardado queda atado a esa cuenta: un token no sirve en otra pasarela ni en otra empresa. Si el cliente tiene servicios en dos empresas, registra un método por empresa.
- **Consentimiento.** Antes de redirigir, el portal muestra y registra el texto (versión, fecha, canal) con frecuencia, monto variable, momento del cargo y cómo cancelar. El texto legal lo aprueba el PM (P-N4).
- **Cuándo se cobra (decisión del PM): al emitir la factura.**
  - Un consumidor de `factura.emitida` crea el intento 1 para las facturas dentro del alcance de un débito activo. El cron `debitos.cobrar` (todo lo pendiente, con lock) es el respaldo y el que ejecuta los reintentos.
  - Una factura que nace `por_certificar` se cobra cuando queda `emitida`.
- **Qué se cobra.** El saldo pendiente de la factura en ese momento, dentro del alcance del débito (servicio, suscripción o todo el cliente en esa empresa).
- **Qué nunca se cobra.** Facturas `por_certificar`, anuladas, sustituidas, con saldo 0, con promesa activa o de un pago en disputa, ni montos bajo el mínimo de la pasarela (`capacidades.minimo`; Q5.00 en Recurrente).
- **Rechazo (decisión del PM): un reintento a los 3 días.**
  - El intento 1 rechazado deja `proximo_intento_en = +3 días`, emite `debito.fallido` y avisa al cliente con enlace para pagar o cambiar la tarjeta.
  - El intento 2 usa clave de idempotencia nueva. Si también se rechaza, esa factura no se vuelve a cobrar sola: sigue su vencimiento y corte normales.
  - Un rechazo `definitivo` (tarjeta vencida o inválida) no programa el reintento.
  - Entre el intento 1 y el 2, si el cliente paga por otro medio, el reintento se cancela.
- **Desactivación (decisión del PM): tras 3 rechazos seguidos.**
  - `rechazos_seguidos` cuenta intentos rechazados consecutivos de ese débito, de cualquier factura; un cargo aprobado lo pone en 0.
  - Al llegar a 3, el débito se desactiva (`motivo = rechazos`), emite `debito.desactivado` y se avisa al cliente.
  - También se desactiva con una tokenización cancelada, un método revocado, un contracargo (`pago.disputa_abierta`) o la tarjeta vencida.
  - Reactivarlo es del cliente, desde el portal, con un método vigente.
- **Idempotencia.**
  - Se crean primero el `pasarela_cobros` y el `debito_intentos`; el `UNIQUE (factura_id, intento_n)` impide dos cargos entre réplicas.
  - Luego se llama a la pasarela con la clave `argos:debito:<factura_id>:<intento_n>`.
  - Un timeout se reintenta con la **misma** clave y, si el adaptador lo permite, se consulta antes (`consultarCargo`).
  - El pago se registra con la misma acción interna del webhook, idempotente por cobro. Webhook y conciliación quedan de respaldo.
- **`requiere_autenticacion`.** Si el proveedor responde que el cargo necesita al cliente (3-D Secure), cuenta como rechazo con `codigo_rechazo = autenticacion` y el aviso lleva el enlace de pago en línea.
- **Reactivación.** El pago del débito llama a `evaluarEstadoServicio` o a `suscripciones.evaluar_estado`, como cualquier pago.
- **Libro.** El mismo asiento del pago en línea (cuenta puente del `proveedores_cobro` de esa cuenta, comisión `5.1.02`, retención de IVA de la emisora). `pagos.metodo`: `debito`.
- **FEL.** Argos certifica con INFILE. La facturación electrónica propia de la pasarela debe estar apagada (la guía de Recurrente dice que `one_time_payments` puede certificar FEL en cuentas que la usan).
- **Multiempresa.** Cuenta, método, débito e intento llevan `empresa_id`. Un cargo nunca mezcla facturas de dos NIT.

### 3.5 Adaptadores

**Recurrente (basado en su documentación pública, §1.4)**

| Operación de la interfaz | En Recurrente |
| --- | --- |
| Credenciales de la cuenta | `secret_key` (`X-SECRET-KEY`), `webhook_secret` (Svix `whsec_…`) |
| `iniciarTokenizacion` | `POST /api/customers` si el cliente no tiene `cus_…` en esa cuenta; luego `POST /api/checkouts` con `mode: "setup"`, `customer_id`, `success_url`, `cancel_url`, `metadata.referencia` |
| Resultado de la tokenización | Webhook `setup_intent.succeeded` (`data.checkout.payment_method.id`) o `setup_intent.cancelled`; respaldo con `consultarTokenizacion` = `GET /api/checkouts/{id}` |
| `consultarMetodo` | `GET /api/payment_methods/{id}` (`card.last4`, `network`, vencimiento, `status`) |
| `cobrarMetodoGuardado` | `POST /api/one_time_payments` con `customer_id`, `payment_method_id`, `items[]` (un ítem en GTQ, `amount_in_cents`) e `Idempotency-Key` |
| `revocarMetodo` | No documentado: `capacidades.revocar_metodo = false`. Argos marca el método `revocado` y deja de usarlo |
| Capacidades | `tokenizacion: 'checkout_alojado'`, `cargo_con_token: true`, `minimo: "5.00"` |

Pendiente de ver en el Sandbox o con la llave LIVE:
1. Forma exacta del webhook de un `one_time_payment` con método guardado (la guía muestra `eventType` y `data.checkout.payment_method`; el resto no).
2. Qué responde un rechazo del banco (código HTTP y cuerpo) para normalizar `codigo_rechazo`.
3. Si un cargo sin presencia puede pedir 3-D Secure y qué responde entonces.
4. La comisión y la retención de IVA de un `one_time_payment` (si llegan en la respuesta o solo por webhook).
5. Que «cobros únicos» esté habilitado en la cuenta.

**NeoNet (supuestos; nada confirmado con documentación técnica)**
- **S1.** El cargo de monto variable con token se haría con Cybersource (tokenización más cargo iniciado por el comercio), no con NeoPagos. NeoPagos parece un cobro mensual programado dentro de una plataforma de NeoNet; no sé si tiene API ni si admite monto variable.
- **S2.** Cybersource ofrece una página de pago alojada con la que el comercio no toca la tarjeta. No confirmé que la afiliación de NeoNet la incluya. Si solo ofrecen campos dentro de la página del comercio, el adaptador no se hace (regla de §3.4).
- **S3.** Credenciales, ambiente de pruebas, formato y firma de las notificaciones, cómo se informa la comisión y los plazos de liquidación son desconocidos.
- **S4.** La afiliación y las tarifas son por comercio (por NIT): encaja con una cuenta de pasarela por empresa.
- Qué pedirle a NeoNet antes de estimar D4 (contacto público del sitio: `servicios@neonet.com.gt`):
  1. documentación de integración de Cybersource y de NeoPagos;
  2. si permiten guardar la tarjeta en una página alojada y cobrar después un monto distinto cada mes sin el cliente presente;
  3. credenciales de prueba;
  4. cómo notifican el resultado y cómo se concilia.

**Falsa (laboratorio y pruebas).** Implementa la interfaz completa, con rechazos programables (`fondos`, `tarjeta_vencida`, `autenticacion`, timeout) para probar D1 y D2 sin proveedor real.

### 3.6 Recordatorios
- **Argos decide qué y cuándo; Iris entrega.**
  - El cron `notify-cron` sigue siendo el único que programa: procesa todo lo pendiente, con lock, en lotes.
  - Por cada factura cobrable resuelve la plantilla efectiva y toma, de sus pasos activos, el más reciente cuyo momento ya pasó y que no se haya enviado (la misma regla de hoy, para no mandar tres atrasados tras una caída).
  - Siguen fuera las facturas `por_certificar`, sustituidas, pagadas y las de un servicio `pendiente_instalacion`.
- **Disparadores.**
  - `vencimiento`: `vence_en + dias` a la `hora` del paso, en hora de Guatemala.
  - `corte_proximo`: `dias` antes de la fecha en que `evaluarEstadoServicio` cortaría (o `suscripciones.evaluar_estado` suspendería) si nada cambia. notify **no** calcula esa fecha: A3 expone una función de solo lectura (`fechaCortePrevista`) con las mismas reglas de plantilla y excepciones. Sin fecha prevista, el paso no sale.
  - `promesa_por_vencer`: `dias` antes del `vence` de una promesa activa del servicio.
- **Entrega.**
  - Con Iris ≥ 0.15.0 y `capacidades.mensajeria.entrega_auto` para la empresa: un solo envío, canal `iris`, con `canal_preferido: "auto"` y los `canales` del paso. Iris aplica su configuración de comunicación, el permiso, el límite diario y el silencio. El estado final y el canal real llegan con `aviso.entregado` o `aviso.fallido`.
  - Con Iris entre 0.6.0 y 0.14.x: como hoy. WhatsApp por Iris con `canal_preferido: "whatsapp"` (solo los códigos que ese Iris conoce) y correo y Telegram desde Argos.
  - Sin Iris: correo y Telegram desde Argos con el texto de `evento_plantilla`. Nada se inventa: un paso sin canal posible queda `omitido` con su motivo.
  - Un aviso `bloqueado` por Iris queda `omitido` con el motivo, sin reintento ni respaldo, como hoy.
- **Personalizados por servicio.** Son una excepción del cliente: un conjunto propio de pasos que sustituye completo al de la plantilla para ese servicio. Lo crea soporte desde la ficha, queda auditado con su diff, y se quita con una acción que devuelve el servicio a su plantilla asignada o a la por defecto.
- **Suscripciones.** Tienen plantilla asignada o la por defecto de la empresa. No tienen personalizados en esta ronda (el PM los pidió por servicio).
- **Contactos.** Los avisos de cobro siguen copiándose a los contactos con `permisos.avisos` del servicio; con entrega por Iris, el contacto y su permiso por número ya los resuelve Iris (§6.4 del contrato).
- **Cambios de plantilla.** Editar los pasos no reenvía lo ya enviado. Retirar una plantilla no la quita de quien la tiene; solo impide asignarla. La por defecto no se puede retirar sin fijar otra.
- **Multiempresa.** La plantilla y la asignación llevan `empresa_id`; un servicio solo recibe plantillas de su empresa (trigger). Con una sola empresa, tras la migración todo se comporta igual que hoy.
- **Panel.** `GET /plantillas-recordatorio/:id/vista-previa` y `GET /servicios/:id/recordatorios` muestran qué saldría y por qué canal puede salir, combinando A52 y `capacidades`. Si no se pudo leer a Iris, la pantalla lo dice con «Reintentar»; no muestra «aprobada» por defecto.

## 4. Lotes ordenados

Carriles: T (tipos y corte), S (adicionales), I (suscripciones), D (débito), R (recordatorios). Complejidad → modelo ejecutor: **alta → Opus, media → Sonnet, baja → Haiku**.

Reglas comunes a todos los lotes:
- Base, puerto y prefijos de Redis propios por agente (regla 12). Migraciones con `node ace make:migration`, fusionadas de una en una.
- Cada lote de API regenera `packages/contracts` y actualiza el `README.md` del módulo, `eventos.md` y el catálogo de `CLAUDE.md` si agrega eventos.
- Las pruebas de API son Japa contra Postgres real, en `apps/api/tests/<módulo>/`.

### Tabla resumen

| Lote | Qué | Dueño | Complejidad | Depende de |
| --- | --- | --- | --- | --- |
| L0 | Contratos y contrato Iris 0.15.0 | líder | media | — |
| T1 | Modelo de tipo de servicio | A1 | media | L0 |
| T2 | Servicio de cable sin router | A1 + A2 | alta | T1 |
| T3a | Respaldo: corte manual avisado a Iris | A6 | media | L0, Iris 0.15.0 bloque B |
| T3b | Corte y reconexión de CATV por SmartOLT | A6 | alta | T1, T3a, fusión de `agente/a6-olt-acs` |
| T4 | Facturación, libro y FEL por tipo | A3 + auditor | alta | T1, S1, cuentas del contador |
| T5 | Panel y portal de tipos | A4 + A5 | media | T2, T3b, T4 |
| T6 | Bordes: textos, importación, demo | A6 | baja | T1 |
| S1 | Catálogo de adicionales ampliado | A1 + A3 | media | L0 |
| S2 | Pausa y baja programada de adicionales | A1 + A3 | media | S1, T4 |
| S3 | Panel de adicionales | A4 | baja | S2 |
| I1 | Modelo y ciclo de vida de la suscripción | A3 | media | S1 |
| I2 | Emisión, FEL, libro y mora | A3 + auditor | alta | I1 |
| I3 | Estado por mora, pagos y vínculo con el servicio | A3 | media | I2, D2 |
| I4 | Panel, portal y avisos de suscripciones | A4 + A5 + A6 | media | I3 |
| D0 | Cuentas de pasarela por empresa y proveedor | A3 | media | L0 |
| D1 | Interfaz común de tokenización; Recurrente y falsa | A3 | alta | D0 |
| D2 | Cargo al emitir, reintento y desactivación | A3 + auditor | alta | D1 |
| D3 | Portal, panel y avisos del débito | A5 + A4 + A6 | media | D2 |
| D4 | Adaptador de NeoNet | A3 | media (a reestimar) | D1, documentación y credenciales de NeoNet |
| R1 | Plantillas de recordatorio: modelo, migración y asignación | A6 | alta | L0 |
| R2 | Cron por plantilla y disparadores nuevos | A6 + A3 | alta | R1 |
| R3 | Entrega por Iris (0.15.0 bloque C) y A52 | A6 | media | R1, Iris 0.15.0 bloque C |
| R4 | Panel de recordatorios | A4 | media | R1 (R2 y R3 para el estado real) |
| R5 | Recordatorios de suscripciones y avisos del débito | A6 | baja | R2, I2, D2 |

### Lote 0 · Contratos (líder)
- **Archivos:** este plan; nuevos `contratos/tipos-servicio.md`, `contratos/suscripciones.md`, `contratos/debito-automatico.md`, `contratos/recordatorios.md`; `adicionales.md`; `pago-en-linea.md` (cuentas por empresa, interfaz común); `equipos-olt-acs.md` (sección CATV, en su rama); `iris.md` (0.15.0, bloques A, B y C, pedidos A53 a A55 y B33 a B35) con su PR espejo en Iris; `eventos.md`; catálogo de `CLAUDE.md`; `modelo-datos.md`.
- **Pruebas:** no aplica. Revisión cruzada de los dueños de cada contrato.
- **Complejidad:** media (el bloque C de Iris toca §6 y hay que acordarlo). **Dependencias:** ninguna. Las preguntas del §5 no lo bloquean: se aplica lo recomendado.

### T1 · Modelo de tipo de servicio (A1)
- **Archivos:** migración; `apps/api/app/core/tipos_servicio.ts` (nuevo); `core/validators.ts`; `core/esquemas.ts`; `core/consultas/servicios.ts`; `network/consultas/planes.ts`; `network/validators.ts`; acciones de plan; `shared/eventos.ts`; `packages/contracts`.
- **Pruebas** (`tests/core/tipos_servicio.spec.ts`, `tests/network/planes_tipo_servicio.spec.ts`)
  - Tras migrar, todo es `internet` con `componentes = {internet}`.
  - Tipo distinto al del plan da 422.
  - Plan mixto con menos de dos componentes, o con `precio_cable + precio_iptv` ≥ precio habiendo internet, da 422.
  - Plan de cable acepta velocidad nula; internet e IPTV no.
  - Los filtros por tipo funcionan en `/servicios` y `/planes`.
  - `servicio.creado` lleva `tipo_servicio` y `componentes`.
  - La suite actual no cambia.
- **Complejidad:** media. **Dependencias:** L0.

### T2 · Servicio de cable sin router (A1 + A2)
- **Archivos:** migración (`router_id` anulable y CHECK); `core/actions/crear_servicio.ts`; `editar_servicio.ts`; `activar_instalacion_servicio.ts`; `core/asignaciones_servicio.ts`; `core/aaa.ts`; `core/consumidor_aaa.ts`; `network/routeros/*`; `network/sesiones/*`; `services/coa`; `core/acl.ts`; consultas con join a routers; `integraciones/iris` (ficha del servicio con `tipo_servicio`, lista `EVENTOS_DESDE_0150`).
- **Pruebas** (`tests/core/servicio_cable.spec.ts`, `tests/network/servicio_sin_router.spec.ts`)
  - Crear un cable sin router devuelve 201, sin clave AAA y sin filas en `audit.red`.
  - Internet, IPTV o mixto sin router dan 422.
  - Un IPTV suspendido se corta por red igual que un internet (Disconnect en `audit.red`); nunca pasa a `limitado`.
  - El cable aparece en la lista, en la ficha del cliente, en reportes y en la exportación a Iris.
  - Activar la instalación de un cable no pide IP.
  - Alcance por router no lo ve; por zona sí.
  - Retirar y eliminar funcionan.
  - `coa` y `routeros` ignoran `servicio.estado_cambiado` de un cable sin fallar ni emitir `coa.fallido`.
- **Complejidad:** alta. **Dependencias:** T1. Ya no existe el caso «TV sin ONU».

### T3a · Respaldo: corte manual avisado a Iris (A6)
- **Archivos:** migración `integraciones.cortes_manuales`; acciones nuevas `integraciones/equipos/actions/solicitar_corte_manual.ts` y `cancelar_corte_manual.ts` (anidadas, no por API); `integraciones/iris/envios.ts` (`EVENTOS_DESDE_0150`); `integraciones/iris/configuracion.ts`; `integraciones/iris/receptor.ts` (`corte_manual.estado_cambiado`); alerta en `notify/alertas.ts`; `contratos/iris.md`.
- **Pruebas** (`tests/integraciones/iris_corte_manual_0150.spec.ts`)
  - Solicitud de corte: una fila y un webhook a un conector 0.15.0.
  - Conector 0.14.x: no recibe el evento y la solicitud queda `sin_iris`, con alerta.
  - Dos solicitudes del mismo servicio y acción: una sola abierta.
  - Cancelar antes de resolver: `servicio.corte_manual_cancelado`.
  - Reactivación con corte `resuelta`: solicitud de `reconexion`.
  - Webhook `corte_manual.estado_cambiado` repetido no cambia nada.
  - `solicitud_id` de otra empresa: 404.
- **Complejidad:** media. **Dependencias:** L0 y el bloque B de la 0.15.0 acordado. El evento sale igual; Iris lo consume cuando llegue a esa versión.

### T3b · Corte y reconexión de CATV por SmartOLT (A6)
- **Archivos:** migración `integraciones.catv_ordenes` y `equipos_servicio.catv_estado`; `integraciones/equipos/smartolt.ts` (`deshabilitarCatv`, `habilitarCatv`, por lotes, `estadoCatv`, estado de tarea); consumidor nuevo de `servicio.estado_cambiado`; `integraciones/equipos/cola.ts`; acciones `aplicar_catv.ts` y `reintentar_catv.ts`; `capacidades.ts`; rutas; `tests/integraciones/equipos_simulado.ts`.
- **Pruebas** (`tests/integraciones/catv_smartolt.spec.ts`, con el SmartOLT simulado)
  - Cable suspendido: `disable_catv` a la instancia correcta; la otra instancia recibe 0 peticiones.
  - Mixto internet + cable suspendido: Disconnect y `disable_catv`.
  - Internet o IPTV suspendido: 0 llamadas a SmartOLT.
  - Reactivado: `enable_catv` y `catv.estado_cambiado`.
  - Evento duplicado: una sola orden.
  - 400 «CATV not supported»: `no_soportado` y solicitud de respaldo.
  - `queued: true`: no queda `aplicado` hasta confirmar la tarea.
  - 409 `onu_busy` y 429: reintento.
  - Instancia no operativa, servicio sin ONU o reintentos agotados: respaldo a Iris con su `causa`.
  - Paso a `limitado`: 0 llamadas.
  - 120 cortes de una instancia: una llamada por lotes.
  - Pago antes de ejecutar: la orden se cancela y no hay corte.
  - El token no aparece en auditoría.
- **Complejidad:** alta. **Dependencias:** T1, T3a y la fusión de `agente/a6-olt-acs`.

### T4 · Facturación, libro y FEL por tipo (A3 + auditor)
- **Archivos:** `billing/actions/emitir_factura.ts`; `billing/facturas.ts`; `billing/configuracion.ts`; `ledger/plan_cuentas.ts`; `fiscal/l10n/gt/cuentas.ts` y versión nueva del paquete fiscal; descripción del ítem en `fiscal`; `billing/actions/evaluar_estado_servicio.ts` (capacidad «sin limitado»); `billing/reportes/*`; `apps/api/tests/contabilidad/`.
- **Pruebas** (`tests/billing/factura_tipo_servicio.spec.ts`, `tests/contabilidad/`)
  - Factura de cable y de IPTV con su concepto y su cuenta.
  - Mixto: una línea por componente que suman el precio, prorrateadas y con descuento de lealtad.
  - Cable e IPTV con `facturas_para_limitar` alcanzado no pasan a `limitado`; al llegar a `facturas_para_cortar` pasan a `suspendido`.
  - Instalar el paquete fiscal dos veces no agrega nada.
  - Factura de internet idéntica a la actual (prueba de regresión byte a byte de líneas y asiento).
  - Invariantes del auditor en verde.
- **Complejidad:** alta. **Dependencias:** T1, S1 (toca el mismo `emitir_factura.ts`: va después) y las cuentas confirmadas por el contador (P-N14).

### T5 · Panel y portal (A4 + A5)
- **Archivos:** `apps/web/app/pages/servicios/nuevo.vue` y el asistente de alta; `servicios/[id]/index.vue` (bloque «Cable»: estado CATV, última orden, solicitud de respaldo con su ticket, «Reintentar»); `servicios/index.vue`; `planes/nuevo.vue`; `planes/[id]`; portal `index.vue` y `cuenta.vue`.
- **Pruebas** (Vitest y Playwright del panel y del portal)
  - Alta de cable sin router ni IP; alta de IPTV y de mixto con router.
  - La ficha muestra el estado CATV o «Corte pendiente en Iris TK-…».
  - Plan mixto: el formulario pide los precios por componente y valida la suma.
  - Un error del endpoint se ve con «Reintentar», nunca como un estado inventado.
  - 390 y 1280 px, claro y oscuro.
  - `pnpm verificar:permisos` pasa.
- **Complejidad:** media. **Dependencias:** T2, T3b, T4. **Tablero:** sí (variantes de `FlujoAlta`, `NuevoAltaCliente`, `OperServicioFicha`). El tablero puede empezar tras L0.

### T6 · Bordes (A6)
- **Archivos:** `notify/variables.ts` y `plantillas_base.ts` (textos por tipo: un aviso de cable no menciona velocidad); `importacion/origenes/mikrowisp.ts` (todo se importa como internet); datos de demostración (`pnpm demo:datos` con un cable, un IPTV y un mixto).
- **Pruebas:** el aviso de un cable no menciona plan de velocidad; la importación deja `tipo_servicio = internet`; `pnpm demo:datos` corre dos veces sin duplicar.
- **Complejidad:** baja. **Dependencias:** T1.

### S1 · Catálogo de adicionales ampliado (A1 + A3)
- **Archivos:** migración; `core/adicionales.ts`; `core/actions/crear_adicional.ts`; `editar_adicional.ts`; `core/validators.ts`; `lineasAdicionales` en `billing/actions/emitir_factura.ts` (A3); `adicionales.md`.
- **Pruebas** (`tests/core/adicionales_catalogo.spec.ts`, `tests/billing/adicionales_cuenta.spec.ts`)
  - Línea con `cuenta_codigo` y asiento cuadrado.
  - Sin cuenta: `4.1.03`.
  - Cuenta inexistente o que no es de ingreso: 422.
  - Los existentes quedan `otro`, o `ip_publica` si su `tipo` es `ip_publica`.
  - `admite_suscripcion` por defecto en false.
- **Complejidad:** media. **Dependencias:** L0.

### S2 · Pausa y baja programada de adicionales (A1 + A3)
- **Archivos:** migración; `core/actions/pausar_adicional_servicio.ts` y `reanudar_adicional_servicio.ts` (nuevas); `quitar_adicional_servicio.ts`; `core/jobs.ts`; `billing/actions/emitir_factura.ts`.
- **Pruebas** (`tests/core/adicionales_pausa.spec.ts`)
  - Periodo en pausa no cobra; el siguiente sí.
  - Pausar un `incluido`: 422.
  - Pausa sobre el tope: 422.
  - Baja programada cobra el periodo en curso y no el siguiente.
  - El job dos veces no duplica.
- **Complejidad:** media. **Dependencias:** S1 y T4 (mismo `emitir_factura.ts`, en serie).

### S3 · Panel de adicionales (A4)
- **Archivos:** `apps/web/app/pages/adicionales/index.vue`; `AdicionalModal.vue`; `AdicionalServicioModal.vue`; pestaña «En servicios» de la página de I4.
- **Pruebas:** categoría y cuenta en el formulario; pausar y reanudar desde la ficha del servicio; 390 y 1280 px.
- **Complejidad:** baja. **Dependencias:** S2. **Tablero:** el mismo de I4.

### I1 · Modelo y ciclo de vida de la suscripción (A3)
- **Archivos:** migración (`billing.suscripciones`, pausas, `facturas.suscripcion_id`, tipo); `billing/suscripciones.ts` (nuevo); acciones nuevas en `billing/actions/` (`crear_suscripcion`, `editar_suscripcion`, `pausar_suscripcion`, `reanudar_suscripcion`, `cancelar_suscripcion`); `billing/validators.ts`; `billing/esquemas.ts`; ruta nueva `start/routes/suscripciones.ts`; `core/permisos.ts`; `core/eliminacion.ts` (un cliente o un servicio con suscripciones no se elimina).
- **Pruebas** (`tests/billing/suscripciones.spec.ts`)
  - Crear independiente (sin `servicio_id`) y ligada a un servicio.
  - Ligada a un servicio de otro cliente o de otra empresa: 422.
  - Producto de otra empresa o sin `admite_suscripcion`: 422.
  - Edición con `version` vieja: 409.
  - Cancelar dos veces: 422.
  - La lista se filtra por empresa activa y alcance; `GET /servicios/:id/suscripciones` solo trae las suyas.
  - Cada acción deja auditoría y evento.
  - `Idempotency-Key` repetida devuelve la misma respuesta.
- **Complejidad:** media. **Dependencias:** S1 (catálogo).

### I2 · Emisión, FEL, libro y mora (A3 + auditor)
- **Archivos:** acciones nuevas `emitir_factura_suscripcion.ts` y `generar_facturas_suscripciones.ts`; `billing/periodos.ts` (ciclo de N meses); `billing/jobs.ts`; `billing/emision.ts`; `billing/actions/vencer_factura.ts` y `vencer_facturas.ts`; `billing/estado_cuenta.ts`; `billing/reportes/*`; `tests/contabilidad/`.
- **Pruebas** (`tests/billing/suscripciones_emision.spec.ts`)
  - Correr el cron dos veces: una sola factura con clave `sus-<id>-<periodo>`.
  - Dos réplicas a la vez: una factura.
  - Tras una caída de 3 meses emite los 3 periodos.
  - Pausada, cancelada o anterior a `inicio`: no emite.
  - Ciclo de 3 meses: una factura cada 3.
  - Primer periodo prorrateado.
  - Monto cero: bonificación.
  - `certificar_al = emitir` con FEL obligatoria: nace `por_certificar`.
  - Asiento con la cuenta del producto y la empresa correcta.
  - La factura vence y recibe mora según su plantilla.
  - La factura de una suscripción ligada lleva `servicio_id` null y no cuenta para el corte de ese servicio ni de ningún otro.
  - Invariantes: CxC = facturas pendientes; saldo del cliente = auxiliar.
- **Complejidad:** alta. **Dependencias:** I1.

### I3 · Estado por mora, pagos y vínculo con el servicio (A3)
- **Archivos:** acciones nuevas `evaluar_estado_suscripcion.ts`, `suspender_suscripcion.ts`, `reactivar_suscripcion.ts`, `seguir_servicio_suscripcion.ts`; `billing/consumidor.ts` (`servicio.estado_cambiado`, `servicio.titular_cambiado`, `servicio.config_cambiada`); `registrar_pago.ts`; `anular_pago.ts`; `ejecutar_corte.ts`; `aprobar_comprobante.ts`.
- **Pruebas** (`tests/billing/suscripciones_estado.spec.ts`)
  - Vencidas ≥ umbral: `suspendida`, con evento, y no emite el periodo siguiente.
  - El pago la reactiva en la misma transacción.
  - Anular ese pago la vuelve a suspender.
  - La suspensión manual no se quita con un pago.
  - Suscripción ligada suspendida: su servicio sigue `activo`. Servicio suspendido: su suscripción sigue `activa`.
  - Servicio retirado: la suscripción queda con baja programada; el evento repetido no cambia nada.
  - Cambio de titular del servicio: la suscripción pasa al titular nuevo y las facturas emitidas no se mueven.
  - Cobro repartido entre empresas con una factura de suscripción.
- **Complejidad:** media. **Dependencias:** I2, y D2 (los dos tocan `registrar_pago.ts`; D2 va primero).

### I4 · Panel, portal y avisos (A4 + A5 + A6)
- **Archivos:** página nueva `apps/web/app/pages/suscripciones/` (pestañas «Suscripciones» y «En servicios»); pestaña en la ficha del cliente y bloque en la ficha del servicio; composable `useSuscripciones`; portal `cuenta.vue` y página nueva «Mis suscripciones»; consultas en `apps/api/app/portal/`; `notify/variables.ts`, `plantillas_base.ts` y `catalogo.ts`.
- **Pruebas**
  - El total mensual coincide con la suma de activas.
  - El alta deja elegir «sin servicio» o un servicio del cliente.
  - El portal no muestra suscripciones de otro cliente (404).
  - Pagar en línea la factura de una suscripción la reactiva.
  - El aviso de factura de suscripción no menciona plan ni velocidad.
  - 390 y 1280 px, claro y oscuro.
- **Complejidad:** media. **Dependencias:** I3. **Tablero:** sí (lista, ficha y alta de suscripción; bloque del portal).

### D0 · Cuentas de pasarela por empresa y proveedor (A3)
- **Archivos:** migración (`billing.pasarela_cuentas`, columnas en `pasarela_cobros` y `pasarela_eventos`); `billing/pasarelas/cuentas.ts` (nuevo); `billing/pasarelas/pasarela.ts` (la fábrica recibe la cuenta; `capacidades`); `recurrente.ts` y `falsa.ts` (configuración inyectada, ya no del entorno); acciones nuevas `crear_cuenta_pasarela.ts`, `editar_cuenta_pasarela.ts`, `probar_cuenta_pasarela.ts`, `activar_cuenta_pasarela.ts`, `desactivar_cuenta_pasarela.ts`, `sembrar_cuenta_pasarela.ts`; `crear_cobro_pasarela.ts`, `procesar_webhook_pasarela.ts` y `conciliar_pasarela.ts` (resuelven la cuenta); `start/routes/billing.ts`; `core/permisos.ts`; `shared/enmascarar.ts`; `.env.example`; `pago-en-linea.md`.
- **Pruebas** (`tests/billing/pasarela_cuentas.spec.ts`; `pasarela.spec.ts` y `pasarela_recurrente.spec.ts` siguen en verde)
  - Sin cuentas en la base: el pago en línea funciona con las variables de entorno, igual que hoy.
  - Dos empresas con cuentas distintas: cada cobro usa la llave de su empresa; el webhook de una cuenta con el secreto de la otra da 401.
  - Dos pasarelas en una empresa: se usa la predeterminada del uso pedido.
  - Las credenciales no aparecen en respuestas, auditoría ni eventos.
  - `probar` con llave mala deja `prueba_ok = false` y no activa.
  - Edición con `version` vieja: 409.
  - La conciliación diaria recorre todas las cuentas activas.
- **Complejidad:** media. **Dependencias:** L0.

### D1 · Interfaz común de tokenización; adaptadores Recurrente y falsa (A3)
- **Archivos:** migración (`pasarela_clientes`, `metodos_pago`); `billing/pasarelas/pasarela.ts` (operaciones nuevas y tipos normalizados); `recurrente.ts`; `falsa.ts`; acciones nuevas `iniciar_metodo_pago.ts`, `registrar_metodo_pago.ts`, `revocar_metodo_pago.ts`; `procesar_webhook_pasarela.ts` (notificación de tipo `tokenizacion`); `shared/enmascarar.ts` (token); `contratos/debito-automatico.md`.
- **Pruebas** (`tests/billing/metodos_pago.spec.ts`, con la pasarela falsa; `tests/billing/pasarela_recurrente_tokenizacion.spec.ts` con respuestas grabadas de la guía)
  - Iniciar devuelve URL y método `pendiente`.
  - Webhook de éxito: `activo` con últimos 4 y evento.
  - Webhook repetido no duplica.
  - Cancelado: no queda activo.
  - Firma inválida: 401.
  - El token no aparece en respuestas, auditoría ni eventos.
  - `url_retorno` fuera de los orígenes permitidos: 422.
  - Cuenta cuyo adaptador no tokeniza: 422 `debito_no_soportado`.
  - Prueba de contrato del adaptador: una misma batería corre contra `falsa` y contra `recurrente` con el proveedor simulado, para que un adaptador nuevo la herede.
  - La prueba real con Sandbox se salta sola sin llave.
- **Complejidad:** alta (define la interfaz que heredan todas las pasarelas). **Dependencias:** D0. Verificarlo contra Recurrente depende de la cuenta.

### D2 · Cargo al emitir, reintento y desactivación (A3 + auditor)
- **Archivos:** migración (`debitos_automaticos`, `debito_intentos`); acciones nuevas `activar_debito.ts`, `desactivar_debito.ts`, `cobrar_debitos.ts`, `cobrar_factura_debito.ts`, `reintentar_debito.ts`; `billing/consumidor.ts` (`factura.emitida`, `pago.disputa_abierta`); `billing/jobs.ts`; `billing/cobros.ts`; `registrar_pago.ts` (método `debito`); `conciliar_pasarela.ts`.
- **Pruebas** (`tests/billing/debito_automatico.spec.ts`, `tests/contabilidad/`)
  - Factura emitida con débito activo: un cargo, pago, asiento con comisión y reactivación del servicio.
  - Evento `factura.emitida` duplicado, cron dos veces y dos réplicas: un solo cargo.
  - Rechazo: `debito.fallido`, la factura sigue pendiente, `proximo_intento_en` a 3 días y el reintento usa otra clave.
  - Segundo rechazo de la misma factura: no hay tercer intento.
  - Rechazo definitivo (tarjeta vencida): sin reintento.
  - Tres rechazos seguidos (entre dos facturas): el débito se desactiva con `motivo = rechazos` y evento; un cargo aprobado en medio reinicia la cuenta.
  - Promesa activa, `por_certificar` o monto bajo el mínimo: no cobra.
  - Timeout de la pasarela: se reintenta con la misma clave y no duplica.
  - `requiere_autenticacion`: cuenta como rechazo.
  - Contracargo desactiva el débito.
  - Pago manual antes del cron o antes del reintento: no cobra.
  - Dos empresas: nunca un cargo que mezcle facturas de dos NIT, y cada cargo sale por la cuenta de su empresa.
  - Invariantes del auditor.
- **Complejidad:** alta. **Dependencias:** D1; cuenta de Recurrente con cobros únicos para la verificación real. Cubre suscripciones cuando I2 esté fusionado (el alcance `suscripcion` se prueba entonces).

### D3 · Portal, panel y avisos (A5 + A4 + A6)
- **Archivos:** portal, página nueva «Pago automático» (consentimiento, tarjeta `•••• 4242`, cambiar, quitar); `apps/api/app/portal/` (rutas); ficha del cliente en el panel (estado, enviar enlace, desactivar, historial de intentos); `apps/web/app/pages/configuracion/proveedores-cobro.vue` o página hermana para las cuentas de pasarela de D0; plantillas de notify (`debito.fallido`, `debito.desactivado`, tarjeta por vencer); walled garden para la página de tokenización.
- **Pruebas**
  - Sin aceptar el consentimiento no se inicia.
  - El portal nunca tiene un campo de tarjeta.
  - Volver con `estado=cancelado` muestra el error con «Intentar de nuevo».
  - El panel no puede activar el débito por el cliente.
  - Empresa sin cuenta de pasarela con débito: el portal no ofrece la opción (no un error).
  - Las llaves de la cuenta nunca vuelven al navegador tras guardarlas.
  - 390 y 1280 px, claro y oscuro.
- **Complejidad:** media. **Dependencias:** D2. **Tablero:** sí (portal, bloque de la ficha y cuentas de pasarela).

### D4 · Adaptador de NeoNet (A3) — bloqueado
- **Archivos:** `billing/pasarelas/neonet.ts` (nuevo) y su línea en el registro; `.env.example` no cambia (las llaves van en la cuenta); `contratos/debito-automatico.md` (sección NeoNet).
- **Pruebas:** la batería de contrato del adaptador de D1, más las propias de firma y formato cuando se conozcan.
- **Complejidad:** media, a reestimar con la documentación. **Dependencias:** D1 y la respuesta de NeoNet (§3.5). Si NeoNet no ofrece página alojada o cargo con token de monto variable, el lote se cierra sin código y queda anotado.

### R1 · Plantillas de recordatorio: modelo, migración y asignación (A6)
- **Archivos:** migración (`notify.plantillas_recordatorio`, `_pasos`, `recordatorios_asignaciones`; siembra de «Estándar» por empresa desde `notify.recordatorios`); `notify/plantillas_recordatorio.ts` (nuevo, con `plantillaRecordatorioEfectiva`); acciones nuevas en `notify/actions/` (`crear_plantilla_recordatorio`, `editar_plantilla_recordatorio`, `retirar_plantilla_recordatorio`, `fijar_plantilla_recordatorio_por_defecto`, `asignar_plantilla_recordatorio`, `asignar_plantilla_recordatorio_masivo`, `personalizar_recordatorios_servicio`, `quitar_recordatorios_personalizados`); `notify/validators.ts`; `notify/esquemas.ts`; rutas; `core/permisos.ts`; `notify/consumidor.ts` (empresa nueva → su «Estándar»; servicio eliminado → limpia asignación); `contratos/recordatorios.md`.
- **Pruebas** (`tests/notify/plantillas_recordatorio.spec.ts`)
  - Tras migrar, cada empresa tiene «Estándar» por defecto con los tres pasos actuales.
  - Resolución: personalizada > asignada > por defecto; factura sin servicio usa la por defecto.
  - Dos por defecto en una empresa: imposible (la nueva desplaza a la anterior en la misma transacción).
  - Retirar la por defecto: 409. Asignar una retirada: 409.
  - Asignar a un servicio una plantilla de otra empresa: 422.
  - Personalizar crea un conjunto propio; quitarlo devuelve a la asignada.
  - Más de 8 pasos u `orden` repetido: 422.
  - Asignación masiva: una fila de auditoría por servicio.
  - Edición con `version` vieja: 409. Cada acción audita y emite su evento.
- **Complejidad:** alta. **Dependencias:** L0.

### R2 · Cron por plantilla y disparadores nuevos (A6 + A3)
- **Archivos:** `notify/actions/programar_recordatorios.ts` (resuelve la plantilla efectiva por factura); `notify/recordatorios.ts`; `notify/actions/editar_recordatorio.ts` (queda como compatibilidad sobre «Estándar» o se retira); `notify/catalogo.ts`, `variables.ts`, `plantillas_base.ts` (`recordatorio.corte_proximo`, `recordatorio.promesa_por_vencer`); **A3:** `billing/cortes.ts` o archivo nuevo con `fechaCortePrevista` (solo lectura, mismas reglas que `evaluarEstadoServicio`) y lectura de promesas por vencer.
- **Pruebas** (`tests/notify/recordatorios.spec.ts` ampliado; `tests/billing/fecha_corte_prevista.spec.ts`)
  - Con la plantilla «Estándar» migrada, el cron produce exactamente los mismos envíos que antes (regresión).
  - Correr el cron dos veces no duplica; dos réplicas tampoco.
  - Tras una caída, sale solo el paso más reciente.
  - Dos servicios del mismo cliente con plantillas distintas reciben pasos distintos.
  - Cambiar de plantilla a mitad de ciclo no reenvía un paso con el mismo `orden` ya enviado.
  - `corte_proximo` sale `dias` antes de la fecha prevista y no sale si hay promesa activa o si la factura se pagó.
  - `fechaCortePrevista` coincide con la fecha en que `ejecutar_corte` corta, con y sin excepciones del servicio.
  - `promesa_por_vencer` sale una vez por promesa.
  - Servicio `pendiente_instalacion` y factura `por_certificar`: nada.
- **Complejidad:** alta. **Dependencias:** R1.

### R3 · Entrega por Iris y A52 (A6)
- **Archivos:** migración (`notify.envios.canal` admite `iris`); `notify/whatsapp.ts` (códigos nuevos en `VARIABLES_IRIS`, `CONTRATO_ENTREGA_AUTO = '0.15.0'`); `notify/canales/whatsapp.ts` o `canales/iris.ts` nuevo (`canal_preferido: "auto"`, `canales_permitidos`); `notify/actions/programar_notificacion.ts` (un envío `iris` en vez de uno por canal, cuando aplica); `notify/acuses_iris.ts` (canal real); `notify/actions/conciliar_avisos_iris.ts`; `integraciones/iris/configuracion.ts` (`CONTRATO_IRIS = '0.15.0'`, `capacidades.mensajeria`); lectura A52 de `plantillas-whatsapp` (cliente nuevo en `integraciones/iris/`).
- **Pruebas** (`tests/notify/recordatorios_iris_0150.spec.ts`, `tests/integraciones/iris_contrato_0150.spec.ts`)
  - Iris 0.15.0 con `entrega_auto`: un solo aviso con `auto`; Argos no manda correo ni Telegram propios para ese paso.
  - Iris 0.14.3: WhatsApp con `canal_preferido: "whatsapp"` y correo y Telegram locales, como hoy.
  - Sin Iris: correo y Telegram locales.
  - Código nuevo pedido a un Iris que no lo declara en `capacidades`: ese paso cae al texto local, sin 422.
  - `aviso.entregado` con `canal: correo` deja el envío `enviado` con ese canal.
  - `bloqueado` por Iris: `omitido` con motivo, sin respaldo.
  - Reintento tras timeout: mismos bytes y misma `Idempotency-Key`.
  - El número y el correo del cliente nunca van en el cuerpo.
  - A52: la lectura falla → el panel recibe el error, no una lista vacía.
- **Complejidad:** media. **Dependencias:** R1 y el bloque C de la 0.15.0 acordado. Puede ir en paralelo con R2 (archivos distintos, salvo `VARIABLES_IRIS`).

### R4 · Panel de recordatorios (A4)
- **Archivos:** página nueva `apps/web/app/pages/plantillas/recordatorios/` (lista, alta y edición en pantalla propia, con sus pasos); `apps/web/app/pages/configuracion/notificaciones.vue` (enlace; se quita la edición de los tres recordatorios fijos); bloque «Recordatorios» en `servicios/[id]/index.vue` (plantilla efectiva, de dónde sale, próximos envíos, «Personalizar») y en la ficha de la suscripción; composable `usePlantillasRecordatorio`.
- **Pruebas**
  - Crear una plantilla con pasos, fijarla por defecto y asignarla a un servicio.
  - Personalizar desde la ficha y volver a la plantilla.
  - La vista previa muestra fechas y canal posible; si no se pudo leer a Iris, muestra el error con «Reintentar».
  - No hay ningún selector de zona.
  - 390 y 1280 px, claro y oscuro; `pnpm verificar:permisos` pasa.
- **Complejidad:** media. **Dependencias:** R1 (contra la API real); R2 y R3 para «próximos envíos» y «canal posible» (antes, con fixtures tipados). **Tablero:** sí (lista y edición de plantilla; bloque de la ficha).

### R5 · Recordatorios de suscripciones y avisos del débito (A6)
- **Archivos:** `notify/actions/programar_recordatorios.ts` (facturas con `suscripcion_id`); `notify/variables.ts` (`suscripcion.*`, `concepto`); `notify/plantillas_base.ts` y `catalogo.ts` (`debito.fallido`, `debito.desactivado`, `suscripcion.estado_cambiada`); `notify/whatsapp.ts` (códigos del bloque C).
- **Pruebas:** la factura de una suscripción usa la plantilla asignada a la suscripción o la por defecto; el aviso lleva `concepto` y no menciona plan; `debito.fallido` avisa una vez por intento; `debito.desactivado` avisa una vez.
- **Complejidad:** baja. **Dependencias:** R2, I2 y D2.

### Orden y paralelismo

Olas (dentro de una ola, los lotes no comparten archivos salvo los señalados abajo):

1. **L0.**
2. **T1, S1, D0, R1, T3a.**
3. **T2, T4, I1, D1, R2, R3, T3b, T6.**
4. **S2, I2, D2.**
5. **I3, R5, D4** (si NeoNet respondió).
6. **T5, S3, I4, D3, R4.** Los tableros de diseño y las pantallas con fixtures pueden empezar desde la ola 2.

Archivos compartidos que obligan a ir en serie (se fusiona uno, el siguiente integra `main` con `scripts/integrar.sh`):

| Archivo | Orden |
| --- | --- |
| `billing/actions/emitir_factura.ts` | S1 → T4 → S2 |
| `billing/actions/registrar_pago.ts` | D2 → I3 |
| `billing/jobs.ts` y `billing/consumidor.ts` | I2 → D2 → I3 |
| `billing/pasarelas/pasarela.ts`, `recurrente.ts`, `falsa.ts` | D0 → D1 → D4 |
| `billing/actions/procesar_webhook_pasarela.ts` | D0 → D1 |
| `core/validators.ts` | T1 → S1 (cambios pequeños) |
| `core/permisos.ts`, `shared/eventos.ts` | cualquiera; conflictos de una línea, se integran al fusionar |
| `notify/actions/programar_recordatorios.ts` | R2 → R5 |
| `notify/whatsapp.ts` (`VARIABLES_IRIS`) | R3 → R5 |
| `notify/variables.ts`, `plantillas_base.ts`, `catalogo.ts` | T6 → R2 → R5 → I4 → D3 |
| `integraciones/iris/envios.ts` y `configuracion.ts` | T2 → T3a → R3 (la constante `CONTRATO_IRIS` sube a 0.15.0 con el último bloque listo) |
| `apps/web/app/pages/servicios/[id]/index.vue` | T5 → I4 → R4 |

**Modelo del ejecutor**
- **Opus (alta):** T2, T3b, T4, I2, D1, D2, R1, R2.
- **Sonnet (media):** L0, T1, T3a, T5, S1, S2, I1, I3, I4, D0, D3, D4, R3, R4.
- **Haiku (baja):** T6, S3, R5.

**Riesgos**
- Joins a routers en T2.
- Límites y restricción semanal de SmartOLT en T3b.
- Cuentas nuevas del paquete fiscal en T4.
- Doble cargo en D2; fuga de llaves al pasar del entorno a la base en D0.
- La interfaz de D1 se diseña con un solo proveedor real documentado: puede necesitar ajustes cuando llegue NeoNet. La batería de contrato del adaptador acota ese riesgo.
- Regresión de los recordatorios actuales al migrar a plantillas (R1, R2): la prueba de «mismos envíos que antes» es obligatoria.
- Avisos duplicados si un paso sale por Iris y además por el correo local (R3).
- Dependencias externas: Recurrente, NeoNet, Iris 0.15.0 y la rama `a6-olt-acs`.

## 5. Preguntas abiertas para el PM

Ninguna bloquea el arranque: mientras no haya respuesta se aplica lo recomendado.

1. **P-N2. Suscripción suspendida por mora: ¿sigue facturando los periodos siguientes?** *Recomendado: no; deja de facturar mientras está suspendida y se reanuda al pagar.*
2. **P-N4. ¿Quién redacta y aprueba el texto de consentimiento del cobro automático?** *Recomendado: el PM con su asesor legal; Argos guarda la versión aceptada por cada cliente. Sin texto aprobado, D3 no sale a producción.*
3. **P-N6. ¿Entra telefonía ahora?** *Recomendado: no; SmartOLT tiene puerto VoIP y se suma después como un tipo más, con el mismo patrón del cable.*
4. **P-N10. IPTV: ¿usa la misma conexión del internet o una propia, y su plan lleva velocidad?** *Recomendado: tratarla como un servicio de datos con su router y su plan; en un mixto con internet, una sola conexión que se corta completa; y nunca «limitar» un servicio de solo IPTV (pasa directo a suspendido).*
5. **P-N11. Suscripción ligada a un servicio: ¿factura propia o una línea en la factura del servicio?** *Recomendado: factura propia siempre; si se quiere una sola factura, se vende como adicional (§2.3).*
6. **P-N12. Con Iris conectado, ¿los recordatorios por correo y Telegram también los entrega Iris, o solo WhatsApp?** *Recomendado: Iris entrega por el canal que tenga configurado (los tres); Argos conserva su correo y su Telegram solo como respaldo cuando Iris no está o es una versión anterior.*
7. **P-N13. NeoNet: ¿ya hay afiliación, y con qué producto (NeoPagos, Cybersource)?** *Recomendado: pedirle a NeoNet la documentación y credenciales de prueba (§3.5) y salir primero con Recurrente; el adaptador de NeoNet no se estima hasta tenerlas.*
8. **P-N14. ¿Qué cuentas contables llevan los ingresos de cable y de IPTV?** *Recomendado: dos cuentas nuevas de ingreso que confirme el contador (`4.1.05` y `4.1.06` ya son de lealtad); mientras tanto T4 no se fusiona.*
9. **P-N15. ¿Quién puede crear recordatorios personalizados para un servicio?** *Recomendado: admin y soporte, con auditoría; cajero y lectura solo los ven.*

## 6. Respuestas del PM

### 6.1 25 nov 2026
- **P1 Suscripciones: ambas.** Cobros extra dentro de la factura del servicio, suscripciones propias con su propia factura, y cobro automático con tarjeta. Sustituye la idea de servicio tipo `otro`.
- **P4 Mixto con deuda: se corta todo.**
- **P5 Corte en campo: Argos solo avisa a Iris.** Iris lleva tickets y órdenes; no hay cola en Argos; Argos muestra el estado que Iris devuelva.

### 6.2 26 nov 2026
- **P-N1 → la suscripción también puede ir sobre un servicio.** Puede ser independiente o colgar de un servicio de internet o de TV. El PM no dijo si la deuda de una corta a las demás: vale lo recomendado, cada una se suspende por su propia deuda (§3.3).
- **Cable e IPTV son tipos distintos.** Cable (CATV) llega por fibra, con ONU, y se corta por SmartOLT. IPTV va sobre IP y se corta como un servicio de datos. Tipos: `internet`, `cable`, `iptv` y `mixto` (§2.1).
- **P-N3 y P-N5 → cobro al emitir, con un reintento.** Reintento único a los 3 días; tras 3 rechazos seguidos el débito se desactiva y se avisa al cliente (§3.4).
- **P-N7 → el débito no es solo para Recurrente.** Recurrente es una pasarela más; vendrán NeoNet y otras. Interfaz común, un adaptador por proveedor y llave por empresa y por pasarela (§2.5).
- **P-N8 → no hay TV por coaxial; todo es fibra.** El corte del cable siempre va por SmartOLT; el aviso a Iris queda de respaldo (§2.2).
- **P-N9 → recordatorios por plantilla.** Plantillas con nombre, como las de facturación, asignadas por servicio o suscripción y con una por defecto en cada empresa. El cliente puede tener recordatorios personalizados por servicio. No van por zona ni son notificaciones push. El envío lo hace Iris con la configuración de comunicación de la integración; Argos decide qué y cuándo (§2.6, §2.7, §3.6).
- **Sin respuesta todavía:** P-N2, P-N4 y P-N6 (siguen en el §5 con su recomendación).

### Critical Files for Implementation
- /home/user/wt-plan-servicios/apps/api/app/billing/actions/emitir_factura.ts
- /home/user/wt-plan-servicios/apps/api/app/billing/actions/emitir_cargo_unico.ts
- /home/user/wt-plan-servicios/apps/api/app/billing/pasarelas/pasarela.ts
- /home/user/wt-plan-servicios/apps/api/app/billing/pasarelas/recurrente.ts
- /home/user/wt-plan-servicios/apps/api/app/integraciones/equipos/smartolt.ts
- /home/user/wt-plan-servicios/apps/api/app/core/actions/cambiar_estado_servicio.ts
- /home/user/wt-plan-servicios/apps/api/app/notify/actions/programar_recordatorios.ts
- /home/user/wt-plan-servicios/apps/api/app/notify/whatsapp.ts
- /home/user/wt-plan-servicios/apps/api/app/integraciones/iris/envios.ts
- /home/user/wt-plan-servicios/.claude/integration/contratos/iris.md
