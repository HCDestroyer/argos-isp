# Contrato: anuncios del portal

Versión 1.0.0 · expone A5 (API `apps/api/app/portal`, portal `apps/portal`) · consume A4 (panel).

Los anuncios son promociones por empresa que el panel publica en el inicio del portal (`/cuenta`) y en la página de corte (`/corte`). Con ningún anuncio publicado, el portal y la página de corte se ven exactamente igual que antes.

## 1. Datos

Viven en la tabla `core.anuncios`, una fila por anuncio y por empresa.

| Campo | Regla |
| --- | --- |
| `titulo` | 1 a 80 caracteres. Texto plano. |
| `texto` | Hasta 500 caracteres. Texto plano, sin HTML: el portal lo pinta como texto, respeta los saltos de línea y nunca interpreta HTML ni Markdown. |
| `imagen` | Opcional. PNG, JPEG o WebP según la firma del archivo, hasta 1 MB y de 64 a 4096 px por lado. Recomendado: 1200×600 (proporción 2:1). Se guarda en el almacenamiento de archivos (`COMPROBANTES_DIR/anuncios/`), nunca en la base. Lleva `alt` obligatorio, de 1 a 200 caracteres. |
| `boton` | Opcional; texto (1 a 40) y URL van juntos. La URL es `http://` o `https://` sin usuario ni contraseña, o una ruta del portal que empieza con `/` (sin `//`). Se rechazan `javascript:`, `data:` y las barras invertidas. |
| `inicio`, `fin` | Opcionales (instantes ISO). Sin `inicio`, rige desde que se publica; sin `fin`, sin vencimiento. `fin` debe ser posterior a `inicio`. |
| `audiencia` | `todos`, `suspendidos` (algún servicio del cliente en esa empresa está suspendido o limitado), `al_dia` (ninguno suspendido o limitado y sin facturas vencidas con saldo) o `con_puntos` (saldo de puntos de lealtad mayor que 0 en esa empresa). |
| `lugares` | `portal_inicio`, `pagina_corte` o ambos. |
| `orden` | De -1000 a 1000. El mayor va primero; a igual orden, el más nuevo. |
| `estado` | `borrador`, `publicado` o `archivado`. Cambia solo por acción. |
| `version` | Control optimista: 409 si cambió. |

## 2. Panel (A4)

Permisos: `anuncios.ver` (admin y lectura) y `anuncios.administrar` (solo admin). Cada anuncio es de una empresa. Crear usa la empresa activa (`X-Empresa-Id`; 422 `empresa_requerida` si el usuario tiene varias y no eligió). Las demás rutas exigen acceso a la empresa del anuncio (403 `empresa_no_permitida`).

| Método y ruta | Permiso | Acción | Notas |
| --- | --- | --- | --- |
| `GET /api/v1/anuncios?estado=&cursor=&limit=` | `anuncios.ver` | — | `{ data: Anuncio[], nextCursor }` de la empresa activa |
| `POST /api/v1/anuncios` | `anuncios.administrar` | `anuncios.crear` | 201 en `borrador` |
| `GET /api/v1/anuncios/:id` | `anuncios.ver` | — | |
| `PUT /api/v1/anuncios/:id` | `anuncios.administrar` | `anuncios.editar` | `{ version, …campos }`: solo los enviados; `null` borra los opcionales. Archivado: 422 `anuncio_archivado` |
| `POST /api/v1/anuncios/:id/imagen` | `anuncios.administrar` | `anuncios.cambiar_imagen` | multipart `imagen` + `version` + `alt`; `quitar=true` la quita. 422 en `imagen` o en `alt` |
| `GET /api/v1/anuncios/:id/imagen` | `anuncios.ver` | — | Vista previa con `ETag` |
| `POST /api/v1/anuncios/:id/publicar` | `anuncios.administrar` | `anuncios.publicar` | `{ version }`. Desde borrador o archivado; si ya está publicado, no cambia nada. Con `fin` pasado, 422 `anuncio_vencido` |
| `POST /api/v1/anuncios/:id/archivar` | `anuncios.administrar` | `anuncios.archivar` | `{ version }`. Desde borrador o publicado; si ya está archivado, no cambia nada |
| `GET /api/v1/anuncios/:id/metricas` | `anuncios.ver` | — | `MetricasAnuncio`: `vistas`, `clics`, `por_lugar[]`, `por_dia[]` (últimos 30 días, fecha de Guatemala) |

`Anuncio` incluye `vigente` (publicado y dentro de su vigencia ahora). La imagen se entrega como `{ url, tipo, ancho, alto, alt }` y nunca expone la ruta interna del archivo. Cada acción queda en `audit.acciones` con su diff en `audit.cambios` (`entidad_tipo = anuncio`). De la imagen se registra solo su huella sha256.

## 3. Portal (A5)

| Método y ruta | Notas |
| --- | --- |
| `GET /api/v1/portal/anuncios?lugar=portal_inicio\|pagina_corte` | Público, con límite por IP. Devuelve `{ data: PortalAnuncio[] }`, hasta 8. Con `pagina_corte`, el cliente es el del servicio de la IP (solo los de su empresa) o, si no hay, el de la sesión. Con `portal_inicio`, el de la sesión. Solo devuelve anuncios publicados, vigentes, de las empresas donde el cliente tiene servicios no retirados y cuya audiencia le aplica. Sin cliente identificado, la lista viene vacía. |
| `GET /api/v1/portal/anuncios/:id/imagen` | Solo de anuncios vigentes (404 si no). Mismo origen, `ETag` y `Cache-Control: public, max-age=300`. |
| `POST /api/v1/portal/anuncios/:id/eventos` | Cuerpo `{ tipo: vista\|clic, visitante: uuid, lugar }`. Responde 204. |

`PortalAnuncio` = `{ id, empresa_id, titulo, texto, imagen: { url, ancho, alto, alt } | null, boton: { texto, url } | null }`.

### Métricas sin datos personales

- `visitante` es un UUID que el navegador genera por sesión y guarda en `sessionStorage`. No identifica a nadie y no viaja en la URL.
- Los eventos son idempotentes: la base guarda una vista y un clic por visitante y anuncio (`UNIQUE (anuncio_id, tipo, visitante)`).
- Es telemetría: el éxito no deja fila en `audit.acciones` y los errores sí.
- La vista cuenta cuando la tarjeta está al menos a la mitad en pantalla. En el carrusel, cuando esa diapositiva es la visible. El clic cuenta al tocar el botón.

## 4. Cómo se ve

- **Página de corte:** debajo de pagar, de los accesos (comprobante, prometer pago, depósito) y del estado en vivo. Nunca encima ni en un modal.
- **Inicio del portal:** al final del inicio, después de los servicios.
- **Un anuncio:** una tarjeta. **Varios:** carrusel `UCarousel`.
  - En el teléfono se desliza y la siguiente tarjeta asoma; en escritorio tiene flechas y puntos.
  - Avanza solo cada 8 s y se detiene mientras se toca, tiene el foco o el ratón encima.
  - Tiene botón «Pausar/Reanudar» (WCAG 2.2.2).
  - Con `prefers-reduced-motion` no avanza solo.
  - Cada diapositiva tiene la etiqueta «n de N: título» y se navega con flechas del teclado.
- **Imagen:** con `width`/`height` fijos y `loading="lazy"`.
- **Si la lectura falla:** aviso «No pudimos cargar las promociones» con «Reintentar». No muestra promociones inventadas.

## 5. Aviso de sorteo próximo (hecho en la fase 3 de sorteos: `GET /portal/avisos-sorteo`)

El aviso de sorteo próximo no forma parte de este contrato. El componente del portal está pensado así: carrusel o lista de los premios del sorteo con la misma tarjeta, cuenta regresiva a la fecha y «tus boletos: N». Se construye cuando A3 exponga los sorteos.
