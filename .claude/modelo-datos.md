# 00 · Modelo de datos base

Lo escribe el líder backend el día 1 como migraciones en `apps/api/database/migrations/`. Los agentes agregan columnas y tablas dentro de su schema; no renombran ni borran lo que está aquí sin acuerdo en `.claude/integration/`.

Convenciones: `id bigint identity`, `created_at`, `updated_at`, `version int` en entidades editables, `snake_case`, UTC, dinero en `numeric(14,2)`.

## Schema `core`

| Tabla | Columnas clave |
| --- | --- |
| `usuarios` | nombre, email, password_hash, activo |
| `roles` | nombre, descripcion |
| `permisos` | nombre (= nombre de acción, ej. `facturas.crear`) |
| `roles_permisos` | role_id, permiso_id |
| `usuarios_roles` | usuario_id, role_id, alcance_tipo (`router`/`zona`/`caja`/null), alcance_id |
| `tokens_api` | usuario_id, nombre, hash, alcances jsonb, ultimo_uso, revocado_en |
| `clientes` | nombre, tipo (`persona`/`empresa`), nit_cui, nombre_fiscal, direccion_fiscal, email, telefono, movil, direccion, coordenadas, zona_id, campos_personalizados jsonb, canal_preferido (`correo`/`telegram`/`whatsapp`), telegram_chat_id |
| `zonas` | nombre |
| `servicios` | cliente_id, router_id, plan_id, plantilla_facturacion_id, estado (`activo`/`limitado`/`suspendido`/`retirado`), tipo_conexion (`pppoe`/`ip_estatica`/`dhcp_fija`; decisión del PM, día 4), user_ppp y pass_ppp (cifrado; solo `pppoe`), mac (obligatoria en `dhcp_fija`), amarre_ip_mac (bool, opcional), direccion, coordenadas, fecha_instalacion, costo_override, excluir_firewall, ipv6_duid, ipv6_modo (`radius_servicio`/`radius_pool`/`duid`/`estatico`/`ninguno`), version |
| `servicios_excepciones` | servicio_id, campo, valor jsonb (excepciones a la plantilla) |
| `idempotency_keys` | clave, actor_id, ruta, respuesta jsonb, created_at |

## Schema `network`

| Tabla | Columnas clave |
| --- | --- |
| `routers` | nombre, host, api_usuario, api_password (cifrado), radius_secret (cifrado), nas_ip, modo_seguridad (`radius`/`api`), modo_velocidad (`simple`/`pcq`), activo |
| `redes_ipv4` | router_id, cidr, gateway, tipo (`estatico`/`pool`) |
| `ipv4_asignaciones` | servicio_id, red_id, ip, inicio, fin |
| `ipv6_bloques` | router_id, prefijo (ej. /40) |
| `ipv6_pools` | bloque_id, prefijo, tipo (`enlace`/`delegacion`), tamano_entrega (64/56/48), nombre_en_router |
| `ipv6_asignaciones` | servicio_id, pool_id, prefijo, tipo, inicio, fin |
| `planes` | nombre, precio, bajada_kbps, subida_kbps, bajada_limitada_kbps, subida_limitada_kbps, reuso, dual_stack (`ambos`/`v4`/`v6`), tamano_prefijo_delegado, global bool, activo |
| `planes_routers` | plan_id, router_id, profile_ppp, pool_ipv4, pool_ipv6_enlace, pool_ipv6_delegacion, local_address, no_crear_reglas, rate_limit_override |
| `sesiones` | servicio_id, router_id, nas_ip, acct_session_id, user_ppp, ipv4, prefijo_enlace_v6, prefijo_delegado_v6, inicio, fin, bytes_in, bytes_out, causa_fin |
| `asignaciones_historial` | servicio_id, router_id, plan_id, ipv4, prefijo_v6, inicio, fin, motivo |

## Schema `billing`

| Tabla | Columnas clave |
| --- | --- |
| `plantillas_facturacion` | nombre, ciclo (`dia_fijo`/`aniversario`), dia, prorrateo bool, dias_gracia, facturas_para_limitar, facturas_para_cortar, mora_tipo, mora_valor, mora_recurrente bool, hora_corte, certificar_al (`emitir`/`pagar`/`nunca`), reglas_promesa jsonb |
| `facturas` | cliente_id, servicio_id, periodo (date), clave_unica (`servicio_id-periodo`), emitida_en, vence_en, estado (`emitida`/`parcial`/`pagada`/`vencida`/`anulada`), subtotal, iva, total, pagado, reglas_snapshot jsonb, fel_uuid, fel_serie, fel_numero, fel_estado, fel_xml, fel_error |
| `facturas_lineas` | factura_id, concepto, tipo (`servicio`/`producto`/`mora`/`otro`), cantidad, precio_unitario, gravable, iva, total |
| `conceptos_recurrentes` | servicio_id, nombre, monto, activo |
| `pagos` | cliente_id, metodo (`caja`/`pasarela`/`deposito`/`agente`/`debito`), monto, comision, referencia, caja_id, pasarela, estado (`registrado`/`pendiente_verificacion`/`anulado`), nota, registrado_por |
| `pagos_aplicaciones` | pago_id, factura_id, monto |
| `comprobantes` | pago_id, archivo, estado, verificado_por, motivo_rechazo |
| `promesas` | servicio_id, cliente_id, vence_en, monto, estado (`activa`/`cumplida`/`incumplida`/`cancelada`), canal, aprobada_por, reglas_snapshot jsonb, resultado_evaluacion jsonb |

## Schema `ledger`

| Tabla | Columnas clave |
| --- | --- |
| `cuentas` | codigo, nombre, tipo (`activo`/`pasivo`/`ingreso`/`gasto`), padre_id, activa |
| `asientos` | fecha, descripcion, origen_tipo (`factura`/`pago`/`mora`/`nota_credito`/`egreso`/`cierre_caja`/`ajuste`), origen_id, periodo_cerrado bool, created_by |
| `movimientos` | asiento_id, cuenta_id, debe, haber, cliente_id (para auxiliar CxC) |
| `cajas` | nombre, cajero_id, cuenta_id |
| `cajas_turnos` | caja_id, abierto_en, fondo_inicial, cerrado_en, esperado, contado, diferencia, motivo |
| `bancos` | nombre, cuenta_id, numero_mascarado |
| `egresos` | fecha, categoria_id, proveedor, monto, forma_pago, comprobante, asiento_id |
| `egresos_categorias` | nombre |
| `cierres_mensuales` | periodo, cerrado_en, cerrado_por |

Restricción: trigger que rechaza `INSERT` en `asientos` cuyos movimientos no cuadren, y `REVOKE UPDATE, DELETE` sobre `ledger.asientos` y `ledger.movimientos` para el rol de la app.

## Schema `notify`

| Tabla | Columnas clave |
| --- | --- |
| `plantillas` | evento, canal, asunto, cuerpo, activa |
| `envios` | cliente_id, evento, canal, destino, estado (`encolado`/`enviado`/`fallido`), error, enviado_en |

## Schema `audit`

| Tabla | Columnas clave |
| --- | --- |
| `acciones` | actor_tipo, actor_id, canal, accion, entidad_tipo, entidad_id, entrada jsonb, resultado, error, request_id, created_at |
| `cambios` | entidad_tipo, entidad_id, campo, antes, despues, actor_id, request_id, created_at |
| `red` | tipo (`coa`/`disconnect`/`routeros`), router_id, servicio_id, comando jsonb, respuesta jsonb, ok bool, created_at |
| `outbox` | evento, payload jsonb, publicado_en, intentos |

`audit.*` particionadas por mes; `REVOKE UPDATE, DELETE` para el rol de la app.
