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
| Acciones: "Ver datos de depósito" es la principal (primario) mientras no hay pago en línea; "Pagar en línea" apagado en neutro con "Pronto" hasta la semana 2; comprobante deshabilitado (siguiente tanda); "Solicitar promesa de pago" si el servicio está identificado, no activo y sin promesa activa; contacto por teléfono o correo | `app/pages/corte.vue` |
| Estado en vivo: `GET /api/v1/portal/estado` cada 5 s hasta 2 min, tras una acción del cliente ("Ya pagué: revisar mi servicio"; luego comprobante, promesa y pago), al volver a la pestaña o con promesa activa. Al ver `activo`: "Ya tienes servicio" y "Seguir navegando" (`NUXT_PUBLIC_SEGUIR_NAVEGANDO_URL`) | `app/composables/useEstadoServicio.ts`, `app/components/corte/EstadoEnVivo.vue`, `app/components/corte/ServicioReactivado.vue` |
| Fixtures tipados contra el contrato (`?fixture=reactivacion` simula la reactivación) | `fixtures/corte.ts` |

### Promesa de pago (tarea 4)

| Pieza | Dónde |
| --- | --- |
| Modal "Solicitar promesa de pago" (en `/corte` por IP y en `/cuenta` con `servicioId` y la sesión): al abrir lee `GET /portal/promesas/condiciones` y muestra los límites antes de enviar (plazo y fecha máxima, monto máximo, abono inicial, si requiere aprobación); prellena la fecha máxima y el saldo vencido | `app/components/promesa/Solicitar.vue`, `useSolicitudPromesa` en `app/composables/usePromesas.ts` |
| `UForm` + zod espejo de `solicitarPromesaValidator` más los límites leídos (la decisión es del backend); un 422 de la API queda en su campo | `app/utils/promesa.ts` |
| `POST /portal/promesas` con `Idempotency-Key` (UUID v4 con `getRandomValues`: `randomUUID` no existe por HTTP); la misma clave en el reintento de un envío sin respuesta, otra cuando la API respondió | `useSolicitudPromesa().solicitar`, `claveIdempotencia` |
| **Aprobada**: cierra el modal, aviso en la página y el estado en vivo hasta "Ya tienes servicio" (`/corte`); en `/cuenta` recarga la cuenta y dice "Ya tienes servicio" si el servicio quedó activo. **Rechazada**: el `motivo` de la API en palabras del cliente y "Cambiar fecha o monto". **Pendiente**: aviso en el modal y en la página; no ofrece otra | `app/pages/corte.vue`, `app/pages/cuenta.vue` |
| Fixtures: `?promesa=` (`aprobada`, `rechazada`, `pendiente_aprobacion`, `con_promesa`) (por defecto aprobada; `fijarPromesaFixture` en pruebas) | `fixtures/promesas.ts`, `fixtures/index.ts` |

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
