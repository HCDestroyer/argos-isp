import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'

/**
 * Catálogo único de Ajustes (plan del menú y Ajustes, lote 1; respuestas del PM del 26 nov 2026):
 * ocho grupos, cada pantalla una sola vez con el permiso de su página, la lista del índice igual a
 * la unión del catálogo, grupos vacíos fuera y un buscador que ignora tildes y busca por lo de dentro.
 */
const WEB = resolve(__dirname, '../..')
const PAGINAS = join(WEB, 'app/pages')

function permisoDePagina(archivo: string): string | string[] | undefined {
    const texto = readFileSync(archivo, 'utf8')
    const meta = texto.match(/definePageMeta\(\{[^}]*permiso: ('[^']+'|\[[^\]]*\])/)?.[1]
    if (!meta) {
        return undefined
    }
    const lista = [...meta.matchAll(/'([^']+)'/g)].map(m => m[1] ?? '')
    return meta.startsWith('[') ? lista : lista[0]
}

function ruta(archivo: string): string {
    return '/' + relative(PAGINAS, archivo).replace(/\.vue$/, '').replace(/(^|\/)index$/, '').replace(/\[(\w+)\]/g, '1')
}

const PAGINAS_AJUSTES = SECCIONES_CONFIGURACION.flatMap(seccion => seccion.paginas)

describe('Ajustes · catálogo único', () => {
    afterEach(() => {
        useUsuarioActual().value = null
    })

    it('ocho grupos con los nombres aprobados y 29 pantallas, cada una una sola vez', () => {
        expect(SECCIONES_CONFIGURACION.map(seccion => seccion.etiqueta)).toEqual(['Empresa y fiscal', 'Facturación y cobro', 'Clientes y portal', 'Red y equipos', 'Comunicación e integraciones', 'Usuarios y seguridad', 'Apariencia y reportes', 'Sistema'])
        expect(PAGINAS_AJUSTES).toHaveLength(29)
        expect(new Set(PAGINAS_AJUSTES.map(p => p.id)).size).toBe(29)
        expect(new Set(PAGINAS_AJUSTES.map(p => p.ruta)).size).toBe(29)
        expect(PAGINAS_AJUSTES.map(p => p.etiqueta)).toEqual(expect.arrayContaining(['Datos de la empresa', 'Régimen e impuestos', 'Conceptos y adicionales', 'Corte, caídas y retiro', 'Canales de aviso', 'Registro de fallos']))
    })

    it('cada página de /configuracion y las 7 de fuera están en el catálogo con el permiso de su página', () => {
        const archivos = (readdirSync(join(PAGINAS, 'configuracion'), { recursive: true }) as string[])
            .filter(nombre => nombre.endsWith('.vue'))
            .map(nombre => join(PAGINAS, 'configuracion', nombre))
        const fuera = ['plantillas/index.vue', 'campos-personalizados.vue', 'notificaciones/index.vue', 'usuarios/index.vue', 'usuarios/roles.vue', 'usuarios/tokens.vue', 'sistema/tareas.vue', 'sistema/salud.vue', 'sistema/registro.vue', 'sistema/almacenamiento.vue']
        for (const archivo of [...archivos, ...fuera.map(nombre => join(PAGINAS, nombre))]) {
            const destino = ruta(archivo)
            if (destino === RUTA_AJUSTES) {
                continue
            }
            const lugar = ubicacionConfiguracion(destino)
            expect(lugar, destino).not.toBeNull()
            if (lugar?.pagina.ruta === destino && lugar.pagina.permiso === null) {
                // Sin permiso propio: la página exige el rol admin en su middleware.
                expect([destino, readFileSync(archivo, 'utf8').includes('roles?.includes(\'admin\')')]).toEqual([destino, true])
            }
            else if (lugar?.pagina.ruta === destino) {
                expect([destino, permisoDePagina(archivo)]).toEqual([destino, lugar.pagina.permiso])
            }
        }
        // Cada pantalla del catálogo existe.
        for (const pagina of PAGINAS_AJUSTES) {
            const candidatos = [join(PAGINAS, `${pagina.ruta}.vue`), join(PAGINAS, pagina.ruta, 'index.vue')]
            expect(candidatos.some(existsSync), pagina.ruta).toBe(true)
        }
    })

    it('la lista de permisos del índice y del menú es la unión del catálogo (corrige ajustes_cobro, reportes y equipos)', () => {
        const indice = permisoDePagina(join(PAGINAS, 'configuracion/index.vue'))
        expect(indice).toEqual([...PERMISOS_AJUSTES])
        expect(PERMISOS_AJUSTES).toEqual(expect.arrayContaining(['ajustes_cobro.ver', 'reportes.ver', 'equipos.ver']))
        expect(obtenerSeccion('configuracion').permiso).toEqual(PERMISOS_AJUSTES)
        // Con solo uno de los que faltaban se entra a Ajustes.
        useUsuarioActual().value = { ...meCajero, permisos: ['reportes.ver'] }
        expect(usePermisos().puedeAbrir(RUTA_AJUSTES)).toBe(true)
        expect(usePaginasConfiguracion().grupos.value.map(g => g.id)).toEqual(['config-apariencia'])
    })

    it('el grupo «Ajustes» del buscador Ctrl K sale del catálogo, sin «Iris» suelto y con Reglas de cobro e Importar', () => {
        const ajustes = GRUPOS_PANEL.find(grupo => grupo.id === 'configuracion')
        expect(ajustes?.subgrupos?.map(subgrupo => subgrupo.id)).toEqual(SECCIONES_CONFIGURACION.map(seccion => seccion.id))
        const ids = seccionesDeGrupo(ajustes!).map(seccion => seccion.id)
        expect(ids).toContain('reglas-cobro')
        expect(ids).toContain('importar')
        expect(ids).not.toContain('integracion-iris')
    })

    it('cada usuario ve solo lo que puede abrir; un grupo sin nada permitido no aparece', () => {
        useUsuarioActual().value = meAdmin
        expect(usePaginasConfiguracion().grupos.value).toHaveLength(8)
        // El ejemplo del tablero (AjustesEscritorio, rol contabilidad): 3 grupos de 8.
        useUsuarioActual().value = { ...meAdmin, roles: ['contabilidad'], permisos: ['fiscal.ver', 'fel.ver', 'cuentas_bancarias.ver', 'bancos.ver', 'ajustes_cobro.ver', 'reportes.ver'] }
        const { grupos, buscar, hayAjustes } = usePaginasConfiguracion()
        expect(grupos.value.map(g => g.etiqueta)).toEqual(['Empresa y fiscal', 'Facturación y cobro', 'Apariencia y reportes'])
        expect(grupos.value.every(g => g.paginas.length > 0)).toBe(true)
        expect(grupos.value.flatMap(g => g.paginas.map(p => p.id))).not.toContain('importar')
        // El buscador tampoco encuentra lo no permitido.
        expect(buscar('logo').map(r => r.pagina.id)).toEqual([])
        expect(hayAjustes.value).toBe(true)
        useUsuarioActual().value = { ...meAdmin, roles: ['lectura'], permisos: ['clientes.ver'] }
        expect(usePaginasConfiguracion().hayAjustes.value).toBe(false)
    })

    it('el buscador ignora tildes y mayúsculas y busca por lo que hay dentro', () => {
        const todos = SECCIONES_CONFIGURACION
        const ids = (texto: string) => buscarAjustes(todos, texto).map(r => r.pagina.id)
        expect(ids('correo').sort()).toEqual(['empresa', 'empresas', 'notificaciones', 'notificaciones-plantillas'])
        expect(ids('mora')).toEqual(['plantillas'])
        expect(ids('LOGO').sort()).toEqual(['apariencia', 'empresas'])
        expect(ids('nit')).toContain('empresas')
        expect(ids('radius')).toContain('salud')
        expect(ids('regimen')).toEqual(['fiscal'])
        expect(ids('')).toEqual([])
        expect(ids('zzz')).toEqual([])
        // Lo que coincide por nombre va primero; por una palabra, se muestra esa palabra.
        const fel = buscarAjustes(todos, 'factura')
        expect(fel[0]?.campo).toBe('etiqueta')
        const correo = buscarAjustes(todos, 'correo').find(r => r.pagina.id === 'empresa')
        expect(correo).toMatchObject({ campo: 'palabras', fragmento: 'correo de atención' })
        expect(resaltar('correo de atención', 'CORREO')).toEqual([{ texto: 'correo', marca: true }, { texto: ' de atención', marca: false }])
        expect(resaltar('Régimen', 'regi')).toEqual([{ texto: 'Régi', marca: true }, { texto: 'men', marca: false }])
    })
})
