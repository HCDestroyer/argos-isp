/**
 * Catálogo único de Ajustes (tableros AjustesEscritorio y AjustesMovil; respuestas del PM del 26 nov
 * 2026): ocho grupos por tarea y cada pantalla una sola vez. De aquí salen la página de tarjetas
 * (`/configuracion`), la lista de la izquierda dentro de cada ajuste (`AjustesNavegacion`), el
 * buscador, las migas y el grupo «Ajustes» del buscador Ctrl K (`navegacion.ts`).
 *
 * Las rutas siguen siendo `/configuracion/…` (y las de siempre fuera de ella) para no romper enlaces
 * ni la ayuda. Los permisos son los de cada página (`definePageMeta`), con los nombres de
 * `apps/api/app/core/permisos.ts`; los `id` son los de las secciones del menú de antes, para no
 * romper los accesos rápidos guardados.
 */
export interface PaginaConfiguracion {
    id: string
    etiqueta: string
    /** Frase de la pantalla: debajo del título y en el tooltip del buscador Ctrl K. */
    descripcion: string
    icono: string
    ruta: string
    /** Uno, o una lista de la que basta uno. `null`: solo el rol `admin` (pantallas sin permiso propio todavía). */
    permiso: string | readonly string[] | null
    /** Palabras de lo que hay dentro, para el buscador («correo», «NIT», «mora»…), separadas por comas. */
    palabras: string
    /** Rutas que cuentan como esta pantalla (subpáginas, como la edición de una plantilla). */
    tambien?: RegExp
}

export interface SeccionConfiguracion {
    id: string
    etiqueta: string
    /** Frase corta del grupo (encabezado de su tarjeta en la página de Ajustes). */
    resumen: string
    icono: string
    paginas: PaginaConfiguracion[]
}

/** Ruta de la página de Ajustes (tarjetas por grupo). */
export const RUTA_AJUSTES = '/configuracion'

export const SECCIONES_CONFIGURACION: SeccionConfiguracion[] = [
    {
        id: 'config-empresa',
        etiqueta: 'Empresa y fiscal',
        resumen: 'Quién factura y cómo',
        icono: 'i-lucide-building',
        paginas: [
            { id: 'empresas', etiqueta: 'Datos de la empresa', descripcion: 'Los datos legales con los que se factura y se declara', icono: 'i-lucide-building', ruta: '/configuracion/empresas', permiso: 'empresas.ver', palabras: 'NIT, logo, razón social, correo de facturación, empresa sugerida' },
            { id: 'fiscal', etiqueta: 'Régimen e impuestos', descripcion: 'País, régimen, establecimientos, frases e impuestos de cada empresa', icono: 'i-lucide-landmark', ruta: '/configuracion/fiscal', permiso: 'fiscal.ver', palabras: 'IVA, ISR, feriados, establecimientos, frases, parámetros, pequeño contribuyente' },
            { id: 'fel', etiqueta: 'Factura electrónica (FEL)', descripcion: 'Certificador, credenciales, contingencia y momento de certificar', icono: 'i-lucide-shield-check', ruta: '/configuracion/fel', permiso: 'fel.ver', palabras: 'certificador, contingencia, INFILE, credenciales' },
            { id: 'empresa', etiqueta: 'Contacto y pagos', descripcion: 'Contacto, horario e instrucciones de pago del aviso y el portal', icono: 'i-lucide-contact', ruta: '/configuracion/empresa', permiso: 'empresa.ver', palabras: 'teléfono, horario, correo de atención, cómo pagar' },
        ],
    },
    {
        id: 'config-cobro',
        etiqueta: 'Facturación y cobro',
        resumen: 'Cuándo se factura, cuándo se corta y cómo se cobra',
        icono: 'i-lucide-receipt',
        paginas: [
            { id: 'plantillas', etiqueta: 'Plantillas de facturación', descripcion: 'Ciclos de facturación, corte, mora y reglas de promesas', icono: 'i-lucide-receipt', ruta: '/plantillas', permiso: 'plantillas.ver', palabras: 'ciclo, corte, mora, promesas, día de pago' },
            { id: 'aviso-cobro', etiqueta: 'Plantillas de documentos', descripcion: 'Aviso de cobro, factura, recibo y nota de crédito en carta o POS 80 mm', icono: 'i-lucide-file-code-2', ruta: '/configuracion/aviso-cobro', permiso: 'documentos.ver', palabras: 'aviso, recibo, factura, nota de crédito, carta, 80 mm, impresión', tambien: /^\/configuracion\/plantillas-documentos(\/|$)/ },
            { id: 'plantillas-conceptos', etiqueta: 'Conceptos y adicionales', descripcion: 'Conceptos de cargo único y adicionales del servicio', icono: 'i-lucide-file-text', ruta: '/configuracion/plantillas-conceptos', permiso: ['plantillas.ver', 'documentos.ver'], palabras: 'cargo único, IP pública, adicionales, conceptos' },
            { id: 'reglas-cobro', etiqueta: 'Reglas de cobro y libro', descripcion: 'Aprobación de asientos y tope de la pausa sin cobro', icono: 'i-lucide-sliders-vertical', ruta: '/configuracion/reglas-cobro', permiso: 'ajustes_cobro.ver', palabras: 'aprobar asientos, pausa sin cobro, libro' },
            { id: 'cuentas-bancarias', etiqueta: 'Cuentas bancarias', descripcion: 'Cuentas propias para depósitos, transferencias, ACH y remesas', icono: 'i-lucide-landmark', ruta: '/configuracion/cuentas-bancarias', permiso: 'cuentas_bancarias.ver', palabras: 'depósitos, transferencias, ACH, remesas' },
            { id: 'bancos-origen', etiqueta: 'Bancos de origen', descripcion: 'De qué bancos viene el dinero de una transferencia o ACH', icono: 'i-lucide-list', ruta: '/configuracion/bancos-origen', permiso: 'cuentas_bancarias.ver', palabras: 'catálogo de bancos' },
            { id: 'proveedores-cobro', etiqueta: 'Proveedores de cobro', descripcion: 'Pasarelas, agentes y débitos con su cuenta puente y fecha de corte', icono: 'i-lucide-credit-card', ruta: '/configuracion/proveedores-cobro', permiso: 'bancos.ver', palabras: 'pasarelas, agentes, débitos, tarjeta' },
        ],
    },
    {
        id: 'config-clientes',
        etiqueta: 'Clientes y portal',
        resumen: 'Qué se pide de cada cliente y cómo entra a su portal',
        icono: 'i-lucide-users',
        paginas: [
            { id: 'campos-personalizados', etiqueta: 'Campos personalizados', descripcion: 'Datos extra de la ficha del cliente: tipo, obligatorio y orden', icono: 'i-lucide-text-cursor-input', ruta: '/campos-personalizados', permiso: 'campos_personalizados.editar', palabras: 'datos extra de la ficha' },
            { id: 'portal-contrasena', etiqueta: 'Contraseña del portal', descripcion: 'Con qué contraseña entran al portal los clientes sin una propia', icono: 'i-lucide-key-round', ruta: '/configuracion/portal-contrasena', permiso: 'empresa.ver', palabras: 'clave de entrada del cliente' },
            { id: 'nodos-portal', etiqueta: 'Nodos del portal', descripcion: 'Portales del cliente instalados en otro servidor', icono: 'i-lucide-server', ruta: '/configuracion/nodos-portal', permiso: 'nodos_portal.administrar', palabras: 'portal en otro servidor, token' },
        ],
    },
    {
        id: 'config-red',
        etiqueta: 'Red y equipos',
        resumen: 'Qué ve el cliente cortado y cómo se manejan los equipos',
        icono: 'i-lucide-network',
        paginas: [
            { id: 'portal-corte', etiqueta: 'Corte, caídas y retiro', descripcion: 'A dónde van los suspendidos, caídas y fallas generales, retiro e historial de IP', icono: 'i-lucide-octagon-pause', ruta: '/configuracion/portal-corte', permiso: 'portal_corte.ver', palabras: 'página de corte, fallas, historial de IP, suspendidos, RADIUS' },
            { id: 'inventario', etiqueta: 'Inventario', descripcion: 'Firma al recibir traslados y la IA que lee facturas de compra', icono: 'i-lucide-package', ruta: '/configuracion/inventario', permiso: 'inventario.configurar', palabras: 'firma de traslados, lector de facturas' },
        ],
    },
    {
        id: 'config-comunicacion',
        etiqueta: 'Comunicación e integraciones',
        resumen: 'Avisos al cliente y sistemas conectados',
        icono: 'i-lucide-bell',
        paginas: [
            { id: 'notificaciones', etiqueta: 'Canales de aviso', descripcion: 'Correo, Telegram y WhatsApp: servidor, bot e interruptores por aviso', icono: 'i-lucide-bell', ruta: '/configuracion/notificaciones', permiso: 'notificaciones.ver', palabras: 'correo, SMTP, Telegram, WhatsApp' },
            { id: 'notificaciones-plantillas', etiqueta: 'Plantillas de avisos', descripcion: 'Texto de cada aviso, recordatorios de pago y registro de envíos', icono: 'i-lucide-message-square-text', ruta: '/notificaciones', permiso: 'notificaciones.ver', palabras: 'textos del correo, recordatorios, envíos' },
            { id: 'integraciones', etiqueta: 'Integraciones', descripcion: 'Iris, Horus Flow, SmartOLT y GenieACS: conexión y credenciales', icono: 'i-lucide-blocks', ruta: '/configuracion/integraciones', permiso: ['horus.ver', 'iris.ver', 'equipos.ver'], palabras: 'Iris, Horus, SmartOLT, GenieACS', tambien: /^\/configuracion\/integraciones\// },
            // Decisión 24 del PM: solo el admin. La API de la importación aún no tiene permiso propio.
            { id: 'importar', etiqueta: 'Importar desde Mikrowisp', descripcion: 'Traer clientes, servicios y facturas desde otro sistema', icono: 'i-lucide-upload', ruta: '/configuracion/importar', permiso: null, palabras: 'migrar, traer clientes' },
        ],
    },
    {
        id: 'config-usuarios',
        etiqueta: 'Usuarios y seguridad',
        resumen: 'Quién entra y qué puede hacer',
        icono: 'i-lucide-shield',
        paginas: [
            { id: 'usuarios', etiqueta: 'Usuarios', descripcion: 'Usuarios del panel: alta, roles con su alcance, desactivar y empresas', icono: 'i-lucide-user', ruta: '/usuarios', permiso: 'usuarios.ver', palabras: 'alta, desactivar, empresas, contraseña' },
            { id: 'roles', etiqueta: 'Roles y permisos', descripcion: 'Roles con sus permisos y el catálogo de permisos', icono: 'i-lucide-shield', ruta: '/usuarios/roles', permiso: 'roles.ver', palabras: 'qué puede hacer cada rol, ACL' },
            { id: 'tokens', etiqueta: 'Tokens de API', descripcion: 'Tokens para integraciones y agentes de IA: crear y revocar', icono: 'i-lucide-key-round', ruta: '/usuarios/tokens', permiso: 'tokens.ver', palabras: 'integraciones, agentes de IA' },
        ],
    },
    {
        id: 'config-apariencia',
        etiqueta: 'Apariencia y reportes',
        resumen: 'Cómo se ve Argos y cómo cuentan sus reportes',
        icono: 'i-lucide-palette',
        paginas: [
            { id: 'apariencia', etiqueta: 'Apariencia', descripcion: 'Color del panel y del portal, marca, logo e inicio de sesión', icono: 'i-lucide-palette', ruta: '/configuracion/apariencia', permiso: 'apariencia.ver', palabras: 'color, logo, inicio de sesión, modo oscuro' },
            { id: 'config-reportes', etiqueta: 'Ajustes de reportes', descripcion: 'Cuándo un servicio cuenta como baja en los reportes', icono: 'i-lucide-chart-pie', ruta: '/configuracion/reportes', permiso: 'reportes.ver', palabras: 'cuándo cuenta una baja' },
        ],
    },
    {
        id: 'config-sistema',
        etiqueta: 'Sistema',
        resumen: 'Cómo está el servidor',
        icono: 'i-lucide-activity',
        paginas: [
            { id: 'salud', etiqueta: 'Salud del sistema', descripcion: 'Estado del servidor, la base, Redis, colas, RADIUS y respaldos', icono: 'i-lucide-heart-pulse', ruta: '/sistema/salud', permiso: 'sistema.ver_salud', palabras: 'servidor, colas, RADIUS' },
            { id: 'registro', etiqueta: 'Registro de fallos', descripcion: 'Errores y avisos recientes de la API, la red, RADIUS, CoA y colas', icono: 'i-lucide-scroll-text', ruta: '/sistema/registro', permiso: 'sistema.ver_registro', palabras: 'errores y avisos' },
            { id: 'almacenamiento', etiqueta: 'Almacenamiento', descripcion: 'Qué ocupa espacio: disco, archivos, base de datos y Redis', icono: 'i-lucide-hard-drive', ruta: '/sistema/almacenamiento', permiso: 'sistema.ver_almacenamiento', palabras: 'disco, base, archivos' },
            { id: 'tareas', etiqueta: 'Tareas programadas', descripcion: 'Cuándo corrieron y cuándo corren las tareas automáticas', icono: 'i-lucide-calendar-clock', ruta: '/sistema/tareas', permiso: 'sistema.ver_crons', palabras: 'crons, cuándo corrieron' },
        ],
    },
]

/**
 * Permisos con los que se entra a Ajustes: la unión del catálogo, en su orden (basta uno). Es la
 * lista del `definePageMeta` de `/configuracion` y la del enlace «Ajustes» del menú; una prueba
 * (`ajustesCatalogo.test.ts`) vigila que sigan iguales.
 */
export const PERMISOS_AJUSTES: readonly string[] = [...new Set(SECCIONES_CONFIGURACION
    .flatMap(seccion => seccion.paginas)
    .flatMap(pagina => (pagina.permiso === null ? [] : typeof pagina.permiso === 'string' ? [pagina.permiso] : [...pagina.permiso])))]

/** El grupo y la pantalla de una ruta (`null` fuera de Ajustes). */
export function ubicacionConfiguracion(ruta: string): { seccion: SeccionConfiguracion, pagina: PaginaConfiguracion } | null {
    for (const seccion of SECCIONES_CONFIGURACION) {
        const pagina = seccion.paginas.find(p => p.ruta === ruta) ?? seccion.paginas.find(p => p.tambien?.test(ruta))
        if (pagina) {
            return { seccion, pagina }
        }
    }
    return null
}

/** Grupos con sus pantallas permitidas; un grupo sin ninguna no aparece. */
export function gruposAjustesVisibles(puedePagina: (pagina: PaginaConfiguracion) => boolean): SeccionConfiguracion[] {
    return SECCIONES_CONFIGURACION
        .map(seccion => ({ ...seccion, paginas: seccion.paginas.filter(puedePagina) }))
        .filter(seccion => seccion.paginas.length > 0)
}

/** Dónde coincidió la búsqueda: el nombre, la descripción, una de las palabras o el grupo. */
export type CampoAjuste = 'etiqueta' | 'descripcion' | 'palabras' | 'grupo'

export interface ResultadoAjuste {
    seccion: SeccionConfiguracion
    pagina: PaginaConfiguracion
    campo: CampoAjuste
    /** Lo que coincidió, para mostrarlo debajo del nombre (una de las palabras, o `null`). */
    fragmento: string | null
}

/** Si `termino` (ya normalizado) aparece en `texto` al inicio de una palabra: «logo» no encuentra «catálogo». */
function contiene(texto: string, termino: string): boolean {
    return inicioDePalabra(normalizarBusqueda(texto), termino) >= 0
}

function inicioDePalabra(base: string, termino: string): number {
    let desde = base.indexOf(termino)
    while (desde > 0 && /[\p{L}\p{N}]/u.test(base.charAt(desde - 1))) {
        desde = base.indexOf(termino, desde + 1)
    }
    return desde
}

/**
 * Busca en las pantallas permitidas, sin tildes ni mayúsculas y por inicio de palabra: nombre,
 * descripción, palabras de lo que hay dentro y grupo. Primero lo que coincide por nombre; después,
 * lo que tiene justo esa palabra y el resto, en el orden del catálogo.
 */
export function buscarAjustes(grupos: SeccionConfiguracion[], texto: string): ResultadoAjuste[] {
    const termino = normalizarBusqueda(texto.trim())
    if (!termino) {
        return []
    }
    const resultados: ResultadoAjuste[] = []
    for (const seccion of grupos) {
        for (const pagina of seccion.paginas) {
            const palabra = pagina.palabras.split(',').map(p => p.trim()).find(p => contiene(p, termino)) ?? null
            const campo: CampoAjuste | null = contiene(pagina.etiqueta, termino)
                ? 'etiqueta'
                : palabra
                    ? 'palabras'
                    : contiene(pagina.descripcion, termino)
                        ? 'descripcion'
                        : contiene(seccion.etiqueta, termino) ? 'grupo' : null
            if (campo) {
                resultados.push({ seccion, pagina, campo, fragmento: campo === 'palabras' ? palabra : null })
            }
        }
    }
    // Primero por nombre; luego la que tiene justo esa palabra («correo» → Canales de aviso); luego el resto.
    const orden = (r: ResultadoAjuste) => (r.campo === 'etiqueta' ? 0 : r.fragmento !== null && normalizarBusqueda(r.fragmento) === termino ? 1 : 2)
    return resultados.map((r, i) => ({ r, i })).sort((a, b) => orden(a.r) - orden(b.r) || a.i - b.i).map(({ r }) => r)
}

/**
 * Parte un texto en trozos para resaltar lo buscado (`<mark>`), sin tildes ni mayúsculas.
 * «correo de atención» con «CORREO» → [{ texto: 'correo', marca: true }, { texto: ' de atención', marca: false }].
 */
export function resaltar(texto: string, busqueda: string): { texto: string, marca: boolean }[] {
    const termino = normalizarBusqueda(busqueda.trim())
    const base = normalizarBusqueda(texto)
    const inicio = termino ? inicioDePalabra(base, termino) : -1
    if (inicio < 0 || base.length !== texto.length) {
        return [{ texto, marca: false }]
    }
    return [
        { texto: texto.slice(0, inicio), marca: false },
        { texto: texto.slice(inicio, inicio + termino.length), marca: true },
        { texto: texto.slice(inicio + termino.length), marca: false },
    ].filter(trozo => trozo.texto.length > 0)
}

/** Quita tildes y pasa a minúsculas, para buscar «fel», «envios»… sin importar cómo se escriba. */
export function normalizarBusqueda(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Fila de la lista de integraciones (tablero OperConfigIntegraciones). */
export interface IntegracionItem {
    id: string
    nombre: string
    frase: string
    icono: string
    tono: string
    to: string
    estado: { etiqueta: string, color: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral', icono?: string, prueba?: string } | null
}
