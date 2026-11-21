# Contrato: apariencia de la instalación

Versión 1.0.0 · expone A6 (`apps/api/app/core`, tabla `core.apariencia`, rama `lider/salud-apariencia`) · lo consumen el panel (`apps/web`: login, tema, Configuración → Apariencia) y el portal (`apps/portal`: login).

Pedido del PM: «El admin puede elegir el tema de la interfaz; los logos del inicio de sesión deben poder configurarse.»

- **Global**: una sola fila para toda la instalación (no por empresa). El logo de cada empresa (portal del cliente, PDF, correos) **sigue saliendo de Empresas** (`GET /api/v1/empresas/:id/logo`); esta apariencia es solo la de la instalación: tema, marca y pantallas de inicio de sesión.
- Sin caché del lado del servidor. Los archivos van con `ETag` y URLs que cambian con el contenido.

## 1. Permisos y acciones

| Permiso / acción | Rol base | Ruta |
| --- | --- | --- |
| (público) | — | `GET /api/v1/apariencia/publica`, `GET /api/v1/apariencia/archivos/:nombre` |
| `apariencia.ver` | `admin` (y todo rol que hoy ve configuración: `admin`) | `GET /api/v1/apariencia` |
| `apariencia.editar` | `admin` | `PUT /api/v1/apariencia` |
| `apariencia.subir_logo_login` | `admin` | `POST /api/v1/apariencia/logo-login` |
| `apariencia.quitar_logo_login` | `admin` | `POST /api/v1/apariencia/logo-login/quitar` |
| `apariencia.subir_fondo_login` | `admin` | `POST /api/v1/apariencia/fondo-login` |
| `apariencia.quitar_fondo_login` | `admin` | `POST /api/v1/apariencia/fondo-login/quitar` |

Cada edición es una acción de dominio (`DomainAction`): fila en `audit.acciones` y diff por campo en `audit.cambios` con `entidad_tipo = 'apariencia'`, `entidad_id = 1`. Los archivos se registran por su nombre y huella, nunca su contenido.

Evento: en esta versión **no se emite evento** (no hay caché que invalidar: la apariencia se lee al cargar la pantalla). Propuesto al líder: `apariencia.cambiada { campos[] }` si un consumidor lo necesita.

## 2. Temas (presets)

`tema` es uno de estos ids. `color` es el nombre del color de Nuxt UI / Tailwind para `appConfig.ui.colors.primary`. `claro` y `oscuro` son los hex del color primario **a usar como `--ui-primary`** en cada modo (tono indicado). Contraste verificado (WCAG 2.1, AA ≥ 4.5:1 para texto normal):

| `tema` | Nombre | `color` (Nuxt UI) | Claro (tono) | Contraste vs `#FFFFFF` | Oscuro (tono) | Contraste vs `#0B0F1A` |
| --- | --- | --- | --- | --- | --- | --- |
| `indigo` (por defecto) | Índigo | `indigo` | `#4F46E5` (600) | 6.29 | `#818CF8` (400) | 6.41 |
| `azul` | Azul | `blue` | `#2563EB` (600) | 5.17 | `#60A5FA` (400) | 7.53 |
| `violeta` | Violeta | `violet` | `#7C3AED` (600) | 5.70 | `#A78BFA` (400) | 7.03 |
| `esmeralda` | Esmeralda | `emerald` | `#047857` (700) | 5.48 | `#34D399` (400) | 9.95 |
| `naranja` | Naranja | `orange` | `#C2410C` (700) | 5.18 | `#FB923C` (400) | 8.45 |
| `rosa` | Rosa | `pink` | `#BE185D` (700) | 6.04 | `#F472B6` (400) | 7.22 |
| `pizarra` | Pizarra | `slate` | `#475569` (600) | 7.58 | `#94A3B8` (400) | 7.46 |

El mismo contraste vale para texto blanco sobre botón primario en claro (mismo par) y para texto `#0B0F1A` sobre botón primario en oscuro. Ojo: Nuxt UI usa por defecto el tono 500 en claro y 400 en oscuro; con estos presets el panel debe fijar `--ui-primary` al tono de la tabla en claro (600 o 700), porque el 500 de varios colores no llega a 4.5:1 sobre blanco.

La API devuelve el catálogo en `temas` (ruta con permiso) y el tema activo resuelto en `paleta` (ruta pública), así el frontend no copia la tabla a mano.

## 3. `GET /api/v1/apariencia/publica` (sin autenticación)

`operationId: aparienciaPublica`, esquema `AparienciaPublica`. Responde con `ETag` (de `version`) y `Cache-Control: no-cache` (el navegador revalida con `If-None-Match` y recibe 304 si no cambió).

```jsonc
{
    "tema": "indigo",
    "paleta": { "color": "indigo", "claro": "#4F46E5", "oscuro": "#818CF8" },
    "modo_predeterminado": "sistema",     // sistema | claro | oscuro
    "nombre_marca": "ArgosIsp",
    "eslogan": null,                      // o texto (≤ 120)
    "logo_login_url": "/api/v1/apariencia/archivos/logo-login-3f2a9c1d0b7e4a55.png",   // o null
    "fondo_login_url": null,              // o "/api/v1/apariencia/archivos/fondo-login-<huella>.<ext>"
    "version": 3
}
```

- Solo datos públicos. Las URLs son **relativas al origen de la API** (anteponer la base de la API).
- La URL cambia cuando cambia el archivo (el nombre lleva los primeros 16 hex del sha256).

## 4. `GET /api/v1/apariencia` (permiso `apariencia.ver`)

`operationId: aparienciaVer`, esquema `Apariencia` = todo lo de `AparienciaPublica` más:

```jsonc
{
    // …campos de AparienciaPublica…
    "logo_login": { "url": "…", "tipo": "image/png", "tamano": 18342, "etag": "<sha256>" },   // o null
    "fondo_login": null,                   // mismo formato; tipo image/png | image/svg+xml | image/jpeg | image/webp
    "temas": [ { "id": "indigo", "nombre": "Índigo", "color": "indigo", "claro": "#4F46E5", "oscuro": "#818CF8" } ],
    "updated_at": "2026-11-21T15:00:00.000Z"
}
```

Si nunca se configuró, responde los valores por defecto con `version: 1` (la fila la crea la migración).

## 5. `PUT /api/v1/apariencia` (acción `apariencia.editar`)

`operationId: aparienciaEditar`. Cuerpo JSON (todo opcional salvo `version`; lo que no viene no cambia):

| Campo | Regla |
| --- | --- |
| `version` | entero, obligatorio; distinto del actual → **409** `urn:argosisp:problema:conflicto_version` |
| `tema` | uno de los ids de §2 |
| `modo_predeterminado` | `sistema` \| `claro` \| `oscuro` |
| `nombre_marca` | texto 1–60, se recorta |
| `eslogan` | texto ≤ 120 o `null` (vacío = null) |

Responde 200 `Apariencia` con `version + 1`. Sin cambios reales responde 200 igual y no sube la versión. Acepta `Idempotency-Key`.

## 6. Logo y fondo del inicio de sesión (multipart)

| Ruta | Archivo | Tipos | Máximo |
| --- | --- | --- | --- |
| `POST /api/v1/apariencia/logo-login` (`aparienciaSubirLogoLogin`) | campo `archivo` | PNG (por firma) o SVG (saneado con `#core/svg`) | 512 KB |
| `POST /api/v1/apariencia/fondo-login` (`aparienciaSubirFondoLogin`) | campo `archivo` | PNG, JPEG, WebP (por firma) o SVG saneado | 1.5 MB |
| `POST /api/v1/apariencia/logo-login/quitar` (`aparienciaQuitarLogoLogin`) | — (JSON) | — | — |
| `POST /api/v1/apariencia/fondo-login/quitar` (`aparienciaQuitarFondoLogin`) | — (JSON) | — | — |

- `multipart/form-data` con el archivo `archivo` y el campo de texto `version`; las rutas `quitar` llevan JSON `{ "version": n }`. 409 si `version` no coincide.
- El tipo se decide por el contenido, no por la extensión ni el `Content-Type`. El SVG se sanea (sin scripts, manejadores de eventos, `foreignObject`, estilos ni referencias externas); con DOCTYPE, entidades o mal formado → 422 en `archivo`. Más grande que el máximo → 422 en `archivo` (`rule: tamano`). Otro tipo → 422 (`rule: tipo`). Falta → 422 (`rule: required`).
- Se guardan en el mismo volumen que los logos de empresa (`COMPROBANTES_DIR/logos/apariencia/`). El archivo anterior se borra después del COMMIT.
- Responden 200 `Apariencia` con `version + 1`.

## 7. `GET /api/v1/apariencia/archivos/:nombre` (sin autenticación)

`operationId: aparienciaArchivo`. `:nombre` = `logo-login-<16 hex>.<ext>` o `fondo-login-<16 hex>.<ext>` tal como sale en las URLs. Solo se sirven los archivos **vigentes**; cualquier otro nombre → 404.

- `Content-Type` del archivo, `ETag: "<sha256>"`, `Cache-Control: public, max-age=31536000, immutable` (el nombre cambia con el contenido), `X-Content-Type-Options: nosniff`; SVG con `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`.
- `If-None-Match` igual → **304** sin cuerpo.

## 8. Errores

| Status | `type` | Cuándo |
| --- | --- | --- |
| 401 | `no_autenticado` | Rutas con permiso sin sesión |
| 403 | `prohibido` | Sin el permiso |
| 404 | `no_encontrado` | Archivo que no es el vigente |
| 409 | `conflicto_version` | `version` desactualizada |
| 422 | `validacion` | `errors[]` con `field`: `tema`, `modo_predeterminado`, `nombre_marca`, `eslogan`, `version`, `archivo` |

(Todos con prefijo `urn:argosisp:problema:`.)

## 9. Cómo lo usan los frontends

- Login del panel y del portal: `GET /apariencia/publica` antes de pintar (si falla, se usan los valores por defecto de §3 sin logo: no es un dato financiero). Aplica `paleta` y `modo_predeterminado` (el usuario puede cambiar su modo en su navegador; `modo_predeterminado` es solo el inicial).
- Panel ya con sesión: mismo `publica` al arrancar para el tema; Configuración → Apariencia usa `GET/PUT /apariencia` y las rutas de archivos, con `version`.
