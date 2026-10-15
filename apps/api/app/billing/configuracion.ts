import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import type { EstadoServicio } from '#shared/eventos'
import { hoyGuatemala } from '#ledger/fechas'
import { obtenerPlantilla } from '#billing/plantillas'
import { aplicarExcepciones, type ConfiguracionFacturacion } from '#billing/excepciones'

/**
 * Lo que facturación necesita de un servicio, leído en solo lectura de `core.servicios` y
 * `network.planes` (columnas acordadas en `app/core/README.md`) más la plantilla con las
 * excepciones del servicio aplicadas.
 */

export interface ServicioFacturable {
    id: number
    cliente_id: number
    plan_id: number
    plan_nombre: string
    estado: EstadoServicio
    /** precio efectivo: `costo_override` o el precio del plan (IVA incluido) */
    precio: string
    /** fecha de instalación, o el día de alta en Guatemala si no tiene */
    inicio: string
    /** el plan tiene velocidad limitada (> 0 en bajada y subida) */
    limitable: boolean
    plantilla_id: number | null
}

interface FilaServicio {
    id: number
    cliente_id: number
    plan_id: number
    plan_nombre: string
    estado: EstadoServicio
    costo_override: string | null
    precio: string
    fecha_instalacion: string | null
    created_at: Date
    bajada_limitada_kbps: number | null
    subida_limitada_kbps: number | null
    plantilla_facturacion_id: number | null
}

export async function leerServicio(
    cliente: QueryClientContract,
    servicioId: number,
): Promise<ServicioFacturable> {
    const consulta = cliente
        .from('core.servicios as s')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .where('s.id', servicioId)
        .select(
            's.id',
            's.cliente_id',
            's.plan_id',
            'p.nombre as plan_nombre',
            's.estado',
            's.costo_override',
            'p.precio',
            cliente.raw(`to_char(s.fecha_instalacion, 'YYYY-MM-DD') as fecha_instalacion`),
            's.created_at',
            'p.bajada_limitada_kbps',
            'p.subida_limitada_kbps',
            's.plantilla_facturacion_id',
        )
    const fila = (await consulta.first()) as FilaServicio | null
    if (!fila) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
    return {
        id: fila.id,
        cliente_id: fila.cliente_id,
        plan_id: fila.plan_id,
        plan_nombre: fila.plan_nombre,
        estado: fila.estado,
        precio: fila.costo_override ?? fila.precio,
        inicio: fila.fecha_instalacion ?? hoyGuatemala(fila.created_at),
        limitable: (fila.bajada_limitada_kbps ?? 0) > 0 && (fila.subida_limitada_kbps ?? 0) > 0,
        plantilla_id: fila.plantilla_facturacion_id,
    }
}

/** Plantilla del servicio con sus excepciones aplicadas; null si no tiene plantilla. */
export async function configuracionDeServicio(
    cliente: QueryClientContract,
    servicio: Pick<ServicioFacturable, 'id' | 'plantilla_id'>,
): Promise<ConfiguracionFacturacion | null> {
    if (!servicio.plantilla_id) return null
    const plantilla = await obtenerPlantilla(servicio.plantilla_id, cliente)
    const excepciones = (await cliente
        .from('core.servicios_excepciones')
        .where('servicio_id', servicio.id)
        .orderBy('campo')
        .select('campo', 'valor')) as Array<{ campo: string; valor: unknown }>
    return aplicarExcepciones(
        {
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
            reglas_promesa: plantilla.reglas_promesa,
        },
        excepciones,
    )
}
