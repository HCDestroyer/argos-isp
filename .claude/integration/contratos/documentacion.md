# Contrato · Documentación pública y ayuda del panel

Versión 1.0.0 · dueño: líder (estructura del sitio) · escriben: todos los agentes, cada uno lo suyo.

## 1. Qué es

- Sitio público con VitePress en `apps/docs` (`@argosisp/docs`). El contenido vive en `/docs`: los runbooks, guías de laboratorio e importación que ya estaban son páginas del sitio sin moverlos.
- Se publica en GitHub Pages (`https://hcdestroyer.github.io/argos-isp/`) con `.github/workflows/docs.yml`. En CI, `pnpm build` también compila el sitio: un enlace roto o una página que no compila falla la PR.
- Público del sitio (decisión del PM): el personal del ISP (cajero, soporte, técnico, contabilidad) y los desarrolladores e integradores. El manual cubre todas las pantallas del panel, incluida la configuración.

## 2. Secciones

| Carpeta | Qué va | Formato |
| --- | --- | --- |
| `docs/guia/` | Primeros pasos: qué es Argos, conceptos (estados, saldo, ciclo de cobro, corte), cómo se controla el acceso, puesta en marcha, glosario | Explicación corta, sin pasos de una pantalla |
| `docs/tutoriales/<puesto>/` | Tareas del día a día por puesto: `cajero`, `soporte`, `tecnico`, `contabilidad` | Plantilla de tutorial (§4) |
| `docs/manual/<area>/` | Una página por pantalla o grupo de pantallas del panel | Plantilla de manual (§3) y `pantallas:` en el frontmatter |
| `docs/runbooks/` | Instalar, actualizar, respaldos, red, proxy, cierres, incidentes | Runbook (ya existe el estilo) |
| `docs/desarrolladores/` | API, autenticación, permisos, errores, paginación, idempotencia, multiempresa, eventos, webhooks, RADIUS, integraciones, contribuir; referencia de la API generada del OpenAPI | Referencia técnica |
| `docs/laboratorio/`, `docs/importacion/`, `docs/seguridad/`, `docs/piloto/` | Lo que ya había | Igual |

Las carpetas y sus `index.md` las crea el líder. Tú solo agregas archivos `.md` en las carpetas que te tocan y no editas archivos de otro agente. Si necesitas una carpeta nueva, pídela.

## 3. Página del manual

```md
---
orden: 2
pantallas:
    - /clientes
    - /clientes/[id]#ficha-del-cliente
---

# Clientes

Una o dos frases: para qué sirve la pantalla.

## Quién la usa

Permiso para verla (`clientes.ver`) y roles base que lo traen.

## Qué ves

Columnas, filtros, pestañas y estados (con su color e icono).

## Acciones

### Suspender un servicio

- **Permiso:** `servicios.suspender`
- **Dónde:** botón «Suspender» en la ficha del servicio.
- **Qué pasa:** … (estado, factura, aviso al cliente, desconexión, bitácora).

## Preguntas frecuentes y errores

«No me deja…», mensajes de error que el usuario ve y qué hacer.

## Relacionado

Enlaces a tutoriales y otras páginas.
```

- `pantallas:` lista las pantallas del panel que explica la página. La clave es la ruta del archivo en `apps/web/app/pages`, sin `.vue` ni `/index` (`clientes/[id]/editar.vue` → `/clientes/[id]/editar`, `index.vue` → `/`). Con `#ancla` el botón «Ayuda» abre esa sección: el ancla es el título `##` en minúsculas, sin tildes ni signos, con guiones (`## Ficha del cliente` → `#ficha-del-cliente`).
- Cada pantalla tiene exactamente una página. La compilación avisa qué pantallas no tienen ayuda; en CI (`DOCS_AYUDA_ESTRICTA=1`) falla.

## 4. Tutorial

```md
---
orden: 1
---

# Cobrar una factura en caja

Qué logras al terminar, en una frase.

## Antes de empezar

- Permiso: `pagos.registrar`, caja abierta.

## Pasos

1. Abre **Cobro** en el menú.
2. …

## Qué pasa después

Reactivación, comprobante, aviso al cliente.

## Si algo sale mal

Error → causa → qué hacer.
```

## 5. Reglas de escritura

- Español de Guatemala, de «tú», frases cortas y el resultado primero. El lector del manual y los tutoriales no es técnico: nada de nombres de tablas, eventos ni código salvo en `desarrolladores/`.
- **Nada inventado.** Cada botón, campo, permiso, mensaje y comportamiento se verifica en el código: la pantalla en `apps/web/app/pages` y sus componentes, la acción en `apps/api/app/<modulo>/actions`, los permisos en `apps/api/app/core/permisos.ts` (nombre exacto), los contratos en `.claude/integration/contratos/`. Si algo no está claro en el código, no lo documentes como cierto: anótalo en tu reporte al líder.
- Montos en quetzales (`Q 150.00`), fechas en hora de Guatemala. Ejemplos con datos ficticios (nunca datos reales de clientes, contraseñas, tokens ni IPs públicas reales; usa `10.x`, `192.0.2.x`, `2001:db8::`).
- Nombres de botones y menús entre comillas latinas tal como aparecen en el panel: «Suspender». Menús en negrita: **Clientes → Nuevo**.
- Avisos con contenedores de VitePress: `::: tip`, `::: warning`, `::: danger` (lo que no se puede deshacer: anular, eliminar, retirar).
- Enlaces relativos entre páginas (`../cobros/caja.md`). Un enlace a un archivo del repositorio fuera de `/docs` se convierte solo en enlace a GitHub.
- Marcadores como `<tu-dominio>` van en `código`. El HTML crudo está desactivado.
- Imágenes en `docs/public/capturas/<area>/` y se enlazan como `/capturas/<area>/archivo.png`, con texto alternativo que diga qué muestra.
- Commits `docs(<modulo>): …`. La compilación `pnpm --filter @argosisp/docs build` pasa sin avisos de tus pantallas antes de entregar.

## 6. Botón «Ayuda» del panel (A4)

- Cada pantalla del panel tiene un botón «Ayuda» que abre `<sitio>/ayuda/?pantalla=<clave>` en una pestaña nueva; `<sitio>` sale de `NUXT_PUBLIC_DOCS_URL` (por defecto el sitio público).
- `/ayuda/` la genera el sitio al compilar desde el frontmatter `pantallas:` y redirige a la página y ancla de esa pantalla; si la clave no existe, abre el manual.
- La clave se calcula de la ruta de Nuxt de la pantalla (`/clientes/:id()` → `/clientes/[id]`), igual que en §3.
