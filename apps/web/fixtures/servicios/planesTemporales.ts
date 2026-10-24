import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, versionCambiada } from '../comun'
import { efectivo } from '../routers/rutas'

type PlanTemporal = Schema<'PlanTemporal'>
type Servicio = Schema<'Servicio'>
type Facturacion = NonNullable<Schema<'ConfiguracionEfectivaServicio'>['facturacion']>

const DIA_MS = 86_400_000

function vigentes(servicioId: number): PlanTemporal[] {
    return bd.planesTemporales.filter(p => p.servicio_id === servicioId && (p.estado === 'activo' || p.estado === 'programado'))
}

/** `Servicio.plan_temporal`: el vigente (activo o programado) o null, como la vista de A1. */
export function planTemporalDe(servicioId: number): Servicio['plan_temporal'] {
    const vigente = vigentes(servicioId).sort((a, b) => a.inicio.localeCompare(b.inicio))[0]
    return vigente
        ? { id: vigente.id, plan_id: vigente.plan_id, plan_original_id: vigente.plan_original_id, inicio: vigente.inicio, fin: vigente.fin, estado: vigente.estado as 'activo' | 'programado', origen: vigente.origen, origen_id: vigente.origen_id, version: vigente.version }
        : null
}

function nombrePlan(id: number): string {
    return bd.planes.find(p => p.id === id)?.nombre ?? `Plan ${id}`
}

/** Plantilla del servicio (o la por defecto) con sus excepciones encima, como `configuracionEfectiva` (A1). */
function facturacionDe(servicio: Servicio): Facturacion | null {
    const plantilla = bd.plantillas.find(p => p.id === servicio.plantilla_facturacion_id) ?? bd.plantillas.find(p => p.por_defecto)
    if (!plantilla) {
        return null
    }
    const excepciones = { ...(servicio.excepciones ?? {}) }
    const { reglas_promesa: reglasExcepcion, ...simples } = excepciones
    return {
        plantilla_id: plantilla.id,
        nombre: plantilla.nombre,
        ciclo: plantilla.ciclo,
        dia: plantilla.dia,
        prorrateo: plantilla.prorrateo,
        dias_gracia: plantilla.dias_gracia,
        facturas_para_limitar: plantilla.facturas_para_limitar,
        facturas_para_cortar: plantilla.facturas_para_cortar,
        mora_tipo: plantilla.mora_tipo,
        mora_valor: plantilla.mora_valor,
        mora_recurrente: plantilla.mora_recurrente,
        hora_corte: plantilla.hora_corte,
        certificar_al: plantilla.certificar_al,
        reglas_promesa: reglasExcepcion ? { ...plantilla.reglas_promesa, ...reglasExcepcion } : plantilla.reglas_promesa,
        ...simples,
        excepciones: Object.keys(excepciones),
    }
}

export const rutasPlanesTemporales: RutasFixture = {
    'GET /api/v1/servicios/:id/configuracion-efectiva': conPermiso('servicios.ver', (solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        const plan = bd.planes.find(p => p.id === servicio?.plan_id)
        if (!servicio || !plan) {
            return noEncontrado('el servicio')
        }
        return {
            status: 200,
            cuerpo: {
                servicio_id: servicio.id,
                plantilla_facturacion_id: servicio.plantilla_facturacion_id,
                plan: efectivo(plan, servicio.router_id),
                facturacion: facturacionDe(servicio),
                excepciones: servicio.excepciones ?? {},
            },
        }
    }),

    'GET /api/v1/servicios/:id/planes-temporales': conPermiso('servicios.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (!bd.servicios.some(s => s.id === id)) {
            return noEncontrado('el servicio')
        }
        return { status: 200, cuerpo: paginar(bd.planesTemporales.filter(p => p.servicio_id === id).sort((a, b) => b.id - a.id), solicitud) }
    }),

    /**
     * Como `ProgramarPlanTemporal` (A1): plan activo del router y distinto del actual, `dias` o `fin`,
     * 409 `plan_temporal_activo` si ya hay uno vigente; sin `inicio` empieza ahora y cambia el plan.
     */
    'POST /api/v1/servicios/:id/planes-temporales': conPermiso('servicios.programar_plan_temporal', conIdempotencia((solicitud) => {
        const servicio = bd.servicios.find(s => s.id === idDe(solicitud))
        if (!servicio) {
            return noEncontrado('el servicio')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const plan = bd.planes.find(p => p.id === cuerpo.plan_id)
        if (!plan || !plan.activo || !(bd.planesPorRouter[servicio.router_id] ?? []).includes(plan.id)) {
            return datosInvalidos([{ field: 'plan_id', message: 'El plan no está activo o no está disponible en el router del servicio', rule: 'plan' }])
        }
        if (plan.id === servicio.plan_id) {
            return datosInvalidos([{ field: 'plan_id', message: 'Elige un plan distinto del actual', rule: 'plan' }])
        }
        const dias = typeof cuerpo.dias === 'number' ? cuerpo.dias : null
        if (dias === null && typeof cuerpo.fin !== 'string') {
            return datosInvalidos([{ field: 'dias', message: 'Indica los días o la fecha de fin', rule: 'required' }])
        }
        if (vigentes(servicio.id).length) {
            return problemaTipado(409, 'plan_temporal_activo', 'Conflicto', 'El servicio ya tiene un plan temporal activo o programado')
        }
        const ahoraMs = Date.now()
        const inicio = typeof cuerpo.inicio === 'string' ? cuerpo.inicio : new Date(ahoraMs).toISOString()
        const fin = typeof cuerpo.fin === 'string' ? cuerpo.fin : new Date(new Date(inicio).getTime() + (dias ?? 1) * DIA_MS).toISOString()
        const empieza = new Date(inicio).getTime() <= ahoraMs
        const creado = ahora()
        const temporal: PlanTemporal = {
            id: siguienteId(bd.planesTemporales),
            empresa_id: servicio.empresa_id ?? 1,
            servicio_id: servicio.id,
            plan_id: plan.id,
            plan_nombre: plan.nombre,
            plan_original_id: servicio.plan_id,
            plan_original_nombre: nombrePlan(servicio.plan_id),
            inicio,
            fin,
            origen: 'manual',
            origen_id: null,
            estado: empieza ? 'activo' : 'programado',
            motivo: typeof cuerpo.motivo === 'string' ? cuerpo.motivo : null,
            iniciado_en: empieza ? creado : null,
            terminado_en: null,
            creado_por: 1,
            version: 1,
            created_at: creado,
            updated_at: creado,
        }
        bd.planesTemporales.push(temporal)
        if (empieza) {
            servicio.plan_id = plan.id
            servicio.version += 1
        }
        registrarAccion(solicitud, 'servicios.programar_plan_temporal', { tipo: 'servicio', id: servicio.id }, cuerpo)
        return { status: 201, cuerpo: temporal }
    })),

    /** Como `CancelarPlanTemporal` (A1): `version` y motivo; si estaba activo, vuelve el plan base. */
    'POST /api/v1/servicios/:id/planes-temporales/:planTemporalId/cancelar': conPermiso('servicios.cancelar_plan_temporal', conIdempotencia((solicitud) => {
        const temporal = bd.planesTemporales.find(p => p.id === idDe(solicitud, 'planTemporalId') && p.servicio_id === idDe(solicitud))
        if (!temporal) {
            return noEncontrado('el plan temporal')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (typeof cuerpo.motivo !== 'string' || cuerpo.motivo.trim().length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'El motivo debe tener al menos 3 caracteres', rule: 'minLength' }])
        }
        if (cuerpo.version !== temporal.version) {
            return versionCambiada()
        }
        if (temporal.estado !== 'activo' && temporal.estado !== 'programado') {
            return problemaTipado(422, 'plan_temporal_terminado', 'Regla de negocio', 'El plan temporal ya terminó o fue cancelado')
        }
        const servicio = bd.servicios.find(s => s.id === temporal.servicio_id)
        if (temporal.estado === 'activo' && servicio) {
            servicio.plan_id = temporal.plan_original_id
            servicio.version += 1
        }
        Object.assign(temporal, { estado: 'cancelado', motivo: cuerpo.motivo.trim(), terminado_en: ahora(), version: temporal.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'servicios.cancelar_plan_temporal', { tipo: 'servicio', id: temporal.servicio_id }, cuerpo)
        return { status: 200, cuerpo: temporal }
    })),
}
