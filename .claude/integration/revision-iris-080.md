# Revisión de Argos del contrato Iris ↔ Argos 0.8.0 (borrador)

Revisado: `HCDestroyer/iris` `e52a1fc5` (`.claude/integration/contratos/argosisp.md`, sha256 `1171dc82…5b171`, verificado) contra `argos-isp` `origin/main` `41e31045` (Argos 1.17.0, contrato 0.7.1) y, para el bloque A, `origin/lider/iris-072` `0c22020c`. Las rutas de archivo son de `apps/api/` salvo que diga otra cosa; «main» y «072» dicen en qué rama está la línea.

Marcas: **[CONTRADICE]** = el borrador dice algo distinto de lo que hace el código. **[INSEGURO]** = el borrador o el código dejan un hueco de seguridad. **[FALTA]** = hay que implementarlo en Argos.

Decisiones ya tomadas por el líder de Argos, incluidas abajo:

- `GET /cuentas-bancarias` devuelve `alias` y `banco_nombre` (no `nombre` ni `banco`).
- El canje ya guarda `base_url`, `token` y `webhook` de Iris y deja `activo: false`. Propuesta: el botón de §1.4 deja el conector activo en Argos y el enlace de §1.3 no.
- El avance de la sincronización se informa con `PUT /api/v1/integraciones/iris/sincronizacion`.

---

## §10.1 Respuestas

### Bloque A: reconexión temporal (§7.3, §7.4)

**1. Formato de `hasta`.** Es un instante RFC 3339 en UTC, con milisegundos y `Z`: `venceEn.toISOString()` → `"2026-11-19T06:00:00.000Z"` (072 `app/billing/actions/registrar_reconexion_temporal.ts:355`). El ejemplo de §7.3 (`"2026-11-19T06:00:00Z"`, sin milisegundos) hay que corregirlo; Iris debe aceptar los dos. La promesa (`GET /promesas/:id`, `vence_en`) y los webhooks (`vence`) usan el mismo formato (072 `app/billing/promesas.ts`, `payloadPromesa`: `new Date(fila.vence_en).toISOString()`).
- [FALTA, A3] La descripción del OpenAPI de `ReconexionTemporal.hasta` todavía dice «ahora + horas_max» (072 `app/billing/esquemas.ts:1445`). Debe decir «según `vigencia`».

**2. «Medianoche de Guatemala».** Son las **00:00 del día siguiente** (`06:00:00.000Z`), no `05:59:59Z`: `inicio.setZone('America/Guatemala').plus({ days: 1 }).startOf('day')` (072 `app/billing/reglas_promesa.ts:217-225`). Si faltan menos de 60 minutos (`MINUTOS_MINIMOS_MEDIANOCHE`), se usa la medianoche siguiente.
- Recomendación para el texto de Iris: «activo hasta la medianoche del miércoles 18 (00:00 del jueves 19)». No escribir «12:00 de la noche de hoy», porque es ambiguo.
- **Aviso:** `hasta` es el fin de la promesa, no la hora del corte. Cuando vence (`promesa.cancelada`/`vencida_sin_revisar`, cron `promesas` cada 1 min, 072 `app/billing/jobs.ts:29,50`), el servicio se re-evalúa, pero el corte respeta la `hora_corte` de la plantilla (§7.3, «Cómo termina»). Iris no debe decir «se corta a medianoche», sino «la reconexión temporal vale hasta…».

**3. Código del `422` por un `motivo` desconocido.** Es la validación de VineJS en la ruta, antes de la acción: `422`, `type` `urn:argosisp:problema:validacion`, con `errors[0] = { field: "motivo", rule: "enum", message }` (072 `app/billing/validators.ts:478`, mapeo en `app/exceptions/handler.ts:85-95`). La acción repite el chequeo con la misma forma (072 `registrar_reconexion_temporal.ts:101-108`). Recomendación: escribir en §7.3 y en §4.1 `422 validacion` con `field = "motivo"` y `rule = "enum"`.

**4. Argos 1.17.x con `sin_personal`.** Responde el mismo `422 validacion` / `motivo` / `enum`: en main el validador es `vine.enum(['fuera_de_horario'])` (main `app/billing/validators.ts:478`). Es seguro: no se crea nada.

**5. ¿Dónde viene `motivo_reconexion`?**
- Viene en `Promesa`: `GET /promesas`, `GET /promesas/:id` y la respuesta `201` de `POST /promesas`, porque usan el mismo esquema (072 `app/billing/esquemas.ts:973`, «Siempre viene»). También viene en los cuatro webhooks `promesa.*` (072 `app/integraciones/iris/envios.ts:568`).
- **No** viene en la respuesta `201` de `POST /comprobantes/:id/reconexion-temporal`: el esquema `ReconexionTemporal` es `{ promesa_id, reconexion_id, hasta, servicio }` (072 `esquemas.ts:1440-1453`). Iris ya sabe qué motivo mandó. Si lo quiere en la respuesta, es un campo aditivo (A3); Argos no lo considera necesario.
- Es `null` en **toda** promesa con `tipo = promesa`, y nunca `null` en una `reconexion_temporal`. Lo garantiza una restricción en la base: `CHECK ((tipo = 'reconexion_temporal') = (motivo_reconexion IS NOT NULL))` (072 `database/migrations/1794959053722_alter_promesas_motivo_reconexion_table.ts`). La migración pone `fuera_de_horario` en las reconexiones viejas.

**6. Cupo.** Hay **un solo cupo** para los dos motivos. Cuenta todas las `reconexion_temporal` del servicio en el periodo, en cualquier estado y sin filtrar por motivo (072 `registrar_reconexion_temporal.ts:234-255`). Es aparte del cupo de promesas normales.

**7. ¿Se puede filtrar la auditoría por motivo?** Hoy no.
- `GET /bitacora/acciones` filtra por actor, acción, entidad, canal e `iris_conversacion`, pero no por campos de la entrada (main `app/core/validators.ts:743-766`). El motivo queda en `audit.acciones.entrada` y en `billing.promesas.motivo_reconexion`.
- `GET /promesas` filtra por `tipo`, pero no por motivo (072 `app/billing/validators.ts:286-309`).
- Recomendación [FALTA, A3 + A4]: agregar el filtro `motivo_reconexion=fuera_de_horario|sin_personal` a `GET /promesas` (que exija `tipo=reconexion_temporal` o lo implique) y su filtro en la lista de promesas del panel. Es el lugar natural para revisar el criterio de Iris; la bitácora no lo necesita.

**8. ¿Datos extra para auditar el criterio `sin_personal`?** **No.** Argos no puede verificar «cuántos de caja había disponibles» en Iris, y guardarlo daría una falsa sensación de control. Iris lo audita de su lado (§7.3, «Auditoría en Iris»). En Argos alcanzan el actor, el canal, `iris_conversacion` y el motivo, que ya quedan.

### Bloque B: cuentas bancarias (§7.8)

**9. `titular` y `tipo`.** Hoy no existen [FALTA, A3] (main `app/billing/cuentas_bancarias.ts:29-44`; esquema main `app/billing/esquemas.ts:1058-1079`). Propuesta final:
- `titular`: string o `null`, de 2 a 120 caracteres, con trim. Las cuentas existentes quedan `null` hasta que alguien las edite. El panel lo pide como obligatorio al crear y al editar, pero la API lo acepta nulo por compatibilidad.
- `tipo`: `"monetaria" | "ahorro"` o `null` en las cuentas viejas.
- Límites que ya existen: `numero` de 3 a 40 y `alias` de 2 a 80 (main `app/billing/validators.ts:345-346`).
- Iris ya cubre el caso `titular: null` (no ofrece la cuenta), así que Argos no inventa un valor.

**10. `cuenta_bancaria.cambiada`.** Hoy no existe ningún evento: ni `CrearCuentaBancaria` ni `EditarCuentaBancaria` emiten nada (main `app/billing/actions/crear_cuenta_bancaria.ts`, `editar_cuenta_bancaria.ts`). Propuesta [FALTA, A3 emite por outbox; A6 reenvía]:
- Payload: `{ cuenta_bancaria_id, empresa_id, campos[], activa, creada }`.
- `campos[]` ⊂ `banco_id`, `numero`, `alias`, `titular`, `tipo`, `moneda`, `activa`. Solo nombres. `empresa_id` no se edita (no está en `editarCuentaBancariaValidator`).
- **Sí se emite al crear**, con `creada: true` y `campos[]` con todos los campos que se guardaron.
- `activa` es el valor **después** del cambio.
- Solo va a conectores con contrato ≥ 0.8.0 (`EVENTOS_DESDE_080` en `envios.ts`, como los de 0.5.0 y 0.6.0). Alcance: la empresa de la cuenta.

**11. Lista.**
- `GET /cuentas-bancarias` sin `activa` devuelve **activas e inactivas** (main `cuentas_bancarias.ts:82-94`).
- **No pagina:** responde un **arreglo plano** `CuentaBancaria[]`, no `{ data, nextCursor }` (main `start/routes/billing.ts:1486-1497`; OpenAPI `type: array`). `limit` y `cursor` no existen y se ignoran. Son pocas filas por instalación, así que se queda así. Iris debe leer un arreglo.
- La respuesta trae además `cuenta_id`, `cuenta_codigo` (subcuenta del libro), `created_at` y `updated_at`. Iris los ignora.
- **[CONTRADICE §2.5 paso 5]** `GET /cuentas-bancarias` y `GET /bancos` declaran `cabecerasIris: true` (main `start/routes/billing.ts:1482,1493`). Con el token de Iris exigen `X-Iris-Actor` y `X-Iris-Conversacion`; sin ellas responden `400 cabecera_iris_requerida` (main `app/integraciones/iris/atencion.ts:73-82`). La primera sincronización no tiene conversación.
- Recomendación [FALTA, A3]: en esas dos lecturas las cabeceras pasan a ser **opcionales**: si vienen se validan y van a la auditoría; si faltan, no hay `400`. Es un cambio que relaja la regla y es compatible. No recomendamos que Iris invente un actor o una conversación para el sistema.
- `GET /cuentas-bancarias/:id` ya no las exige.

**12. `GET /cuentas-bancarias/:id` inexistente.** Responde `404` `urn:argosisp:problema:no_encontrado` (main `cuentas_bancarias.ts:140-147`, `app/shared/errores.ts:76-80`). Fuera del alcance: `403` `urn:argosisp:problema:empresa_no_permitida` (main `start/routes/billing.ts:1507-1509` → `app/billing/empresa.ts:25-28`). Las cuentas nunca se borran: no hay ruta `DELETE` ni acción de borrado. Es la misma semántica de «Confirmar un borrado» de §2.3.

**13. `POST /comprobantes` con una cuenta `activa: false`.**
- Hoy responde `422 validacion` con `errors[0] = { field: "cuenta_bancaria_id", rule: "exists", message: "…no existe o está inactiva" }` (main `app/billing/datos_bancarios.ts:79-84`).
- Una cuenta en `USD` responde `rule: "moneda"` (`:85-90`).
- Recomendación para 0.8.0 [FALTA, A3]: seguir rechazando, pero con `rule: "inactiva"` para distinguirla de una cuenta inexistente. Iris pasa el caso a una persona y caja lo registra a mano.
- Aceptar depósitos hechos antes de desactivar la cuenta necesitaría un `desactivada_en` y comparar con `fecha_deposito`. Queda fuera de 0.8.0.

**14. Desajuste de nombres.** Confirmado: **Iris lee campos que no existen.** La cuenta trae `alias` y `banco_nombre` (más `banco_id`). Nunca trajo `nombre` ni un objeto `banco` (main `cuentas_bancarias.ts:65-79`, esquema `esquemas.ts:1058-1079`). Es un fallo de Iris y se corrige con la migración de §10.3. Argos no agrega alias de compatibilidad.

**15. Monedas.** `moneda` es `GTQ | USD` en el catálogo (main `cuentas_bancarias.ts:11`), pero solo `GTQ` recibe pagos y comprobantes (main `datos_bancarios.ts:85-90`; portal `listarCuentasDeposito`, `cuentas_bancarias.ts:116-138`). No hay planes de cambiarlo en 0.8.0. Iris sigue filtrando por `GTQ`.

**16. `GET /bancos`.**
- Es un catálogo fijo (`billing.bancos`): no tiene ruta ni acción de edición en la API. Solo cambia con una migración de una versión nueva de Argos, por eso no hay evento.
- Devuelve **solo los bancos activos** (`listarBancos(…, soloActivos = true)`, main `cuentas_bancarias.ts:46-58`).
- Recomendación: Iris lo relee al activar el conector, cuando cambia `version_argos` y cada 24 h. Lo mismo aplica a `banco_nombre` dentro de las cuentas.

### Bloque C: datos del servicio (§2.4)

**17. Nombres y dónde vienen.**
- **[CONTRADICE]** `router_nombre` **ya existe**, en `GET /servicios/:id` y en la lista, junto con `plan_nombre` y `zona_nombre` (main `app/core/esquemas.ts:533-539`; SQL `app/core/consultas/servicios.ts:153`). Hay que quitarlo de A27.
- `precio_mensual` y `moneda` son nuevos [FALTA, A1]. La lista y el detalle usan el mismo esquema `Servicio` (main `start/routes/core.ts:890-899`, `pagina(Servicio)`), así que salen en los dos.
- Nombres finales: `precio_mensual` (string decimal con 2 decimales) y `moneda` (`"GTQ"` siempre en 0.8.0; los planes no tienen moneda).

**18. Evento cuando cambia el precio.** Hoy **ninguno**:
- Editar el precio de un plan solo emite `catalogo.cambiado` con `nombre` o `activo` (main `app/network/actions/editar_plan.ts:32,88-98`).
- Cambiar `costo_override` no está entre los `campos` de `servicio.config_cambiada` (main `app/shared/eventos.ts:301-321`).

Propuesta [FALTA, A1; A6 reenvía]:
- `servicio.config_cambiada` con `"precio"` en `campos[]` cuando cambia `costo_override` o empieza o termina un plan temporal con otro precio.
- `catalogo.cambiado` (`catalogo: "plan"`) con `"precio"` en `campos[]` cuando cambia el precio del plan. Iris relee los servicios de ese plan (`GET /servicios?plan_id=`, paginado).
- Los dos son aditivos: `campos[]` ya se reenvía completo (main `envios.ts:309-321`).

**19. ¿Qué incluye `precio_mensual`?**
- Es el precio con el que Argos factura el servicio: `costo_override ?? precio del plan vigente`, **IVA incluido** (main `app/billing/configuracion.ts:22,110`). Un plan temporal activo cuenta, porque `plan_id` ya es el temporal (`Servicio.plan_temporal`).
- **No** incluye adicionales (`servicio.adicional_*`), descuentos de lealtad o bonificaciones, mora, prorrateo ni cargos únicos.
- El asistente debe decir «su plan cuesta Q250.00 al mes», no «su factura es de…». Si Iris necesita el total facturado, que lea `GET /clientes/:id/estado-cuenta`.
- Implementación: una sola función de A3 (la de `configuracion.ts`) reutilizada por A1 en el SQL de la lista, para no tener dos cálculos.

**20. `tipo_conexion` y formatos.**
- `tipo_conexion` = `pppoe | ip_estatica | dhcp_fija` (main `esquemas.ts:466-469`).
- `ipv4`: la dirección **sin máscara** (`host(a.ip)`), por ejemplo `"100.64.12.34"`.
- `prefijo_enlace_v6` y `prefijo_delegado_v6`: CIDR **con máscara** (`prefijo::text`), por ejemplo `"2001:db8:10::/64"` (main `consultas/servicios.ts:133-139`).
- Sin asignación vienen `null`, nunca `""`.
- `user_ppp` es `null` fuera de `pppoe` (main `esquemas.ts:470`).
- Ojo: `ipv4` es **una sola** (la subconsulta usa `LIMIT 1` sin orden, main `consultas/servicios.ts:133`). En cambio, `asignacion.cambiada` trae `ipv4[]`. Si un servicio tuviera más de una IPv4, Iris solo vería una. No es un caso normal hoy. Si hace falta, se agregaría `ipv4s[]` en otra versión; en 0.8.0 no.

**21. Caja o nodo.** Argos **no** tiene caja ni nodo de planta y no los va a exponer. La única referencia es `planta` (A9), de solo lectura, cuya fuente es OZmap.
- **[CONTRADICE el ejemplo de §2.4]** `planta` trae **siempre las seis claves** (`caja`, `puerto`, `olt`, `slot`, `pon`, `potencia_dbm`), todas string (`puerto` es `"3"`, no `3`) y nulables según el caso (main `esquemas.ts:487-507`). El ejemplo `{ "caja": "C-014", "puerto": 3 }` hay que corregirlo.

**22. ¿Cambia `user_ppp`?** Sí: se edita (`PUT /servicios/:id`) y se genera o borra al cambiar `tipo_conexion`. Lo avisa `servicio.config_cambiada` con `campos` que incluye `"credenciales"` (también cambia con `pass_ppp`) o `"tipo_conexion"` (main `eventos.ts:315-316`, `app/core/actions/editar_servicio.ts:46-47,129-135`). Se reenvía a Iris sin valores.
- [CONTRADICE §2.3] La lista de `campos` de `servicio.config_cambiada` es más larga que «plan, IPs, prefijo, router»: incluye además `tipo_conexion`, `mac`, `amarre_ip_mac`, `empresa`, `servidor_pppoe` y `credenciales`. Hay que actualizar §2.3.

**23. ¿Hace falta un permiso nuevo?** **No.** Basta `servicios.ver`, que el token ya tiene (main `app/core/integraciones_iris.ts`, `PERMISOS_IRIS_CONTRATO`). Un permiso nuevo obligaría a migrar los tokens vigentes, porque el token recorta a `PERMISOS_IRIS` al crearse.
- **Minimizar datos (para B6):** hoy el token de Iris ya recibe en `Servicio` campos que el borrador no lista: `mac`, `ipv6_duid`, `ipv6_modo`, `local_address`, `servidor_pppoe_id`, `excepciones`, `costo_override`, `suspension_manual_motivo` y `externo`. Iris debe guardar solo una **lista blanca** de campos en su instantánea. Argos no los recorta en 0.8.0. Si Iris prefiere que Argos los oculte al token, se puede hacer como con `nit_cui` (`ocultarDocumentoIris`), pero sería otro pedido.

### Bloque D: conexión de un paso (§1.5, §2.5)

**24. Receptor de Iris en el canje.** **Sí, Argos ya lo guarda todo en la misma transacción del canje, desde el conector original (A2)**, no desde 0.8.0:
- Canje directo: `url_base` (origen normalizado de `base_url`), `token_cifrado` (`iris_pat_`), `webhook_salida_url`, `webhook_salida_secreto_cifrado`, el secreto nuevo del receptor de Argos, `contrato` y `receptor_argos` (main `app/integraciones/iris/actions/canjear_enlace_iris.ts:254-273`).
- Reconexión: el mismo juego, cifrado en `pendiente_*`, se aplica en la primera llamada del `atk_` nuevo (`:236-253`).
- **Lo único que se hace aparte es encenderlo** (`activo`), en el panel o con `PUT /integraciones/iris`.
- Propuesta de Argos [FALTA, A1]: con el **botón** (§1.4) el conector queda activo en Argos al **confirmar** el canje (primera llamada autenticada del `atk_`, `ConfirmarCanjeIris`), no al canjear. Así, si Iris rechaza el canje y lo revoca, nunca se encendió.
- Con el **enlace** (§1.3) sigue apagado.
- En una reconexión, `activo` no cambia (como hoy).
- Hay que corregir el texto de §1.5 («Con la 0.8.0, Argos guarda…»): es así desde antes, y la fila «Receptor de Iris en el canje» de §4.1 no aplica.
- La configuración a mano (`PUT /integraciones/iris` y tokens `atk_` del panel) sigue existiendo como vía de recuperación; ver el aviso sobre S5 más abajo.

**25. Código del `422` cuando el host del receptor no coincide.**
- **[CONTRADICE, INSEGURO]** Argos **no** valida hoy que el host de `webhook.url` sea el de `base_url`, ni que `base_url` sea el `origen_iris` que aprobó el admin con el botón. `validarDatosDeIris` solo comprueba `https` (main `canjear_enlace_iris.ts:329-349`), y el canje ni siquiera lee `origen_iris` del enlace (`:169-184`). La columna sí se guarda al autorizar (main `actions/autorizar_iris.ts:71-75`).
- PKCE impide que un tercero sin el `code_verifier` use el código, así que el riesgo real es bajo, pero la regla que el borrador da por cumplida no existe.
- Propuesta [FALTA, A1]: `422`, `type` `urn:argosisp:problema:webhook_invalido`, el mismo nombre que usa Iris (0.6.2):
    - `errors[0] = { field: "webhook.url", rule: "mismo_host" }` si el host de `webhook.url` ≠ host de `base_url`;
    - `errors[0] = { field: "base_url", rule: "origen_aprobado" }` si el código nació del botón y `origen(base_url)` ≠ `origen_iris`.
- En los dos casos el código **queda gastado**, como un `code_verifier` que no coincide (mismo mecanismo `gastar`, `rechazado_en`). Repetir con ese código responde `410 enlace_vencido`.
- Los errores de formato (`422 validacion`) siguen sin gastarlo.

**26. Listas completas.**
- Sí: `GET /clientes` y `GET /servicios` se recorren completas con `cursor` y sin `q` ni `cliente_id`. Son keyset por `id` ascendente (main `app/core/consultas/clientes.ts:312`, `consultas/servicios.ts:284`), filtradas por el alcance de empresas del token.
- `limit` máximo: **200** (`LIMITE_MAXIMO`, main `app/shared/paginacion.ts:13-14`); por defecto 50.
- Filtros que ya existen: `GET /servicios?estado=` (un solo estado) y `GET /clientes?estado_servicio=` (clientes con al menos un servicio en ese estado).
- **No hay** filtro «no retirado» ni por fecha de cambio (`updated_at`).
- Propuesta [FALTA, A1], solo si el PM decide cargar solo los activos (§10.2.9): agregar `excluir_retirados=true` a las dos listas. Para reanudar, el cursor por id alcanza; no hace falta un filtro por fecha.

**27. Ritmo.**
- `GET /clientes` y `GET /servicios` **no** tienen límite de peticiones ni responden `429`. Solo las rutas `limitada: true` lo tienen (main `app/shared/rutas.ts:121-122`); por ejemplo, `POST /integraciones/iris/verificar-identidad`.
- Pedido de Argos para la primera carga: **una petición a la vez por recurso**, `limit=200` y **como máximo 5 peticiones por segundo** en total. La consulta de servicios lleva subconsultas por fila (IPs, prefijos y nombres).
- Iris respeta `429` con `Retry-After` si algún día aparece. Argos no lo agrega en 0.8.0.

**28. Cómo se entera Argos del avance.** Decidido: `PUT /api/v1/integraciones/iris/sincronizacion` [FALTA, A1 API; A4 pantalla]. Forma propuesta:
- **Credencial:** solo el `atk_` de Iris, con permiso de ruta `sso.emitir`, igual que `PUT /integraciones/iris/contrato` (main `start/routes/iris.ts:114-126`) y por la misma razón: no obliga a migrar tokens. Cualquier otra credencial responde `403`. Funciona con el conector apagado.
- **Cuerpo:**
    ```json
    {
      "sincronizacion_id": "<uuid v7 de Iris>",
      "estado": "en_curso",
      "iniciada_en": "…Z",
      "actualizada_en": "…Z",
      "etapas": [
        {
          "recurso": "clientes",
          "estado": "en_curso",
          "procesados": 1200,
          "total": null,
          "error": null,
          "terminada_en": null
        }
      ]
    }
    ```
    - `estado` ∈ `en_curso | completa | con_errores`.
    - `recurso` ∈ `empresas | zonas | planes | routers | cuentas_bancarias | bancos | clientes | servicios`.
    - `estado` de cada etapa ∈ `pendiente | en_curso | completa | con_errores`.
    - `error`: texto de hasta 300 caracteres, sin datos de clientes.
- **Idempotente:** la misma `sincronizacion_id` con el mismo `actualizada_en` responde `200` con lo guardado.
- **`409 sincronizacion_vieja`:** si `actualizada_en` es menor que el guardado para esa `sincronizacion_id`, o si la `sincronizacion_id` es más vieja que la guardada (comparación de UUID v7).
- **Respuesta:** `200 { sincronizacion_id, estado, actualizada_en }`.
- Se guarda en `integraciones.iris_conector` (columna `sincronizacion jsonb`); es estado de Iris, no de Argos. Auditoría `iris.informar_sincronizacion`. Iris lo manda solo al cambiar de etapa o de estado (no por página), así no se llena la bitácora.
- `GET /integraciones/iris` agrega `sincronizacion` (o `null`, que el panel muestra como «no informado»).
- **Alinear nombres:** el borrador (§2.5, «Progreso») usa `completo` y `fallido`. Deben ser `completa` y `con_errores`.

**29. Huella TLS.**
- **[CONTRADICE la infraestructura de Argos]**
    - Argos no termina TLS: lo hace Caddy, con Let's Encrypt (`infra/produccion/config/Caddyfile`), y hay instalaciones detrás de otro proxy (Nginx Proxy Manager, `docs/runbooks/detras-de-proxy.md`). La API de Node no conoce el certificado que ve Iris.
    - En el canje Argos no abre ninguna conexión TLS hacia Iris, así que no hay «huella que Argos vio de Iris al canjear».
    - Let's Encrypt renueva cada 60 a 90 días y Caddy, por defecto, cambia también la clave en cada renovación. Fijar el certificado **o** la clave pública cortaría las escrituras de Iris en cada renovación.
- Recomendación:
    - (a) Argos **no** muestra huella en la pantalla de aprobación. Ahí la protección es S1–S7: PKCE, código en el fragmento, canje por HTTPS validado contra las CA públicas y aprobación por `iris.configurar`.
    - (b) Si Iris quiere la capa extra, que sea **informativa**: Iris muestra a su admin el emisor, el sujeto y la huella del certificado de la API de Argos. Si cambia sin reconexión pero la cadena es válida para el mismo host, Iris **registra el cambio y avisa**, sin bloquear escrituras.
    - (c) Bloquear solo si la cadena no valida, que es lo que ya hace TLS.
- Hay que quitar la huella de A28.

**30. ¿Cuándo arranca la primera sincronización?** Al **activar en Iris**, como propone el borrador. Antes debe ir la primera llamada autenticada (`PUT /integraciones/iris/contrato`), que confirma el canje. Argos no necesita enterarse antes. Se entera por el `PUT …/sincronizacion` con `en_curso`.

**31. ¿Limitar la lectura en bloque?** No hace falta un mecanismo nuevo. El token ya está acotado a las empresas que el admin vio y aprobó (S5 y S7), y la primera carga solo lee lo que Iris ya podía leer a demanda. Sí pedimos:
- [FALTA, A4] que la pantalla de aprobación (`/integraciones/iris/autorizar`) y la del enlace digan explícitamente: «Iris copiará los clientes, los servicios y las cuentas bancarias de estas empresas».
- Que la carga quede visible en el panel de Argos por el `PUT …/sincronizacion` (punto 28).

**32. Versiones.** El PM decidió **una sola 0.8.0** con los cuatro bloques: Argos la publica en una sola versión (1.18.0) y `CONTRATO_IRIS` pasa directo de `'0.7.1'` a `'0.8.0'`. `lider/iris-072` entra como parte de esa rama.
- La condición de Iris para `sin_personal` en §4.1 queda «contrato ≥ 0.8.0», como en el borrador.
- [FALTA, líder Argos] En 072, `.claude/integration/contratos/eventos.md` (la fila de `motivo_reconexion`, línea 41) dice «El webhook a Iris (`envios.ts`) no lo reenvía todavía», pero `envios.ts:568` sí lo reenvía. Hay que corregir esa frase antes de fusionar.

---

## Revisión de las secciones nuevas

### §1.5 Conexión de un paso
- **S1, S2, S3 y S4:** se cumplen.
    - Código de 15 min y un uso; uno nuevo anula los anteriores (`crearCodigoIris`, main `app/integraciones/iris/autorizacion.ts:166-189`).
    - Va en el fragmento (`autorizar_iris.ts:81-86`).
    - El canje es servidor a servidor y exige https salvo `IRIS_PERMITIR_HTTP` (`configuracion.ts:235-246`).
    - PKCE S256 con el código gastado si falla (`canjear_enlace_iris.ts:194-199`, `:149-162`).
- **S5, [CONTRADICE]:** el `atk_` del canje nunca se muestra y siempre está recortado a `PERMISOS_IRIS`, nunca admin (`app/core/actions/generar_token_iris.ts:23-46`). Pero el panel de Argos **sí** muestra un `atk_` una vez cuando se genera a mano (`POST /integraciones/iris/tokens`, web `apps/web/app/pages/configuracion/integraciones/iris.vue:213-233`, `mostrarUnaVez`) y acepta pegar un `iris_pat_` a mano. Hay dos salidas:
    - (a) S5 dice «en la conexión de un paso», y la vía manual queda documentada como recuperación, solo `admin` y auditada;
    - (b) Argos retira la vía manual.
    Recomendamos (a) en 0.8.0. Iris tiene la misma pregunta de su lado.
- **S6:** Argos rota el secreto de su receptor y revoca el `atk_` anterior al confirmar (README del conector, «Reconexión»). El `iris_pat_` anterior lo revoca **Iris** de su lado: Argos solo deja de usarlo. Hay que escribirlo así.
- **S7:** se cumple. `iris.configurar`, solo `admin`, tanto para el enlace como para el botón.
- **S8:** se cumple. El vínculo nace solo del autologin Iris → Argos con la contraseña (§1.3). La primera carga no toca usuarios.
- **(b), el host del receptor:** ver el punto 25. Hoy **no** se valida.
- Huella TLS: ver el punto 29.

### §2.4 Más datos del servicio
- `router_nombre` ya existe (punto 17).
- El ejemplo de `planta` está mal (punto 21).
- `costo_override` y otros campos sensibles ya llegan al token (punto 23).
- Los permisos `servicios.ver_red` y `servicios.ver_ubicacion` son de Iris; Argos no tiene objeción.
- El asistente sin IP, `user_ppp`, coordenadas ni dirección: de acuerdo.

### §2.5 Primera sincronización y pantalla de estado
- Las lecturas existen, con estas salvedades: las cabeceras de `GET /cuentas-bancarias` y `GET /bancos` (punto 11); `GET /zonas` es un arreglo sin paginar (main `start/routes/core.ts:744-750`); `planes` y `routers` son `pagina` (main `start/routes/network.ts:144-150,709-715`).
- **Panel de Argos:** ya existe parte de la pantalla:
    - estado del canje y de la reconexión;
    - `requiere_reconectar`;
    - webhooks enviados a Iris, con pendientes, fallidos, último error y `ultimo_enviado_en` (`GET /integraciones/iris/envios/resumen`, main `app/integraciones/iris/envios_panel.ts:121-160`; web `iris.vue:257-296,723-780`).
- **Falta** [A4]:
    - la versión de contrato de cada lado y qué funciones quedan apagadas por eso;
    - la sincronización informada (punto 28);
    - las empresas del alcance y `alcance_global` en la página de configuración (hoy solo en la pantalla de aprobación).
- Estados: alinear con `completa` y `con_errores` (punto 28).

### §4.1 Compatibilidad
- La fila de `sin_personal` queda con ≥ 0.8.0 (una sola versión, punto 32).
- La fila «Receptor de Iris en el canje» sobra: Argos lo guarda desde antes (punto 24).
- La fila de la huella TLS: ver el punto 29.
- Tabla de errores:
    - motivo desconocido → `422 validacion`, `motivo`/`enum`;
    - canje en Argos con host distinto → `422 webhook_invalido` (`mismo_host` | `origen_aprobado`), código gastado;
    - cuenta inactiva en `POST /comprobantes` → `422 validacion`, `cuenta_bancaria_id`/`inactiva` (hoy `exists`);
    - nuevo: `409 sincronizacion_vieja` en `PUT /integraciones/iris/sincronizacion`;
    - nuevo: `400 cabecera_iris_requerida` deja de aplicar a `GET /cuentas-bancarias` y `GET /bancos`.
- `403 empresa_no_permitida` en la lista de cuentas: solo con `?empresas=todas` sin alcance global (main `app/shared/empresa_activa.ts:82-100`). Sin filtro, la lista solo trae lo del alcance, no responde `403`.
- `cuenta_bancaria.cambiada` solo a conectores con contrato ≥ 0.8.0, y `motivo_reconexion` sin filtro de versión: de acuerdo, y es como lo hace 072.

### §7.3 Reconexión temporal
- Coincide con 072: los motivos `fuera_de_horario` | `sin_personal`; las mismas ocho reglas en el mismo orden; `vigencia` `horas` (por defecto) | `medianoche` (072 `reglas_promesa.ts:57,115,217`); `motivo_reconexion` en la promesa, con `CHECK`, y en los webhooks.
- Hay que corregir: el formato de `hasta` (punto 1), «medianoche» = 00:00 del día siguiente (punto 2) y que `hasta` no es la hora del corte (punto 2).
- El criterio `sin_personal` es de Iris. Argos lo acepta con sus barreras de siempre (plantilla apagada de fábrica, cupo único, que el comprobante cubra lo vencido, sin suspensión manual y sin otra promesa abierta).

### §7.8 Cuentas bancarias
- Los campos actuales están bien descritos (punto 14). Además vienen `cuenta_id`, `cuenta_codigo`, `created_at` y `updated_at`, y `moneda` puede ser `USD`.
- `titular`, `tipo` y el evento no existen (puntos 9 y 10).
- La lista es un arreglo sin paginar y hoy exige las cabeceras de Iris (punto 11).
- «Nunca se borra»: ya es así (punto 12).
- La relectura con `GET /cuentas-bancarias/:id` antes de registrar no exige cabeceras: bien.

### §5 Pedidos
- **A25:** correcto («en `lider/iris-072`», que entra en la rama de la 0.8.0), con un pendiente: la frase vieja de `eventos.md`.
- **A26:** correcto como pedido. Agregar «se emite también al crear (`creada: true`)» y «la lista es un arreglo sin paginar».
- **A27:** quitar `router_nombre`, que ya existe. Queda `precio_mensual` y `moneda`, más el `"precio"` en `servicio.config_cambiada` y en `catalogo.cambiado` (punto 18). La caja o el nodo: «no, sigue siendo `planta`/OZmap».
- **A28:** el receptor de Iris en el canje ya se guarda. Lo que falta es (1) validar el host y el origen aprobado (punto 25), (2) activar al confirmar con el botón (punto 24), (3) `PUT /integraciones/iris/sincronizacion` (punto 28) y (4) la pantalla de estado (§2.5). La huella TLS se quita (punto 29). Agregar «cabeceras de Iris opcionales en `GET /cuentas-bancarias` y `GET /bancos`» (punto 11).
- **B4:** Argos no objeta. Pide que Iris no diga «se corta a medianoche» (punto 2).
- **B5:** de acuerdo. Ojo: la respuesta es un arreglo, los campos son `alias` y `banco_nombre`, y hay que manejar `rule: inactiva`.
- **B6:** de acuerdo. Pedimos lista blanca de campos en la instantánea (punto 23).
- **B7:** cambiar «fijar y comparar la huella TLS» por «registrar y avisar» (punto 29). La sincronización se informa con el `PUT` del punto 28.

---

## Trabajo en Argos

**A1, núcleo, integraciones y SSO**
1. `CONTRATO_IRIS = '0.8.0'` en la rama de la 0.8.0 (Argos 1.18.0), cuando se espeje el contrato final.
2. Canje: validar el host de `webhook.url` contra `base_url` y `origen(base_url)` contra `iris_enlaces.origen_iris` cuando hay `code_challenge`. Si falla: `422 webhook_invalido` (`mismo_host` | `origen_aprobado`), con el código gastado.
3. Botón (§1.4): marcar el enlace para que `ConfirmarCanjeIris` encienda `activo` en un canje directo. Con el enlace (§1.3) y en una reconexión, `activo` no cambia.
4. `PUT /integraciones/iris/sincronizacion` (`iris.informar_sincronizacion`, ruta con `sso.emitir` y solo el `atk_`, idempotente, `409 sincronizacion_vieja`), columna `sincronizacion jsonb` y `sincronizacion` en `GET /integraciones/iris`.
5. `precio_mensual` y `moneda` en `Servicio` (lista y detalle), con el cálculo de precio de A3.
6. `"precio"` en `campos[]` de `servicio.config_cambiada` (cambio de `costo_override` o de plan temporal con otro precio) y de `catalogo.cambiado` de plan (cambio de precio).
7. Opcional, si el PM lo decide: `excluir_retirados=true` en `GET /clientes` y `GET /servicios`.
8. README del conector y OpenAPI regenerado.

**A3, billing y cuentas**
1. `titular` (nulable, 2–120) y `tipo` (`monetaria` | `ahorro`, nulable) en `billing.cuentas_bancarias`, con migración, validadores, esquema y diff en `audit.cambios`.
2. Evento `cuenta_bancaria.cambiada` por outbox al crear y al editar `{ cuenta_bancaria_id, empresa_id, campos[], activa, creada }`, en el catálogo de `eventos.ts` y en `eventos.md`.
3. Cabeceras de Iris **opcionales** en `GET /cuentas-bancarias` y `GET /bancos`.
4. `rule: "inactiva"` (en lugar de `exists`) para una cuenta desactivada en `validarDatosBancarios`.
5. Filtro `motivo_reconexion` en `GET /promesas`.
6. Corregir la descripción de `ReconexionTemporal.hasta`. Exponer la función de precio efectivo (`costo_override ?? plan`, IVA incluido) para A1.

**A4, panel**
1. `titular` y `tipo` en el formulario de cuentas bancarias, obligatorios en el panel.
2. Filtro por motivo de reconexión en la lista de promesas (la vigencia ya está en 072).
3. Pantalla del conector Iris:
    - contrato de Argos y de Iris, y qué funciones quedan apagadas;
    - sincronización informada por Iris, o «no informado»;
    - empresas del alcance y `alcance_global`;
    - nunca tokens ni secretos.
4. Texto en la pantalla de aprobación (`/integraciones/iris/autorizar`) y en la del enlace: «Iris copiará clientes, servicios y cuentas bancarias de estas empresas».
5. Si se elige la opción (a) de S5: rotular la generación manual de tokens como «vía de recuperación».

**A6, webhooks y notify**
1. Reenviar `cuenta_bancaria.cambiada` (nuevo `EVENTOS_DESDE_080`, solo con `conectorAdmite('0.8.0')`), con el alcance de la empresa de la cuenta y lista cerrada de campos, nunca valores.
2. Verificar que `"precio"` llega en `campos[]` de `servicio.config_cambiada` y `catalogo.cambiado` (hoy se reenvían completos; agregar una prueba).
3. El reenvío de `motivo_reconexion` en `promesa.*` ya está en 072 (`envios.ts:568`). Falta corregir la frase vieja de `eventos.md` en esa rama.
