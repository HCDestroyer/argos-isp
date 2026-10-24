import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, registrarAccion, versionCambiada } from '../comun'

type PlanRouter = Schema<'PlanRouter'>

const creado = '2026-09-01T15:00:00.000Z'

/** Una implementación sembrada: el plan 1 en el router 1 con su profile y pool, como en el laboratorio. */
export const implementacionesPlan: PlanRouter[] = [
    {
        id: 1,
        plan_id: 1,
        router_id: 1,
        profile_ppp: 'argos-hogar',
        pool_ipv4: 'pool-clientes',
        pool_ipv6_enlace: null,
        pool_ipv6_delegacion: null,
        local_address: '10.10.0.1',
        no_crear_reglas: false,
        rate_limit_override: null,
        reuso: null,
        garantizado_pct: null,
        rafaga_bajada_kbps: null,
        rafaga_subida_kbps: null,
        rafaga_umbral_pct: null,
        rafaga_segundos: null,
        prioridad: null,
        version: 1,
        created_at: creado,
        updated_at: creado,
    },
]

const TEXTOS = ['profile_ppp', 'pool_ipv4', 'pool_ipv6_enlace', 'pool_ipv6_delegacion', 'local_address', 'rate_limit_override'] as const
const NUMEROS = { reuso: [1, 64], garantizado_pct: [0.01, 100], rafaga_bajada_kbps: [1, 100_000_000], rafaga_subida_kbps: [1, 100_000_000], rafaga_umbral_pct: [1, 99], rafaga_segundos: [1, 3600], prioridad: [1, 8] } as const

export const rutasImplementacionesPlan: RutasFixture = {
    'GET /api/v1/planes/:id/routers': conPermiso('planes.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (!bd.planes.some(p => p.id === id)) {
            return noEncontrado('el plan')
        }
        return { status: 200, cuerpo: bd.implementacionesPlan.filter(i => i.plan_id === id) }
    }),

    /**
     * Como `ImplementarPlanEnRouter` (A1): crea sin `version` o edita con ella (409); textos y
     * números con los rangos del validador; garantía ≤ 100 / reuso efectivo.
     */
    'PUT /api/v1/planes/:id/routers/:routerId': conPermiso('planes.editar', (solicitud) => {
        const plan = bd.planes.find(p => p.id === idDe(solicitud))
        const routerId = idDe(solicitud, 'routerId')
        if (!plan || !bd.routers.some(r => r.id === routerId) || routerId === null) {
            return noEncontrado(plan ? 'el router' : 'el plan')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const existente = bd.implementacionesPlan.find(i => i.plan_id === plan.id && i.router_id === routerId)
        if (existente && cuerpo.version !== existente.version) {
            return versionCambiada()
        }
        const errores = []
        for (const [campo, [min, max]] of Object.entries(NUMEROS)) {
            const valor = cuerpo[campo]
            if (valor !== undefined && valor !== null && (typeof valor !== 'number' || valor < min || valor > max)) {
                errores.push({ field: campo, message: `Debe estar entre ${min} y ${max}`, rule: 'range' })
            }
        }
        const reuso = typeof cuerpo.reuso === 'number' ? cuerpo.reuso : (existente?.reuso ?? plan.reuso)
        if (typeof cuerpo.garantizado_pct === 'number' && cuerpo.garantizado_pct > 100 / reuso) {
            errores.push({ field: 'garantizado_pct', message: `Con reuso 1:${reuso} la garantía no puede pasar de ${(100 / reuso).toFixed(2)} %`, rule: 'velocidad' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const base: PlanRouter = existente ?? {
            id: siguienteId(bd.implementacionesPlan),
            plan_id: plan.id,
            router_id: routerId,
            profile_ppp: null,
            pool_ipv4: null,
            pool_ipv6_enlace: null,
            pool_ipv6_delegacion: null,
            local_address: null,
            no_crear_reglas: false,
            rate_limit_override: null,
            reuso: null,
            garantizado_pct: null,
            rafaga_bajada_kbps: null,
            rafaga_subida_kbps: null,
            rafaga_umbral_pct: null,
            rafaga_segundos: null,
            prioridad: null,
            version: 0,
            created_at: ahora(),
            updated_at: ahora(),
        }
        for (const campo of TEXTOS) {
            if (cuerpo[campo] !== undefined) {
                base[campo] = typeof cuerpo[campo] === 'string' ? cuerpo[campo] : null
            }
        }
        for (const campo of Object.keys(NUMEROS) as (keyof typeof NUMEROS)[]) {
            if (cuerpo[campo] !== undefined) {
                base[campo] = typeof cuerpo[campo] === 'number' ? cuerpo[campo] : null
            }
        }
        if (typeof cuerpo.no_crear_reglas === 'boolean') {
            base.no_crear_reglas = cuerpo.no_crear_reglas
        }
        base.version += 1
        base.updated_at = ahora()
        if (!existente) {
            bd.implementacionesPlan.push(base)
        }
        const enRouter = bd.planesPorRouter[routerId] ?? []
        if (!enRouter.includes(plan.id)) {
            bd.planesPorRouter[routerId] = [...enRouter, plan.id]
        }
        registrarAccion(solicitud, 'planes.editar', { tipo: 'plan', id: plan.id }, { router_id: routerId, ...cuerpo })
        return { status: 200, cuerpo: base }
    }),
}
