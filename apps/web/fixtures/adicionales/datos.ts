import type { Schema } from '@argosisp/contracts'
import { servicios } from '../servicios/datos'

type Adicional = Schema<'Adicional'>
type MotivoCortesia = Schema<'MotivoCortesia'>
type AdicionalServicio = Schema<'AdicionalServicio'>
type Servicio = Schema<'Servicio'>
type BloqueoAdicional = Schema<'BloqueoAdicional'>

/** Fila de `network.planes_adicionales`: la vista `AdicionalPlan` se arma en las rutas. */
export interface PlanAdicionalFixture {
    plan_id: number
    adicional_id: number
    cantidad: number
}

const creado = '2026-09-01T15:00:00.000Z'

/**
 * Catálogo (A1, `contratos/adicionales.md`): ArgosNet (empresa 1) tiene streaming, IPTV y un
 * antivirus ya desactivado; Fibra del Sur (empresa 2), su propio IPTV sin precio sugerido.
 */
export const adicionales: Adicional[] = [
    { id: 1, empresa_id: 1, codigo: 'STREAM', nombre: 'Cuenta de streaming', descripcion: 'Plan básico de la plataforma de video asociada', precio_sugerido: '45.00', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 2, empresa_id: 1, codigo: 'IPTV', nombre: 'Usuario de IPTV', descripcion: 'Un usuario de la app de televisión (varios por servicio)', precio_sugerido: '35.00', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 3, empresa_id: 1, codigo: 'ANTIVIRUS', nombre: 'Antivirus familiar', descripcion: null, precio_sugerido: '20.00', activo: false, version: 2, created_at: creado, updated_at: '2026-10-01T16:00:00.000Z' },
    { id: 4, empresa_id: 2, codigo: 'IPTV', nombre: 'IPTV Sur', descripcion: null, precio_sugerido: null, activo: true, version: 1, created_at: creado, updated_at: creado },
]

/** Los cinco comunes de la migración (`empresa_id = null`) y uno propio de ArgosNet. */
export const motivosCortesia: MotivoCortesia[] = [
    { id: 1, empresa_id: null, codigo: 'PROMOCION', nombre: 'Promoción', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 2, empresa_id: null, codigo: 'CORTESIA', nombre: 'Cortesía', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 3, empresa_id: null, codigo: 'GARANTIA', nombre: 'Garantía', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 4, empresa_id: null, codigo: 'COMPENSACION_FALLA', nombre: 'Compensación por falla', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 5, empresa_id: null, codigo: 'CONVENIO', nombre: 'Convenio', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 6, empresa_id: 1, codigo: 'EMPLEADO', nombre: 'Empleado de la empresa', activo: true, version: 1, created_at: creado, updated_at: creado },
]

/** El plan Pyme (3) trae una cuenta de streaming y dos usuarios de IPTV de ArgosNet. */
export const planesAdicionales: PlanAdicionalFixture[] = [
    { plan_id: 3, adicional_id: 1, cantidad: 1 },
    { plan_id: 3, adicional_id: 2, cantidad: 2 },
]

/** Asignación como la vista `AdicionalServicio` de la API (todos los campos, sin credencial). */
export function asignacion(id: number, servicio: Pick<Servicio, 'id' | 'empresa_id'>, adicional: Adicional, datos: Partial<AdicionalServicio>, momento = creado): AdicionalServicio {
    return {
        id,
        empresa_id: servicio.empresa_id,
        servicio_id: servicio.id,
        adicional_id: adicional.id,
        adicional_codigo: adicional.codigo,
        adicional_nombre: adicional.nombre,
        modalidad: 'incluido',
        identificador: null,
        tiene_credencial: false,
        precio: null,
        motivo_id: null,
        motivo_nombre: null,
        motivo_detalle: null,
        plan_id: null,
        estado: 'activo',
        alta_en: momento,
        baja_en: null,
        motivo_baja: null,
        // A1 (adicionales con el servicio suspendido): bloqueo por estado y primer periodo del cobrado.
        bloqueo: 'vigente',
        bloqueado_en: null,
        primer_periodo: datos.modalidad === 'cobrado' ? 'prorrateado' : null,
        cobrado_desde: datos.modalidad === 'cobrado' ? momento : null,
        version: 1,
        created_at: momento,
        updated_at: momento,
        ...datos,
    }
}

function porId(id: number): Adicional {
    const encontrado = adicionales.find(a => a.id === id)
    if (!encontrado) {
        throw new Error(`Adicional ${id} sin fixture`)
    }
    return encontrado
}

const servicioUno = servicios.find(s => s.id === 1)

/**
 * El servicio 1 muestra las tres modalidades y una baja: streaming incluido con credencial, IPTV
 * cobrado con credencial, IPTV de cortesía (compensación por falla) y un antivirus dado de baja.
 * Los servicios del plan Pyme de ArgosNet traen sus incluidos, como al darlos de alta.
 */
function semilla(): { asignaciones: AdicionalServicio[], credenciales: Record<number, string>, bloqueos: BloqueoAdicional[] } {
    const lista: AdicionalServicio[] = []
    const credenciales: Record<number, string> = {}
    const bloqueos: BloqueoAdicional[] = []
    if (servicioUno) {
        lista.push(
            asignacion(1, servicioUno, porId(1), { identificador: 'cliente1@stream.test', tiene_credencial: true }),
            asignacion(2, servicioUno, porId(2), { modalidad: 'cobrado', precio: '35.00', identificador: 'iptv-0001', tiene_credencial: true }),
            asignacion(3, servicioUno, porId(2), { modalidad: 'cortesia', motivo_id: 4, motivo_nombre: 'Compensación por falla', motivo_detalle: 'Tres días sin servicio en septiembre', identificador: 'iptv-0002' }),
            asignacion(4, servicioUno, porId(3), { modalidad: 'cobrado', precio: '20.00', estado: 'baja', baja_en: '2026-10-01T16:00:00.000Z', motivo_baja: 'El cliente ya no lo usa', version: 2 }),
        )
        credenciales[1] = 'Str3am-0001'
        credenciales[2] = 'PIN 4821'
    }
    for (const servicio of servicios.filter(s => s.estado !== 'retirado')) {
        for (const fila of planesAdicionales.filter(p => p.plan_id === servicio.plan_id)) {
            const adicional = porId(fila.adicional_id)
            if (adicional.empresa_id !== servicio.empresa_id || !adicional.activo) {
                continue
            }
            for (let i = 0; i < fila.cantidad; i++) {
                lista.push(asignacion(lista.length + 1, servicio, adicional, { plan_id: servicio.plan_id }, servicio.created_at))
            }
        }
    }
    // El servicio 2 (suspendido por deuda) tiene un IPTV cobrado que entró «sin costo este mes».
    const servicioDos = servicios.find(s => s.id === 2)
    if (servicioDos) {
        lista.push(asignacion(lista.length + 1, servicioDos, porId(2), { modalidad: 'cobrado', precio: '35.00', identificador: 'iptv-0101', primer_periodo: 'sin_costo' }, '2026-08-15T16:00:00.000Z'))
    }
    // Como `aplicarBloqueoPorEstado` de A1: con el servicio suspendido, sus adicionales activos
    // están bloqueados desde la suspensión, con su fila en el historial.
    for (const fila of lista) {
        const servicio = servicios.find(s => s.id === fila.servicio_id)
        if (servicio?.estado === 'suspendido' && fila.estado === 'activo') {
            const desde = servicio.updated_at
            Object.assign(fila, { bloqueo: 'bloqueado', bloqueado_en: desde })
            bloqueos.push({ id: bloqueos.length + 1, asignacion_id: fila.id, accion: 'bloqueado', estado_servicio: 'suspendido', motivo: 'Corte por facturas vencidas', created_at: desde })
        }
    }
    // El IPTV cobrado del servicio 1 estuvo bloqueado dos días de septiembre.
    bloqueos.push(
        { id: bloqueos.length + 1, asignacion_id: 2, accion: 'bloqueado', estado_servicio: 'suspendido', motivo: 'Corte por 1 factura vencida', created_at: '2026-09-10T12:05:00.000Z' },
        { id: bloqueos.length + 2, asignacion_id: 2, accion: 'desbloqueado', estado_servicio: 'activo', motivo: 'Pago registrado', created_at: '2026-09-12T15:40:00.000Z' },
    )
    return { asignaciones: lista, credenciales, bloqueos }
}

const inicial = semilla()
export const adicionalesServicio: AdicionalServicio[] = inicial.asignaciones
/** Credenciales en claro de los fixtures (en la API, cifradas): solo las lee `GET …/credencial`. */
export const credencialesAdicionales: Record<number, string> = inicial.credenciales
/** `core.servicios_adicionales_bloqueos` (solo inserción): bloqueos y desbloqueos por estado. */
export const bloqueosAdicionales: BloqueoAdicional[] = inicial.bloqueos
