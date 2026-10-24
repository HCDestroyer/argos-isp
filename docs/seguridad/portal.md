# Seguridad del portal del cliente

Revisión de A5, semana 3 (adelantada de la semana 4). Alcance: `apps/portal` (Nuxt + Nitro) y las
rutas `/api/v1/portal/*` de `apps/api` (`start/routes/portal.ts`, `app/portal/`).

Estado: `[x]` verificado con prueba automática · `[~]` mitigado, con pendiente · `[ ]` abierto.

## Cómo llega el cliente

```
teléfono ──HTTP──▶ MikroTik (dst-nat de los suspendidos) ──▶ portal Nitro :3001 ──▶ API :3333 (red interna)
                                                              /api/v1/portal/** ──┘   (nunca publicada)
```

El navegador solo habla con el portal. Nitro reenvía `/api/v1/portal/**` a la API y agrega la IP del
socket a `X-Forwarded-For`; la API solo cree esa cabecera si la conexión viene de
`PORTAL_PROXIES_CONFIABLES`.

## Checklist

### 1. Límite de peticiones

- [x] Las 23 rutas `/api/v1/portal/*` tienen límite por IP (IPv6 por /64), con contador propio por
  ruta: las públicas y también las de la sesión (`cuenta`, `facturas`, PDF, `contacto`,
  `telegram`, `salir`…). Al pasarse: 429 problem+json con `Retry-After`. Todas declaran
  `limitada: true` (429 en el OpenAPI).
  Prueba: `apps/api/tests/portal/seguridad.spec.ts` recorre la tabla de rutas; una ruta nueva sin
  límite o sin caso de prueba hace fallar la prueba.
- [x] El código de acceso: 5 intentos por código (`PORTAL_CODIGO_INTENTOS`), 5 códigos por cliente y
  hora (`PORTAL_CODIGO_MAX_HORA`), más el límite por IP de `codigo` y `verificar` (`acceso.spec.ts`,
  `seguridad.spec.ts`).
- [~] El validador VineJS del cuerpo corre antes del handler (`despachar` en `app/shared/rutas.ts`,
  de A1): un cuerpo inválido responde 422 sin contar para el límite. Es validación en memoria, sin
  base de datos ni Redis. Pedido a A1 en `.claude/integration/a5.md`: un gancho para aplicar el
  límite antes de validar.
- [~] Si Redis no responde, el límite deja pasar (la página de corte cobra y no debe caerse) y lo
  registra en el log.

### 2. Ningún endpoint devuelve datos de otro cliente

- [x] Por IP solo sale el servicio de esa IP: nombre parcial ("Ana L."), estado y montos. Nunca nombre
  completo, NIT, correo, teléfono, dirección ni usuario PPPoE (`quien_soy.spec.ts`).
- [x] Dos clientes, dos IPs (`seguridad.spec.ts`):
  - desde la IP de A, apuntar al servicio, las facturas o el cobro en línea de B sin sesión → 401/404,
    sin efectos (ni promesa ni comprobante para B);
  - el código pedido por IP va al correo de A;
  - con la sesión de A, aun desde la IP de B: cuenta y listas solo de A; factura, PDF, condiciones,
    promesa, pago, cobro y comprobante de B → 404;
  - ninguna respuesta contiene el nombre, NIT, correo o IP de B.
- [x] Cliente con varios servicios: cada IP ve solo su servicio y su deuda (`varios_servicios.spec.ts`).
- [x] La sesión es de un cliente: todas las lecturas autenticadas filtran por `cliente_id` de la sesión.
- [~] `Idempotency-Key` en rutas públicas: hoy el espacio de claves anónimo es compartido. Lo acota A1
  (próxima tanda); el portal genera UUID v4 por envío, así que no hay colisiones en la práctica.

### 3. Cookie de sesión (`argos_portal`)

- [x] `HttpOnly`: el JavaScript del portal nunca ve el token (el cuerpo de `verificar` no lo trae).
- [x] `SameSite=Strict` (antes `Lax`): no viaja en peticiones iniciadas desde otro sitio. El portal la
  usa solo con `fetch` del mismo origen y el enlace al PDF es del mismo sitio.
- [x] `Path=/api/v1/portal`: no viaja al resto del sitio.
- [x] `Secure` cuando la petición llegó por HTTPS: TLS directo en la API, o `X-Forwarded-Proto: https`
  **solo** desde un proxy de `PORTAL_PROXIES_CONFIABLES` (antes se creía la cabecera de cualquiera).
  `PORTAL_COOKIE_SEGURA=siempre` lo fuerza.
- [x] Se guarda solo el SHA-256 del token; vence por inactividad (30 min) y a las 4 h; `salir` la
  revoca y borra la cookie con los mismos atributos.

**Para producción:** la página de corte es HTTP por fuerza (el portal cautivo no puede redirigir
HTTPS), pero `/entrar` y `/cuenta` deberían servirse por HTTPS con `NUXT_PORTAL_URL_PUBLICA=https://…`,
el certificado del portal en el walled garden y `PORTAL_COOKIE_SEGURA=siempre`. Con el portal solo
en HTTP la cookie viaja sin cifrar dentro de la red del ISP.

### 4. Cabeceras del portal (Nitro)

- [x] `Content-Security-Policy` en cada página HTML (`server/plugins/seguridad.ts`):
  `default-src 'self'`; `script-src 'self'` más el hash SHA-256 de cada script en línea que pone Nuxt
  (estado, modo de color, importmap), **sin** `unsafe-inline` ni `unsafe-eval`; `connect-src 'self'`;
  `img-src 'self' data: blob:` (vista previa del comprobante); `object-src 'none'`;
  `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`. Ningún dominio externo.
  `style-src` admite `unsafe-inline` (Nuxt UI y Vue usan estilos en línea).
- [x] Verificado en Chromium: `/corte`, `/entrar` y `/contacto` hidratan y no hay violaciones. zod v4
  probaba `new Function('')`; se apagó su JIT (`app/plugins/zod.ts`).
- [x] `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `Permissions-Policy` y `Cross-Origin-Opener-Policy` en toda respuesta, también en las
  redirecciones del portal cautivo y en las respuestas del proxy (`server/middleware/0-seguridad.ts`).
- [x] Sin `X-Powered-By`.
- [ ] HSTS: no se pone; depende de que el portal tenga HTTPS (ver 3).

Pruebas: `apps/portal/tests/nuxt/seguridad.test.ts` (reglas) y `apps/portal/tests/servidor/portal.test.ts`
(servidor de producción: CSP con el hash de cada script de `/corte`, `/entrar`, `/cuenta` y `/contacto`).

### 5. Proxy del portal a la API

- [x] **Corregido:** `/api/v1/portal/../clientes` y `/api/v1/portal/%2e%2e/clientes` llegaban a
  `/api/v1/clientes` (el `URL` resuelve los puntos), así que el walled garden alcanzaba toda la API
  del panel (con Bearer, pero expuesta). Ahora se valida la ruta ya resuelta: 404 y la API no recibe
  nada.
- [x] **CSRF:** por IP no hace falta cookie, así que un sitio ajeno podía enviar un formulario
  (`application/x-www-form-urlencoded`, que la API acepta) a `/api/v1/portal/promesas` a nombre de
  quien lo visitara. Ahora POST/PUT/PATCH/DELETE con `Origin` de otro host, `Origin: null` o
  `Sec-Fetch-Site` distinto de `same-origin` responden 403 sin llegar a la API.
- [x] Si la API no responde: 502/504 problem+json en español, sin la URL interna.
- [x] La IP del cliente: el portal agrega la del socket al final de `X-Forwarded-For`; un valor falso
  del cliente queda a la izquierda y la API no lo usa (`quien_soy.spec.ts`).

### 6. Subida de comprobantes

- [x] El tipo se decide por el contenido (firma de los primeros bytes: JPG, PNG, WebP o PDF), nunca
  por la extensión ni por el `Content-Type` del navegador: SVG con script, HTML, ejecutable o GIF con
  nombre `.png`/`.pdf` → 422 `archivo` `tipo` (`RegistrarComprobante` de A3; `seguridad.spec.ts`).
- [x] Más de 5 MB → 422 `archivo` `tamano` **antes** de leer el archivo a memoria (el bodyparser
  admite hasta 20 MB en disco temporal). Más de un archivo en el campo → 422 `unico`.
- [x] El nombre original es solo un dato (recortado a 255); la ruta en disco la arma la API y rechaza
  rutas fuera de su carpeta. El archivo nunca se sirve desde el portal.
- [x] La subida por IP o por sesión sigue las mismas reglas de identificación que la promesa.

### 7. Datos personales y bitácora

- [x] `quien-soy` y `estado` se auditan una vez por IP y servicio cada 10 min (`portal.quien_soy`).
- [x] Sin datos personales en la URL; `Cache-Control: no-store` en todas las respuestas del portal.
- [~] Las acciones del cliente se auditan como actor `sistema` con canal `portal`; el actor `cliente`
  lo agrega A1 (próxima tanda).

## Pendientes

| Qué | Quién |
| --- | --- |
| Probar en el laboratorio que la IP real llega al portal (dst-nat, Docker sin `userland-proxy`) | A6 (necesita el MikroTik del laboratorio) |

Hechos (ya no pendientes): el límite por IP corre antes de validar el cuerpo (gancho `antes` de `despachar`, `app/shared/rutas.ts`: un cuerpo inválido también consume el cupo); `Idempotency-Key` acotada al cliente en rutas públicas (cookie de sesión o IP) y con la huella de los archivos en multipart (`app/middleware/idempotencia_middleware.ts`); HTTPS del portal en producción con certificado de Caddy, `PORTAL_COOKIE_SEGURA=siempre` y HSTS (`infra/produccion/config/Caddyfile`, `PORTAL_HSTS_MAX_AGE`).
