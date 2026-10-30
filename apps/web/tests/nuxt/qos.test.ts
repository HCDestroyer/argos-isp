import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { MATRIZ } from '~~/fixtures/routers/estrategias'
import { estrategiaArbol, estrategiaSimple } from '~~/fixtures/routers/estrategiasDatos'
import EstrategiaVelocidadEditor from '~/components/EstrategiaVelocidadEditor.vue'
import QosClaseModal from '~/components/QosClaseModal.vue'
import RouterQos from '~/components/RouterQos.vue'
import PaginaPerfil from '~/pages/red/qos/[id].vue'
import PaginaPerfiles from '~/pages/red/qos/index.vue'
import { esperar } from '../ayudas/esperar'

/** QoS por clases (`contratos/qos.md`, A2): fixtures, reglas, pantallas y el extra `qos` de la estrategia. */
describe('QoS por clases', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    const router = (id: number) => structuredClone(bd.routers.find(r => r.id === id)!)
    const clase = (id: number) => structuredClone(bd.qosClases.find(c => c.id === id)!)
    const enBody = (prueba: string) => document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)

    function escribir(selector: string, valor: string) {
        const campo = document.body.querySelector<HTMLInputElement>(selector)
        expect(campo, selector).not.toBeNull()
        campo!.value = valor
        campo!.dispatchEvent(new Event('input'))
    }

    it('fixtures como la API: perfil predeterminado con las semillas, extras.qos apagado y qos_perfil_id en cada router', async () => {
        const lista = await useQos().listar()
        expect(lista.ok && lista.data.data.map(p => [p.nombre, p.predeterminado, p.clases.filter(c => c.activa).length])).toEqual([
            ['Predeterminado', true, 5],
            ['Norte sin streaming', false, 4],
        ])
        // Σ topes > 100 %: un cliente con varias clases a la vez puede pasar su MIR (§3.5).
        expect(lista.ok && lista.data.data[0]?.advertencias.map(a => a.regla)).toEqual(['tope_por_cliente'])
        expect(bd.routers.every(r => r.qos_perfil_id === null && !r.estrategia_velocidad.pppoe.extras.qos)).toBe(true)
        expect(MATRIZ.extras.find(e => e.valor === 'qos')).toEqual({ valor: 'qos', por_defecto: false })
        expect(MATRIZ.reglas.map(r => r.rule)).toEqual(expect.arrayContaining(['qos_familia', 'qos_fasttrack', 'qos_costo']))
        const detalle = await useQos().ver(1)
        // El predeterminado lo usan los routers activos sin perfil propio; sin planes con qos, 0 hojas.
        expect(detalle.ok && detalle.data.routers.map(r => [r.router_id, r.hojas, r.limite_hojas])).toEqual([[1, 0, 1024], [2, 0, 1024], [4, 0, 1024]])
    })

    it('el extra qos solo se prende en el árbol y con FastTrack verificado; el porqué sale de la matriz', () => {
        const simple = estrategiaSimple().pppoe
        const arbol = estrategiaArbol().pppoe
        expect(extraDisponible(MATRIZ, 'qos', simple)).toEqual({ valida: false, motivo: 'RADIUS por sesión no tiene hojas por clase: qos (prioridad por clases) solo con arbol_pcq.' })
        expect(extraDisponible(MATRIZ, 'qos', arbol)).toEqual({ valida: true, motivo: null })
        expect(extraDisponible(MATRIZ, 'qos', { ...arbol, extras: { ...arbol.extras, excluir_fasttrack: false } }).motivo).toContain('qos exige excluir_fasttrack')
        expect(extraDisponible(MATRIZ, 'rafaga', simple).valida).toBe(true)
        // Al pasar a colas simples, qos se apaga solo.
        const conQos = { ...arbol, extras: { ...arbol.extras, qos: true } }
        expect(ajustarEstrategia(MATRIZ, { ...conQos, aplicacion: 'radius_rate_limit', tipo_cola: 'default' }, 'pppoe', '7.24.5').extras.qos).toBe(false)
        expect(resumenEstrategia(conQos)).toContain('QoS por clases')
    })

    it('el editor deshabilita QoS en un router simple con el porqué y lo deja prender en el árbol', async () => {
        const simple = await mountSuspended(EstrategiaVelocidadEditor, { props: { matriz: MATRIZ, version: '7.24.5', router: estrategiaSimple(), estrategias: estrategiaSimple() } })
        const extraSimple = simple.get('[data-extra="qos"]')
        expect(extraSimple.text()).toContain('Prioridad por clases (QoS)')
        expect(extraSimple.text()).toContain('No disponible: RADIUS por sesión no tiene hojas por clase')
        expect(extraSimple.get('[role="switch"]').attributes('disabled')).toBeDefined()

        const arbol = await mountSuspended(EstrategiaVelocidadEditor, { props: { matriz: MATRIZ, version: '7.24.5', router: estrategiaArbol(), estrategias: estrategiaArbol() } })
        const extraArbol = arbol.get('[data-extra="qos"]')
        expect(extraArbol.get('[role="switch"]').attributes('disabled')).toBeUndefined()
        expect(extraArbol.text()).not.toContain('No disponible')
    })

    it('API: la matriz rechaza qos fuera del árbol (422 qos_familia) y lo acepta en el árbol con su vista previa', async () => {
        const cv = useControlVelocidad()
        const simple = estrategiaSimple()
        simple.pppoe.extras.qos = true
        const mala = await cv.vistaPrevia(1, { estrategia_velocidad: simple })
        expect(!mala.ok && mala.problema.errors?.[0]).toMatchObject({ field: 'estrategia_velocidad.pppoe.extras.qos', rule: 'qos_familia' })
        expect(erroresPorCapa(!mala.ok ? mala.problema.errors ?? [] : [])).toHaveProperty(['pppoe.extras.qos'])

        const arbol = estrategiaArbol()
        for (const tipo of TIPOS_CONEXION_VELOCIDAD) {
            arbol[tipo].extras.qos = true
        }
        const previa = await cv.vistaPrevia(4, { estrategia_velocidad: arbol })
        expect(previa.ok && previa.data.valida).toBe(true)
        const cambio = await cv.cambiarRouter(4, { version: 1, estrategia_velocidad: arbol })
        expect(cambio.ok && cambio.data.estrategia_velocidad.pppoe.extras.qos).toBe(true)

        // Sin `extras.qos` en la petición se conserva el del router (`completarQos`).
        const sinQos = estrategiaArbol()
        const cuerpo = JSON.parse(JSON.stringify(sinQos)) as Record<string, { extras: Record<string, boolean> }>
        for (const tipo of TIPOS_CONEXION_VELOCIDAD) {
            delete cuerpo[tipo]!.extras.qos
        }
        const otra = await cv.cambiarRouter(4, { version: 2, estrategia_velocidad: cuerpo as unknown as typeof sinQos })
        expect(otra.ok && otra.data.estrategia_velocidad.pppoe.extras.qos).toBe(true)
    })

    it('API: reglas del perfil con sus field y rule (puertos, garantizado, resto, nombre, versión)', async () => {
        const qos = useQos()
        const puertos = await qos.crearClase(1, { nombre: 'Juegos', orden: 4, prioridad: 2, reglas: [{ protocolo: 'icmp', puertos_destino: '3074' }] }, nuevaClaveIdempotencia())
        expect(!puertos.ok && puertos.problema.errors?.[0]).toMatchObject({ field: 'reglas.0.puertos_destino', rule: 'qos_puertos' })

        const garantizado = await qos.crearClase(1, { nombre: 'Juegos', orden: 4, prioridad: 2, garantizado_pct: 40, reglas: [{ protocolo: 'udp', puertos_destino: '3074' }] }, nuevaClaveIdempotencia())
        expect(!garantizado.ok && garantizado.problema.errors?.[0]).toMatchObject({ field: 'garantizado_pct', rule: 'qos_garantizado' })

        const repetida = await qos.crearClase(1, { nombre: 'web', orden: 4, prioridad: 2, reglas: [{ protocolo: 'tcp' }] }, nuevaClaveIdempotencia())
        expect(!repetida.ok && repetida.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:qos_nombre_duplicado' })

        const nueva = await qos.crearClase(1, { nombre: 'Juegos', orden: 4, prioridad: 2, garantizado_pct: 5, reglas: [{ protocolo: 'udp', puertos_destino: '3074,27000-27050' }] }, nuevaClaveIdempotencia())
        expect(nueva.ok && nueva.data).toMatchObject({ perfil_id: 1, activa: true, es_resto: false, version: 1 })

        const resto = await qos.cambiarEstado(clase(5), false, nuevaClaveIdempotencia())
        expect(!resto.ok && resto.problema.errors?.[0]).toMatchObject({ rule: 'qos_resto' })

        // Web es origen de Descargas: no se desactiva sin dejarla sin origen.
        const web = await qos.cambiarEstado(clase(3), false, nuevaClaveIdempotencia())
        expect(!web.ok && web.problema.errors?.[0]?.rule).toBe('qos_reclasifica')

        const editada = await qos.editarClase(1, { version: 1, prioridad: 2 })
        expect(editada.ok && editada.data).toMatchObject({ prioridad: 2, version: 2 })
        const vieja = await qos.editarClase(1, { version: 1, prioridad: 3 })
        expect(!vieja.ok && vieja.problema.status).toBe(409)

        const streaming = await qos.cambiarEstado(clase(2), false, nuevaClaveIdempotencia())
        expect(streaming.ok && streaming.data.activa).toBe(false)
    })

    it('API: crear un perfil copia las clases activas con reclasifica_de traducido; un router solo usa comunes o de su empresa', async () => {
        const qos = useQos()
        const copia = await qos.crearPerfil({ nombre: 'Copia', copiar_de: 1 }, nuevaClaveIdempotencia())
        expect(copia.ok).toBe(true)
        if (!copia.ok) {
            return
        }
        const descargas = copia.data.clases.find(c => c.nombre === 'Descargas')
        const origenes = copia.data.clases.filter(c => descargas?.reclasifica_de.includes(c.id)).map(c => c.nombre).sort()
        expect(origenes).toEqual(['Resto', 'Web'])
        const repetido = await qos.crearPerfil({ nombre: 'copia' }, nuevaClaveIdempotencia())
        expect(!repetido.ok && repetido.problema.status).toBe(409)

        const otraEmpresa = await qos.asignarPerfil(1, { version: 1, qos_perfil_id: 2 })
        expect(!otraEmpresa.ok && otraEmpresa.problema.errors?.[0]).toMatchObject({ field: 'qos_perfil_id', rule: 'qos_empresa' })
        const propio = await qos.asignarPerfil(2, { version: 1, qos_perfil_id: 2 })
        expect(propio.ok && propio.data.qos_perfil_id).toBe(2)
        const viejo = await qos.asignarPerfil(2, { version: 1, qos_perfil_id: null })
        expect(!viejo.ok && viejo.problema.status).toBe(409)
    })

    it('API: sin qos.ver (cajero), 403', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const lista = await useQos().listar()
        expect(!lista.ok && lista.problema.status).toBe(403)
    })

    it('esquema de la clase: espejo del validador y de las reglas, con los nombres de campo del 422', () => {
        const base = entradaClaseQos(null, 4)
        const malos = esquemaClaseQos(false).safeParse({ ...base, nombre: 'VoIP', reglas: [{ ...reglaVacia(), protocolo: 'icmp', puertos_destino: '5060' }, { ...reglaVacia(), protocolo: CUALQUIERA }] })
        expect(malos.success).toBe(false)
        const rutas = malos.error?.issues.map(i => i.path.join('.'))
        expect(rutas).toEqual(expect.arrayContaining(['reglas.0.puertos_destino', 'reglas.1.protocolo']))
        const rango = esquemaClaseQos(false).safeParse({ ...base, nombre: 'VoIP', reglas: [{ ...reglaVacia(), protocolo: 'udp', puertos_destino: '70000' }] })
        expect(rango.error?.issues[0]?.message).toContain('fuera de 1–65535')
        const descargas = esquemaClaseQos(false).safeParse({ ...base, nombre: 'Pesadas', descargas: true, reglas: [] })
        expect(descargas.error?.issues.map(i => i.path.join('.'))).toEqual(['bytes_minimo', 'reclasifica_de'])
        // La clase resto no lleva reglas.
        expect(esquemaClaseQos(true).safeParse({ ...entradaClaseQos(clase(5), 1) }).success).toBe(true)
        const cuerpo = cuerpoClaseQos(esquemaClaseQos(false).parse({ ...base, nombre: 'VoIP', reglas: [{ ...reglaVacia(), protocolo: 'icmp', dscp: 46 }] }))
        expect(cuerpo.reglas).toEqual([{ protocolo: 'icmp', puertos_destino: null, puertos_origen: null, dscp: 46, lista_destino: null }])
        expect(resumenReglas(clase(4), bd.qosClases.filter(c => c.perfil_id === 1))).toBe('Conexiones de Web y Resto que pasan 10.0 MB')
    })

    it('modal de clase: el 409 por nombre va junto al nombre y el 422 de garantizado junto a su campo', async () => {
        const clases = bd.qosClases.filter(c => c.perfil_id === 1).map(c => structuredClone(c))
        await mountSuspended(QosClaseModal, { props: { perfilId: 1, clase: null, clases, open: true } })
        await esperar(() => expect(enBody('form-clase-qos')).not.toBeNull())
        escribir('[data-prueba="clase-nombre"] input, input[data-prueba="clase-nombre"]', 'Web')
        escribir('input[data-prueba="regla-puertos-destino-0"], [data-prueba="regla-puertos-destino-0"] input', '3074')
        await flushPromises()
        enBody('form-clase-qos')!.dispatchEvent(new Event('submit'))
        await esperar(() => expect(enBody('form-clase-qos')?.textContent).toContain('El perfil ya tiene una clase «Web»'))

        escribir('[data-prueba="clase-nombre"] input, input[data-prueba="clase-nombre"]', 'Juegos')
        escribir('[data-prueba="clase-garantizado"] input, input[data-prueba="clase-garantizado"]', '60')
        document.body.querySelector('[data-prueba="clase-garantizado"] input, input[data-prueba="clase-garantizado"]')?.dispatchEvent(new Event('blur'))
        await flushPromises()
        enBody('form-clase-qos')!.dispatchEvent(new Event('submit'))
        await esperar(() => expect(enBody('form-clase-qos')?.textContent).toContain('la suma del garantizado de las clases activas sería 130 %'))
        expect(bd.qosClases.some(c => c.nombre === 'Juegos')).toBe(false)
    })

    it('lista de perfiles: routers que lo usan y costo; detalle con clases, advertencias y la ayuda §3.5', async () => {
        const lista = await mountSuspended(PaginaPerfiles, { route: '/red/qos' })
        await esperar(() => expect(lista.find('[data-prueba="routers-perfil-1"]').exists()).toBe(true))
        expect(lista.get('[data-prueba="routers-perfil-1"]').text()).toContain('RB-Centro')
        expect(lista.text()).toContain('Predeterminado')
        expect(lista.get('[data-prueba="qos-ayuda"]').text()).toContain('La prioridad actúa cuando el plan o el router se llenan')
        expect(lista.find('[data-prueba="nuevo-perfil-qos"]').exists()).toBe(true)
        lista.unmount()

        const detalle = await mountSuspended(PaginaPerfil, { route: '/red/qos/1' })
        await esperar(() => expect(detalle.find('[data-prueba="tabla-clases"]').exists()).toBe(true))
        expect(detalle.get('[data-prueba="tabla-clases"]').text()).toContain('Interactivo')
        expect(detalle.get('[data-prueba="tabla-clases"]').text()).toContain('Conexiones de Web y Resto que pasan 10.0 MB')
        expect(detalle.get('[data-advertencia="tope_por_cliente"]').text()).toContain('Un cliente puede pasar la velocidad de su plan')
        expect(detalle.get('[data-prueba="suma-garantizado"]').text()).toBe('70 %')
        // Resto no se desactiva: no tiene el botón.
        expect(detalle.find('[data-prueba="estado-clase-5"]').exists()).toBe(false)
        expect(detalle.find('[data-prueba="estado-clase-2"]').exists()).toBe(true)
    })

    it('ficha del router: el selector solo ofrece perfiles comunes o de su empresa y guarda con version', async () => {
        const centro = await mountSuspended(RouterQos, { props: { router: router(1) } })
        await esperar(() => expect(centro.find('[data-prueba="qos-perfil-router"]').exists()).toBe(true))
        expect(centro.get('[data-prueba="qos-perfil-router"]').text()).toBe('Predeterminado')
        expect(centro.get('[data-prueba="qos-estado-router"]').text()).toContain('Apagado')

        const mixco = await mountSuspended(RouterQos, { props: { router: router(2) } })
        await esperar(() => expect(mixco.find('[data-prueba="qos-perfil-selector"]').exists()).toBe(true))
        const vm = mixco.findComponent({ name: 'USelect' })
        const items = vm.props('items') as { label: string, value: number }[]
        expect(items.map(i => i.label)).toEqual(['Predeterminado', 'Norte sin streaming'])
        await vm.vm.$emit('update:modelValue', 2)
        await flushPromises()
        await mixco.get('[data-prueba="qos-perfil-guardar"]').trigger('click')
        await esperar(() => expect(mixco.emitted('actualizado')?.[0]?.[0]).toMatchObject({ id: 2, qos_perfil_id: 2, version: 2 }))
    })
})
