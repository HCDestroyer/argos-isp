# @argosisp/portal · portal del cliente y página de corte

Nuxt 4 (SSR) + Nuxt UI v4, móvil primero. Puerto 3001. Pantallas: agente A5 (`.claude/agents/a5-portal.md`).

## Comandos

```
pnpm --filter @argosisp/portal dev          # http://localhost:3001
NUXT_PUBLIC_USE_FIXTURES=true pnpm --filter @argosisp/portal dev   # sin backend; /corte?fixture=activo|suspendido|desconocido
pnpm --filter @argosisp/portal lint | typecheck | test | build
docker build -f apps/portal/Dockerfile -t argosisp/portal .        # desde la raíz
```

Variables en `.env.example` (nombre de la empresa mientras carga, URL interna de la API, portal cautivo).

## Acceso a la API: proxy en el mismo origen

El navegador nunca llama a `apps/api` directo. Llama a `/api/v1/portal/**` en el origen del portal y
Nitro lo reenvía a `NUXT_API_BASE_INTERNAL` (`server/api/v1/portal/[...ruta].ts`):

- El walled garden solo necesita el portal: la API no se publica a los suspendidos y no hace falta CORS.
- Solo se reenvía `/api/v1/portal/**`; el resto de la API (panel) no es alcanzable desde el portal.
- La IP del cliente viaja en `X-Forwarded-For`: el portal agrega la IP del socket al final de la cadena
  recibida y la API decide en quién confiar con `PORTAL_PROXIES_CONFIABLES` (ver `apps/api/app/portal/README.md`).
  El portal debe ver la IP real del cliente: el dst-nat del MikroTik la conserva; Docker también, si el
  puerto se publica con iptables (no con `userland-proxy`, que en IPv6 la reemplaza por la del puente).
- Cookies y `Set-Cookie` pasan sin cambios (sesión del cliente por cookie httpOnly en el día 4).

`NUXT_PUBLIC_API_BASE` vacío es lo recomendado; con una URL el navegador iría directo a la API.

## Portal cautivo: cualquier Host y ruta → `/corte`

El MikroTik hace dst-nat de TCP/80 de los suspendidos al portal (`portalCortePuerto` en
`infra/mikrotik/lab.rsc`), así que llegan peticiones como `http://example.com/noticias`. La
middleware `server/middleware/portal-cautivo.ts` (lógica pura en `server/utils/portalCautivo.ts`) responde:

| Petición | Respuesta |
| --- | --- |
| Pruebas de conectividad: `/generate_204`, `/gen_204` (Android), `/hotspot-detect.html`, `/library/test/success.html` (Apple), `/ncsi.txt`, `/connecttest.txt`, `/redirect` (Windows), `/success.txt`, `/canonical.html` (Firefox), `/check_network_status.txt`, `/connectivity-check.html` (Linux) y otras | 302 a `/corte` con cualquier Host: el teléfono muestra "Iniciar sesión en la red" |
| Host ajeno, cualquier ruta | 302 a `NUXT_PORTAL_URL_PUBLICA/corte`; sin URL pública, 302 relativo a `/corte` en el mismo Host (se sirve ahí; funciona sin DNS) |
| Host ajeno, recursos de la página (`/_nuxt/`, `/api/v1/portal/`, iconos) | Se sirven |
| Host del portal (`NUXT_PORTAL_URL_PUBLICA`, `NUXT_PORTAL_HOSTS`, localhost) | Rutas normales |

Las redirecciones llevan `Cache-Control: no-store` para que el navegador no las recuerde tras la reactivación.
HTTPS no se puede redirigir (el certificado no coincide): el MikroTik corta 443 y el sistema operativo cae a la prueba HTTP.

### Sondas de portal cautivo

Cada sistema operativo pide una URL conocida y, si recibe exactamente la respuesta "de éxito", cree
que hay Internet y no avisa. A un suspendido el portal **nunca** le da esa respuesta: responde 302 a
`/corte` (absoluto con `NUXT_PORTAL_URL_PUBLICA`, relativo sin ella), con GET o HEAD, con o sin query,
con el Host de la sonda o con el del portal (IPv4, `[portalV6]:80` o nombre). El teléfono muestra
"Iniciar sesión en la red" y al tocarlo abre `/corte`. Catálogo en `SONDAS` de `server/utils/portalCautivo.ts`.

| Sistema | Sonda | Espera con Internet | El portal responde |
| --- | --- | --- | --- |
| Android, ChromeOS, Chrome | `connectivitycheck.gstatic.com/generate_204`, `clients3.google.com/generate_204` | 204 sin cuerpo | 302 → `/corte` |
| Android (Google) | `www.google.com/gen_204` | 204 | 302 → `/corte` |
| Samsung, Xiaomi, Huawei | `connectivitycheck.samsung.com/generate_204`, `connect.rom.miui.com/generate_204`, `connectivitycheck.platform.hicloud.com/generate_204` | 204 | 302 → `/corte` |
| Huawei / Honor antiguos | `/mobile/status.php` | 204 | 302 → `/corte` |
| iOS, iPadOS, macOS | `captive.apple.com/hotspot-detect.html`, `www.apple.com/library/test/success.html` | 200 con `<TITLE>Success</TITLE>` | 302 → `/corte` |
| Windows 10 / 11 | `www.msftconnecttest.com/connecttest.txt`, `ipv6.msftconnecttest.com/connecttest.txt` (y `dns.msftncsi.com` debe resolver a su IP real: el DNS del suspendido pasa a cualquier resolver) | 200 `Microsoft Connect Test` | 302 → `/corte` |
| Windows 10 / 11 (abre el navegador) | `www.msftconnecttest.com/redirect` | 200 | 302 → `/corte` |
| Windows 7 / 8 | `www.msftncsi.com/ncsi.txt` | 200 `Microsoft NCSI` | 302 → `/corte` |
| Firefox | `detectportal.firefox.com/success.txt`, `/canonical.html` | 200 `success` | 302 → `/corte` |
| GNOME / NetworkManager | `nmcheck.gnome.org/check_network_status.txt` | 200 `NetworkManager is online` | 302 → `/corte` |
| Fedora | `fedoraproject.org/static/hotspot.txt` | 200 `OK` | 302 → `/corte` |
| Ubuntu | `connectivity-check.ubuntu.com/` y `/connectivity-check.html` | 204 | 302 → `/corte` |
| KDE | `networkcheck.kde.org/` | 200 `OK` | 302 → `/corte` (Host ajeno) |
| Kindle | `/kindle-wifi/wifistub.html`, `/kindle-wifi/wifiredirect.html` | 200 | 302 → `/corte` |
| Cualquier otra URL HTTP de un suspendido | | | 302 → `/corte` (Host ajeno) |

`/corte` responde 200 con HTML y no contiene ninguno de esos textos de éxito.

**URL de corte del operador** (`empresas.url_corte`, `contratos/control-velocidad.md` §10.6): antes del 302 el servidor del portal pregunta `GET /api/v1/portal/destino-corte` (con la IP del cliente) y, si la empresa del servicio tiene URL, el 302 va a ella. Sin URL, si la API falla o tarda más de 1,5 s, a `/corte`. Nunca un 204.

Para A6: ningún dominio de esta tabla puede estar en el walled garden; si lo estuviera, la sonda
llegaría al sitio real, recibiría su respuesta de éxito y el teléfono no avisaría.

Pruebas: `tests/nuxt/portal-cautivo.test.ts` (reglas puras, cada sonda) y
`tests/servidor/portal.test.ts` (servidor Nitro de producción: cada sonda con GET y HEAD,
con y sin URL pública).

## Cuando algo falla (piloto)

Regla: error claro con "Reintentar" y nunca montos, saldos ni estados calculados sobre datos que
no se pudieron leer. Pruebas en `tests/nuxt/robustez.test.ts` (fallas simuladas con
`fijarFallaFixture(ruta, respuesta | 'sin_conexion')`).

| Situación | Qué ve el cliente |
| --- | --- |
| La API no responde (el proxy de Nitro devuelve 502, o 504 a los 15 s) | problem+json en español ("No pudimos contactar al sistema…"), nunca el error genérico de h3 ni la URL interna |
| `quien-soy` falla (sin red, 5xx, 429) | "No pudimos consultar tu servicio" con el detalle (el 429 dice cuántos segundos esperar) y "Reintentar"; sin montos ni estado. Siguen "Ver datos de depósito" y el contacto (si `/portal/empresa` tampoco responde, "Contacta a soporte" lleva a `/contacto`) |
| Un error que no es problem+json (HTML de otro proxy) | Texto según el status (`aProblema`), no "Error inesperado" a secas |
| `/portal/estado` falla durante el estado en vivo | Sigue intentando cada 5 s; desde el 2.º fallo seguido avisa "No logramos consultar tu servicio"; al agotarse los 2 min dice "No pudimos consultar el estado de tu servicio" con "Reintentar", nunca "Aún no vemos tu servicio activo" |
| Seguimiento del pago en línea sin respuesta | Igual: no dice "Aún no recibimos la confirmación" si no se pudo leer |
| `quien-soy` con `monto_adeudado` o `facturas_vencidas` nulos | "No disponible"; nunca "Q 0.00" ni "Sin facturas vencidas" |
| Promesa, comprobante, pago y cuenta | Ya mostraban el `detail` y "Reintentar"; ahora el 502 del proxy llega con texto en español |

**IP no identificada** (otra red, datos móviles, IP fuera de `network.sesiones` y asignaciones):
"No pudimos identificar tu servicio", la IP de conexión, "Entrar con mi NIT o usuario" (`/entrar`),
datos de depósito y contacto. No se ofrecen "Pagar en línea", "Subir comprobante" ni "Solicitar
promesa": por IP la API respondería 422 `no_identificado` después de llenar el formulario. Con la
sesión se hacen desde `/cuenta`.

**Varios servicios**: por IP la página de corte muestra solo el servicio de esa IP y su deuda (lo
que hay que pagar para reactivarlo). En `/cuenta` cada servicio muestra su saldo; "Pagar en línea"
cobra un servicio, así que con dos o más servicios con saldo el cliente elige cuál en un selector
(con su monto). Pruebas de la API en `apps/api/tests/portal/varios_servicios.spec.ts`.

## Seguridad

Checklist completo en `docs/seguridad/portal.md`. En el portal:

| Pieza | Dónde |
| --- | --- |
| CSP por página con el hash de cada script en línea (sin `unsafe-inline` ni `unsafe-eval` en scripts, nada externo, `frame-ancestors 'none'`); sin `X-Powered-By` | `server/plugins/seguridad.ts`, `server/utils/cabecerasSeguridad.ts` |
| `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` en toda respuesta (también redirecciones y proxy) | `server/middleware/0-seguridad.ts` |
| El proxy no sale de `/api/v1/portal/` (`../` y `%2e%2e` → 404) | `destinoReenvio` en `server/utils/reenvioApi.ts` |
| POST/PUT/DELETE solo desde el mismo origen (`Origin` y `Sec-Fetch-Site`; si no, 403) | `origenPermitido` en `server/utils/reenvioApi.ts` |
| zod sin JIT (`new Function`), para no chocar con la CSP | `app/plugins/zod.ts` |

En desarrollo (`nuxt dev`) no se pone CSP: Vite necesita scripts propios.

## Guía para el ISP

`docs/piloto/portal-cliente.md`: qué ve un cliente cortado, promesa, comprobante, Telegram y dudas
frecuentes, con capturas a 390 px en `docs/piloto/img/` (build de producción con fixtures,
Chromium a 2×, PNG de 256 colores con tramado para que el aura no quede en bandas; menos de 150 KB cada una).

Los modales dejan margen a la derecha del título (`modal.slots.wrapper` en `app.config.ts`): a 390 px
la descripción pasaba por debajo del botón de cerrar.

## Pruebas

`pnpm test` corre dos tandas: `vitest.config.ts` (entorno `nuxt` con happy-dom, componentes y
composables contra los fixtures) y `vitest.servidor.config.ts` (`tests/servidor/`, entorno node:
compila el portal en `.nuxt/test/servidor` y lo levanta con una API falsa; unos 40 s).
`pnpm test:servidor` corre solo la segunda. El servidor se levanta con `servidorCon(env)`
(`tests/servidor/ayudas.ts`), no con `setup({ server: true })`: `startServer` elige un puerto libre y
lo suelta antes de que Nitro escuche, y con varias apps probando en paralelo otro proceso puede
tomarlo (`EADDRINUSE`). `servidorCon` reintenta con otro puerto (hasta 5 veces) y solo da por
arrancado el servidor cuando el que responde es el nuestro (su `Listening on …:<puerto>`). Nitro no
acepta `PORT=0` (`destr('0') || 3000`).

## Walled garden

La página de corte se abre con el servicio suspendido, así que todo sale de este servidor:

- `ui.fonts: false` (sin `@nuxt/fonts` ni Google Fonts): fuentes del sistema en `app/assets/css/main.css`.
- Iconos lucide locales (`@iconify-json/lucide`) empaquetados en el cliente; `fallbackToApi: false`,
  nunca `api.iconify.design`. Usa solo iconos `i-lucide-*`.
- Ningún CDN. Si agregas un dominio externo (pasarela, API), anótalo en `.claude/integration/a5.md` para A6.

## Página de corte `/corte`

| Pieza | Dónde |
| --- | --- |
| Identificación por IP: `GET /api/v1/portal/quien-soy` (`Schema<'QuienSoy'>` del contrato), solo en el navegador | `app/composables/useCorte.ts` |
| Título y texto según estado (`activo`, `limitado`, `suspendido`, `retirado`, `pendiente_instalacion`, no identificado) | `app/utils/corte.ts` |
| Monto adeudado, badge de estado, facturas vencidas (cantidad y total), promesa activa | `app/components/corte/ResumenDeuda.vue` |
| Datos de depósito: cuentas de A3 e instrucciones de pago del panel (`GET /portal/empresa`) | `app/components/corte/DatosDeposito.vue` |
| Acciones: "Pagar en línea" es la principal si hay pasarela (`pago_en_linea` de `GET /portal/empresa`); si no, se ve apagado en neutro y "Ver datos de depósito" pasa a primario; "Subir comprobante de pago"; "Solicitar promesa de pago" si el servicio está identificado, no activo y sin promesa activa; contacto por teléfono o correo | `app/pages/corte.vue` |
| Pago en línea: `POST /portal/pagos/iniciar` con `Idempotency-Key` (también en `/cuenta` con el servicio de la sesión); la pasarela devuelve al cliente a `/corte?pago=<id>&estado=pagado|fallido` (`url_retorno` con `PORTAL_URL_PUBLICA` de la API) y, por si no, antes de salir a `url_pago` la URL pasa a `/corte?pago=<id>` (retorno con "Atrás"; bfcache recarga). `estado=pagado` muestra "Tu pago fue aprobado" y `estado=fallido` "Tu pago no se completó" mientras el cobro siga pendiente; luego manda la API. En el retorno se sigue `GET /portal/pagos/en-linea/:id` cada 5 s junto con el estado: "Procesando tu pago…" → "Recibimos tu pago" → "Ya tienes servicio"; rechazado, vencido o 404 con error claro y "Entendido". Con un pago pendiente no se ofrece pagar otra vez, sino "Volver a la página de pago". Contrato en `.claude/integration/contratos/pago-en-linea.md` | `app/components/pago/EnLinea.vue`, `app/composables/usePagoEnLinea.ts`, `app/utils/pago.ts`, `app/plugins/retorno-pago.client.ts`, `app/components/corte/EstadoEnVivo.vue` |
| Estado en vivo: `GET /api/v1/portal/estado` cada 5 s hasta 2 min, tras una acción del cliente ("Ya pagué: revisar mi servicio"; luego comprobante, promesa y pago), al volver a la pestaña o con promesa activa. Al ver `activo`: "Ya tienes servicio" y "Seguir navegando" (`NUXT_PUBLIC_SEGUIR_NAVEGANDO_URL`) | `app/composables/useEstadoServicio.ts`, `app/components/corte/EstadoEnVivo.vue`, `app/components/corte/ServicioReactivado.vue` |
| Fixtures tipados contra el contrato (`?fixture=reactivacion` simula la reactivación; `?pago_fixture=pagado\|fallido\|expirado\|pendiente\|sin_pasarela` el pago en línea) | `fixtures/corte.ts`, `fixtures/pagos.ts` |

### Promesa de pago (tarea 4)

| Pieza | Dónde |
| --- | --- |
| Modal "Solicitar promesa de pago" (en `/corte` por IP y en `/cuenta` con `servicioId` y la sesión): al abrir lee `GET /portal/promesas/condiciones` y muestra los límites antes de enviar (plazo y fecha máxima, abono inicial con lo que falta, si requiere aprobación) y «Prometes pagar Q X (todo lo vencido)» con las facturas que cubre (`monto_promesa`, `facturas`); el cliente solo elige la fecha (prellenada con la máxima): no hay campo de monto. Sin nada vencido no se ofrece | `app/components/promesa/Solicitar.vue`, `useSolicitudPromesa` en `app/composables/usePromesas.ts` |
| `UForm` + zod espejo de `solicitarPromesaValidator` más los límites leídos de `limitesPromesa()` de A3 (fecha máxima y `pago_previo`: con abono inicial o deuda vencida sobre el máximo sin cubrir no deja enviar y explica cuánto pagar antes); la decisión es del backend; un 422 de la API queda en su campo | `app/utils/promesa.ts` |
| `POST /portal/promesas` con `Idempotency-Key` (UUID v4 con `getRandomValues`: `randomUUID` no existe por HTTP); la misma clave en el reintento de un envío sin respuesta, otra cuando la API respondió | `useSolicitudPromesa().solicitar`, `claveIdempotencia` |
| **Aprobada**: cierra el modal, aviso en la página y el estado en vivo hasta "Ya tienes servicio" (`/corte`); en `/cuenta` recarga la cuenta y dice "Ya tienes servicio" si el servicio quedó activo. **Rechazada**: el `motivo` de la API en palabras del cliente y "Cambiar fecha o monto". **Pendiente**: aviso en el modal y en la página; no ofrece otra | `app/pages/corte.vue`, `app/pages/cuenta.vue` |
| Fixtures: `?promesa=` (`aprobada`, `rechazada`, `rechazada_fecha`, `pendiente_aprobacion`, `con_promesa`, `con_pago_previo`, `sin_vencido`) (por defecto aprobada; `fijarPromesaFixture` en pruebas) | `fixtures/promesas.ts`, `fixtures/index.ts` |

Desde la IP solo se muestran nombre parcial, estado y montos; nunca datos personales completos.

### Servicio pendiente de instalación

Contrato `.claude/integration/contratos/instalacion.md` §3: un servicio vendido desde Iris nace `pendiente_instalacion` y se activa cuando el técnico cierra la instalación. El cliente ve «Instalación pendiente» (badge azul `info` con `i-lucide-calendar-clock`) y sus cargos únicos; nunca se muestra como cortado.

| Pieza | Dónde |
| --- | --- |
| Presentación del estado y `esPendienteInstalacion()`; urgencia: suspendido > limitado > activo > pendiente > retirado (igual que la API) | `app/utils/estadoServicio.ts`, `app/utils/empresas.ts` |
| `/corte`: «Tu instalación está pendiente», «Cargos pendientes» con el monto, sin facturas vencidas en rojo, sin promesa ni estado en vivo; pagar en línea, depósito y comprobante sí (abonan los cargos: «Lo abonamos a tus cargos», nunca «reactivando») | `app/pages/corte.vue`, `app/components/corte/ResumenDeuda.vue`, `app/components/corte/EstadoEnVivo.vue` |
| `/cuenta`: aviso «Tu instalación está pendiente» en la tarjeta del servicio con sus cargos pendientes (facturas pendientes de ese servicio: solo pueden ser cargos únicos); sin «Pedir promesa» ni aviso de reactivar | `app/components/cuenta/InicioEmpresa.vue`, `app/pages/cuenta.vue` |
| Fixtures: `?fixture=pendiente` en `/corte` y `?cuenta=pendiente` en `/cuenta` | `fixtures/corte.ts`, `fixtures/cuenta.ts` |

## Entrar con documento y contraseña, y «Ver mi cuenta» en `/corte`

Pedido del PM. Contrato y reglas en `apps/api/app/portal/README.md` § Acceso con documento y contraseña;
manual en `docs/manual/portal/acceso-con-contrasena.md`.

- `/entrar`: pestañas **Documento y contraseña** (por defecto, `POST /portal/entrar`) y **Código** (la de
  siempre; `?con=codigo`, y siempre con `?por_ip=1`). `?empresa=<id>` limita a esa empresa.
- Si entró con la contraseña de la empresa (`debe_cambiar_contrasena`), va a `/cambiar-contrasena`; la API
  responde 403 `cambio_contrasena_requerido` en todo lo demás y `/cuenta` lo trae de vuelta allí.
- `/cambiar-contrasena`: pide la actual, la nueva y su confirmación. También desde **Cuenta**.
- `/corte`: el acceso «Ver mi cuenta» (`data-testid="ver-mi-cuenta"`) llama `POST /portal/corte/sesion` y
  pasa a `/cuenta`, sin pedir nada. Si la API ya no identifica la conexión, ofrece entrar con documento o código.
- Fixtures: documento `12345679`, contraseña propia `MiClave2026`; `/entrar?contrasena=defecto` simula un
  cliente que aún usa la de la empresa (`Bienvenido2026`).
- Pruebas: `tests/nuxt/contrasena.test.ts` y `tests/e2e/acceso.spec.ts` (axe, claro y oscuro, 390 y 1280 px).

## Peso de la página de corte

Al suspendido se le limita la velocidad, así que lo que baja `/corte` importa. Medido con Chromium a 390 px
contra el servidor de producción (`node .output/server/index.mjs`), sumando cada archivo del mismo origen
(gzip 9 y brotli 11 calculados del archivo servido):

| | Archivos | Sin comprimir | gzip | brotli |
| --- | --- | --- | --- | --- |
| Antes (v1.19.0) | 36 | 1 231 KB | 360 KB | 310 KB |
| Ahora | 37 | 735 KB | 234 KB | 205 KB |

Qué se hizo:

- **`nitro.compressPublicAssets`** (gzip y brotli): `.gz` y `.br` junto a cada archivo de `_nuxt/` y `public/`;
  Nitro los sirve según `Accept-Encoding`. El HTML es dinámico: lo comprime el Caddy (`encode`, A6).
- **Fixtures fuera del bundle**: `plugins/api.ts` los importa de forma diferida y solo en modo fixtures
  (antes ~150 KB iban en toda página de producción).
- **Sin `prefetch` de chunks diferidos** (gancho `build:manifest` en `nuxt.config.ts`): el navegador ya no baja
  en segundo plano formularios, zod ni fixtures mientras carga `/corte`.
- **zod solo con los formularios**: `~/lib/zod` (con `jitless`, antes un plugin global) y los esquemas en
  `utils/promesaEsquema.ts` y `utils/comprobanteEsquema.ts`; `utils/promesa.ts` y `utils/comprobante.ts`
  (que `/corte` usa) ya no importan zod.
- **Modales de `/corte` diferidos** (`LazyPromesaSolicitar`, `LazyComprobanteSubir`, `LazyCorteDatosDeposito`,
  montados al abrirse la primera vez) y **carrusel de promociones diferido** (`LazyPromoCarrusel`: embla solo
  con dos o más promociones).
- **CSS solo de los componentes usados** (`ui.experimental.componentDetection`): 197 KB → 105 KB (27 → 16 KB gzip).
- Iconos: el bundle de cliente lleva solo los lucide usados (~31 KB, 5 KB gzip); sin fuentes externas.

Lo que queda (~165 KB gzip) es la base que toda página necesita para hidratar: Vue + Nuxt + Iconify
(76 KB), router + `UApp` + toasts de reka (44 KB), tailwind-merge/variants de Nuxt UI (23 KB) y decimal.js
(14 KB; la regla del repositorio lo pide para dinero). Bajar de ~150 KB exigiría una `/corte` sin Vue (HTML
del servidor sin hidratar), que hoy no puede pedir promesas ni subir comprobantes.

## Mi cuenta: entrada con código (`/entrar`) y portal autenticado (`/cuenta`)

| Pieza | Dónde |
| --- | --- |
| Pide el código con NIT/CUI o usuario de conexión, o por IP desde `/corte` (`/entrar?por_ip=1`, botón "Ver mis facturas y pagos"); código de 6 dígitos con `UPinInput` | `app/pages/entrar.vue`, `app/composables/useAccesoPortal.ts` |
| La API pone la cookie httpOnly `argos_portal` (ruta `/api/v1/portal`): el portal nunca ve el token. Todo se consulta en el navegador (`server: false`) | `app/composables/useCuenta.ts` |
| Saldo, servicios y pestañas: facturas, pagos, promesas (solo lectura) y mis datos; sin sesión manda a `/entrar`; errores con "Reintentar", sin montos inventados | `app/pages/cuenta.vue`, `app/components/cuenta/*` |
| Listas por cursor con "Ver más" (un composable por recurso) | `useListaCursor`, `useFacturas`, `usePagos`, `usePromesas` |
| Correo, teléfonos y canal preferido con `UForm` + zod (espejo de `editarContactoValidator`), 409 si cambió la `version`; Telegram deshabilitado hasta vincularlo (semana 2) | `app/components/cuenta/Contacto.vue`, `useContacto` |
| "Ver aviso de cobro (PDF)" en cada factura: enlace a `/api/v1/portal/facturas/:id/pdf` en el mismo origen (la API genera el PDF; la cookie viaja sola) | `app/components/cuenta/Facturas.vue`, `useFacturas().urlPdf` |
| FEL: «Factura» (o «Nota de débito») solo con el DTE certificado, autorización y fecha, "Descargar XML" (`/api/v1/portal/facturas/:id/xml`), «Sustituida» con la factura que la reemplaza, anulación en trámite o ante la SAT, notas de crédito (PDF con la marca de la empresa; NCRE con su XML; anuladas como tales) | `app/components/cuenta/Facturas.vue`, `app/components/cuenta/NotasCredito.vue`, `useNotasCredito` |
| Fixtures: el código correcto es `123456`; la sesión es un estado en memoria (`fijarSesionFixture` en pruebas) | `fixtures/cuenta.ts`, `fixtures/index.ts` |

Dependencia nueva: `zod` (misma versión que `apps/web`) para los esquemas de `UForm`.

### Telegram en "Mis datos" (semana 2)

Contrato de A6 en `.claude/integration/contratos/telegram.md`. "Vincular Telegram" pide el código
(`POST /portal/telegram/vincular`), ofrece "Abrir Telegram" (`t.me/<bot>?start=<código>`) y de respaldo
`/start <código>`, y consulta `GET /portal/telegram` cada 3 s hasta ver "Vinculado" o hasta que venza.
Tras recargar sigue esperando (solo `vence_en` en `sessionStorage`, nunca el código). Desvincular pide
confirmación. Telegram como canal preferido solo se habilita con el chat vinculado.

### Avisos por WhatsApp en "Mi cuenta" (contrato Iris 0.6.0 §6.4)

`CuentaWhatsapp` (`app/components/cuenta/Whatsapp.vue`, `useWhatsapp`): casilla «Acepto recibir avisos
por WhatsApp» (`UForm` + zod, espejo de `registrarWhatsappValidator`) solo si la API dice `visible`
(WhatsApp encendido para la empresa). La casilla siempre muestra lo que respondió la API: al cambiarla
manda `POST /portal/whatsapp` con `Idempotency-Key` y toma el estado de la respuesta. Una baja dada en el
chat de Iris se explica. Conector Iris apagado, error al leer, error al guardar o entrega fallida a Iris:
alerta con «Reintentar» y, si no se pudo leer, ninguna casilla ni estado. Fixtures:
`?whatsapp=nuevo|acepta|baja_iris|apagado|sin_conector|fallido`. Pruebas en `tests/nuxt/whatsapp.test.ts`.

### Promesa rechazada

"Cambiar fecha o monto" aparece solo si `corregible` (la regla fue el plazo o la próxima factura); por
cupo, historial o deuda se ofrece "Contactar a la oficina".

## Accesibilidad

- Controles de al menos 44 × 44 px: `min-h-11 min-w-11` en `UButton`, `min-h-11` en `UInput`, `USelect`
  y `USelectMenu`, casillas del código de 44 px (`app.config.ts`); el logo y el enlace del pie también.
- Contraste 4.5:1 en claro y oscuro: en claro los colores semánticos usan los tonos 700–800 y
  `text-dimmed` el zinc-500; en oscuro, los 300–400 (`assets/css/main.css`).
- Foco visible: `outline` de 2 px del color primario en todo `:focus-visible`.
- Preferencias del sistema: menos movimiento (sin deriva del aura ni animaciones), menos transparencia
  (vidrio y modales sólidos, sin aura) y más contraste (texto atenuado más fuerte, bordes marcados, sin halos).
- Revisión automática con Playwright (tamaño de toque, nombre accesible, contraste de texto y foco con
  Tab) en `/corte`, `/entrar`, el paso del código y los modales de promesa, depósito y comprobante.

## Sistema visual (índigo eléctrico)

Rediseño pedido por el PM: interfaz amigable, coherente y con iconos. Marca **índigo eléctrico** (primario
`#4F46E5` en claro, `#818CF8` en oscuro) con el degradado índigo → cian como acento; fondo gris muy claro
(`#F8F9FA`) o azul noche (`#0B0F1A`); tarjetas blancas de radio 12 px con borde de 1 px y casi sin sombra.
Se construye sobre Nuxt UI: tokens propios `--ax-*` (los mismos nombres que el panel), el `ui` de
`app.config.ts` y componentes compartidos. Nunca colores crudos de Tailwind en los componentes.

| Pieza | Dónde |
| --- | --- |
| Tokens `--ax-*` por modo (fondo, tarjeta, borde, radios, sombras, marca, degradados, cabecera de tabla), AA y las preferencias del sistema | `app/assets/css/main.css` |
| Nuxt UI tematizado: botón primario en pastilla, badges en pastilla, pestañas tipo segmento, campos, tarjetas, tabla, modal (hoja inferior < 640 px), drawer, menú, toast, alerta, esqueleto | `app/app.config.ts` |
| Pastilla de icono tintada por tono (`PortalPastilla`, `.ax-pastilla[data-tono]`) | `components/portal/Pastilla.vue` |
| Lista que en escritorio es tabla (`PortalLista` + `PortalFila`, grilla `.ax-grilla`): icono, título, subtítulo gris, monto en negrita, estado con icono, acciones; cabecera en mayúsculas pequeñas solo desde 768 px | `components/portal/Lista.vue`, `Fila.vue` |
| Drawer de detalle (factura, pago, comprobante) sin salir de la lista; desde abajo en el teléfono | `components/portal/Detalle.vue` |
| Indicador del tablero (`PortalKpi`) y banner de bienvenida con degradado (`CuentaResumen`) | `components/portal/Kpi.vue`, `components/cuenta/Resumen.vue` |
| Título de modal con pastilla de icono según el tipo | `components/portal/TituloModal.vue` |
| Ayudas `?` con texto del manual (promesa, vencimiento, puntos, comprobante), cursor `help` | `components/portal/Ayuda.vue`, `utils/ayudas.ts` |
| Login dividido (panel con degradado y frase en escritorio; logo y formulario en el teléfono) | `components/portal/Acceso.vue` |
| Pista de los botones de solo icono, solo CSS (`.ax-pista` + `data-pista`) | `app/assets/css/main.css` |
| Marca de ArgosIsp: cuadro con el degradado índigo-600 → cyan-700, radio 7/32, trazo blanco | `components/LogoArgos.vue`, `public/favicon.svg`, `public/iconos/` |

**Texto sobre el degradado.** El acento (`--ax-gradiente`, índigo → cian) nunca lleva texto encima. Donde
hay texto blanco (banner de `/cuenta`, inicio público, panel del login) se usa `--ax-gradiente-texto`,
que termina en cyan-700: el blanco pasa 4,5:1 en todo el recorrido. La acción sobre el banner es una
pastilla blanca con texto índigo-700.

**Iconos.** Todo botón, opción de menú, pestaña y estado lleva icono Lucide + texto, y la misma acción
usa siempre el mismo icono, coloreado por intención: pagar = `credit-card`, subir comprobante =
`upload`, prometer pago = `calendar-check`, factura = `receipt`, puntos = `gem`, cuenta = `user-round`,
depósito = `landmark`, soporte = `headset`. Los botones de solo icono llevan `aria-label` y pista.

**Cursores.** `pointer` en todo lo que se toca, `not-allowed` en lo deshabilitado, `progress` en un botón
que procesa, `text` en los campos. Con `data-cursor`: `help` (ayudas `?`), `copy` (número de cuenta,
referencia, autorización), `zoom-in` (foto del comprobante), `grab` (zona de soltar el archivo).

**Movimiento.** Discreto y siempre apagado con `prefers-reduced-motion`: entrada de la página (0,22 s),
cambio de sección, tarjetas que suben 1 px al pasar el puntero, botones que se hunden al tocarlos, el
punto «En vivo» que late y la hoja inferior que sube.

### Modal, drawer o página propia

Criterio del PM: una ventana solo para confirmar o pedir de 1 a 4 datos; lo demás es acción directa,
drawer o página. Nunca un modal sobre otro; en el teléfono los modales son hoja inferior.

| Superficie | Cuándo | En el portal |
| --- | --- | --- |
| Acción directa | No hay nada que preguntar | Actualizar, descargar PDF o XML, copiar número de cuenta, salir |
| Modal (hoja inferior en 390 px) | Confirmar o pedir 1–4 datos | Prometer pago (una fecha), confirmar canje, datos de depósito (consulta corta), foto ampliada del comprobante |
| Drawer | Ver el detalle de algo de una lista sin perder la lista | Factura (montos, DTE, XML), pago, comprobante |
| Página propia (con URL) | Formularios largos, archivos, acceso, todo lo que se comparte o se vuelve a abrir | `/entrar`, `/cambiar-contrasena`, `/comprobante` (subir comprobante con vista previa y arrastrar y soltar), pagar en línea (sección `?seccion=pagar` y la pasarela), estado de cuenta y facturas (`/cuenta?seccion=…`) |

`/comprobante` recibe `servicio`, `empresa` y `volver` (`/corte` o `/cuenta?seccion=pagar`); al volver a
`/corte`, el comprobante enviado queda en `useComprobanteEnviado` y la página muestra «Recibimos tu
comprobante» y vigila la reactivación como antes.

### Peso de `/corte`

El sistema visual no agrega fuentes ni imágenes a `/corte` (pila de fuentes del sistema; Inter no se
carga). Ver la tabla de «Peso de la página de corte».

## Inicio del cliente (dashboard móvil) y PWA

| Pieza | Dónde |
| --- | --- |
| `/cuenta?seccion=inicio\|pagar\|facturas\|cuenta`: secciones en la URL ("Atrás" vuelve), transición corta apagada con movimiento reducido | `app/pages/cuenta.vue`, `app/utils/navegacion.ts` |
| Barra inferior de vidrio con sesión (móvil, destinos de 56 × 44 px, `env(safe-area-inset-bottom)` con `viewport-fit=cover`) y barra de secciones centrada en escritorio | `app/components/portal/Navegacion.vue`, `app/layouts/default.vue` |
| Encabezado compacto: total, estado más urgente y "Actualizar" | `app/components/cuenta/Resumen.vue` |
| Jalar para actualizar sin dependencias (touch pasivo; "Actualizar" es la alternativa de un toque) | `app/composables/useJalarParaActualizar.ts`, `app/components/portal/JalarParaActualizar.vue` |
| Accesos rápidos: solo lo que la API aceptaría ahora (tabla en el archivo) | `app/utils/accesos.ts`, `app/components/portal/AccesosRapidos.vue` |
| Servicios agrupados por la empresa que los factura (`servicio.empresa`), la principal primero | `app/utils/empresas.ts`, `app/components/cuenta/InicioEmpresa.vue` |
| ¿Hay sesión? Estado compartido + pista `argos:portal:sesion` en `localStorage` (solo `1`): `/corte` pregunta por la cuenta solo si hubo sesión en el dispositivo | `app/composables/useSesionPortal.ts` |
| Manifiesto PWA (`standalone`, índigo `#4f46e5`, nombre de la empresa principal del cliente con `?empresa=<id>` desde `/cuenta`, o el configurado), íconos de la marca; sin service worker | `server/routes/manifest.webmanifest.get.ts`, `server/utils/manifiesto.ts`, `public/iconos/` |

Los íconos PNG salen de la marca (`LogoArgos`): cuadro redondeado para `any` y fondo a sangre con el
ojo en la zona segura para `maskable` y `apple-touch-icon`. El manifiesto y `/iconos/` se sirven
también con Host ajeno (portal cautivo) y la CSP lleva `manifest-src 'self'`.

## Multiempresa: la marca de la empresa de cada servicio

Contrato: `.claude/integration/contratos/multiempresa.md` § Marca.

| Qué | Dónde |
| --- | --- |
| Encabezado: en `/cuenta` la empresa principal del cliente (`de=cliente`); en `/corte` y el resto, la que decide la API (la del servicio de la IP, luego la principal de la sesión, luego la configurada). Logo de `logo_url` o, sin él, el ojo de ArgosIsp | `app/layouts/default.vue`, `app/components/portal/MarcaEmpresa.vue` |
| Una empresa: sin secciones de marca. Varias: una sección por empresa con su logo (o sus iniciales), nombre y NIT | `app/components/cuenta/InicioEmpresa.vue` |
| Accesos de cada sección (pagar, comprobante, depósito, soporte) con los datos de SU empresa (`useEmpresa({ empresaId })`), nunca mezclados; el modal de depósito y el de comprobante reciben `empresa-id` | `app/pages/cuenta.vue`, `app/components/corte/DatosDeposito.vue`, `app/components/comprobante/Subir.vue`, `app/components/pago/EnLinea.vue` |
| Sección Pagar: cada servicio dice de qué empresa es; depósito y pago en línea de la empresa del servicio elegido | `app/pages/cuenta.vue` |
| `/contacto?empresa=<id>`: contacto de esa empresa (el soporte sin teléfono de una sección) | `app/pages/contacto.vue` |
| Título y manifiesto con la empresa principal del cliente | `app/pages/cuenta.vue`, `server/routes/manifest.webmanifest.get.ts` |
| Fixtures: `MARCA_FIXTURE`, `MARCA_SUR_FIXTURE`, `EMPRESA_SUR_FIXTURE`, `CUENTA_DOS_EMPRESAS_FIXTURE` (`?cuenta=dos_empresas` en desarrollo) | `fixtures/` |
| `/cuenta`: saldo y facturas pendientes de cada empresa (`PortalCuenta.empresas`, el estado de cuenta de A3); una empresa con deuda y sin servicios también tiene su sección | `agruparPorEmpresa(servicios, principal, secciones)`, `resumenFacturas` en `app/utils/empresas.ts` |
| Telegram por empresa: con servicios en varias, una tarjeta por empresa (`CuentaTelegram` con `empresa`) que vincula el bot de esa empresa (`empresa_id`); el acceso "Vincular Telegram" de cada grupo lleva a su tarjeta (`#telegram-<id>`) | `app/components/cuenta/Telegram.vue`, `app/composables/useTelegram.ts` |
| Comprobante a la cuenta de otra empresa (422 `cuenta_de_otra_empresa`): aviso arriba y campo marcado. Pago en línea de varias empresas (422 `pago_de_varias_empresas`): "Cada empresa se paga por separado" | `app/components/comprobante/Subir.vue`, `app/components/pago/EnLinea.vue` |
| Pruebas | `tests/nuxt/multiempresa.test.ts`, `tests/nuxt/telegram.test.ts`; axe en `tests/e2e/accesibilidad.spec.ts` |

`useEmpresa` guarda una consulta por empresa (`portal:empresa:<id>`, `portal:empresa:cliente` y
`portal:empresa`); en pruebas se limpian con `clearNuxtData(clave => clave.startsWith('portal:empresa'))`.

## Datos de la empresa y contacto (configurables desde el panel)

| Pieza | Dónde |
| --- | --- |
| `GET /api/v1/portal/empresa` una vez por empresa (claves `portal:empresa*`), solo en el navegador; el nombre de `NUXT_PUBLIC_EMPRESA_NOMBRE` solo mientras carga | `app/composables/useEmpresa.ts` |
| Encabezado y pie con el nombre y el teléfono; el pie lleva a `/contacto` | `app/layouts/default.vue` |
| `/contacto`: teléfonos (`tel:`), WhatsApp (`wa.me`, no funciona con el servicio suspendido), correo, horario y oficina; error con "Reintentar" | `app/pages/contacto.vue`, `app/utils/contacto.ts` |
| `/corte`: "Llamar a soporte" con el teléfono configurado (si no hay, a `/contacto`); "Ver datos de depósito" se oculta si no hay cuentas ni instrucciones | `app/pages/corte.vue` |
| Datos de depósito: cuentas activas de `billing.cuentas_bancarias` (A3) e instrucciones de pago; sin cuentas no hay sección | `app/components/corte/DatosDeposito.vue` |
| Fixtures | `fixtures/empresa.ts` (`fijarEmpresaFixture` en pruebas) |

`NUXT_PUBLIC_EMPRESA_TELEFONO`, `NUXT_PUBLIC_EMPRESA_CORREO` y `NUXT_PUBLIC_DEPOSITO_*` ya no existen.

## Políticas públicas para Meta (`/privacidad`, `/terminos`, `/eliminar-datos`)

Las URLs que pide la revisión de apps de Meta (WhatsApp Business). Públicas, sin sesión, y
**renderizadas en el servidor** con el texto completo y la empresa responsable en el HTML (el
revisor y su rastreador no ejecutan JavaScript). Manual: `docs/manual/portal/politicas-meta.md`.

| Pieza | Dónde |
| --- | --- |
| La empresa se lee en el servidor antes de renderizar, con la IP de origen y la cookie (mismas cabeceras que el proxy, nunca sin IP); corre después de `portal-cautivo.ts`, así un Host ajeno sale con su 302 a `/corte` sin llamar a la API | `server/middleware/responsable-politicas.ts`, `server/utils/politicas.ts` |
| Qué empresa: `?empresa=<id>`, o la que decide la API (la del servicio de la IP, la principal del cliente de la sesión o la principal de la instalación: la que ve el revisor de Meta) | `app/composables/usePoliticas.ts` |
| Responsable: `razon_social` (nombre legal), nombre comercial, NIT, dirección, correo, teléfonos y horario; lo que falta no se inventa y se remite a `/contacto` | `app/components/politica/Responsable.vue` |
| Si la API no responde: 200 con el texto y un aviso con "Reintentar" | `app/components/politica/Pagina.vue` |
| Versión, vigencia y plazo de respuesta (30 días): al cambiar el texto, sube la versión y la fecha | `app/utils/politicas.ts` |
| Enlaces en el pie de todas las páginas, `/corte` incluida (enlaces internos, sin recursos externos) | `app/layouts/default.vue` |
| Pruebas: HTML del servidor (`tests/servidor/portal.test.ts`), axe y 390/1280 px en claro y oscuro (`tests/e2e/accesibilidad.spec.ts`) | |

## Lo que deja el día 1

| Pieza | Dónde |
| --- | --- |
| Cliente HTTP único con `credentials: 'include'` (cookie httpOnly, sin Bearer) | `app/utils/clienteApi.ts`, `app/plugins/api.ts`, `useApi()` |
| Layout con encabezado de la empresa y pie | `app/layouts/default.vue` |
| Fixtures y `fetch` falso | `fixtures/`, `app/utils/fetchFixtures.ts` |
| Formato de fechas (America/Guatemala) y quetzales; `EstadoServicioBadge` | `app/utils/`, `app/components/` |

## Accesibilidad (axe en navegador)

`pnpm --filter @argosisp/portal test:e2e` (Playwright, navegadores de `PLAYWRIGHT_BROWSERS_PATH`)
levanta el portal en modo fixtures y pasa axe (WCAG 2.1 A/AA, contraste incluido) por `/corte`,
`/entrar`, `/contacto` y las cuatro secciones de `/cuenta` (una empresa y `?cuenta=dos_empresas`),
en claro y oscuro, a 390 px y 1280 px. Dependencias de desarrollo: `@playwright/test` 1.56.1 y
`@axe-core/playwright` 4.11.0 (las mismas versiones que `apps/web`). `?cuenta=dos_empresas` se
recuerda en la pestaña (`sessionStorage`) para que siga después de entrar con el código.
