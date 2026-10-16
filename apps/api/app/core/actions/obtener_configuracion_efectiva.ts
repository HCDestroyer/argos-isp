import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { obtenerImplementacionPlan, type PlanEfectivo } from '#network/actions/obtener_implementacion_plan'
import { verServicio, type ServicioVista } from '#core/consultas/servicios'
import { configuracionDeServicio } from '#billing/configuracion'
import type { ConfiguracionFacturacion } from '#billing/excepciones'

/**
 * Interfaz pública de A1 (solo lectura, sin auditoría): todo lo que define a un servicio hoy.
 *
 * - `plan`: configuración efectiva del plan en el router del servicio.
 * - `plantilla_facturacion`: fila de `billing.plantillas_facturacion` (o null).
 * - `excepciones`: filas de `core.servicios_excepciones`.
 * - `facturacion`: plantilla con las excepciones ya aplicadas (`aplicarExcepciones` de A3, vía
 *   `configuracionDeServicio`); null si el servicio no tiene plantilla.
 *
 * Acepta un cliente/transacción para leer dentro de otra acción (p. ej. `generarFacturas`).
 */
export interface ConfiguracionEfectiva {
    servicio: ServicioVista
    plan: PlanEfectivo
    plantilla_facturacion: Record<string, unknown> | null
    excepciones: Array<{ campo: string; valor: unknown }>
    facturacion: ConfiguracionFacturacion | null
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
    const facturacion = await configuracionDeServicio(cliente, {
        id: servicioId,
        plantilla_id: servicio.plantilla_facturacion_id,
    })
    return { servicio, plan, plantilla_facturacion: plantilla, excepciones, facturacion }
}

/** Respuesta de `GET /servicios/:id/configuracion-efectiva` (schema `ConfiguracionEfectivaServicio`). */
export async function configuracionEfectivaPublica(servicioId: number) {
    const config = await obtenerConfiguracionEfectiva(servicioId)
    return {
        servicio_id: servicioId,
        plantilla_facturacion_id: config.servicio.plantilla_facturacion_id,
        plan: config.plan,
        facturacion: config.facturacion,
        excepciones: config.servicio.excepciones,
    }
}
