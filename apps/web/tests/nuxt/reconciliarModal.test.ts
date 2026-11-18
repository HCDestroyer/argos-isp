import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd, type PasoReconciliacion } from '~~/fixtures/bd'
import { UApp } from '#components'
import RouterReconciliarModal from '~/components/RouterReconciliarModal.vue'
import type { ReconciliacionEstado } from '~/types/reconciliacion'
import { esperar } from '../ayudas/esperar'

/**
 * «Reconciliar ahora» después de confirmar (bug del PM): con el `job_id` del 202 el modal sondea
 * `GET /routers/:id/reconciliaciones/:job_id` cada 2 s y dice en qué va y cómo terminó.
 */
describe('reconciliar ahora: seguimiento del trabajo', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        vi.useRealTimers()
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    const enBody = (prueba: string) => document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
    const paso = (estado: PasoReconciliacion['estado'], extra: Partial<PasoReconciliacion> = {}): PasoReconciliacion => ({ estado, cambios: null, errores: [], error: null, ...extra })
    const consultas = () => bd.reconciliaciones.reduce((total, r) => total + r.consultas, 0)

    /** Monta el modal de RB-Centro abierto, espera la vista previa y pasa a timers falsos. */
    async function abrir() {
        const abierto = ref(true)
        const terminados: ReconciliacionEstado[] = []
        const conApp = defineComponent({
            render: () => h(UApp, null, {
                default: () => h(RouterReconciliarModal, {
                    'router': { id: 1, nombre: 'RB-Centro' },
                    'open': abierto.value,
                    'onUpdate:open': (valor: boolean) => (abierto.value = valor),
                    'onReconciliado': (estado: ReconciliacionEstado) => terminados.push(estado),
                }),
            }),
        })
        await mountSuspended(conApp)
        await esperar(() => expect(enBody('reconciliar-confirmar')?.hasAttribute('disabled')).toBe(false))
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        return { abierto, terminados }
    }

    async function confirmar() {
        enBody('reconciliar-confirmar')?.click()
        // El POST respondió: se ve el seguimiento (o ya el resultado, si el primer sondeo terminó).
        await esperar(() => expect(enBody('reconciliar-encolado') ?? enBody('reconciliar-resultado')).not.toBeNull())
    }

    /** Avanza el reloj y deja que lleguen las respuestas de los fixtures. */
    async function avanzar(ms: number) {
        await vi.advanceTimersByTimeAsync(ms)
        await nextTick()
    }

    it('en cola, aplicando y listo con los cambios aplicados; el sondeo se detiene al terminar', async () => {
        const previa = await useControlVelocidad().vistaPreviaReconciliar(1)
        const esperados = previa.ok ? previa.data.cambios.length + (previa.data.red_acceso?.length ?? 0) : -1
        expect(esperados).toBeGreaterThan(1)
        const { terminados } = await abrir()
        await confirmar()
        await esperar(() => expect(enBody('reconciliar-encolado')?.textContent).toContain('En cola…'))
        expect(enBody('reconciliar-espera-larga')).toBeNull()
        await avanzar(2_000)
        await esperar(() => expect(enBody('reconciliar-encolado')?.textContent).toContain('Aplicando en el router…'))
        await avanzar(2_000)
        await esperar(() => expect(enBody('reconciliar-resultado')?.dataset.estado).toBe('completada'))
        expect(enBody('reconciliar-resultado')?.textContent).toContain(`Listo: ${esperados} cambios aplicados en el router`)
        expect(terminados.map(t => t.estado)).toEqual(['completada'])
        expect(terminados[0]?.job_id).toBe(bd.reconciliaciones[0]?.job_id)
        // Terminó: no vuelve a preguntar.
        const hechas = consultas()
        await avanzar(10_000)
        expect(consultas()).toBe(hechas)
    })

    it('completada sin cambios: «El router ya estaba como debe»', async () => {
        bd.guionReconciliacion = [paso('en_curso'), paso('completada', { cambios: 0 })]
        await abrir()
        await confirmar()
        await avanzar(2_000)
        await esperar(() => expect(enBody('reconciliar-resultado')?.textContent).toContain('El router ya estaba como debe'))
    })

    it('completada con errores: aviso con cada operación y lo demás aplicado', async () => {
        bd.guionReconciliacion = [paso('completada', {
            cambios: 3,
            errores: [
                { operacion: '/ip/firewall/nat argosisp:top corte NAT', mensaje: 'failure: already have such entry' },
                { operacion: '/queue/simple argosisp:plan:2', mensaje: 'input does not match any value of target' },
            ],
        })]
        const { terminados } = await abrir()
        await confirmar()
        await esperar(() => expect(enBody('reconciliar-resultado')?.dataset.estado).toBe('completada_con_errores'))
        const alerta = enBody('reconciliar-resultado')
        expect(alerta?.textContent).toContain('Terminó con 2 errores')
        expect(alerta?.textContent).toContain('lo demás sí se aplicó en el router (3 cambios)')
        const operaciones = [...document.body.querySelectorAll('[data-prueba="reconciliar-error-operacion"]')].map(li => li.textContent?.trim())
        expect(operaciones).toEqual([
            '/ip/firewall/nat argosisp:top corte NAT — failure: already have such entry',
            '/queue/simple argosisp:plan:2 — input does not match any value of target',
        ])
        expect(terminados).toHaveLength(1)
    })

    it('fallida: muestra el error y «Reintentar» vuelve a la vista previa', async () => {
        bd.guionReconciliacion = [paso('en_curso'), paso('fallida', { error: 'El router no respondió a la API REST (timeout de 10 s)' })]
        const { terminados } = await abrir()
        await confirmar()
        await avanzar(2_000)
        await esperar(() => expect(enBody('reconciliar-resultado')?.dataset.estado).toBe('fallida'))
        expect(enBody('reconciliar-resultado')?.textContent).toContain('El router no respondió a la API REST')
        expect(terminados.map(t => t.estado)).toEqual(['fallida'])
        const reintentar = [...enBody('reconciliar-resultado')!.querySelectorAll('button')].find(b => b.textContent?.includes('Reintentar'))
        reintentar?.click()
        vi.useRealTimers()
        // Lo que no se aplicó sigue en la vista previa y se puede confirmar otra vez.
        await esperar(() => expect(enBody('reconciliar-menus')).not.toBeNull())
        expect(enBody('reconciliar-resultado')).toBeNull()
        expect(enBody('reconciliar-confirmar')?.hasAttribute('disabled')).toBe(false)
    })

    it('desconocida: no inventa un resultado', async () => {
        bd.guionReconciliacion = [paso('desconocida')]
        const { terminados } = await abrir()
        await confirmar()
        await esperar(() => expect(enBody('reconciliar-resultado')?.dataset.estado).toBe('desconocida'))
        expect(enBody('reconciliar-resultado')?.textContent).toContain('No se pudo saber el resultado; revisa los eventos de red del router.')
        expect(terminados.map(t => t.estado)).toEqual(['desconocida'])
    })

    it('más de 30 s en cola: avisa que el worker no ha tomado el trabajo', async () => {
        bd.guionReconciliacion = [paso('en_espera')]
        await abrir()
        await confirmar()
        await avanzar(28_000)
        expect(enBody('reconciliar-encolado')?.textContent).toContain('En cola…')
        expect(enBody('reconciliar-espera-larga')).toBeNull()
        await avanzar(4_000)
        await esperar(() => expect(enBody('reconciliar-espera-larga')?.textContent).toContain('El worker no ha tomado el trabajo. Revisa que el servicio worker de Argos esté corriendo.'))
        // Sigue preguntando mientras espera.
        expect(bd.reconciliaciones[0]?.consultas).toBeGreaterThanOrEqual(16)
    })

    it('al cerrar el modal se deja de sondear', async () => {
        bd.guionReconciliacion = [paso('en_espera')]
        const { abierto, terminados } = await abrir()
        await confirmar()
        await avanzar(4_000)
        const hechas = consultas()
        expect(hechas).toBeGreaterThanOrEqual(2)
        abierto.value = false
        await nextTick()
        await avanzar(20_000)
        expect(consultas()).toBe(hechas)
        expect(terminados).toEqual([])
    })

    it('con una ya pedida (`encolado: false`) sigue la que estaba', async () => {
        bd.guionReconciliacion = [paso('en_curso')]
        const previa = await useRouters().reconciliar(1)
        expect(previa.ok && previa.data.encolado).toBe(true)
        await abrir()
        await confirmar()
        await esperar(() => expect(enBody('reconciliar-en-curso')?.textContent).toContain('Ya había una reconciliación pedida'))
        await esperar(() => expect(enBody('reconciliar-encolado')?.textContent).toContain('Aplicando en el router…'))
        expect(bd.reconciliaciones).toHaveLength(1)
        expect(bd.reconciliaciones[0]?.consultas).toBeGreaterThan(0)
    })
})
