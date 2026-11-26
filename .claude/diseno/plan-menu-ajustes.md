# Menú lateral, Ajustes y perfil: diagnóstico, propuesta y plan (26 nov 2026)

Pedido del PM: «El sidebar está roto también, no tiene espacio en la parte de abajo así que ajustes se ve cortado, además el menú de ajustes es de mejorarlo o reestructurarlo para hacer aún más práctico e intuitivo, el menú en modo teléfono del perfil es de mezclarlo con drawers, ya que así contextual no es práctico».

Este documento es el diagnóstico y el plan. El diseño está **pendiente de aprobación del PM**, salvo el lote 0 (el corte del menú), que es un arreglo y no espera.

- Rama: `lider/diseno-menu` (parte de `main` más `lider/marco-movil-2`, PR #329: `PanelBarraAccion`, `--ax-barra-accion`, `ConfiguracionMarco` con el pie en la isla).
- Tableros: `tableros/MenuLateral.dc.html`, `AjustesEscritorio.dc.html`, `AjustesMovil.dc.html`, `PerfilDrawer.dc.html` (generador `generadores/menu_ajustes.py`).
- Imágenes: `imagenes/menu-ajustes/` (la propuesta) e `imagenes/menu-ajustes/antes/` (capturas del panel real con fixtures).

## 1. Diagnóstico del menú lateral

Reproducido con el panel en modo fixtures (`NUXT_PUBLIC_USE_FIXTURES=true`), usuario `admin@argos.test`, Chromium, `deviceScaleFactor` 1, en 1280×720, 1280×800, 1440×900 y 390×844, claro y oscuro.

### Causa exacta del corte

`apps/web/app/assets/css/main.css`, regla `.lateral-argos` (desde 1024 px):

```css
.lateral-argos {
    margin: 1rem 0 1rem 1rem;
    height: calc(100dvh - 2rem);
}
```

La isla debería medir «pantalla menos 32 px». Pero la raíz de `UDashboardSidebar` de Nuxt UI trae `min-h-svh` (`.nuxt/ui/dashboard-sidebar.ts`: `root: 'relative hidden lg:flex flex-col min-h-svh …'`), y un alto mínimo le gana al alto. Resultado medido:

| Pantalla | Alto de la isla | Empieza en | Termina en | Queda fuera |
| --- | --- | --- | --- | --- |
| 1280×720 | 720 px (debía ser 688) | 16 | 736 | 16 px |
| 1280×800 | 800 px (debía ser 768) | 16 | 816 | 16 px |
| 1440×900 | 900 px (debía ser 868) | 16 | 916 | 16 px |

La isla empieza 16 px abajo y mide la pantalla completa, así que sus últimos 16 px quedan fuera de `UDashboardGroup` (`fixed inset-0 overflow-hidden`). El pie del menú solo tiene 14 px de relleno (`pb-3.5`): se pierde todo el relleno, la esquina redondeada y parte del texto «Ajustes». No depende del tema ni del tamaño: pasa igual en los tres altos y en claro y oscuro.

No es `h-screen` contra `dvh` ni el desplazamiento del menú: es `min-height` de la librería contra `height` de nuestra hoja de estilos. Comprobado en el navegador: con `min-height: 0` en `.lateral-argos`, la isla pasa a 688, 768 y 868 px y termina 16 px antes del borde.

En el teléfono (390×844) el menú «Más» no se corta: va a pantalla completa (`menu-movil`, con `padding-bottom: env(safe-area-inset-bottom)`).

### Segundo problema, de diseño (no es el corte, pero se ve igual)

En el menú expandido, «Ajustes» vive en el pie (`footer`) como un acordeón con 6 subgrupos y 28 enlaces, con `max-h-[55%]` y desplazamiento propio. Al abrirlo:

- en 1280×720 el pie crece a 283 px y, con un subgrupo abierto, a 396 px con desplazamiento interno; al menú de todos los días le quedan 268 px, también con desplazamiento;
- quedan dos zonas con barra de desplazamiento dentro de la misma isla, y la última fila del pie queda a medias.

Esto no se arregla con CSS: se resuelve con la reestructuración (el menú lleva una sola entrada «Ajustes»).

Observación por comprobar en el lote 0: después de abrir «Ajustes», la isla aparece 2 px más arriba (de 16 a 14). Algo se desplaza dentro del grupo al enfocar; hay que ver si desaparece con el arreglo.

## 2. Auditoría de Ajustes (Configuración)

### Cómo se navega hoy

Hay **dos catálogos distintos** que no coinciden:

- `app/utils/navegacion.ts`, grupo `configuracion` de `GRUPOS_PANEL`: 1 entrada suelta («Toda la configuración») y **6 subgrupos con 28 secciones**. Lo usan el menú lateral, el buscador Ctrl K, los accesos rápidos y el índice `/configuracion`.
- `app/utils/configuracionSecciones.ts`, `SECCIONES_CONFIGURACION`: **10 secciones con 24 pantallas**. Lo usan `ConfiguracionSubmenu` y `ConfiguracionMarco`.

Escritorio, en `/configuracion`, lo mismo aparece tres veces a la vez (captura `antes/configuracion-triplicada-1280x800-claro.png`):

1. el acordeón «Ajustes» del menú lateral (6 grupos);
2. la isla «Configuración» de `ConfiguracionSubmenu` (10 secciones, con su buscador «Buscar un ajuste…»);
3. las tarjetas del índice (6 categorías, con otro buscador «Buscar: FEL, plantillas, roles…»).

Más Ctrl K: tres buscadores para lo mismo. Dentro de una sección, unas agrupan sus pantallas en pestañas (Empresa y fiscal, Facturación y cobro, Sistema) y otras las esconden como subpáginas con «Atrás» (Red y portal).

Teléfono: «Más» → acordeón «Ajustes» (los 6 grupos del primer catálogo) → «Toda la configuración» → la isla con las 10 secciones del segundo catálogo y, debajo, otra vez el título «Configuración» con las tarjetas de las 6 categorías. Dentro de una sección, «‹ Configuración» y pestañas con desplazamiento horizontal.

### Inventario

Permisos con el nombre exacto de `apps/api/app/core/permisos.ts` (todos comprobados). «Menú» = aparece en el acordeón, en el menú compacto, en Ctrl K y como tarjeta del índice. «Submenú» = aparece en la isla de Configuración.

| # | Pantalla (ruta) | Qué configura | Permiso | Menú | Submenú | Marco |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/configuracion` | Índice con tarjetas | lista de 23 permisos, basta uno | «Toda la configuración» | — | sí |
| 2 | `/configuracion/empresas` | Empresas (NIT), logo, datos fiscales, empresa sugerida | `empresas.ver` | «Empresas» | «Datos de la empresa» (pestaña) | sí |
| 3 | `/configuracion/fiscal` | País, régimen, establecimientos, frases, impuestos, feriados | `fiscal.ver` | «Fiscal» | «Régimen e impuestos» (pestaña) | sí |
| 4 | `/configuracion/fel` | Certificador, credenciales, contingencia | `fel.ver` | «FEL» | «Factura electrónica (FEL)» (pestaña) | sí |
| 5 | `/configuracion/empresa` | Contacto, horario e instrucciones de pago | `empresa.ver` | «Contacto y pagos» | igual (pestaña) | sí |
| 6 | `/plantillas` | Ciclos de facturación, corte, mora, promesas | `plantillas.ver` | «Plantillas de facturación» | **no está** | **no** |
| 7 | `/configuracion/aviso-cobro` (+ `plantillas-documentos/[id]`, `nueva` con `documentos.crear`) | Plantillas de aviso, factura, recibo y nota de crédito | `documentos.ver` | «Plantillas de documentos» | solo como subpágina de la 8 | sí |
| 8 | `/configuracion/plantillas-conceptos` | Resumen de plantillas, conceptos de cargo único y adicionales | `plantillas.ver` o `documentos.ver` | «Plantillas y conceptos» | igual (pestaña) | sí |
| 9 | `/configuracion/reglas-cobro` | Aprobación de asientos, tope de la pausa sin cobro | `ajustes_cobro.ver` | **no está** | «Reglas de cobro y libro» (pestaña) | sí |
| 10 | `/configuracion/cuentas-bancarias` | Cuentas propias | `cuentas_bancarias.ver` | sí | sí (pestaña) | sí |
| 11 | `/configuracion/bancos-origen` | Catálogo de bancos de origen | `cuentas_bancarias.ver` | sí | sí (pestaña) | sí |
| 12 | `/configuracion/proveedores-cobro` | Pasarelas, agentes y débitos | `bancos.ver` | sí | sí (pestaña) | sí |
| 13 | `/campos-personalizados` | Datos extra de la ficha del cliente | `campos_personalizados.editar` | sí (en «Facturación y cobro») | **no está** | **no** |
| 14 | `/configuracion/portal-corte` | Portal de corte, caídas y fallas generales, retiro, historial de IP, acceso | `portal_corte.ver` | «Portal de corte» | «Red y portal» | sí |
| 15 | `/configuracion/portal-contrasena` | Contraseña de fábrica del portal | `empresa.ver` | sí | subpágina | sí |
| 16 | `/configuracion/nodos-portal` | Portales en otro servidor | `nodos_portal.administrar` | sí | subpágina | sí |
| 17 | `/configuracion/inventario` | Firma de traslados, IA que lee facturas | `inventario.configurar` | sí | subpágina | sí |
| 18 | `/configuracion/notificaciones` | Correo, Telegram, WhatsApp, interruptores | `notificaciones.ver` | sí | sí | sí |
| 19 | `/notificaciones` | Texto de cada aviso, recordatorios, envíos | `notificaciones.ver` | «Plantillas de avisos» | **no está** | **no** |
| 20 | `/configuracion/integraciones` (+ `horus` con `horus.ver`, `iris` con `iris.ver`) | Iris, Horus, SmartOLT, GenieACS | `horus.ver`, `iris.ver` o `equipos.ver` | «Integraciones» **y además** «Iris» | «Integraciones» | sí |
| 21 | `/configuracion/importar` | Importar desde Mikrowisp | rol `admin` (sin permiso propio, decisión 24) | **no está** | «Importar datos» | sí |
| 22 | `/usuarios` | Usuarios, roles con alcance, empresas | `usuarios.ver` | sí | sí | **no** |
| 23 | `/usuarios/roles` | Roles y catálogo de permisos | `roles.ver` | sí | sí | **no** |
| 24 | `/usuarios/tokens` | Tokens de API | `tokens.ver` | sí | sí | **no** |
| 25 | `/configuracion/apariencia` | Color, logo, inicio de sesión | `apariencia.ver` | sí | sí | sí |
| 26 | `/configuracion/reportes` | Cuándo un servicio cuenta como baja | `reportes.ver` | «Ajustes de reportes» | «Reportes» | sí |
| 27 | `/sistema/salud` | Estado del servidor | `sistema.ver_salud` | sí | «Salud» (pestaña) | sí |
| 28 | `/sistema/registro` | Errores y avisos | `sistema.ver_registro` | sí | «Registro» (pestaña) | sí |
| 29 | `/sistema/almacenamiento` | Espacio en disco | `sistema.ver_almacenamiento` | sí | «Almacenamiento» (pestaña) | sí |
| 30 | `/sistema/tareas` | Tareas programadas | `sistema.ver_crons` | sí | **no está** | **no** |

`/perfil` («Mi cuenta») no es un ajuste del sistema: es personal y se abre desde el menú del perfil.

### Hallazgos

1. **Triple repetición** en escritorio y doble en el teléfono, con tres buscadores.
2. **Dos catálogos que no coinciden**: 6 grupos contra 10 secciones, y nombres distintos para lo mismo («Usuarios y acceso» / «Usuarios y permisos»; «Fiscal» / «Régimen e impuestos»; «Portal de corte» / «Red y portal»; «Empresas» / «Datos de la empresa»).
3. **Pantallas que solo están en un catálogo**: Reglas de cobro e Importar no salen en el menú ni en Ctrl K; Plantillas de facturación, Campos personalizados, Plantillas de avisos y Tareas programadas no salen en la isla de Configuración.
4. **Siete pantallas se salen del marco** (filas 6, 13, 19, 22, 23, 24 y 30): al abrirlas desaparece la navegación de Ajustes.
5. **«Iris» aparece dos veces** en el menú (dentro de «Integraciones» y como entrada propia).
6. **Agrupación forzada**: Campos personalizados está en «Facturación y cobro»; Inventario en «Red y portal»; Ajustes de reportes en «Sistema y apariencia».
7. **Navegación desigual**: unas secciones usan pestañas y otras subpáginas con «Atrás».
8. **Falla de permisos en el índice**: la lista de `/configuracion` no incluye `ajustes_cobro.ver`, `reportes.ver` ni `equipos.ver`. Un usuario que solo tenga uno de esos no puede abrir el índice aunque sí su pantalla.
9. **Dos nombres**: el menú dice «Ajustes» y la pantalla dice «Configuración».

## 3. Propuesta: Ajustes reestructurado

Tableros `AjustesEscritorio` y `AjustesMovil`.

### Un solo catálogo, ocho grupos por tarea

Cada pantalla aparece **una vez**. Las rutas no cambian.

| Grupo | Pantallas (permiso) |
| --- | --- |
| **Empresa y fiscal** | Datos de la empresa (`empresas.ver`) · Régimen e impuestos (`fiscal.ver`) · Factura electrónica (FEL) (`fel.ver`) · Contacto y pagos (`empresa.ver`) |
| **Facturación y cobro** | Plantillas de facturación (`plantillas.ver`) · Plantillas de documentos (`documentos.ver`) · Conceptos y adicionales (`plantillas.ver` o `documentos.ver`) · Reglas de cobro y libro (`ajustes_cobro.ver`) · Cuentas bancarias (`cuentas_bancarias.ver`) · Bancos de origen (`cuentas_bancarias.ver`) · Proveedores de cobro (`bancos.ver`) |
| **Clientes y portal** | Campos personalizados (`campos_personalizados.editar`) · Contraseña del portal (`empresa.ver`) · Nodos del portal (`nodos_portal.administrar`) |
| **Red y equipos** | Corte, caídas y retiro (`portal_corte.ver`) · Inventario (`inventario.configurar`) |
| **Comunicación e integraciones** | Canales de aviso (`notificaciones.ver`) · Plantillas de avisos (`notificaciones.ver`) · Integraciones (`horus.ver`, `iris.ver` o `equipos.ver`) · Importar desde Mikrowisp (rol `admin`) |
| **Usuarios y seguridad** | Usuarios (`usuarios.ver`) · Roles y permisos (`roles.ver`) · Tokens de API (`tokens.ver`) |
| **Apariencia y reportes** | Apariencia (`apariencia.ver`) · Ajustes de reportes (`reportes.ver`) |
| **Sistema** | Salud del sistema (`sistema.ver_salud`) · Registro de fallos (`sistema.ver_registro`) · Almacenamiento (`sistema.ver_almacenamiento`) · Tareas programadas (`sistema.ver_crons`) |

Son 29 pantallas (las 30 del inventario menos el índice). Nombres que cambian: «Empresas» → «Datos de la empresa», «Fiscal» → «Régimen e impuestos», «Plantillas y conceptos» → «Conceptos y adicionales», «Portal de corte» / «Red y portal» → «Corte, caídas y retiro», «Notificaciones» → «Canales de aviso», «Registro del sistema» → «Registro de fallos». La entrada suelta «Iris» desaparece (vive dentro de Integraciones).

Todo se llama **«Ajustes»** (menú, título, migas). Las rutas siguen siendo `/configuracion/…`.

### Escritorio: navegación lateral propia de Ajustes

- El menú principal lleva **una sola entrada «Ajustes»**, fija abajo, sin acordeón ni menú flotante.
- Dentro de Ajustes, a la izquierda, una isla con la lista agrupada completa (encabezado de grupo y sus pantallas, un clic a cualquiera) y **un solo buscador** arriba. A la derecha, la pantalla elegida con su título, las pastillas de empresa cuando aplica y el pie «Descartar / Guardar».
- Las pestañas dejan de servir para pasar de una pantalla a otra. Quedan solo para partes de una misma pantalla (como las tres de «Corte, caídas y retiro»).
- Migas: «Ajustes › Empresa y fiscal › Datos de la empresa».
- «Ajustes» abre la última pantalla que el usuario visitó (se recuerda por usuario, como el menú compacto); la primera vez, la primera permitida. Ya no hay página de tarjetas en escritorio.
- Lo que requiere atención se marca en la lista con un indicador discreto (ícono y texto en el `title`): hoy, «Contingencia activa» en FEL. Solo si se pudo leer de la API.

### Teléfono

- «Más» → «Ajustes» (una fila) abre la misma lista agrupada a pantalla completa, con el buscador arriba.
- Al tocar una pantalla se abre a pantalla completa con «‹ Ajustes», el nombre del grupo debajo del título y la acción principal en la isla fija de abajo (`PanelBarraAccion`, PR #329).
- Es el mismo componente que en escritorio: en escritorio va en la columna izquierda y en el teléfono es la pantalla índice.

### Buscador dentro de Ajustes

- Un solo campo (`UInput`), en la lista. Filtra mientras se escribe, sin tildes ni mayúsculas.
- Busca en el nombre, la descripción, el grupo y **palabras clave** de cada pantalla (`palabras` en el catálogo): «correo» encuentra Canales de aviso, Plantillas de avisos, Contacto y pagos y Datos de la empresa; «mora» encuentra Plantillas de facturación; «logo», Apariencia y Datos de la empresa.
- Los resultados salen en una lista plana con su grupo debajo. Flechas para moverse, Enter abre el primero, Esc borra. Sin resultados: «Nada coincide con «…»» y «Borrar búsqueda».
- Ctrl K sigue igual y sale del mismo catálogo.

### Permisos

- Una pantalla se lista solo si el usuario puede abrirla (`puede(permiso)`; Importar, solo rol `admin`).
- **Un grupo sin ninguna pantalla permitida no se muestra.** El buscador tampoco encuentra lo no permitido.
- «Ajustes» aparece en el menú si hay al menos una pantalla permitida. La lista de permisos del índice se iguala a la unión del catálogo (corrige el hallazgo 8) y una prueba lo vigila.
- Ejemplo en el tablero (`{"v":"rol"}`): el rol contabilidad ve 3 grupos de 8.

### Por qué esta opción y cuál se descartó

Elegida: **lista lateral propia con buscador** (el mismo patrón en escritorio y teléfono).

- Un clic para llegar a cualquier ajuste y para pasar de uno a otro, sin volver a un índice.
- Se ve dónde estás y qué más hay en el grupo.
- Ya es el diseño aprobado el 21 nov (tableros `OperConfig*`): cambia el contenido de la isla, no la distribución.
- Un solo componente y un solo catálogo: ya no pueden desalinearse.

Descartada: **índice con tarjetas** como entrada a Ajustes (lo que hoy es `/configuracion`).

- Cuesta un clic más en cada visita y hay que volver al índice para cambiar de ajuste.
- 29 tarjetas con descripción ocupan varias pantallas de alto; la lista, bastante menos.
- Convivir con la lista lateral es justo la repetición que hoy confunde.

Lo que se pierde: las pastillas informativas («2 empresas», «5 plantillas»). Se conservan solo las que piden actuar.

También descartado: dejar el acordeón de Ajustes en el menú principal y solo ordenarlo. No resuelve el espacio del menú ni la repetición.

### Cambio respecto al diseño aprobado

Los tableros `OperConfig*` muestran la isla con secciones y pestañas para sus pantallas. Si el PM aprueba, la isla pasa a listar pantallas por grupo y esas pestañas de navegación desaparecen. El contenido de cada pantalla no cambia.

## 4. Propuesta: menú del perfil del teléfono como drawer

Tablero `PerfilDrawer`.

Hoy (captura `antes/perfil-contextual-390x844-claro.png`): el círculo «AA» abre un menú contextual pegado arriba a la derecha, con filas pequeñas, «Tema» en un submenú y las empresas mezcladas con las acciones.

Propuesta: bajo 1024 px, el círculo abre un **`UDrawer` desde abajo**, con todo a la altura del pulgar:

1. **Quién eres**: iniciales, nombre, rol y correo, y cerrar.
2. **Empresa activa** (solo con más de una): lista de opción única con el NIT; «Todas las empresas» si el usuario tiene alcance global. Al elegir, se cierra y avisa «Empresa activa: …».
3. **Tema**: tres botones a la vista (Claro, Oscuro, Sistema), sin submenú.
4. **Mi cuenta**, **Ayuda de esta pantalla** y **Qué cambió** (con la versión).
5. **Cerrar sesión**, aparte y en rojo.

Filas de 48 px o más. Con muchas empresas, el drawer se desplaza por dentro. En escritorio sigue el menú desplegable actual; los dos salen de la misma lista (`useMenuCuenta`) para que no se desalineen.

### ¿Se une con el menú «Más»?

No se funden en uno; **se conectan**:

- «Más» sigue a pantalla completa (diseño `MarcoMovil` aprobado): tiene buscador y 8 áreas, y no cabe en un drawer junto con la cuenta.
- Arriba de «Más» va una fila con la cuenta (iniciales, nombre, empresa activa y rol) que abre **el mismo drawer**. Primero se cierra «Más» (nunca un panel sobre otro).
- «Ayuda» sale de la lista de «Más», donde hoy queda suelta debajo de Reportes, y pasa al drawer.

Por qué no un solo drawer con todo: mezclaría «a dónde voy» con «quién soy y con qué empresa», sería más largo y el cambio de empresa quedaría escondido al final. Con dos entradas al mismo drawer, la cuenta se alcanza desde arriba (el círculo) y desde abajo (Más), y hay un solo lugar donde vive.

Opción descartada: quitar el círculo del encabezado y dejar la cuenta solo en «Más». Ahorra un botón, pero cambiar de empresa pasaría de un toque a dos y el círculo también muestra de un vistazo que hay sesión.

Materiales (identidad Horus): el drawer es capa funcional (vidrio fuerte) y sus bloques son tarjetas; cerrar sesión lleva ícono, texto y color.

## 5. Plan de ejecución por lotes

Reglas para todos: solo componentes de Nuxt UI, 4 espacios, permisos con su nombre exacto, `pnpm lint`, `pnpm typecheck` y `pnpm verificar:permisos` en verde, y revisar en 390 y 1280 px, claro y oscuro. Las pruebas Playwright corren en los dos proyectos (`escritorio` y `telefono`). `aclPantallas` es `apps/web/tests/nuxt/aclPantallas.test.ts`.

| Lote | Qué | Complejidad | Depende de |
| --- | --- | --- | --- |
| 0 | Arreglo del corte del menú lateral | Baja | Nada. No espera la aprobación |
| 1 | Catálogo único de Ajustes | Media | Aprobación del PM |
| 2 | Navegación de Ajustes y su marco (escritorio y teléfono) | Alta | Lote 1 y PR #329 en `main` |
| 3 | Las 7 pantallas que hoy quedan fuera del marco | Media | Lote 2 |
| 4 | Menú principal: «Ajustes» como una sola entrada | Media | Lote 2 (mejor después del 3) |
| 5 | Drawer del perfil en el teléfono | Media | Aprobación del PM y PR #329; después del lote 4 (los dos tocan `default.vue`) |
| 6 | Limpieza, ayuda y diseño al día | Baja | Lotes 2 a 5 |

### Lote 0 · Arreglo del corte (baja)

- **Archivos:** `apps/web/app/assets/css/main.css` (`.lateral-argos` desde 1024 px: agregar `min-height: 0` junto a `height: calc(100dvh - 2rem)`, con un comentario que explique el `min-h-svh` de Nuxt UI).
- **Playwright** (`tests/e2e/menu.spec.ts`, solo escritorio): en 1280×720, 1280×800 y 1440×900, con el menú compacto y expandido, la caja de `#dashboard-sidebar-principal` termina en `alto − 16` (±1) y el enlace «Ajustes» queda completo dentro de la pantalla. Comprobar también que la isla no se mueve al abrir y cerrar grupos.
- **Vitest:** no aplica (es CSS). **aclPantallas:** sin cambios; debe seguir en verde.
- **Teléfono:** `marco-movil.spec.ts` sin cambios, en verde.

### Lote 1 · Catálogo único (media)

- **Archivos:**
    - `app/utils/configuracionSecciones.ts`: los 8 grupos y 29 pantallas de la sección 3, con `descripcion`, `palabras` y `tambien` (subrutas); se quita `pestana`.
    - `app/utils/navegacion.ts`: el grupo `configuracion` de `GRUPOS_PANEL` se arma desde ese catálogo (mismos `id` de sección, para no romper accesos rápidos guardados; se quita la entrada «Iris» y se agregan Reglas de cobro e Importar).
    - `app/composables/usePaginasConfiguracion.ts`: grupos visibles, primera pantalla permitida y búsqueda.
    - `app/pages/configuracion/index.vue`: la lista de `permiso` igual a la unión del catálogo (agrega `ajustes_cobro.ver`, `reportes.ver`, `equipos.ver`). Va escrita literal: `aclPantallas` y `verificar-permisos` leen el texto.
    - `app/composables/useAccesosRapidos.ts` y `app/components/AccesosRapidosEditor.vue`: revisar que sigan resolviendo los `id`.
- **Vitest:** nuevo `tests/nuxt/ajustesCatalogo.test.ts` (cada página de `pages/configuracion/**` y las 7 de fuera está una sola vez en el catálogo, con el mismo permiso que su `definePageMeta`; la lista del índice es la unión; un grupo sin permitidas no sale; la búsqueda ignora tildes y usa las palabras clave). Actualizar `menuLateral.test.ts` (subgrupos esperados), `usePermisos.test.ts`, `aclRoles.test.ts`.
- **aclPantallas:** en verde (cada página declara su permiso y el menú pide el mismo).
- **Playwright:** `permisos.spec.ts` y `menu.spec.ts` en los dos proyectos, ajustando los nombres que cambian.

### Lote 2 · Navegación de Ajustes y marco (alta)

- **Archivos:**
    - nuevo `app/components/AjustesNavegacion.vue` (reemplaza a `ConfiguracionSubmenu.vue`): lista agrupada con `UInput`, resultados, teclado, indicador de atención.
    - `app/components/ConfiguracionMarco.vue`: usa la navegación nueva; título y migas desde el catálogo; sin pestañas de navegación; «‹ Ajustes» en el teléfono; conserva `PanelBarraAccion` (pie y acción principal) del PR #329.
    - `app/components/PanelPagina.vue`: migas «Ajustes › grupo › pantalla».
    - `app/pages/configuracion/index.vue`: en el teléfono, la lista; desde 1024 px, lleva a la última pantalla visitada o a la primera permitida.
    - nuevo `app/composables/useAjustesRecientes.ts` (última pantalla por usuario en `localStorage`, con `try/catch`).
    - las 27 páginas que ya usan `ConfiguracionMarco`: quitar `titulo` repetido y `volver` donde ya no hace falta.
- **Vitest:** nuevo `ajustesNavegacion.test.ts` (permisos, grupo vacío, búsqueda, sin resultados, pantalla activa, indicador solo si la API respondió); actualizar `pendientesConfig.test.ts`, `notificacionesConfiguracion.test.ts`, `portalCorte.test.ts`, `portalContrasena.test.ts`, `iris.test.ts`.
- **Playwright** (escritorio y teléfono): nuevo `tests/e2e/ajustes.spec.ts` (abrir Ajustes, ver los 8 grupos como admin, buscar «correo» y abrir con Enter, pasar de una pantalla a otra con un clic, rol con pocos permisos ve menos grupos y ninguno vacío; en el teléfono, lista → pantalla → «‹ Ajustes», y el pie fijo no tapa campos). Actualizar `pendientes-config.spec.ts`, `horus.spec.ts`, `multiempresa.spec.ts`, `marco-movil.spec.ts`, `accesibilidad.spec.ts` (axe sobre la lista y una pantalla) y los selectores `submenu-configuracion`, `buscar-ajuste`, `buscar-configuracion`, `data-seccion-config`, `data-tarjeta-config`, `pestanas-configuracion`, `volver-configuracion`.
- **aclPantallas:** cada enlace de la lista se oculta sin el permiso de su destino.

### Lote 3 · Pantallas fuera del marco (media)

- **Archivos:** `app/pages/plantillas/index.vue`, `campos-personalizados.vue`, `notificaciones/index.vue`, `usuarios/index.vue`, `usuarios/roles.vue`, `usuarios/tokens.vue`, `sistema/tareas.vue`: pasan de `PanelPagina` a `ConfiguracionMarco`. Se retira `UsuariosNavegacion.vue` (sus tres pantallas ya están en la lista).
- **Vitest:** `usuariosAcl.test.ts` y las pruebas de esas páginas.
- **Playwright** (los dos proyectos): `usuarios.spec.ts`, `plantillas.spec.ts`, `campos-personalizados.spec.ts`, `tareas-programadas.spec.ts`; en `ajustes.spec.ts`, que las 29 pantallas mantienen la lista visible en escritorio y «‹ Ajustes» en el teléfono.
- **aclPantallas:** en verde.

### Lote 4 · «Ajustes» como una sola entrada del menú (media)

- **Archivos:** `app/layouts/default.vue` (pie del menú: un enlace a `/configuracion` en compacto y expandido; fuera `itemsExpandidoAjustes`, el menú flotante de Ajustes y `max-h-[55%]`); `tests/e2e/ayudas.ts` (`expandirGrupos`, `ir`: a los ajustes se llega por la lista).
- **Vitest:** `menuLateral.test.ts`.
- **Playwright** (los dos proyectos): `menu.spec.ts` (Ajustes no despliega nada y abre su pantalla; el menú principal ya no tiene desplazamiento en 1280×720 con un grupo abierto), `marco-movil.spec.ts` («Más» → «Ajustes»).
- **aclPantallas:** el enlace «Ajustes» pide la misma lista que el índice.

### Lote 5 · Drawer del perfil (media)

- **Archivos:**
    - nuevo `app/composables/useMenuCuenta.ts` (identidad, empresas, tema, acciones y estado «abierto» compartido);
    - nuevo `app/components/CuentaDrawer.vue` (`UDrawer` desde abajo; `URadioGroup` para la empresa, tres `UButton` para el tema, filas con `UButton`);
    - `app/components/MenuUsuario.vue`: desde 1024 px, el `UDropdownMenu` actual; debajo, el botón abre el drawer;
    - `app/layouts/default.vue`: fila de la cuenta arriba de «Más» (cierra el menú y abre el drawer) y se quita `AyudaBoton` de esa lista;
    - `tests/e2e/ayudas.ts`: `elegirEmpresa` por el drawer en el teléfono.
- **Vitest:** nuevo `cuentaDrawer.test.ts` (sin selector con una sola empresa; «Todas las empresas» solo con alcance global; elegir empresa y tema; cerrar sesión).
- **Playwright:** en `telefono`, nuevo bloque en `marco-movil.spec.ts` (abrir desde el círculo y desde «Más», cambiar empresa y tema, Esc y arrastre cierran, nunca dos paneles a la vez); `multiempresa.spec.ts`, `version.spec.ts` y `sesion.spec.ts` en los dos proyectos; `accesibilidad.spec.ts` con el drawer abierto.
- **aclPantallas:** el drawer no enlaza a secciones con permiso («Mi cuenta» no lo pide); en verde.

### Lote 6 · Limpieza y documentación (baja)

- **Archivos:** borrar `ConfiguracionSubmenu.vue` y lo que quede sin uso (`FRASES`, `TONOS` del índice); `apps/web/README.md`; índice de ayuda (`pnpm --filter @argosisp/web ayuda:indice`); `.claude/diseno/README.md` (pasar la sección de «pendiente» a aprobada y anotar que la isla de los tableros `OperConfig*` cambió).
- **Pruebas:** toda la batería (`pnpm test`, `pnpm test:e2e` en los dos proyectos, `aclPantallas`).

## 6. Preguntas para el PM

1. ¿Aprueba los 8 grupos y los nombres nuevos?
2. ¿«Ajustes» en todas partes en lugar de «Configuración»?
3. ¿Está bien que en la computadora «Ajustes» abra directo la última pantalla usada, sin la página de tarjetas?
4. ¿El perfil del teléfono con el drawer y, además, la fila de la cuenta arriba de «Más»?
5. ¿«Sistema» (salud, registro, almacenamiento, tareas) se queda dentro de Ajustes?
