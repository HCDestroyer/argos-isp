import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, numeroQuery, paginar, registrarAccion, versionCambiada } from '../comun'
import { validarVelocidad, velocidadDePlan, vistaPreviaVelocidad } from './velocidad'

type Plan = Schema<'Plan'>
type Errores = NonNullable<Problem['errors']>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

function entero(valor: unknown, min: number, max: number): boolean {
    return typeof valor === 'number' && Number.isInteger(valor) && valor >= min && valor <= max
}

/**
 * Como `crearPlanValidator` + `validarVelocidad` (A1): tipos y rangos por campo y luego las
 * reglas cruzadas del modelo de velocidad, cada una en su campo.
 */
function validar(plan: Plan): Errores {
    const errores: Errores = []
    if (plan.nombre.trim().length < 2 || plan.nombre.length > 100) {
        errores.push({ field: 'nombre', message: 'El nombre debe tener entre 2 y 100 caracteres', rule: 'minLength' })
    }
    if (!MONTO.test(plan.precio)) {
        errores.push({ field: 'precio', message: 'Monto inválido', rule: 'dinero' })
    }
    for (const campo of ['bajada_kbps', 'subida_kbps', 'bajada_limitada_kbps', 'subida_limitada_kbps'] as const) {
        if (!entero(plan[campo], 1, 100_000_000)) {
            errores.push({ field: campo, message: 'Debe ser un entero entre 1 y 100000000', rule: 'range' })
        }
    }
    if (errores.length) {
        return errores
    }
    return validarVelocidad(velocidadDePlan(plan)).map(e => ({ field: e.field, message: e.message, rule: 'velocidad' }))
}

function planDe(cuerpo: Record<string, unknown>, base: Plan): Plan {
    const valor = <K extends keyof Plan>(campo: K): Plan[K] => (campo in cuerpo ? cuerpo[campo] as Plan[K] : base[campo])
    return {
        ...base,
        nombre: typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : base.nombre,
        precio: typeof cuerpo.precio === 'string' ? cuerpo.precio : base.precio,
        bajada_kbps: valor('bajada_kbps'),
        subida_kbps: valor('subida_kbps'),
        bajada_limitada_kbps: valor('bajada_limitada_kbps'),
        subida_limitada_kbps: valor('subida_limitada_kbps'),
        reuso: valor('reuso'),
        garantizado_pct: valor('garantizado_pct'),
        rafaga_bajada_kbps: valor('rafaga_bajada_kbps'),
        rafaga_subida_kbps: valor('rafaga_subida_kbps'),
        rafaga_umbral_pct: valor('rafaga_umbral_pct'),
        rafaga_segundos: valor('rafaga_segundos'),
        prioridad: valor('prioridad'),
        dual_stack: valor('dual_stack'),
        tamano_prefijo_delegado: valor('tamano_prefijo_delegado'),
        global: valor('global'),
        activo: valor('activo'),
    }
}

function guardar(solicitud: SolicitudFixture, base: Plan, accion: string, status: number): RespuestaFixture {
    const plan = planDe(cuerpoObjeto(solicitud), base)
    const errores = validar(plan)
    if (errores.length) {
        return datosInvalidos(errores)
    }
    if (bd.planes.some(p => p.id !== plan.id && p.nombre.toLowerCase() === plan.nombre.toLowerCase())) {
        const cuerpo: Problem = { type: 'urn:argosisp:problema:plan_duplicado', title: 'Conflicto', status: 409, detail: `Ya existe el plan ${plan.nombre}` }
        return { status: 409, cuerpo }
    }
    plan.precio = new Decimal(plan.precio).toFixed(2)
    const indice = bd.planes.findIndex(p => p.id === plan.id)
    if (indice >= 0) {
        bd.planes[indice] = plan
    }
    else {
        bd.planes.push(plan)
    }
    registrarAccion(solicitud, accion, { tipo: 'plan', id: plan.id }, cuerpoObjeto(solicitud))
    return { status, cuerpo: plan }
}

export const rutasPlanes: RutasFixture = {
    'GET /api/v1/planes': conPermiso('planes.ver', (solicitud) => {
        const activo = solicitud.query.get('activo')
        const router = numeroQuery(solicitud, 'router_id')
        const filas = bd.planes
            .filter(plan => activo === null || String(plan.activo) === activo)
            .filter(plan => router === undefined || (bd.planesPorRouter[router] ?? []).includes(plan.id))
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    /** Como `POST /planes/vista-previa` (A1): no guarda; 422 por campo con las reglas de crear. */
    'POST /api/v1/planes/vista-previa': conPermiso('planes.ver', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const momento = ahora()
        const base: Plan = {
            id: 0,
            nombre: 'Vista previa',
            precio: '0.00',
            bajada_kbps: 0,
            subida_kbps: 0,
            bajada_limitada_kbps: 0,
            subida_limitada_kbps: 0,
            reuso: 1,
            garantizado_pct: null,
            rafaga_bajada_kbps: null,
            rafaga_subida_kbps: null,
            rafaga_umbral_pct: 75,
            rafaga_segundos: 16,
            prioridad: 8,
            dual_stack: 'ambos',
            tamano_prefijo_delegado: 56,
            global: true,
            activo: true,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        const plan = planDe(cuerpo, base)
        const errores = validar(plan)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const activos = typeof cuerpo.activos === 'number' ? cuerpo.activos : 1
        const override = typeof cuerpo.rate_limit_override === 'string' ? cuerpo.rate_limit_override : null
        return { status: 200, cuerpo: vistaPreviaVelocidad(velocidadDePlan(plan), activos, override) }
    }),

    'GET /api/v1/planes/:id': conPermiso('planes.ver', (solicitud) => {
        const plan = bd.planes.find(p => p.id === idDe(solicitud))
        return plan ? { status: 200, cuerpo: plan } : noEncontrado('el plan')
    }),

    'POST /api/v1/planes': conPermiso('planes.crear', (solicitud) => {
        const momento = ahora()
        const base: Plan = {
            id: siguienteId(bd.planes),
            nombre: '',
            precio: '',
            bajada_kbps: 0,
            subida_kbps: 0,
            bajada_limitada_kbps: 0,
            subida_limitada_kbps: 0,
            reuso: 1,
            garantizado_pct: null,
            rafaga_bajada_kbps: null,
            rafaga_subida_kbps: null,
            rafaga_umbral_pct: 75,
            rafaga_segundos: 16,
            prioridad: 8,
            dual_stack: 'ambos',
            tamano_prefijo_delegado: 56,
            global: true,
            activo: true,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        return guardar(solicitud, base, 'planes.crear', 201)
    }),

    'PUT /api/v1/planes/:id': conPermiso('planes.editar', (solicitud) => {
        const plan = bd.planes.find(p => p.id === idDe(solicitud))
        if (!plan) {
            return noEncontrado('el plan')
        }
        if (cuerpoObjeto(solicitud).version !== plan.version) {
            return versionCambiada()
        }
        return guardar(solicitud, { ...plan, version: plan.version + 1, updated_at: ahora() }, 'planes.editar', 200)
    }),
}
