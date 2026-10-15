import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { obtenerImplementacionPlan, type PlanEfectivo } from '#network/actions/obtener_implementacion_plan'
import { verServicio, type ServicioVista } from '#core/consultas/servicios'

/**
 * Interfaz pública de A1 (solo lectura, sin auditoría): todo lo que define a un servicio hoy.
 *
 * - `plan`: configuración efectiva del plan en el router del servicio.
 * - `plantilla_facturacion`: fila de `billing.plantillas_facturacion` (o null).
 * - `excepciones`: filas de `core.servicios_excepciones`. La configuración de facturación con
 *   las excepciones ya aplicadas (`aplicarExcepciones` de A3) llega con la tarea 11.
 *
 * Acepta un cliente/transacción para leer dentro de otra acción (p. ej. `generarFacturas`).
 */
export interface ConfiguracionEfectiva {
    servicio: ServicioVista
    plan: PlanEfectivo
    plantilla_facturacion: Record<string, unknown> | null
    excepciones: Array<{ campo: string; valor: unknown }>
}

export async function obtenerConfiguracionEfectiva(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ConfiguracionEfectiva> {
    const servicio = await verServicio(servicioId, cliente)
    const plan = await obtenerImplementacionPlan(servicio.plan_id, servicio.router_id, cliente, {
        aunqueNoDisponible: true,
    })
    const plantilla = servicio.plantilla_facturacion_id
        ? ((await cliente
              .from('billing.plantillas_facturacion')
              .where('id', servicio.plantilla_facturacion_id)
              .first()) as Record<string, unknown> | null)
        : null
    const excepciones = (await cliente
        .from('core.servicios_excepciones')
        .where('servicio_id', servicioId)
        .orderBy('campo')
        .select('campo', 'valor')) as Array<{ campo: string; valor: unknown }>
    return { servicio, plan, plantilla_facturacion: plantilla, excepciones }
}
