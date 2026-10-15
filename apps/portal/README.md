# @argosisp/portal · portal del cliente y página de corte

Nuxt 4 (SSR) + Nuxt UI v4, móvil primero. Puerto 3001. Pantallas: agente A5 (`.claude/agents/a5-portal.md`).

## Comandos

```
pnpm --filter @argosisp/portal dev          # http://localhost:3001
NUXT_PUBLIC_USE_FIXTURES=true pnpm --filter @argosisp/portal dev   # sin backend; /corte?fixture=activo|suspendido|desconocido
pnpm --filter @argosisp/portal lint | typecheck | test | build
docker build -f apps/portal/Dockerfile -t argosisp/portal .        # desde la raíz
```

Variables en `.env.example` (empresa, cuentas de depósito, URL interna de la API).

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

## Walled garden

La página de corte se abre con el servicio suspendido, así que todo sale de este servidor:

- `ui.fonts: false` (sin `@nuxt/fonts` ni Google Fonts): fuentes del sistema en `app/assets/css/main.css`.
- Iconos lucide locales (`@iconify-json/lucide`) empaquetados en el cliente; `fallbackToApi: false`,
  nunca `api.iconify.design`. Usa solo iconos `i-lucide-*`.
- Ningún CDN. Si agregas un dominio externo (pasarela, API), anótalo en `.claude/INTEGRATION.md` para A6.

## Página de corte `/corte`

| Pieza | Dónde |
| --- | --- |
| Identificación por IP: `GET /api/v1/portal/quien-soy` (`Schema<'QuienSoy'>` del contrato), solo en el navegador | `app/composables/useCorte.ts` |
| Título y texto según estado (`activo`, `limitado`, `suspendido`, `retirado`, no identificado) | `app/utils/corte.ts` |
| Monto adeudado, badge de estado, facturas vencidas (cantidad y total), promesa activa | `app/components/corte/ResumenDeuda.vue` |
| Datos de depósito (`NUXT_PUBLIC_DEPOSITO_*`; pasa al panel en la tarea 9) | `app/components/corte/DatosDeposito.vue` |
| Acciones: pagar en línea (semana 2), comprobante y promesa (día 3) deshabilitadas; contacto por teléfono o correo | `app/pages/corte.vue` |
| Fixtures tipados contra el contrato | `fixtures/corte.ts` |

Desde la IP solo se muestran nombre parcial, estado y montos; nunca datos personales completos.

## Lo que deja el día 1

| Pieza | Dónde |
| --- | --- |
| Cliente HTTP único con `credentials: 'include'` (cookie httpOnly, sin Bearer) | `app/utils/clienteApi.ts`, `app/plugins/api.ts`, `useApi()` |
| Layout con encabezado de la empresa y pie | `app/layouts/default.vue` |
| Fixtures y `fetch` falso | `fixtures/`, `app/utils/fetchFixtures.ts` |
| Formato de fechas (America/Guatemala) y quetzales; `EstadoServicioBadge` | `app/utils/`, `app/components/` |
