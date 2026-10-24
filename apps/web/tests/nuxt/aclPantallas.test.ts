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

function permisoDePagina(texto: string): string | undefined {
    return texto.match(/definePageMeta\(\{[^}]*permiso: '([^']+)'/)?.[1]
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
function permisoDeEnlace(destino: string, paginas: Map<string, string>): string | undefined {
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
function rutasDePaginas(): Map<string, string> {
    const mapa = new Map<string, string>()
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
    // LibroCierres solo se abre desde /libro (página con `libro.ver`): ya lo comprobó quien la abrió.
    // La ficha de la declaración (fase 7 PR B) la muestra con `tipo="impuestos"` solo con `libro.ver`.
    'CierreChecklist.vue': { permisos: ['libro.ver'], desde: ['components/LibroCierres.vue', 'pages/declaraciones/[id].vue'], exentos: { 'components/LibroCierres.vue': ['libro.ver'] } },
    'ProcesosDetenidos.vue': { permisos: ['facturas.ver'], desde: ['pages/libro/bloqueos.vue'] },
    'BloqueoLibroModal.vue': { permisos: ['libro.bloquear', 'libro.desbloquear'], desde: ['pages/libro/bloqueos.vue'] },
    'BloqueoDuroModal.vue': { permisos: ['libro.bloquear_duro'], desde: ['pages/libro/bloqueos.vue'] },
    'ExcepcionBloqueoModal.vue': { permisos: ['libro.excepcion_bloqueo'], desde: ['pages/libro/bloqueos.vue'] },
    // Libros legales con folio (fase 6 PR D): leen los folios del libro (`libros.ver`, el de la página).
    'EmitirLibroModal.vue': { permisos: ['libros.emitir', 'libros.ver'], desde: ['pages/libros/index.vue'] },
    'HabilitacionLibroModal.vue': { permisos: ['libros.habilitar', 'libros.ver'], desde: ['pages/libros/habilitaciones.vue'] },
    'CargoUnicoModal.vue': { permisos: ['facturas.emitir_cargo_unico', 'facturas.ver'], desde: ['pages/servicios/[id].vue', 'pages/clientes/[id]/index.vue'] },
    'PeriodosBonificados.vue': { permisos: ['facturas.ver'], desde: ['components/ClienteEstadoCuenta.vue', 'pages/servicios/[id].vue'] },
    'AnularFacturaModal.vue': { permisos: ['facturas.anular', 'fel.anular'], desde: ['pages/facturas/[id].vue'] },
    'DteDocumento.vue': { permisos: ['fel.ver'], desde: ['pages/facturas/[id].vue', 'pages/notas-credito/[id].vue'] },
    'DteFicha.vue': { permisos: ['fel.ver'], desde: ['components/DteDocumento.vue', 'pages/dte/[id].vue'] },
    'FelCertificarAl.vue': { permisos: ['plantillas.ver'], desde: ['pages/configuracion/fel.vue'] },
    'FelCredencialesModal.vue': { permisos: ['fel.configurar'], desde: ['pages/configuracion/fel.vue'] },
    'SustituirFacturaModal.vue': { permisos: ['facturas.sustituir'], desde: ['pages/facturas/[id].vue'] },
    'CajaAperturaModal.vue': { permisos: ['cajas.abrir'], desde: ['pages/caja/index.vue'] },
    'CajaDepositoModal.vue': { permisos: ['cajas.depositar'], desde: ['pages/caja/index.vue'] },
    'CarteraCastigoModal.vue': { permisos: ['cartera.castigar', 'facturas.ver'], desde: ['pages/cartera/index.vue'] },
    'CarteraProvisionModal.vue': { permisos: ['cartera.provisionar'], desde: ['pages/cartera/index.vue'] },
    'ConciliarLineaSlideover.vue': { permisos: ['bancos.conciliar', 'bancos.ver'], desde: ['pages/bancos/extractos/[id].vue'] },
    'ExtractoImportarModal.vue': { permisos: ['bancos.importar_extracto'], desde: ['pages/bancos/extractos/index.vue'] },
    'LlegadaReatribuirModal.vue': { permisos: ['bancos.reatribuir_llegada', 'bancos.ver'], desde: ['pages/bancos/extractos/[id].vue'] },
    'LineaRegistrarModal.vue': { permisos: ['bancos.conciliar'], desde: ['pages/bancos/extractos/[id].vue'] },
    'LiquidacionRegistrarModal.vue': { permisos: ['cobros.liquidar'], desde: ['pages/cobros/por-liquidar.vue'] },
    'ProveedorCobroModal.vue': { permisos: ['cobros.configurar'], desde: ['pages/configuracion/proveedores-cobro.vue'] },
    'ReglaConciliacionModal.vue': { permisos: ['bancos.conciliar'], desde: ['pages/bancos/reglas.vue'] },
    'TrasladoModal.vue': { permisos: ['bancos.trasladar'], desde: ['pages/bancos/transito.vue'] },
    'ClientePuntos.vue': { permisos: ['lealtad.ver'], desde: ['pages/clientes/[id]/index.vue'] },
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
    'ComprobanteAprobarModal.vue': { permisos: ['comprobantes.aprobar'], desde: ['pages/comprobantes/[id].vue'] },
    'ComprobanteArchivo.vue': { permisos: ['comprobantes.ver'], desde: ['pages/comprobantes/[id].vue'] },
    'CuentaBancariaFormulario.vue': { permisos: ['cuentas_bancarias.editar'], desde: ['pages/configuracion/cuentas-bancarias.vue'] },
    'EgresoRegistrarModal.vue': { permisos: ['egresos.registrar'], desde: ['pages/egresos/index.vue'] },
    'EmpresaLogoModal.vue': { permisos: ['empresas.cambiar_logo'], desde: ['pages/configuracion/empresas.vue'] },
    'LibroCierres.vue': { permisos: ['libro.ver'], desde: ['pages/libro/index.vue'] },
    'LibroEstadoFinanciero.vue': { permisos: ['libro.ver'], desde: ['pages/libro/index.vue'] },
    'LibroDiarios.vue': { permisos: ['libro.ver'], desde: ['pages/libro/index.vue'] },
    'LibroIntegridad.vue': { permisos: ['libro.ver'], desde: ['pages/libro/index.vue'] },
    'LineaTiempoBitacora.vue': { permisos: ['bitacora.ver'], desde: ['pages/clientes/[id]/index.vue', 'pages/servicios/[id].vue'] },
    'NotaCreditoModal.vue': { permisos: ['facturas.nota_credito'], desde: ['pages/facturas/[id].vue'] },
    // La ficha del plan solo edita; el alta ("Nuevo plan", `planes.crear`) está en la lista.
    'PlanFormulario.vue': { permisos: ['planes.crear', 'planes.editar', 'planes.ver'], desde: ['pages/planes/index.vue', 'pages/planes/[id].vue'], exentos: { 'pages/planes/[id].vue': ['planes.crear'] } },
    // Servicios adicionales (A1, `contratos/adicionales.md`).
    'AdicionalBloqueosModal.vue': { permisos: ['servicios.ver'], desde: ['components/ServicioAdicionales.vue'] },
    'AdicionalCredencialModal.vue': { permisos: ['servicios.ver_credencial_adicional'], desde: ['components/ServicioAdicionales.vue'] },
    'AdicionalModal.vue': { permisos: ['adicionales.crear', 'adicionales.editar'], desde: ['pages/adicionales/index.vue'] },
    'AdicionalQuitarModal.vue': { permisos: ['servicios.quitar_adicional'], desde: ['components/ServicioAdicionales.vue'] },
    'AdicionalServicioModal.vue': { permisos: ['servicios.agregar_adicional', 'servicios.editar_adicional', 'adicionales.ver'], desde: ['components/ServicioAdicionales.vue'] },
    'MotivoCortesiaModal.vue': { permisos: ['adicionales.crear_motivo'], desde: ['pages/adicionales/motivos.vue'] },
    'PlanIncluidos.vue': { permisos: ['planes.ver'], desde: ['pages/planes/[id].vue'] },
    'PlanAdicionalesModal.vue': { permisos: ['planes.editar', 'adicionales.ver'], desde: ['components/PlanIncluidos.vue'] },
    'ServicioAdicionales.vue': { permisos: ['servicios.ver'], desde: ['pages/servicios/[id].vue'] },
    'PromesaAprobarModal.vue': { permisos: ['promesas.aprobar'], desde: ['pages/promesas/index.vue'] },
    'ReciboCobro.vue': { permisos: ['pagos.ver'], desde: ['pages/cobro/index.vue'] },
    'PromesaCrearModal.vue': { permisos: ['promesas.crear'], desde: ['pages/servicios/[id].vue'] },
    'PromesaSimularModal.vue': { permisos: ['promesas.ver'], desde: ['pages/servicios/[id].vue', 'pages/promesas/index.vue'] },
    'RouterConexion.vue': { permisos: ['routers.ver'], desde: ['pages/routers/index.vue'] },
    'RouterVelocidad.vue': { permisos: ['routers.ver'], desde: ['pages/routers/index.vue'] },
    'ServicioCambiarEmpresaModal.vue': { permisos: ['servicios.cambiar_empresa'], desde: ['pages/servicios/[id].vue'] },
    'ServicioAsignaciones.vue': { permisos: ['servicios.ver'], desde: ['pages/servicios/[id].vue'] },
    'ServicioEditar.vue': { permisos: ['servicios.editar', 'servicios.ver'], desde: ['pages/servicios/[id].vue'] },
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
    'UsuarioFormulario.vue': { permisos: ['usuarios.crear', 'usuarios.editar'], desde: ['pages/usuarios/index.vue'] },
    'RolFormulario.vue': { permisos: ['roles.crear', 'roles.editar'], desde: ['pages/usuarios/roles.vue'] },
    'TokenApiModal.vue': { permisos: ['tokens.crear'], desde: ['pages/usuarios/tokens.vue'] },
}

describe('semana 3 · ACL por pantalla (revisión estática)', () => {
    const rutas = rutasDePaginas()

    it('cada página declara su permiso; el menú pide el mismo que la página', () => {
        const sinPermiso = PAGINAS
            // Sin permiso a propósito: login, autologin desde Horus (`sso/entrar`), la explicación del
            // enlace de conexión (`conectar`) y "Mi cuenta" (`perfil`, cualquier usuario con sesión).
            .filter(archivo => !/\/(login|sin-permiso|index|conectar|perfil|sso\/entrar)\.vue$/.test(archivo) || /pages\/\w[\w-]*\/index\.vue$/.test(archivo))
            .filter(archivo => !permisoDePagina(leer(archivo)))
            .map(relativo)
        expect(sinPermiso).toEqual([])
        for (const seccion of SECCIONES_PANEL) {
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
                    if (!permiso || permiso === pagina || vistos.has(permiso) || componente?.permisos.includes(permiso)) {
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
            const usuarios = ARCHIVOS.filter(archivo => leer(archivo).includes(`<${nombre}`)).map(archivo => relativo(archivo).replace(/^app\//, ''))
            for (const archivo of usuarios) {
                const texto = leer(join(WEB, 'app', archivo))
                const pagina = permisoDePagina(texto)
                for (const permiso of permisos) {
                    if (permiso !== pagina && !comprobados(texto).has(permiso) && !exentos?.[archivo]?.includes(permiso)) {
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
                if (!permiso || permiso === pagina || vistos.has(permiso) || conGuardia) {
                    continue
                }
                huecos.push(`${relativo(archivo)}:${linea} enlaza ${m[1]} (pide ${permiso})`)
            }
        }
        expect(huecos.join('\n')).toBe('')
    })
})
