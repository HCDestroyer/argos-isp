# Contrato: suscripciones (con o sin servicio)

Lote L0 del plan v3 (`plan-servicios-suscripciones-recordatorios.md`, §2.3, §2.4 y §3.3). Decisiones del PM del 25 y 26 nov 2026: cobros extra dentro de la factura del servicio **y** suscripciones propias (P1); la suscripción puede ir sin servicio o ligada a uno (P-N1); **factura propia siempre** (P-N11). Dueño: A3 (schema `billing`). Lotes: I1 a I4 y S1 a S3.

## 1. Adicional o suscripción

Un solo catálogo de productos (`core.adicionales`) y dos formas de venderlos. La suscripción no copia modalidades, bloqueos ni credenciales del adicional; el adicional no gana factura ni estado propios.

| | Adicional (`core.servicios_adicionales`) | Suscripción (`billing.suscripciones`) |
| --- | --- | --- |
| Dónde se cobra | Una línea en la factura del servicio | Su propia factura |
| Ciclo y vencimiento | Los del servicio | Los suyos: plantilla de facturación y `ciclo_meses` propios |
| Necesita servicio | Sí, siempre | No. Puede ir sin servicio o ligada a uno |
| Qué pasa con deuda | Sigue al servicio: se bloquea cuando el servicio se suspende | Se suspende por su propia deuda; no corta al servicio ni el servicio a ella |
| Modalidades | `incluido`, `cortesia`, `cobrado` | Solo cobrada |
| Débito automático y recordatorios | Los del servicio | Los suyos |
| Conviene cuando | Es parte del paquete (IP pública, canales premium sobre el cable, seguro del equipo) | Se vende aparte o a otro ritmo (streaming anual, membresía) o el cliente no tiene servicio de red |

Regla práctica: si el cliente debe ver **una sola factura** y perder el extra cuando le cortan el servicio, es un adicional. Si el extra tiene **su propia factura y su propia suerte**, es una suscripción; ligarla a un servicio solo dice dónde se usa.

## 2. Cambios al catálogo y a los adicionales (S1, S2)

- `core.adicionales`: `categoria` (`streaming`, `canales_premium`, `ip_publica`, `seguro_equipo`, `membresia`, `otro`), `cuenta_codigo text NULL` (null = `4.1.03`; debe existir y ser de ingreso, si no 422) y `admite_suscripcion boolean DEFAULT false`. La columna `tipo` (`general` | `ip_publica`) no cambia. Los existentes quedan `otro`, o `ip_publica` si su `tipo` lo es.
- `core.servicios_adicionales.baja_programada date NULL`.
- `core.servicios_adicionales_pausas`: `asignacion_id`, `empresa_id`, `desde`, `hasta`, `motivo`, `estado`, `terminada_en`, `version`.
- Pausa: no se cobra el periodo que empieza en pausa; tope `ajustes_cobro.pausa_tope_dias`; pausar un `incluido` da 422. Baja inmediata sin reembolso, o programada a fin de periodo (`efectiva: "ahora" | "fin_periodo"` en `quitar`). Cuenta de ingreso por línea: `cuenta_codigo` del producto o `4.1.03`.
- Eventos: `servicio.adicional_pausado` y `servicio.adicional_reanudado`. Permisos: `servicios.pausar_adicional` y `servicios.reanudar_adicional`.
- Endpoints: `POST /servicios/:id/adicionales/:asignacionId/pausar` y `/reanudar`; `GET /adicionales/asignaciones` (lista general).

## 3. Tablas de la suscripción (I1)

- `billing.suscripciones`:
  - `empresa_id NOT NULL`, `cliente_id NOT NULL`, `codigo` (lo pone la base);
  - `servicio_id bigint NULL → core.servicios`: null = independiente; con valor = ligada a ese servicio (de cualquier tipo);
  - `producto_id NULL → core.adicionales` (catálogo con `admite_suscripcion`);
  - `descripcion`, `precio numeric(14,2) > 0`, `cantidad`, `ciclo_meses` (1, 3, 6 o 12; por defecto 1);
  - `plantilla_facturacion_id NOT NULL` (da día, gracia, mora, `facturas_para_cortar` y `certificar_al`). Las plantillas de facturación son **globales** (no tienen `empresa_id`): no hay comprobación de empresa;
  - `inicio date`, `primer_periodo` (`prorrateado` | `completo` | `sin_costo`);
  - `estado` (`activa`, `pausada`, `suspendida`, `cancelada`), `suspension_manual bool`;
  - `baja_programada date NULL`, `cancelada_en`, `motivo_cancelacion`, `identificador`, `notas`, `version`.
  - Un trigger exige que el producto sea de la misma empresa y, con `servicio_id`, que el servicio sea de la misma empresa y del mismo cliente.
- `billing.suscripciones_pausas`: `suscripcion_id`, `desde`, `hasta`, `motivo`, `estado`, `terminada_en`, `version`.
- `billing.facturas.suscripcion_id bigint NULL`; `facturas.tipo` suma `suscripcion`.
  - En una factura de suscripción, `suscripcion_id` va siempre.
  - `servicio_id` va **null** aunque la suscripción esté ligada a un servicio: así la factura no cuenta para el corte de ese servicio, no entra en sus promesas ni en su estado de cuenta por servicio. El vínculo se lee por la suscripción.
  - CHECK: nunca `servicio_id` y `suscripcion_id` a la vez.
- No se reutiliza `billing.conceptos_recurrentes` (`servicio_id NOT NULL` y nada lo escribe).

## 4. Emisión (I2)

- Idempotencia: `clave_unica = 'sus-<suscripcion_id>-<YYYY-MM-DD del periodo>'`, con `ON CONFLICT DO NOTHING`. No choca con `<servicio_id>-<periodo>` ni con `cargo-<uuid>`.
- Cron `suscripciones.generar`: procesa **todo lo pendiente hasta ahora**, por lotes y con lock (regla 6). Una factura por suscripción y periodo de `ciclo_meses`, con una línea «<nombre> del … al …», tipo `otro` y la cuenta del producto. Reusa `emitirDocumento`, como el cargo único sin servicio. Tras una caída de 3 meses emite los 3 periodos.
- No se emite: periodos en pausa, anteriores a `inicio`, posteriores a la cancelación, con la suscripción `suspendida` (P-N2, recomendado: no factura mientras está suspendida y se reanuda al pagar) o de monto cero (bonificación, nunca factura de Q0).
- Vencimiento y mora: `vence_en = periodo + dias_gracia` de la plantilla; `vencer_factura.ts` toma la configuración por suscripción cuando no hay servicio.
- FEL: regla `certificar_al` de su plantilla y datos fiscales del cliente; sin cambios en `fiscal`. Libro: CxC del cliente contra ingreso (cuenta del producto) más IVA, con la `empresa_id` de la suscripción. Los anticipos del cliente en esa empresa se aplican como hoy.

## 5. Estado por mora (I3)

**Cada una por su propia deuda** (recomendado en la v2; el PM no lo contradijo).

- `suscripciones.evaluar_estado` es la única que decide: con facturas vencidas de esa suscripción ≥ `facturas_para_cortar` pasa a `suspendida` y emite `suscripcion.estado_cambiada`. La llaman el cron de corte, `registrarPago` y `anularPago`. El pago la reactiva en la misma transacción; anular ese pago la vuelve a suspender. La suspensión manual solo se quita con `reactivar`.
- La deuda de una suscripción no corta ningún servicio, ni el servicio al que está ligada. La deuda de un servicio no suspende sus suscripciones. No hay nada de red que cortar: quien presta el producto actúa con el evento.
- **Ligada a un servicio:**
  - hereda cliente y empresa (trigger); se muestra en la ficha del servicio;
  - `servicio.titular_cambiado`: la suscripción pasa al titular nuevo por una acción auditada; las facturas ya emitidas quedan con el titular anterior;
  - servicio `retirado` o eliminado: la suscripción se cancela con baja programada a fin del periodo ya facturado (`motivo = servicio_retirado`); consumidor idempotente de `servicio.estado_cambiado`;
  - servicio `suspendido` o `limitado`: la suscripción no cambia;
  - servicio que cambia de empresa: la suscripción no se mueve sola, queda marcada para revisión y sale una alerta interna (el producto puede no existir en la otra empresa).
- Un cliente o servicio con suscripciones no se elimina (`core/eliminacion.ts`).
- Promesas: no aplican en esta ronda (`billing.promesas.servicio_id` es obligatorio).
- Baja: inmediata o programada a fin de periodo; sin reembolso del periodo ya facturado (nota de crédito manual si hace falta).

## 6. Portal y avisos (I4)

- Portal: «Mis suscripciones» (nombre, precio, ciclo, estado, próximo cobro, servicio al que está ligada) y sus facturas en la cuenta. Se pagan con el pago en línea existente (`{ facturas: [ids] }`). Ni alta ni baja desde el portal; nunca credenciales. Una suscripción de otro cliente da 404.
- Notify: `factura.emitida` y `factura.vencida` con `servicio_id` null ya ocurren con cargos únicos; se agrega la variable `suscripcion.*` y el aviso de `suscripcion.estado_cambiada`. El aviso de una factura de suscripción no menciona plan ni velocidad. Recordatorios: `recordatorios.md`.

## 7. Eventos, permisos y endpoints

- Eventos: `suscripcion.creada`, `suscripcion.cambiada`, `suscripcion.estado_cambiada`; `factura.*`, `pago.*` y `nota_credito.*` suman `suscripcion_id` (null en las demás). Payloads en `eventos.md`.
- Permisos: `suscripciones.ver`, `.crear`, `.editar`, `.pausar`, `.reanudar`, `.suspender`, `.reactivar`, `.cancelar`, `.emitir`. Admin, todos. Soporte: ver, crear, pausar, reanudar. Cajero y contabilidad: ver. Lectura: ver.
- Endpoints: `GET /suscripciones` (filtros `servicio_id`, `cliente_id`, `estado`, `independiente`), `POST /suscripciones`, `GET /suscripciones/:id`, `PUT /suscripciones/:id` (con `version`; 409 si es vieja); `POST /suscripciones/:id/pausar | reanudar | suspender | reactivar | cancelar` (cancelar dos veces: 422); `POST /suscripciones/generar` (manual del cron); `GET /clientes/:id/suscripciones` y `GET /servicios/:id/suscripciones`. Toda escritura acepta `Idempotency-Key`. Las listas se filtran por empresa activa y alcance.

## 8. Dependencias y orden

S1 → I1 → I2 → I3 → I4. `billing/actions/emitir_factura.ts` va en serie S1 → T4 → S2; `registrar_pago.ts`: D2 antes de I3; `billing/jobs.ts` y `consumidor.ts`: I2 → D2 → I3.

## 9. Preguntas abiertas

P-N2 (¿una suscripción suspendida sigue facturando?, recomendado: no).
