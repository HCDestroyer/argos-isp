import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Revisión de seguridad del panel (semana 3, tarea 3; checklist en `docs/seguridad/acl-panel.md`).
 * Lee las fuentes de `apps/web/app` y el OpenAPI de `packages/contracts` y comprueba que:
 *
 * 1. cada página declara su permiso y el menú pide el mismo;
 * 2. cada llamada a la API de una pantalla está cubierta por el permiso exacto del endpoint
 *    (`x-permiso`): el de la página, un `puede('…')` en el archivo o, en componentes que solo se
 *    abren desde otra pantalla, un `puede('…')` en cada archivo que los usa;
 * 3. cada enlace a otra sección se oculta sin el permiso de la página destino.
 */

const WEB = [process.cwd(), resolve(process.cwd(), 'apps/web')].find(ruta => existsSync(join(ruta, 'app/pages'))) ?? process.cwd()
const OPENAPI = resolve(WEB, '../../packages/contracts/openapi.json')

function leer(ruta: string): string {
    return readFileSync(ruta, 'utf8')
}

function vues(directorio: string): string[] {
    return (readdirSync(join(WEB, directorio), { recursive: true }) as string[])
        .filter(nombre => nombre.endsWith('.vue'))
        .map(nombre => join(WEB, directorio, nombre))
}

const PAGINAS = vues('app/pages')
const COMPONENTES = vues('app/components')
const ARCHIVOS = [...PAGINAS, ...COMPONENTES, ...vues('app/layouts')]

function relativo(ruta: string): string {
    return relative(WEB, ruta)
}

/** Permiso de la página: uno, o la lista de la que basta uno (`permiso: ['horus.ver', 'iris.ver']`). */
function permisoDePagina(texto: string): string | string[] | undefined {
    const meta = texto.match(/definePageMeta\(\{[^}]*permiso: ('[^']+'|\[[^\]]*\])/)?.[1]
    if (!meta) {
        return undefined
    }
    const lista = [...meta.matchAll(/'([^']+)'/g)].map(m => m[1] ?? '')
    return meta.startsWith('[') ? lista : lista[0]
}

/**
 * Si el permiso de la página cubre `permiso`. Una página con lista no cubre ninguno por sí sola:
 * se entra con cualquiera, así que cada llamada comprueba el suyo con `puede('…')`.
 */
function cubre(pagina: string | string[] | undefined, permiso: string): boolean {
    return typeof pagina === 'string' && pagina === permiso
}

/** Si el destino de un enlace (uno o una lista de la que basta uno) ya está comprobado. */
function destinoCubierto(destino: string | string[], pagina: string | string[] | undefined, vistos: Set<string>): boolean {
    return (typeof destino === 'string' ? [destino] : destino).some(permiso => cubre(pagina, permiso) || vistos.has(permiso))
}

/** El `<template>` de un archivo `.vue` (donde se montan los componentes), sin el `<script>`. */
function plantilla(texto: string): string {
    const inicio = texto.indexOf('<template')
    return inicio < 0 ? '' : texto.slice(inicio)
}

function comprobados(texto: string): Set<string> {
    return new Set([...texto.matchAll(/puede\w*\(\s*'([a-z_0-9.]+)'/g)].map(m => m[1] ?? ''))
}

/** `METODO /ruta` → permiso (`x-permiso` del OpenAPI). */
function permisosApi(): Map<string, string> {
    const spec = JSON.parse(leer(OPENAPI)) as { paths: Record<string, Record<string, { 'x-permiso'?: string }>> }
    const mapa = new Map<string, string>()
    for (const [ruta, operaciones] of Object.entries(spec.paths)) {
        for (const [metodo, operacion] of Object.entries(operaciones)) {
            if (operacion['x-permiso']) {
                mapa.set(`${metodo.toUpperCase()} ${ruta}`, operacion['x-permiso'])
            }
        }
    }
    return mapa
}

/** `useX` → función → endpoints que llama (`api.GET('/api/v1/…')`). */
function endpointsDeComposables(): Map<string, Map<string, string[]>> {
    const mapa = new Map<string, Map<string, string[]>>()
    for (const archivo of readdirSync(join(WEB, 'app/composables'))) {
        const funciones = new Map<string, string[]>()
        for (const parte of leer(join(WEB, 'app/composables', archivo)).split(/\n {4}(?:async )?function /).slice(1)) {
            const nombre = parte.match(/^(\w+)/)?.[1]
            if (nombre) {
                funciones.set(nombre, [...parte.matchAll(/api\.(GET|POST|PUT|DELETE)\('([^']+)'/g)].map(m => `${m[1]} ${m[2]}`))
            }
        }
        mapa.set(archivo.replace(/\.ts$/, ''), funciones)
    }
    return mapa
}

/** Llamadas `useX().f(` y `const { f } = useX()` de un archivo. */
function llamadas(texto: string): [string, string][] {
    const lista: [string, string][] = []
    for (const m of texto.matchAll(/(use[A-Z]\w*)\(\)\.(\w+)\(/g)) {
        lista.push([m[1] ?? '', m[2] ?? ''])
    }
    for (const m of texto.matchAll(/const \{([^}]+)\} = (use[A-Z]\w*)\(\)/g)) {
        for (const nombre of (m[1] ?? '').split(',').map(s => s.trim().split(':')[0]?.trim() ?? '')) {
            lista.push([m[2] ?? '', nombre])
        }
    }
    return lista
}

/** Permiso de la página a la que lleva un enlace (`/clientes/${id}?tab=cuenta` → `clientes.ver`). */
function permisoDeEnlace(destino: string, paginas: Map<string, string | string[]>): string | string[] | undefined {
    const ruta = destino.replace(/^[`'"]/, '').split(/[?#`'"]/)[0]?.replace(/\$\{[^}]+\}/g, ':id') ?? ''
    const partes = ruta.split('/').filter(Boolean)
    for (const [patron, permiso] of paginas) {
        const p = patron.split('/').filter(Boolean)
        if (p.length === partes.length && p.every((segmento, i) => segmento.startsWith(':') || segmento === partes[i] || (partes[i] === ':id' && segmento.startsWith(':')))) {
            return permiso
        }
    }
    return undefined
}

/** Ruta de cada página con su permiso (`app/pages/clientes/[id]/editar.vue` → `/clientes/:id/editar`). */
function rutasDePaginas(): Map<string, string | string[]> {
    const mapa = new Map<string, string | string[]>()
    // Las rutas fijas primero, para que `/clientes/nuevo` no caiga en `/clientes/:id`.
    const ordenadas = [...PAGINAS].sort((a, b) => Number(a.includes('[')) - Number(b.includes('[')))
    for (const archivo of ordenadas) {
        const permiso = permisoDePagina(leer(archivo))
        if (!permiso) {
            continue
        }
        const ruta = '/' + relative(join(WEB, 'app/pages'), archivo).replace(/\.vue$/, '').replace(/(^|\/)index$/, '').replace(/\[(\w+)\]/g, ':$1')
        mapa.set(ruta.replace(/\/$/, '') || '/', permiso)
    }
    return mapa
}

/**
 * Componentes que llaman acciones pero no deciden si se muestran: los abre otra pantalla, que
 * debe comprobar el permiso antes. Para cada uno, el permiso y quién lo abre.
 */
/**
 * `exentos`: quien abre el componente sin una de sus acciones, con el motivo en un comentario (la
 * ficha del plan solo edita: siempre le pasa el plan, así que nunca crea).
 */
const ABIERTOS_DESDE: Record<string, { permisos: string[], desde: string[], exentos?: Record<string, string[]> }> = {
    // LibroCierres solo se abre desde /libro/cierres (página con `libro.ver`): ya lo comprobó quien la abrió.
    // La ficha de la declaración (fase 7 PR B) la muestra con `tipo="impuestos"` solo con `libro.ver`.
    'CierreChecklist.vue': { permisos: ['libro.ver'], desde: ['components/LibroCierres.vue', 'pages/declaraciones/[id].vue'], exentos: { 'components/LibroCierres.vue': ['libro.ver'] } },
    'ProcesosDetenidos.vue': { permisos: ['facturas.ver'], desde: ['pages/libro/bloqueos.vue'] },
    'BloqueoLibroModal.vue': { permisos: ['libro.bloquear', 'libro.desbloquear'], desde: ['pages/libro/bloqueos.vue'] },
    'BloqueoDuroModal.vue': { permisos: ['libro.bloquear_duro'], desde: ['pages/libro/bloqueos.vue'] },
    'ExcepcionBloqueoModal.vue': { permisos: ['libro.excepcion_bloqueo'], desde: ['pages/libro/bloqueos.vue'] },
    // Libros legales con folio (fase 6 PR D): leen los folios del libro (`libros.ver`, el de la página).
    'EmitirLibroModal.vue': { permisos: ['libros.emitir', 'libros.ver'], desde: ['pages/libros/index.vue'] },
    'HabilitacionLibroModal.vue': { permisos: ['libros.habilitar', 'libros.ver'], desde: ['pages/libros/habilitaciones.vue'] },
    // «Nueva factura» (antes CargoUnicoModal): ficha del servicio, del cliente y lista de Facturas.
    'FacturaNuevaPanel.vue': { permisos: ['facturas.emitir_cargo_unico', 'facturas.ver'], desde: ['pages/servicios/[id]/index.vue', 'pages/clientes/[id]/index.vue', 'pages/facturas/index.vue'] },
    'PeriodosBonificados.vue': { permisos: ['facturas.ver'], desde: ['components/ClienteEstadoCuenta.vue', 'pages/servicios/[id]/index.vue'] },
    'AnularFacturaModal.vue': { permisos: ['facturas.anular', 'fel.anular'], desde: ['pages/facturas/[id].vue'] },
    'DteDocumento.vue': { permisos: ['fel.ver'], desde: ['pages/facturas/[id].vue', 'pages/notas-credito/[id].vue'] },
    'DteFicha.vue': { permisos: ['fel.ver'], desde: ['components/DteDocumento.vue', 'pages/dte/[id].vue'] },
    'FelCertificarAl.vue': { permisos: ['plantillas.ver'], desde: ['pages/configuracion/fel.vue'] },
    'FelCredencialesModal.vue': { permisos: ['fel.configurar'], desde: ['pages/configuracion/fel.vue'] },
    'SustituirFacturaModal.vue': { permisos: ['facturas.sustituir'], desde: ['pages/facturas/[id].vue'] },
    'CajaAperturaModal.vue': { permisos: ['cajas.abrir'], desde: ['pages/caja/index.vue'] },
    'CajaDepositoSlideover.vue': { permisos: ['cajas.depositar'], desde: ['pages/caja/index.vue'] },
    'CarteraCastigoModal.vue': { permisos: ['cartera.castigar', 'facturas.ver'], desde: ['pages/cartera/index.vue'] },
    'CarteraProvisionModal.vue': { permisos: ['cartera.provisionar'], desde: ['pages/cartera/index.vue'] },
    'ExtractoImportarModal.vue': { permisos: ['bancos.importar_extracto_archivo'], desde: ['pages/bancos/extractos/index.vue', 'pages/bancos/extractos/[id].vue'] },
    'LlegadaReatribuirModal.vue': { permisos: ['bancos.reatribuir_llegada', 'bancos.ver'], desde: ['pages/bancos/extractos/[id].vue'] },
    'LineaRegistrarModal.vue': { permisos: ['bancos.conciliar'], desde: ['pages/bancos/extractos/[id].vue'] },
    'LiquidacionRegistrarModal.vue': { permisos: ['cobros.liquidar'], desde: ['pages/cobros/por-liquidar.vue'] },
    'ProveedorCobroModal.vue': { permisos: ['cobros.configurar'], desde: ['pages/configuracion/proveedores-cobro.vue'] },
    'ReglaConciliacionModal.vue': { permisos: ['bancos.conciliar'], desde: ['pages/bancos/reglas.vue'] },
    'TrasladoModal.vue': { permisos: ['bancos.trasladar'], desde: ['pages/bancos/transito.vue'] },
    'ClientePuntos.vue': { permisos: ['lealtad.ver'], desde: ['pages/clientes/[id]/index.vue'] },
    'ClientePagos.vue': { permisos: ['pagos.ver'], desde: ['pages/clientes/[id]/index.vue'] },
    'ClientePromesas.vue': { permisos: ['promesas.ver'], desde: ['pages/clientes/[id]/index.vue'] },
    'ClienteContactos.vue': { permisos: ['contactos.buscar', 'clientes.ver'], desde: ['pages/clientes/[id]/index.vue'] },
    'ContactoAgregarSlideover.vue': { permisos: ['contactos.gestionar'], desde: ['components/ClienteContactos.vue'] },
    'ProgramaLealtadModal.vue': { permisos: ['lealtad.configurar'], desde: ['pages/lealtad/index.vue'] },
    // Anuncios del portal (A5, `contratos/anuncios.md`).
    'AnuncioFormulario.vue': { permisos: ['anuncios.administrar'], desde: ['pages/anuncios/index.vue', 'pages/anuncios/[id].vue'] },
    'AnuncioImagenModal.vue': { permisos: ['anuncios.administrar'], desde: ['pages/anuncios/[id].vue'] },
    'AnuncioMetricas.vue': { permisos: ['anuncios.ver'], desde: ['pages/anuncios/[id].vue'] },
    'PuntosAjusteModal.vue': { permisos: ['lealtad.ajustar'], desde: ['components/ClientePuntos.vue'] },
    'ReglaLealtadModal.vue': { permisos: ['lealtad.configurar'], desde: ['pages/lealtad/index.vue'] },
    'CajaCierreModal.vue': { permisos: ['cajas.cerrar'], desde: ['pages/caja/index.vue'] },
    'CajaCrearModal.vue': { permisos: ['cajas.crear'], desde: ['pages/caja/index.vue'] },
    'ClienteEstadoCuenta.vue': { permisos: ['clientes.estado_cuenta'], desde: ['pages/clientes/[id]/index.vue'] },
    'ClienteResponsablePago.vue': { permisos: ['clientes.ver'], desde: ['pages/clientes/[id]/index.vue'] },
    // Rediseño (decisión 13): la revisión en una sola vista se abre desde la cola y desde la pantalla del comprobante.
    'ComprobanteRevision.vue': { permisos: ['comprobantes.ver'], desde: ['pages/comprobantes/index.vue', 'pages/comprobantes/[id].vue'] },
    'ComprobanteArchivo.vue': { permisos: ['comprobantes.ver'], desde: ['components/ComprobanteRevision.vue'], exentos: { 'components/ComprobanteRevision.vue': ['comprobantes.ver'] } },
    'FacturaImpresion.vue': { permisos: ['facturas.ver'], desde: ['pages/facturas/index.vue', 'pages/facturas/[id].vue'] },
    'BitacoraDetalle.vue': { permisos: ['bitacora.ver'], desde: ['pages/bitacora/index.vue'] },
    'CuentaBancariaFormulario.vue': { permisos: ['cuentas_bancarias.editar'], desde: ['pages/configuracion/cuentas-bancarias.vue'] },
    'EgresoRegistrarModal.vue': { permisos: ['egresos.registrar'], desde: ['pages/egresos/index.vue'] },
    'EmpresaLogoModal.vue': { permisos: ['empresas.cambiar_logo'], desde: ['pages/configuracion/empresas.vue'] },
    'LibroCierres.vue': { permisos: ['libro.ver'], desde: ['pages/libro/cierres.vue'] },
    'LibroEstadoFinanciero.vue': { permisos: ['libro.ver'], desde: ['pages/reportes/balance.vue', 'pages/reportes/resultados.vue'] },
    'LibroDiarios.vue': { permisos: ['libro.ver'], desde: ['pages/libro/index.vue'] },
    'LibroIntegridad.vue': { permisos: ['libro.ver'], desde: ['pages/libro/integridad.vue'] },
    'LineaTiempoBitacora.vue': { permisos: ['bitacora.ver'], desde: ['pages/clientes/[id]/index.vue', 'pages/servicios/[id]/index.vue'] },
    'NotaCreditoModal.vue': { permisos: ['facturas.nota_credito'], desde: ['pages/facturas/[id].vue'] },
    // Formulario en página (rediseño): «Nuevo plan» solo crea y «Editar» solo edita.
    'PlanFormulario.vue': { permisos: ['planes.crear', 'planes.editar', 'planes.ver'], desde: ['pages/planes/nuevo.vue', 'pages/planes/[id]/editar.vue'], exentos: { 'pages/planes/nuevo.vue': ['planes.editar', 'planes.ver'], 'pages/planes/[id]/editar.vue': ['planes.crear', 'planes.ver'] } },
    // Servicios adicionales (A1, `contratos/adicionales.md`).
    'AdicionalBloqueosModal.vue': { permisos: ['servicios.ver'], desde: ['components/ServicioAdicionales.vue'] },
    'AdicionalCredencialModal.vue': { permisos: ['servicios.ver_credencial_adicional'], desde: ['components/ServicioAdicionales.vue'] },
    'AdicionalModal.vue': { permisos: ['adicionales.crear', 'adicionales.editar'], desde: ['pages/adicionales/index.vue'] },
    'AdicionalQuitarModal.vue': { permisos: ['servicios.quitar_adicional'], desde: ['components/ServicioAdicionales.vue'] },
    'AdicionalServicioModal.vue': { permisos: ['servicios.agregar_adicional', 'servicios.editar_adicional', 'adicionales.ver'], desde: ['components/ServicioAdicionales.vue'] },
    'MotivoCortesiaModal.vue': { permisos: ['adicionales.crear_motivo'], desde: ['pages/adicionales/motivos.vue'] },
    'PlanIncluidos.vue': { permisos: ['planes.ver'], desde: ['pages/planes/[id]/index.vue'] },
    'PlanAdicionalesModal.vue': { permisos: ['planes.editar', 'adicionales.ver'], desde: ['components/PlanIncluidos.vue'] },
    'ServicioAdicionales.vue': { permisos: ['servicios.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    'PromesaAprobarModal.vue': { permisos: ['promesas.aprobar'], desde: ['pages/promesas/index.vue'] },
    'ReciboCobro.vue': { permisos: ['pagos.ver'], desde: ['pages/cobro/index.vue'] },
    'PromesaCrearModal.vue': { permisos: ['promesas.crear'], desde: ['pages/servicios/[id]/index.vue'] },
    'PromesaSimularModal.vue': { permisos: ['promesas.ver'], desde: ['pages/servicios/[id]/index.vue', 'pages/promesas/index.vue'] },
    'RouterConexion.vue': { permisos: ['routers.ver'], desde: ['components/RouterAcciones.vue'], exentos: { 'components/RouterAcciones.vue': ['routers.ver'] } },
    'RouterVelocidad.vue': { permisos: ['routers.ver'], desde: ['components/RouterAcciones.vue'], exentos: { 'components/RouterAcciones.vue': ['routers.ver'] } },
    // Núcleo de routers: el control de velocidad, la salud y la red de acceso van en la ficha (`routers.ver`) y el panel lateral.
    'RouterControlVelocidad.vue': { permisos: ['routers.ver'], desde: ['components/RouterVelocidad.vue'], exentos: { 'components/RouterVelocidad.vue': ['routers.ver'] } },
    // Red de acceso (`contratos/red-acceso.md`, A1): la pestaña con `red_acceso.ver`; cada modal con el permiso de su acción.
    'RouterRedAcceso.vue': { permisos: ['red_acceso.ver', 'routers.ver'], desde: ['pages/routers/[id].vue'] },
    'OltsSlideover.vue': { permisos: ['red_acceso.ver', 'olts.crear', 'olts.editar'], desde: ['components/RouterRedAcceso.vue', 'pages/red/acceso.vue'], exentos: { 'components/RouterRedAcceso.vue': ['olts.crear', 'olts.editar'] } },
    'RedAccesoDescubrir.vue': { permisos: ['red_acceso.descubrir', 'red_acceso.adoptar'], desde: ['components/RouterRedAcceso.vue', 'pages/red/acceso.vue'], exentos: { 'components/RouterRedAcceso.vue': ['red_acceso.adoptar'], 'pages/red/acceso.vue': ['red_acceso.adoptar'] } },
    'VlanModal.vue': { permisos: ['vlans.crear', 'vlans.editar'], desde: ['components/RouterRedAcceso.vue'] },
    'TomarControlModal.vue': { permisos: ['red_acceso.tomar_control'], desde: ['components/RouterRedAcceso.vue'] },
    'ServidorPppoeModal.vue': { permisos: ['servidores_pppoe.crear', 'servidores_pppoe.editar'], desde: ['components/RouterRedAcceso.vue'] },
    'RouterExcepcionesAviso.vue': { permisos: ['routers.ver'], desde: ['components/RouterControlVelocidad.vue', 'components/RouterVelocidadPanel.vue'], exentos: { 'components/RouterControlVelocidad.vue': ['routers.ver'], 'components/RouterVelocidadPanel.vue': ['routers.ver'] } },
    // Menú de acciones del router: lo montan la lista y la ficha (las dos con `routers.ver`).
    'RouterAcciones.vue': { permisos: ['routers.ver'], desde: ['pages/routers/index.vue', 'pages/routers/[id].vue'] },
    // Direccionamiento del router (contratos/pools.md): lo monta la ficha (`routers.ver`) y abre los
    // modales solo con el permiso de cada acción; `redes.ver` lo da quien puede editar la red.
    'RouterDireccionamiento.vue': { permisos: ['routers.ver'], desde: ['pages/routers/[id].vue'] },
    'RedIpv4Modal.vue': { permisos: ['redes.crear', 'redes.editar', 'redes.ver'], desde: ['components/RouterDireccionamiento.vue', 'pages/red/ips.vue'], exentos: { 'components/RouterDireccionamiento.vue': ['redes.ver'] } },
    'Ipv6BloqueModal.vue': { permisos: ['ipv6.crear', 'ipv6.editar'], desde: ['components/RouterDireccionamiento.vue'] },
    'Ipv6PoolModal.vue': { permisos: ['ipv6.crear', 'ipv6.editar'], desde: ['components/RouterDireccionamiento.vue'] },
    'PoolMigrarModal.vue': { permisos: ['redes.migrar', 'ipv6.migrar', 'routers.ver'], desde: ['components/RouterDireccionamiento.vue'], exentos: { 'components/RouterDireccionamiento.vue': ['routers.ver'] } },
    // Conexión por WireGuard (contratos/conexion-routers.md): la ficha monta la sección (`routers.ver`) y
    // cada botón comprueba su permiso; el script lo abren la sección y el menú de acciones.
    'RouterConexionSeccion.vue': { permisos: ['routers.ver'], desde: ['pages/routers/[id].vue'] },
    'RouterPruebaConexionModal.vue': { permisos: ['routers.probar_conexion'], desde: ['components/RouterAcciones.vue', 'pages/routers/[id].vue', 'pages/routers/index.vue'] },
    'RouterClaveModal.vue': { permisos: ['routers.conexion_clave'], desde: ['components/RouterConexionSeccion.vue', 'pages/routers/nuevo.vue'] },
    // Con `modo="rotar"` usa `routers.rotar_conexion`; el menú de acciones solo lo abre para generar.
    'RouterScriptModal.vue': { permisos: ['routers.generar_script', 'routers.rotar_conexion'], desde: ['components/RouterConexionSeccion.vue', 'components/RouterAcciones.vue'], exentos: { 'components/RouterAcciones.vue': ['routers.rotar_conexion'] } },
    // También desde «Probar conexión» (el diagnóstico de corte ofrece «Editar router» si el portal ve otra IP);
    // las dos se abren solo desde la lista y la ficha de routers, que exigen `routers.ver`.
    'RouterEditarModal.vue': { permisos: ['routers.editar', 'routers.ver'], desde: ['components/RouterAcciones.vue', 'components/RouterPruebaConexionModal.vue', 'pages/routers/[id].vue'], exentos: { 'components/RouterAcciones.vue': ['routers.ver'], 'components/RouterPruebaConexionModal.vue': ['routers.ver'] } },
    'ServicioCambiarEmpresaModal.vue': { permisos: ['servicios.cambiar_empresa'], desde: ['pages/servicios/[id]/index.vue'] },
    // Solo se monta con `puedeActivarInstalacion` (servicios.activar_instalacion); recarga con el servicios.ver de la página.
    'ServicioActivarInstalacionModal.vue': { permisos: ['servicios.activar_instalacion', 'servicios.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    'ServicioSincronizarRouterModal.vue': { permisos: ['servicios.sincronizar_router'], desde: ['pages/servicios/[id]/index.vue'] },
    'ServicioAsignaciones.vue': { permisos: ['servicios.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    'ServicioSesiones.vue': { permisos: ['sesiones.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    'ServicioEditar.vue': { permisos: ['servicios.editar', 'servicios.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    'UsuarioEmpresasModal.vue': { permisos: ['usuarios.asignar_empresas'], desde: ['pages/usuarios/index.vue'] },
    'SorteoFormulario.vue': { permisos: ['sorteos.gestionar'], desde: ['pages/lealtad/sorteos/index.vue', 'pages/lealtad/sorteos/[id].vue'] },
    'SorteoEjecutarModal.vue': { permisos: ['sorteos.ejecutar'], desde: ['pages/lealtad/sorteos/[id].vue'] },
    'SorteoImagenPremioModal.vue': { permisos: ['sorteos.gestionar'], desde: ['pages/lealtad/sorteos/[id].vue'] },
    'SorteoAnularEntregaModal.vue': { permisos: ['sorteos.entregar'], desde: ['pages/lealtad/sorteos/[id].vue'] },
    'SorteoEntregarModal.vue': { permisos: ['sorteos.entregar'], desde: ['pages/lealtad/sorteos/[id].vue'] },
    'SorteoMarcarRequisitoModal.vue': { permisos: ['sorteos.marcar_requisito'], desde: ['pages/lealtad/sorteos/[id].vue'] },
    // Fase 5 (A3): proveedores, compras, pagos a proveedores, activos y diferidos.
    'ProveedorModal.vue': { permisos: ['proveedores.editar'], desde: ['pages/proveedores/index.vue', 'pages/proveedores/[id].vue'] },
    'PagoProveedorModal.vue': { permisos: ['compras.pagar'], desde: ['pages/proveedores/[id].vue'] },
    'ConstanciaCompraModal.vue': { permisos: ['compras.registrar'], desde: ['pages/compras/[id].vue'] },
    'DiferirLineaModal.vue': { permisos: ['libro.registrar_asiento'], desde: ['pages/compras/[id].vue'] },
    'ActivoAltaModal.vue': { permisos: ['activos.registrar'], desde: ['pages/activos/index.vue'] },
    'BajaActivoModal.vue': { permisos: ['activos.dar_de_baja'], desde: ['pages/activos/[id].vue'] },
    // Tarea 8 y 9 (pantallas pendientes): plantillas, usuarios, roles y tokens de API. La página
    // abre el formulario en solo lectura sin el permiso de editar (y lo dice el propio formulario).
    'PlantillaFormulario.vue': { permisos: ['plantillas.crear', 'plantillas.editar', 'plantillas.ver'], desde: ['pages/plantillas/index.vue'] },
    // Plantillas de fábrica (18 nov): la página solo lo monta con `plantillas.asignar_sin_plantilla`.
    'PlantillaAsignarSinPlantillaModal.vue': { permisos: ['plantillas.asignar_sin_plantilla'], desde: ['pages/plantillas/index.vue'] },
    'UsuarioFormulario.vue': { permisos: ['usuarios.crear', 'usuarios.editar'], desde: ['pages/usuarios/index.vue'] },
    'RolFormulario.vue': { permisos: ['roles.crear', 'roles.editar'], desde: ['pages/usuarios/roles.vue'] },
    'TokenApiModal.vue': { permisos: ['tokens.crear'], desde: ['pages/usuarios/tokens.vue'] },
    // Pendientes de la prioridad 2: avisos, plan por router, router nuevo.
    'PlantillaNotificacionModal.vue': { permisos: ['notificaciones.editar', 'notificaciones.ver'], desde: ['pages/notificaciones/index.vue'] },
    'RecordatorioPagoModal.vue': { permisos: ['notificaciones.editar'], desde: ['pages/notificaciones/index.vue'] },
    // Secciones de fichas: leen con el permiso de la ficha que las monta.
    // Eliminar sin historial (`contratos/eliminar.md`): cada ficha comprueba el suyo.
    'EliminarRegistroModal.vue': { permisos: ['servicios.eliminar', 'routers.eliminar'], desde: ['pages/servicios/[id]/index.vue', 'pages/routers/[id].vue'], exentos: { 'pages/servicios/[id]/index.vue': ['routers.eliminar'], 'pages/routers/[id].vue': ['servicios.eliminar'] } },
    // Rediseño de Red (tablero RedPlanForm): la ficha del plan es `planes/[id]/index.vue` y su edición `planes/[id]/editar.vue`.
    'PlanRouters.vue': { permisos: ['planes.ver'], desde: ['pages/planes/[id]/index.vue'] },
    // Rediseño de Red: el plan elegido al lado de la lista (RedPlanes) y las pestañas de la ficha del router (RedRouterFicha).
    'RedPlanDetalle.vue': { permisos: ['planes.ver'], desde: ['pages/planes/index.vue'] },
    'RouterResumen.vue': { permisos: ['routers.ver'], desde: ['pages/routers/[id].vue'] },
    'RouterVelocidadPanel.vue': { permisos: ['routers.ver'], desde: ['pages/routers/[id].vue'] },
    'RouterBitacoraComandos.vue': { permisos: ['red.ver'], desde: ['pages/routers/[id].vue'] },
    // Control de velocidad por capas (`contratos/control-velocidad.md`, A2).
    // La matriz pide `routers.ver`: «Velocidad» solo se abre desde la lista de routers, que ya lo exige.
    // También desde «Velocidad» de la ficha rediseñada (RouterVelocidadPanel), que solo monta la ficha (`routers.ver`).
    'EstrategiaVelocidadModal.vue': { permisos: ['routers.cambiar_control_velocidad', 'routers.ver'], desde: ['components/RouterControlVelocidad.vue'], exentos: { 'components/RouterControlVelocidad.vue': ['routers.ver'], 'components/RouterVelocidadPanel.vue': ['routers.ver'] } },
    'SincronizarPlanModal.vue': { permisos: ['planes.sincronizar'], desde: ['components/PlanRouters.vue', 'pages/planes/[id]/index.vue', 'pages/planes/index.vue'] },
    // «Reconciliar ahora» con vista previa: desde el menú del router, «Velocidad» y el chequeo del corte de «Probar conexión».
    'RouterReconciliarModal.vue': { permisos: ['routers.reconciliar'], desde: ['components/RouterAcciones.vue', 'components/RouterControlVelocidad.vue', 'components/RouterRedAcceso.vue', 'components/RouterPruebaConexionModal.vue', 'pages/routers/[id].vue'] },
    'ServicioConfiguracionEfectiva.vue': { permisos: ['servicios.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    'ServicioPlanesTemporales.vue': { permisos: ['servicios.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    // Código de corte (`contratos/corte-identificacion.md`): lee con el `servicios.ver` de la ficha.
    'ServicioCodigoCorte.vue': { permisos: ['servicios.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    'CorteAhoraBoton.vue': { permisos: ['facturas.generar'], desde: ['pages/facturas/index.vue'] },
    'CertificarLoteModal.vue': { permisos: ['fel.certificar'], desde: ['pages/dte/index.vue'] },
    'PremioLealtadModal.vue': { permisos: ['lealtad.configurar'], desde: ['pages/lealtad/premios.vue'] },
    'BodegaFormulario.vue': { permisos: ['bodegas.crear', 'bodegas.editar'], desde: ['pages/inventario/bodegas.vue'] },
    'ProductoFormulario.vue': { permisos: ['productos.crear', 'productos.editar', 'inventario.ver'], desde: ['pages/inventario/productos.vue'] },
    'TipoProductoFormulario.vue': { permisos: ['tipos_producto.crear', 'tipos_producto.editar'], desde: ['pages/inventario/tipos-producto.vue'] },
    // Rediseño de inventario (A47/A48): las operaciones a mano se abren desde las acciones del encabezado,
    // que solo montan las páginas de inventario (`inventario.ver`) y comprueban el permiso de cada operación.
    'InventarioAcciones.vue': { permisos: ['inventario.ver'], desde: ['pages/inventario/index.vue', 'pages/inventario/unidades.vue', 'pages/inventario/kardex.vue', 'pages/inventario/por-recuperar/index.vue', 'pages/inventario/revision.vue'] },
    'MovimientoInventarioModal.vue': { permisos: ['inventario.ver'], desde: ['components/InventarioAcciones.vue'], exentos: { 'components/InventarioAcciones.vue': ['inventario.ver'] } },
    // Marco de las pantallas de inventario: lee los contadores de las pestañas con el `inventario.ver` de la página.
    'InventarioMarco.vue': { permisos: ['inventario.ver'], desde: ['pages/inventario/index.vue', 'pages/inventario/unidades.vue', 'pages/inventario/kardex.vue', 'pages/inventario/por-recuperar/index.vue', 'pages/inventario/revision.vue'] },
    'InventarioTrasladosLista.vue': { permisos: ['inventario.ver'], desde: ['pages/inventario/traslados/index.vue', 'pages/inventario/bodegas.vue'] },
    // Acciones sobre un equipo (A48): EquipoAcciones lo montan Equipos, Por recuperar y Revisión (`inventario.ver`)
    // y monta cada ventana solo con el permiso de su acción; `ejecutar` tampoco abre una acción sin él.
    'EquipoAcciones.vue': { permisos: ['inventario.ver'], desde: ['pages/inventario/unidades.vue', 'pages/inventario/por-recuperar/index.vue', 'pages/inventario/revision.vue'] },
    'CobroEquipoAprobarModal.vue': { permisos: ['inventario.cobrar_equipo'], desde: ['pages/inventario/por-recuperar/index.vue'] },
    // Elegir la unidad nueva lee con `inventario.ver`: lo tienen las páginas de inventario que montan EquipoAcciones
    // y la ficha del servicio solo monta ServicioEquipos con `inventario.ver`.
    'EquipoCambiarModal.vue': { permisos: ['servicios.cambiar_equipo', 'inventario.ver'], desde: ['components/EquipoAcciones.vue', 'components/ServicioEquipos.vue'], exentos: { 'components/EquipoAcciones.vue': ['inventario.ver'], 'components/ServicioEquipos.vue': ['inventario.ver'] } },
    'EquipoContactoModal.vue': { permisos: ['inventario.registrar_contacto_recuperacion'], desde: ['components/EquipoAcciones.vue', 'pages/inventario/por-recuperar/[id].vue'] },
    'EquipoDevolverModal.vue': { permisos: ['inventario.devolver_comodato'], desde: ['components/EquipoAcciones.vue'] },
    'EquipoGarantiaModal.vue': { permisos: ['inventario.enviar_garantia', 'inventario.resolver_garantia'], desde: ['components/EquipoAcciones.vue'] },
    'EquipoNoRecuperadoModal.vue': { permisos: ['inventario.cobrar_equipo'], desde: ['components/EquipoAcciones.vue', 'pages/inventario/por-recuperar/[id].vue'] },
    // Pendientes del backend (23 nov): cada ventana solo se abre con el permiso de su acción.
    'IntentoDecidirModal.vue': { permisos: ['inventario.decidir_intento_recuperacion'], desde: ['pages/inventario/por-recuperar/[id].vue'] },
    'BancoOrigenModal.vue': { permisos: ['bancos_origen.crear', 'bancos_origen.editar'], desde: ['pages/configuracion/bancos-origen.vue'] },
    'CorreoExternoModal.vue': { permisos: ['reportes.aprobar_correo_externo'], desde: ['pages/reportes/envios.vue'] },
    // Plan de contabilidad P2: cada ventana se monta solo con el permiso de su acción.
    'AsientoManualSlideover.vue': { permisos: ['libro.registrar_asiento'], desde: ['pages/libro/index.vue'] },
    // «Por aprobar» lista con el `libro.ver` de la página del libro.
    'LibroBorradores.vue': { permisos: ['libro.ver'], desde: ['pages/libro/index.vue'] },
    'CarteraGestionModal.vue': { permisos: ['gestiones_cobro.registrar'], desde: ['pages/cartera/index.vue'] },
    'ReporteEnvioModal.vue': { permisos: ['reportes.programar_envio'], desde: ['pages/reportes/[reporte].vue'] },
    // SmartOLT y ACS por separado: la página de integraciones se abre con cualquiera de sus permisos y monta la
    // lista de SmartOLT con `smartolt.ver` y el ACS con `acs.ver` (según `?ver=`, que solo lista lo permitido).
    'ConfiguracionSmartOlt.vue': { permisos: ['smartolt.ver'], desde: ['pages/configuracion/integraciones/index.vue'] },
    'ConfiguracionAcs.vue': { permisos: ['acs.ver'], desde: ['pages/configuracion/integraciones/index.vue'] },
    // El formulario de una instancia lo montan sus dos páginas (`smartolt.crear_instancia` y `smartolt.editar_instancia`).
    'SmartOltFormulario.vue': { permisos: ['smartolt.crear_instancia', 'smartolt.editar_instancia'], desde: ['pages/configuracion/integraciones/smartolt/nueva.vue', 'pages/configuracion/integraciones/smartolt/[id]/editar.vue'], exentos: { 'pages/configuracion/integraciones/smartolt/nueva.vue': ['smartolt.editar_instancia'], 'pages/configuracion/integraciones/smartolt/[id]/editar.vue': ['smartolt.crear_instancia'] } },
    // Ficha del servicio › Equipo: la pestaña solo con `servicios.ver_equipo`.
    'ServicioEquipoGestion.vue': { permisos: ['servicios.ver_equipo'], desde: ['pages/servicios/[id]/index.vue'] },
    'ServicioEquipos.vue': { permisos: ['inventario.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    'ServicioCambiarEquipo.vue': { permisos: ['servicios.cambiar_equipo'], desde: ['pages/servicios/[id]/index.vue'] },
    'UnidadInventarioDetalle.vue': { permisos: ['inventario.ver'], desde: ['pages/inventario/unidades.vue'] },
    'CampoPersonalizadoFormulario.vue': { permisos: ['campos_personalizados.crear', 'campos_personalizados.editar'], desde: ['pages/campos-personalizados.vue'] },
    'CanjeLealtadModal.vue': { permisos: ['lealtad.canjear', 'lealtad.ver'], desde: ['pages/lealtad/canjes.vue'] },
    // Routers duplicados (A1, `contratos/routers.md`): el aviso en la lista y la ficha; «Unir» solo con `routers.unir`.
    // El aviso no repite `routers.ver`: solo se monta en las páginas de routers, que ya lo exigen.
    'RoutersDuplicadosAviso.vue': { permisos: ['routers.ver'], desde: ['pages/routers/index.vue', 'pages/routers/[id].vue'] },
    'RouterUnirModal.vue': { permisos: ['routers.unir', 'routers.ver'], desde: ['components/RoutersDuplicadosAviso.vue'], exentos: { 'components/RoutersDuplicadosAviso.vue': ['routers.ver'] } },
    // Alta de servicio: la página tiene `servicios.crear`; el panel lateral lo abre la ficha del cliente, que lo comprueba.
    'ServicioAltaFormulario.vue': { permisos: ['servicios.crear'], desde: ['pages/servicios/nuevo.vue', 'components/ServicioAltaSlideover.vue'], exentos: { 'components/ServicioAltaSlideover.vue': ['servicios.crear'] } },
    'ServicioAltaSlideover.vue': { permisos: ['servicios.crear'], desde: ['pages/clientes/[id]/index.vue'] },
    // Alta desde la lista (`clientes.crear`) y edición desde la ficha (`clientes.editar`).
    // QoS por clases (`contratos/qos.md`, A2): los modales con `qos.gestionar`; la sección de la ficha del router con `qos.ver`.
    'QosClaseModal.vue': { permisos: ['qos.gestionar'], desde: ['pages/red/qos/[id].vue'] },
    'QosPerfilModal.vue': { permisos: ['qos.gestionar'], desde: ['pages/red/qos/index.vue', 'pages/red/qos/[id].vue'] },
    'RouterQos.vue': { permisos: ['qos.ver'], desde: ['components/RouterVelocidadPanel.vue'] },
    // Inventario fase D (`contratos/inventario.md` D.1): recibir y el papel firmado se abren desde el detalle
    // de la orden y desde «Mi bodega», que comprueban el permiso de la acción; leen con el `inventario.ver` de la página.
    'TrasladoRecibirSlideover.vue': { permisos: ['inventario.recibir_traslado', 'inventario.ver'], desde: ['pages/inventario/traslados/[id].vue', 'pages/inventario/mi-bodega.vue'] },
    'TrasladoDocumentoModal.vue': { permisos: ['inventario.adjuntar_documento_traslado'], desde: ['pages/inventario/traslados/[id].vue'] },
    // Contrato Iris 0.6.0: el WhatsApp de la ficha con `notificaciones.ver`; rechazar con causa con `comprobantes.rechazar`.
    'ClienteWhatsapp.vue': { permisos: ['notificaciones.ver'], desde: ['pages/clientes/[id]/index.vue'] },
    // Comprobante por WhatsApp tras cobrar (vía Iris): lee el estado del envío con `pagos.ver`.
    'ReciboWhatsapp.vue': { permisos: ['pagos.ver'], desde: ['pages/cobro/index.vue'] },
    // Contraseña del portal (A5): la tarjeta lee con el `clientes.ver` de la ficha; «Restaurar» lo comprueba con `puede()`.
    'ClientePortal.vue': { permisos: ['clientes.ver'], desde: ['pages/clientes/[id]/index.vue'] },
    'ComprobanteRechazarModal.vue': { permisos: ['comprobantes.rechazar'], desde: ['components/ComprobanteRevision.vue'] },
    // Tipo de conexión por router (`contratos/tipo-conexion-router.md`): la sección de la ficha lee con el
    // `routers.ver` de la página; el modal se monta solo con `routers.cambiar_tipo_conexion`.
    'RouterTipoConexion.vue': { permisos: ['routers.ver'], desde: ['components/RouterVelocidadPanel.vue'], exentos: { 'components/RouterVelocidadPanel.vue': ['routers.ver'] } },
    'CambiarTipoConexionModal.vue': { permisos: ['routers.cambiar_tipo_conexion', 'routers.ver'], desde: ['components/RouterTipoConexion.vue'], exentos: { 'components/RouterTipoConexion.vue': ['routers.ver'] } },
    // Desde el rediseño, «Nuevo cliente» abre su página (`/clientes/nuevo`): el panel lateral queda para editar desde la ficha.
    // Promociones de velocidad (decisiones del PM 18 y 34): el detalle lee con el `promociones_velocidad.ver`
    // de sus páginas; cada ventana se monta solo con el permiso de su acción.
    'PromocionDetalle.vue': { permisos: ['promociones_velocidad.ver'], desde: ['pages/planes/promociones/index.vue', 'pages/planes/promociones/[id].vue'] },
    'PromocionFormulario.vue': { permisos: ['promociones_velocidad.crear'], desde: ['pages/planes/promociones/nueva.vue'] },
    'PromocionAsignarModal.vue': { permisos: ['promociones_velocidad.asignar'], desde: ['components/PromocionDetalle.vue'] },
    'PromocionQuitarModal.vue': { permisos: ['promociones_velocidad.quitar'], desde: ['components/PromocionDetalle.vue', 'components/ServicioPromociones.vue'] },
    'ServicioPromociones.vue': { permisos: ['servicios.ver'], desde: ['pages/servicios/[id]/index.vue'] },
    'ServicioAgregarPromocionModal.vue': { permisos: ['promociones_velocidad.asignar', 'promociones_velocidad.ver'], desde: ['components/ServicioPromociones.vue'] },
    'ClienteSlideover.vue': { permisos: ['clientes.crear', 'clientes.editar', 'clientes.ver'], desde: ['pages/clientes/[id]/index.vue'], exentos: { 'pages/clientes/[id]/index.vue': ['clientes.crear'] } },
}

describe('semana 3 · ACL por pantalla (revisión estática)', () => {
    const rutas = rutasDePaginas()

    it('cada página declara su permiso; el menú pide el mismo que la página', () => {
        const sinPermiso = PAGINAS
            // Sin permiso a propósito: login, autologin desde Horus (`sso/entrar`), la explicación del
            // enlace de conexión (`conectar`) y "Mi cuenta" (`perfil`, cualquier usuario con sesión).
            // «Conectar con un botón» (`integraciones/iris/autorizar`) comprueba `iris.configurar` con
            // `puede()` y lo dice en su propia pantalla, sin menú y sin redirigir a Iris.
            .filter(archivo => !/\/(login|sin-permiso|index|conectar|perfil|restablecer-contrasena|sso\/entrar|integraciones\/iris\/autorizar)\.vue$/.test(archivo) || /pages\/\w[\w-]*\/index\.vue$/.test(archivo))
            .filter(archivo => !permisoDePagina(leer(archivo)))
            .map(relativo)
        expect(sinPermiso).toEqual([])
        for (const seccion of SECCIONES_PANEL) {
            if (seccion.soloRol) {
                // Sin permiso propio todavía (Importar desde Mikrowisp): la página exige ese rol en su
                // middleware y el menú la muestra solo a ese rol (`puedeSeccion`).
                const archivo = PAGINAS.find(ruta => ruta.endsWith(`pages${seccion.ruta}.vue`) || ruta.endsWith(`pages${seccion.ruta}/index.vue`))
                expect([seccion.ruta, archivo && leer(archivo).includes(`roles?.includes('${seccion.soloRol}')`)]).toEqual([seccion.ruta, true])
                expect([seccion.ruta, seccion.permiso]).toEqual([seccion.ruta, SIN_PERMISO])
                continue
            }
            expect([seccion.ruta, rutas.get(seccion.ruta)]).toEqual([seccion.ruta, seccion.permiso])
        }
    })

    it('cada llamada a la API está cubierta por el permiso exacto de su endpoint', () => {
        const api = permisosApi()
        const composables = endpointsDeComposables()
        const huecos: string[] = []
        for (const archivo of ARCHIVOS) {
            const texto = leer(archivo)
            const pagina = permisoDePagina(texto)
            const vistos = comprobados(texto)
            const componente = ABIERTOS_DESDE[archivo.split('/').at(-1) ?? '']
            for (const [composable, funcion] of llamadas(texto)) {
                for (const endpoint of composables.get(composable)?.get(funcion) ?? []) {
                    const permiso = api.get(endpoint)
                    if (!permiso || cubre(pagina, permiso) || vistos.has(permiso) || componente?.permisos.includes(permiso)) {
                        continue
                    }
                    huecos.push(`${relativo(archivo)}: ${composable}().${funcion} → ${endpoint} pide ${permiso}`)
                }
            }
        }
        expect(huecos.join('\n')).toBe('')
    })

    it('los componentes de acción solo se abren desde pantallas que comprueban su permiso', () => {
        const huecos: string[] = []
        for (const [componente, { permisos, desde, exentos }] of Object.entries(ABIERTOS_DESDE)) {
            const nombre = componente.replace(/\.vue$/, '')
            // Solo en la plantilla: `shallowRef<UnidadInventarioDetalle>` es un tipo con el nombre del componente, no lo monta.
            const usuarios = ARCHIVOS.filter(archivo => plantilla(leer(archivo)).includes(`<${nombre}`)).map(archivo => relativo(archivo).replace(/^app\//, ''))
            for (const archivo of usuarios) {
                const texto = leer(join(WEB, 'app', archivo))
                const pagina = permisoDePagina(texto)
                for (const permiso of permisos) {
                    if (!cubre(pagina, permiso) && !comprobados(texto).has(permiso) && !exentos?.[archivo]?.includes(permiso)) {
                        huecos.push(`${archivo} abre ${componente} sin comprobar ${permiso}`)
                    }
                }
            }
            for (const archivo of desde) {
                expect(usuarios, `${componente} debería abrirse desde ${archivo}`).toContain(archivo)
            }
        }
        expect(huecos.join('\n')).toBe('')
    })

    it('cada enlace a otra sección se oculta sin el permiso de la página destino', () => {
        const huecos: string[] = []
        for (const archivo of ARCHIVOS) {
            const texto = leer(archivo)
            const pagina = permisoDePagina(texto)
            const vistos = comprobados(texto)
            const lineas = texto.split('\n')
            for (const m of texto.matchAll(/(?::to="|\bto="|\bto: |navigateTo\()\s*([`'"]?\/[^"\s,)]*)/g)) {
                const permiso = permisoDeEnlace(m[1] ?? '', rutas)
                const linea = texto.slice(0, m.index).split('\n').length
                const conGuardia = /enlace\(|puedeAbrir\(|destinoPermitido\(/.test(lineas[linea - 1] ?? '')
                if (!permiso || destinoCubierto(permiso, pagina, vistos) || conGuardia) {
                    continue
                }
                huecos.push(`${relativo(archivo)}:${linea} enlaza ${m[1]} (pide ${permiso})`)
            }
        }
        expect(huecos.join('\n')).toBe('')
    })
})
