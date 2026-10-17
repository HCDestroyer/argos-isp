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
| Samsung, Xiaomi, Huawei | `connect.rom.miui.com/generate_204` y equivalentes | 204 | 302 → `/corte` |
| Huawei / Honor antiguos | `/mobile/status.php` | 204 | 302 → `/corte` |
| iOS, iPadOS, macOS | `captive.apple.com/hotspot-detect.html`, `www.apple.com/library/test/success.html` | 200 con `<TITLE>Success</TITLE>` | 302 → `/corte` |
| Windows 10 / 11 | `www.msftconnecttest.com/connecttest.txt` | 200 `Microsoft Connect Test` | 302 → `/corte` |
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
Chromium, PNG de 128 colores; menos de 60 KB cada una).

Los modales dejan margen a la derecha del título (`modal.slots.wrapper` en `app.config.ts`): a 390 px
la descripción pasaba por debajo del botón de cerrar.

## Pruebas

`pnpm test` corre dos tandas: `vitest.config.ts` (entorno `nuxt` con happy-dom, componentes y
composables contra los fixtures) y `vitest.servidor.config.ts` (`tests/servidor/`, entorno node:
compila el portal en `.nuxt/test/servidor` y lo levanta con una API falsa; unos 40 s).
`pnpm test:servidor` corre solo la segunda.

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
| Título y texto según estado (`activo`, `limitado`, `suspendido`, `retirado`, no identificado) | `app/utils/corte.ts` |
| Monto adeudado, badge de estado, facturas vencidas (cantidad y total), promesa activa | `app/components/corte/ResumenDeuda.vue` |
| Datos de depósito: cuentas de A3 e instrucciones de pago del panel (`GET /portal/empresa`) | `app/components/corte/DatosDeposito.vue` |
| Acciones: "Pagar en línea" es la principal si hay pasarela (`pago_en_linea` de `GET /portal/empresa`); si no, se ve apagado en neutro y "Ver datos de depósito" pasa a primario; "Subir comprobante de pago"; "Solicitar promesa de pago" si el servicio está identificado, no activo y sin promesa activa; contacto por teléfono o correo | `app/pages/corte.vue` |
| Pago en línea: `POST /portal/pagos/iniciar` con `Idempotency-Key` (también en `/cuenta` con el servicio de la sesión); la pasarela devuelve al cliente a `/corte?pago=<id>&estado=pagado|fallido` (`url_retorno` con `PORTAL_URL_PUBLICA` de la API) y, por si no, antes de salir a `url_pago` la URL pasa a `/corte?pago=<id>` (retorno con "Atrás"; bfcache recarga). `estado=pagado` muestra "Tu pago fue aprobado" y `estado=fallido` "Tu pago no se completó" mientras el cobro siga pendiente; luego manda la API. En el retorno se sigue `GET /portal/pagos/en-linea/:id` cada 5 s junto con el estado: "Procesando tu pago…" → "Recibimos tu pago" → "Ya tienes servicio"; rechazado, vencido o 404 con error claro y "Entendido". Con un pago pendiente no se ofrece pagar otra vez, sino "Volver a la página de pago". Contrato en `.claude/integration/contratos/pago-en-linea.md` | `app/components/pago/EnLinea.vue`, `app/composables/usePagoEnLinea.ts`, `app/utils/pago.ts`, `app/plugins/retorno-pago.client.ts`, `app/components/corte/EstadoEnVivo.vue` |
| Estado en vivo: `GET /api/v1/portal/estado` cada 5 s hasta 2 min, tras una acción del cliente ("Ya pagué: revisar mi servicio"; luego comprobante, promesa y pago), al volver a la pestaña o con promesa activa. Al ver `activo`: "Ya tienes servicio" y "Seguir navegando" (`NUXT_PUBLIC_SEGUIR_NAVEGANDO_URL`) | `app/composables/useEstadoServicio.ts`, `app/components/corte/EstadoEnVivo.vue`, `app/components/corte/ServicioReactivado.vue` |
| Fixtures tipados contra el contrato (`?fixture=reactivacion` simula la reactivación; `?pago_fixture=pagado\|fallido\|expirado\|pendiente\|sin_pasarela` el pago en línea) | `fixtures/corte.ts`, `fixtures/pagos.ts` |

### Promesa de pago (tarea 4)

| Pieza | Dónde |
| --- | --- |
| Modal "Solicitar promesa de pago" (en `/corte` por IP y en `/cuenta` con `servicioId` y la sesión): al abrir lee `GET /portal/promesas/condiciones` y muestra los límites antes de enviar (plazo y fecha máxima, monto máximo, abono inicial, si requiere aprobación); prellena la fecha máxima y el saldo vencido | `app/components/promesa/Solicitar.vue`, `useSolicitudPromesa` en `app/composables/usePromesas.ts` |
| `UForm` + zod espejo de `solicitarPromesaValidator` más los límites leídos de `limitesPromesa()` de A3 (fecha máxima, monto máximo y `pago_previo`: con abono inicial o deuda vencida sobre el máximo sin cubrir no deja enviar y explica cuánto pagar antes); la decisión es del backend; un 422 de la API queda en su campo | `app/utils/promesa.ts` |
| `POST /portal/promesas` con `Idempotency-Key` (UUID v4 con `getRandomValues`: `randomUUID` no existe por HTTP); la misma clave en el reintento de un envío sin respuesta, otra cuando la API respondió | `useSolicitudPromesa().solicitar`, `claveIdempotencia` |
| **Aprobada**: cierra el modal, aviso en la página y el estado en vivo hasta "Ya tienes servicio" (`/corte`); en `/cuenta` recarga la cuenta y dice "Ya tienes servicio" si el servicio quedó activo. **Rechazada**: el `motivo` de la API en palabras del cliente y "Cambiar fecha o monto". **Pendiente**: aviso en el modal y en la página; no ofrece otra | `app/pages/corte.vue`, `app/pages/cuenta.vue` |
| Fixtures: `?promesa=` (`aprobada`, `rechazada`, `pendiente_aprobacion`, `con_promesa`, `con_pago_previo`) (por defecto aprobada; `fijarPromesaFixture` en pruebas) | `fixtures/promesas.ts`, `fixtures/index.ts` |

Desde la IP solo se muestran nombre parcial, estado y montos; nunca datos personales completos.

## Mi cuenta: entrada con código (`/entrar`) y portal autenticado (`/cuenta`)

| Pieza | Dónde |
| --- | --- |
| Pide el código con NIT/CUI o usuario de conexión, o por IP desde `/corte` (`/entrar?por_ip=1`, botón "Ver mis facturas y pagos"); código de 6 dígitos con `UPinInput` | `app/pages/entrar.vue`, `app/composables/useAccesoPortal.ts` |
| La API pone la cookie httpOnly `argos_portal` (ruta `/api/v1/portal`): el portal nunca ve el token. Todo se consulta en el navegador (`server: false`) | `app/composables/useCuenta.ts` |
| Saldo, servicios y pestañas: facturas, pagos, promesas (solo lectura) y mis datos; sin sesión manda a `/entrar`; errores con "Reintentar", sin montos inventados | `app/pages/cuenta.vue`, `app/components/cuenta/*` |
| Listas por cursor con "Ver más" (un composable por recurso) | `useListaCursor`, `useFacturas`, `usePagos`, `usePromesas` |
| Correo, teléfonos y canal preferido con `UForm` + zod (espejo de `editarContactoValidator`), 409 si cambió la `version`; Telegram deshabilitado hasta vincularlo (semana 2) | `app/components/cuenta/Contacto.vue`, `useContacto` |
| "Ver aviso de cobro (PDF)" en cada factura: enlace a `/api/v1/portal/facturas/:id/pdf` en el mismo origen (la API genera el PDF; la cookie viaja sola) | `app/components/cuenta/Facturas.vue`, `useFacturas().urlPdf` |
| Fixtures: el código correcto es `123456`; la sesión es un estado en memoria (`fijarSesionFixture` en pruebas) | `fixtures/cuenta.ts`, `fixtures/index.ts` |

Dependencia nueva: `zod` (misma versión que `apps/web`) para los esquemas de `UForm`.

### Telegram en "Mis datos" (semana 2)

Contrato de A6 en `.claude/integration/contratos/telegram.md`. "Vincular Telegram" pide el código
(`POST /portal/telegram/vincular`), ofrece "Abrir Telegram" (`t.me/<bot>?start=<código>`) y de respaldo
`/start <código>`, y consulta `GET /portal/telegram` cada 3 s hasta ver "Vinculado" o hasta que venza.
Tras recargar sigue esperando (solo `vence_en` en `sessionStorage`, nunca el código). Desvincular pide
confirmación. Telegram como canal preferido solo se habilita con el chat vinculado.

### Promesa rechazada

"Cambiar fecha o monto" aparece solo si `corregible` (la regla fue el plazo o la próxima factura); por
cupo, historial o deuda se ofrece "Contactar a la oficina".

## Accesibilidad

- Controles de al menos 44 × 44 px: `min-h-11 min-w-11` en `UButton`, `min-h-11` en `UInput`, `USelect`
  y `USelectMenu`, casillas del código de 44 px (`app.config.ts`); el logo y el enlace del pie también.
- Contraste 4.5:1 en claro y oscuro: en claro los colores semánticos usan el tono 700 (verde 800) y
  `text-dimmed` el slate-500; en oscuro, los 400 (`assets/css/main.css`).
- Foco visible: el anillo de Nuxt UI en controles y un `outline` del color primario en enlaces.
- Revisión automática con Playwright (tamaño de toque, nombre accesible, contraste de texto y foco con
  Tab) en `/corte`, `/entrar`, el paso del código y los modales de promesa, depósito y comprobante.

## Datos de la empresa y contacto (configurables desde el panel)

| Pieza | Dónde |
| --- | --- |
| `GET /api/v1/portal/empresa` una sola vez (clave `portal:empresa`), solo en el navegador; el nombre de `NUXT_PUBLIC_EMPRESA_NOMBRE` solo mientras carga | `app/composables/useEmpresa.ts` |
| Encabezado y pie con el nombre y el teléfono; el pie lleva a `/contacto` | `app/layouts/default.vue` |
| `/contacto`: teléfonos (`tel:`), WhatsApp (`wa.me`, no funciona con el servicio suspendido), correo, horario y oficina; error con "Reintentar" | `app/pages/contacto.vue`, `app/utils/contacto.ts` |
| `/corte`: "Llamar a soporte" con el teléfono configurado (si no hay, a `/contacto`); "Ver datos de depósito" se oculta si no hay cuentas ni instrucciones | `app/pages/corte.vue` |
| Datos de depósito: cuentas activas de `billing.cuentas_bancarias` (A3) e instrucciones de pago; sin cuentas no hay sección | `app/components/corte/DatosDeposito.vue` |
| Fixtures | `fixtures/empresa.ts` (`fijarEmpresaFixture` en pruebas) |

`NUXT_PUBLIC_EMPRESA_TELEFONO`, `NUXT_PUBLIC_EMPRESA_CORREO` y `NUXT_PUBLIC_DEPOSITO_*` ya no existen.

## Lo que deja el día 1

| Pieza | Dónde |
| --- | --- |
| Cliente HTTP único con `credentials: 'include'` (cookie httpOnly, sin Bearer) | `app/utils/clienteApi.ts`, `app/plugins/api.ts`, `useApi()` |
| Layout con encabezado de la empresa y pie | `app/layouts/default.vue` |
| Fixtures y `fetch` falso | `fixtures/`, `app/utils/fetchFixtures.ts` |
| Formato de fechas (America/Guatemala) y quetzales; `EstadoServicioBadge` | `app/utils/`, `app/components/` |
