import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { obtenerPlantilla } from '#billing/plantillas'
import {
    ESTADOS_ASIGNABLES,
    exigirPlantillaAsignable,
    serviciosSinPlantilla,
    type ConteoPorEstado,
    type FiltroSinPlantilla,
} from '#billing/asignacion_plantilla'

/**
 * `plantillas.asignar_sin_plantilla` (`POST /plantillas-facturacion/:id/asignar-servicios-sin-plantilla
 * { total_esperado }`, decisión del PM del 18 nov). El PM la pulsa viendo la vista previa; nunca corre
 * sola.
 *
 * - Asigna la plantilla a los servicios `activo`/`limitado`/`suspendido` **sin plantilla** de la
 *   empresa activa (o las del alcance del usuario) y del alcance router/zona del permiso. No toca
 *   servicios con plantilla, ni `retirado`, ni `pendiente_instalacion`.
 * - **Sin facturar hacia atrás**: a cada servicio le guarda en `billing.servicios_facturar_desde` el
 *   primer inicio de ciclo mayor o igual a hoy en Guatemala (`primerPeriodoTrasAsignacion`); `generarFacturas` y
 *   `EmitirFactura` no emiten un periodo que empiece antes. Sin prorrateo del tramo ya corrido.
 * - `total_esperado`: el total de la vista previa. Si el conjunto cambió (otro servicio entró o salió)
 *   responde 409 `total_cambiado` y no asigna nada: el panel vuelve a pedir la vista previa.
 * - Plantilla retirada: 409 `plantilla_retirada`; inexistente: 404.
 * - Fila por fila (nunca un `UPDATE` masivo): `plantilla_facturacion_id`, `version + 1` y su diff en
 *   `audit.cambios` (`entidad_tipo = servicio`, campos `plantilla_facturacion_id` y `facturar_desde`).
 * - Sin evento: el catálogo no tiene uno para el cambio de plantilla de un servicio (tampoco lo emite
 *   `servicios.editar`) y la plantilla no cambia nada en la red ni el estado del servicio.
 */

export interface EntradaAsignarSinPlantilla extends FiltroSinPlantilla {
    plantilla_id: number
    total_esperado: number
}

export interface ResultadoAsignarSinPlantilla {
    plantilla_id: number
    asignados: number
    por_estado: ConteoPorEstado
    /** primeros periodos que se facturarán (distintos, ascendentes) */
    facturar_desde: string[]
}

export default class AsignarPlantillaSinPlantilla extends DomainAction<
    EntradaAsignarSinPlantilla,
    ResultadoAsignarSinPlantilla
> {
    readonly nombre = 'plantillas.asignar_sin_plantilla'

    protected async handle(input: EntradaAsignarSinPlantilla, t: Transaccion) {
        t.fijarEntidad('plantilla_facturacion', input.plantilla_id)
        // la plantilla no se retira mientras tanto (el retiro la bloquea para actualizarla)
        await t.trx
            .from('billing.plantillas_facturacion')
            .where('id', input.plantilla_id)
            .forShare()
            .select('id')
        const plantilla = await obtenerPlantilla(input.plantilla_id, t.trx)
        exigirPlantillaAsignable(plantilla)

        const hoy = hoyGuatemala()
        const filtro = { empresas: input.empresas, alcance: input.alcance }
        const servicios = await serviciosSinPlantilla(t.trx, plantilla, filtro, {
            limite: null,
            bloquear: true,
            hoy,
        })
        if (servicios.length !== input.total_esperado) {
            throw new Conflicto(
                `Los servicios sin plantilla cambiaron: ahora son ${servicios.length}, no ${input.total_esperado}. Vuelve a ver la vista previa.`,
                'total_cambiado',
                'Los servicios sin plantilla cambiaron',
            )
        }
        const empresas = new Set(servicios.map((s) => s.empresa_id))
        if (empresas.size === 1) t.fijarEmpresa([...empresas][0]!)

        const porEstado = Object.fromEntries(ESTADOS_ASIGNABLES.map((e) => [e, 0])) as ConteoPorEstado
        const fechas = new Set<string>()
        for (const s of servicios) {
            await t.trx
                .from('core.servicios')
                .where('id', s.servicio_id)
                .whereNull('plantilla_facturacion_id')
                .update({
                    plantilla_facturacion_id: plantilla.id,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            const guardado = await t.trx.rawQuery(
                `INSERT INTO billing.servicios_facturar_desde (servicio_id, facturar_desde, plantilla_id, origen)
                 VALUES (?, ?, ?, 'asignacion_sin_plantilla')
                 ON CONFLICT (servicio_id) DO UPDATE
                    SET facturar_desde = greatest(billing.servicios_facturar_desde.facturar_desde, EXCLUDED.facturar_desde),
                        plantilla_id = EXCLUDED.plantilla_id,
                        updated_at = now()
                 RETURNING to_char(facturar_desde, 'YYYY-MM-DD') AS facturar_desde`,
                [s.servicio_id, s.facturar_desde, plantilla.id],
            )
            // una asignación anterior más adelante se respeta (nunca se mueve hacia atrás)
            const facturarDesde = (guardado.rows[0] as { facturar_desde: string }).facturar_desde
            await t.registrarCambios(
                { tipo: 'servicio', id: s.servicio_id },
                { plantilla_facturacion_id: null, facturar_desde: null },
                { plantilla_facturacion_id: plantilla.id, facturar_desde: facturarDesde },
            )
            porEstado[s.estado] += 1
            fechas.add(facturarDesde)
        }

        return {
            plantilla_id: plantilla.id,
            asignados: servicios.length,
            por_estado: porEstado,
            facturar_desde: [...fechas].sort(),
        }
    }
}
