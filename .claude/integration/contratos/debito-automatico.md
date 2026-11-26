# Contrato: débito automático independiente de la pasarela

Lote L0 del plan v3 (`plan-servicios-suscripciones-recordatorios.md`, §1.4, §2.5, §3.4 y §3.5). Decisiones del PM del 26 nov 2026: el débito **no es solo para Recurrente** (P-N7); cobro **al emitir**, un reintento a los **3 días**, desactivación tras **3 rechazos seguidos** y aviso al cliente (P-N3, P-N5); **primero Recurrente**, NeoNet después (P-N13). Dueño: A3 (`billing`). Lotes D0 a D4. El pago en línea existente está en `pago-en-linea.md` (que enlaza aquí las cuentas por empresa).

## 1. Principios

- **Sin datos de tarjeta en Argos.** El cliente escribe la tarjeta solo en la página alojada del proveedor. Argos guarda el token cifrado, la marca, los últimos 4 y el vencimiento; nunca el número, el CVV ni el nombre impreso. El panel nunca captura tarjetas: solo envía el enlace. Un proveedor que solo tokenice con campos dentro de la página del comercio no se integra (`tokenizacion: 'ninguna'`): cambiaría el alcance PCI.
- **Ningún `if (proveedor === 'recurrente')` fuera del adaptador.** El resto del sistema mira `capacidades`.
- **Una cuenta de pasarela por empresa y proveedor** (regla 14): nunca un único global implícito.
- Activar el débito es solo del cliente, desde el portal, con consentimiento registrado.

## 2. Cuentas de pasarela por empresa y proveedor (D0)

- `billing.pasarela_cuentas`: `empresa_id NOT NULL`, `proveedor` (nombre del adaptador: `recurrente`, `neonet`, `falsa`), `alias`; `proveedor_cobro_id → ledger.proveedores_cobro` (da la cuenta puente y la de liquidación de esa empresa); `credenciales_cifradas` (JSON cifrado con `#shared/cifrado`; cada adaptador declara qué claves pide) y `webhook_secreto_cifrado`, en auditoría `***`; `clave_publica` (identificador sin secreto para la URL del webhook); `modo` (`pruebas` | `produccion`); `usos text[]` (`pago_en_linea`, `debito`); `activa`, `prueba_ok`, `probada_en`, `version`. `UNIQUE (empresa_id, proveedor)`; un índice parcial deja una sola cuenta predeterminada por empresa y uso.
- `billing.pasarela_cobros.pasarela_cuenta_id NULL` y `billing.pasarela_eventos.pasarela_cuenta_id NULL`.
- Webhook: `POST /pasarela/webhook/:proveedor/:clave_publica`, firma verificada con el secreto de esa cuenta (el de otra cuenta da 401). La ruta actual `POST /pasarela/webhook/:proveedor` sigue valiendo para la cuenta sembrada del entorno.
- **Compatibilidad:** `sembrar_cuenta_pasarela` crea la cuenta de la empresa principal a partir de `PASARELA_PROVEEDOR` y `RECURRENTE_*`. Sin cuentas en la base todo se comporta como hoy. Las llaves nunca vuelven al navegador, ni aparecen en respuestas, auditoría ni eventos.
- `probar` con llave mala deja `prueba_ok = false` y no activa. La conciliación diaria recorre todas las cuentas activas.
- Evento `pasarela.config_cambiada`. Permisos: `pasarelas.ver`, `pasarelas.configurar`, `pasarelas.probar` (admin; contabilidad solo ver).
- Endpoints: `GET /pasarelas/cuentas`, `POST /pasarelas/cuentas`, `PUT /pasarelas/cuentas/:id`, `POST /pasarelas/cuentas/:id/probar | activar | desactivar`, `GET /pasarelas/proveedores` (adaptadores y sus capacidades).

## 3. Interfaz común (D1)

El adaptador se construye con la configuración de una cuenta (ya no lee el entorno) y declara lo que sabe hacer (`apps/api/app/billing/pasarelas/pasarela.ts`):

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
- `ResultadoCargo`: `estado` (`pagado` | `rechazado` | `pendiente` | `requiere_autenticacion`), `id_proveedor`, `monto`, `comision`, `retenido_iva`, `codigo_rechazo` normalizado (`fondos`, `tarjeta_vencida`, `tarjeta_invalida`, `rechazo_banco`, `autenticacion`, `otro`), `definitivo` (true = no reintentar con ese método).
- `NotificacionPasarela` suma el tipo `tokenizacion` (éxito o cancelación) junto a los estados de cobro existentes.
- Una cuenta cuyo adaptador no tiene `cargo_con_token` no se ofrece para débito; pedirlo responde `422 debito_no_soportado`.
- Un adaptador nuevo es un archivo en `pasarelas/` y una línea en el registro; no toca tablas ni acciones. Todo adaptador pasa la **batería de contrato** (la misma que corre contra `falsa` y `recurrente` simulado).
- **Pasarela falsa** (laboratorio y pruebas): implementa la interfaz completa con rechazos programables (`fondos`, `tarjeta_vencida`, `autenticacion`, timeout).

## 4. Tablas del débito (D1, D2)

- `billing.pasarela_clientes`: `empresa_id`, `cliente_id`, `pasarela_cuenta_id`, `id_proveedor` (el `cus_…` en Recurrente); único por cuenta y cliente.
- `billing.metodos_pago`: `empresa_id`, `cliente_id`, `pasarela_cuenta_id`, `token_cifrado` (`#shared/cifrado`; en auditoría `***`), `marca`, `ultimos4`, `vence_mes`, `vence_anio`, `estado` (`pendiente`, `activo`, `revocado`, `vencido`), `tokenizacion_id`, `consentimiento_en`, `consentimiento_version`, `consentimiento_canal`, `version`. El método queda atado a su cuenta: un token no sirve en otra pasarela ni en otra empresa; un cliente con servicios en dos empresas registra un método por empresa.
- `billing.debitos_automaticos`: `empresa_id`, `cliente_id`, `metodo_pago_id`, `alcance` (`cliente` | `servicio` | `suscripcion`), `servicio_id`, `suscripcion_id`, `activo`, `rechazos_seguidos smallint DEFAULT 0`, `desactivado_motivo`, `desactivado_en`, `version`. Único parcial: un débito activo por alcance.
- `billing.debito_intentos` (solo inserción más cambio de estado): `factura_id`, `debito_id`, `metodo_pago_id`, `cobro_id → billing.pasarela_cobros`, `intento_n` (1 o 2), `clave_idempotencia`, `estado` (`pendiente`, `pagado`, `rechazado`, `error`), `codigo_rechazo`, `proximo_intento_en`. `UNIQUE (factura_id, intento_n)`.

## 5. Consentimiento

Antes de redirigir, el portal muestra y registra el texto (versión, fecha, canal) con frecuencia, monto variable, momento del cargo y cómo cancelar. Sin aceptarlo no se inicia la tokenización. **El texto legal lo aprueba el PM con su asesor (P-N4, abierta); sin texto aprobado, D3 no sale a producción.** Una empresa sin cuenta de pasarela con `debito` no ofrece la opción en el portal (no es un error).

## 6. Política de cobro

- **Cuándo: al emitir la factura** (decisión del PM). Un consumidor de `factura.emitida` crea el intento 1 para las facturas dentro del alcance de un débito activo. Una factura que nace `por_certificar` se cobra cuando queda `emitida`. El cron `debitos.cobrar` (todo lo pendiente, con lock) es el respaldo y ejecuta los reintentos.
- **Qué se cobra:** el saldo pendiente de la factura en ese momento, dentro del alcance (servicio, suscripción o todo el cliente en esa empresa). Un cargo nunca mezcla facturas de dos NIT y sale por la cuenta predeterminada para `debito` de la empresa de la factura.
- **Qué nunca se cobra:** facturas `por_certificar`, anuladas, sustituidas, con saldo 0, con promesa activa o de un pago en disputa, ni montos bajo `capacidades.minimo` (Q5.00 en Recurrente).
- **Rechazo (un reintento a los 3 días):** el intento 1 rechazado deja `proximo_intento_en = +3 días`, emite `debito.fallido` y avisa al cliente con enlace para pagar o cambiar la tarjeta. El intento 2 usa clave de idempotencia nueva; si también se rechaza, esa factura no se vuelve a cobrar sola y sigue su vencimiento y corte normales. Un rechazo `definitivo` (tarjeta vencida o inválida) no programa el reintento. Si el cliente paga por otro medio entre ambos intentos, el reintento se cancela.
- **Desactivación (3 rechazos seguidos):** `rechazos_seguidos` cuenta intentos rechazados consecutivos de ese débito, de cualquier factura; un cargo aprobado lo pone en 0. Al llegar a 3 el débito se desactiva (`motivo = rechazos`), emite `debito.desactivado` y se avisa al cliente. También se desactiva con tokenización cancelada, método revocado, contracargo (`pago.disputa_abierta`) o tarjeta vencida. Reactivarlo es solo del cliente, desde el portal, con un método vigente.
- **`requiere_autenticacion`** (3-D Secure) cuenta como rechazo con `codigo_rechazo = autenticacion`; el aviso lleva el enlace de pago en línea.
- **Idempotencia:** primero se crean el `pasarela_cobros` y el `debito_intentos` (el `UNIQUE (factura_id, intento_n)` impide dos cargos entre réplicas); luego se llama a la pasarela con la clave `argos:debito:<factura_id>:<intento_n>`. Un timeout se reintenta con la **misma** clave y, si el adaptador lo permite, se consulta antes (`consultarCargo`). El pago se registra con la misma acción interna del webhook, idempotente por cobro; webhook y conciliación son respaldo. Si el banco rechaza, no se reusa la clave.
- **Pago y estado:** el éxito sale como el `pago.registrado` de siempre con `metodo: debito` y llama a `evaluarEstadoServicio` o `suscripciones.evaluar_estado`.
- **Libro:** el mismo asiento del pago en línea (cuenta puente del `proveedores_cobro` de esa cuenta, comisión `5.1.02`, retención de IVA de la emisora). **FEL:** certifica Argos con INFILE; la facturación electrónica propia de la pasarela debe estar apagada.

## 7. Eventos, permisos y endpoints

- Eventos: `metodo_pago.guardado`, `metodo_pago.revocado`, `debito.activado`, `debito.desactivado`, `debito.fallido`, `pasarela.config_cambiada`. Payloads en `eventos.md`. Nunca el token ni credenciales.
- Permisos: `debitos.ver`, `debitos.enviar_enlace`, `debitos.desactivar`, `debitos.reintentar` (admin, cajero, soporte).
- Portal: `POST /portal/metodos-pago/iniciar`, `GET /portal/metodos-pago`, `POST /portal/metodos-pago/:id/quitar`, `POST /portal/debito/activar | desactivar`. `url_retorno` fuera de los orígenes permitidos: 422.
- Panel: `GET /clientes/:id/debito`, `POST /clientes/:id/debito/enviar-enlace`, `POST /debitos/:id/desactivar`, `POST /facturas/:id/debito/reintentar`.
- Avisos al cliente (por Iris con 0.15.0 bloque C, o los canales de Argos): `debito_fallido`, `debito_desactivado`, tarjeta por vencer.

## 8. Adaptador de Recurrente (D1, D2)

Fuente: guía «Guardar y reutilizar métodos de pago» (<https://docs.recurrente.com/guias-espanol/guias/guardar-y-reutilizar-metodos-de-pago.md>, releída el 26 nov 2026).

| Operación de la interfaz | En Recurrente |
| --- | --- |
| Credenciales de la cuenta | `secret_key` (`X-SECRET-KEY`), `webhook_secret` (Svix `whsec_…`) |
| `iniciarTokenizacion` | `POST /api/customers` (`email`, `full_name`) si el cliente no tiene `cus_…` en esa cuenta; luego `POST /api/checkouts` con `mode: "setup"`, `customer_id`, `success_url`, `cancel_url`, `metadata.referencia` (autorización de monto cero) |
| Resultado de la tokenización | Webhook `setup_intent.succeeded` (`data.checkout.payment_method.id`, `data.customer.id`) o `setup_intent.cancelled`; respaldo con `consultarTokenizacion` = `GET /api/checkouts/{id}` |
| `consultarMetodo` | `GET /api/payment_methods/{id}` (`card.last4`, `network`, `expiration_month`, `expiration_year`, `issuer_name`, `status`) |
| `cobrarMetodoGuardado` | `POST /api/one_time_payments` con `customer_id`, `payment_method_id`, `items[]` (un ítem en GTQ, `amount_in_cents`) e `Idempotency-Key`; responde `{ object, id, status: "paid" }` |
| `revocarMetodo` | No documentado: `capacidades.revocar_metodo = false`. Argos marca el método `revocado` y deja de usarlo |
| Capacidades | `tokenizacion: 'checkout_alojado'`, `cargo_con_token: true`, `minimo: "5.00"` |

Requiere «cobros únicos» habilitados en la cuenta. Los webhooks reales solo se envían con llave de producción: la tokenización completa se valida con llave LIVE. Recurrente también ofrece suscripciones propias; **no se usan** (el monto de Argos varía y la factura la certifica Argos). Pendiente de ver en el Sandbox o con LIVE: (1) forma del webhook de un `one_time_payment` con método guardado; (2) respuesta de un rechazo del banco, para normalizar `codigo_rechazo`; (3) si un cargo sin presencia pide 3-D Secure; (4) comisión y retención de IVA del `one_time_payment`; (5) «cobros únicos» habilitado.

## 9. Adaptador de NeoNet (D4, bloqueado)

NeoNet (antes VisaNet Guatemala) no publica documentación para desarrolladores. Su sitio anuncia cobros mensuales programados (NeoPagos) y tokenización con Cybersource, sin detalle técnico. **Supuestos, nada confirmado:**

- **S1.** El cargo de monto variable con token se haría con Cybersource (tokenización y cargo iniciado por el comercio), no con NeoPagos.
- **S2.** Cybersource ofrece una página de pago alojada; no está confirmado que la afiliación la incluya. Si solo ofrecen campos dentro de la página del comercio, el adaptador no se hace.
- **S3.** Credenciales, ambiente de pruebas, formato y firma de notificaciones, comisión y plazos de liquidación: desconocidos.
- **S4.** Afiliación y tarifas por comercio (por NIT): encaja con una cuenta por empresa.

Qué pedirle a NeoNet antes de estimar D4: (1) documentación de integración de Cybersource y NeoPagos; (2) si permiten guardar la tarjeta en página alojada y cobrar después un monto distinto cada mes sin el cliente; (3) credenciales de prueba; (4) cómo notifican el resultado y cómo se concilia. Si no ofrece página alojada o cargo con token de monto variable, D4 se cierra sin código y queda anotado.

## 10. Lotes y orden

| Lote | Qué | Depende de |
| --- | --- | --- |
| D0 | Cuentas de pasarela por empresa y proveedor | L0 |
| D1 | Interfaz común de tokenización; Recurrente y falsa | D0 |
| D2 | Cargo al emitir, reintento y desactivación | D1; cuenta de Recurrente con cobros únicos para la verificación real |
| D3 | Portal, panel y avisos | D2 |
| D4 | Adaptador de NeoNet (bloqueado) | D1, documentación y credenciales |

Archivos en serie: `pasarela.ts`, `recurrente.ts`, `falsa.ts` (D0 → D1 → D4); `procesar_webhook_pasarela.ts` (D0 → D1); `registrar_pago.ts` (D2 → I3).

## 11. Preguntas abiertas

P-N4 (quién aprueba el texto de consentimiento), P-N13 respondida: primero Recurrente.
