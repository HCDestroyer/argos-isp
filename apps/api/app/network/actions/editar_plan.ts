import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import {
    columnasPlan,
    exigirTipoPlanValido,
    exigirVelocidadValida,
    type DatosPlan,
    type PlanConAdvertencias,
} from '#network/actions/crear_plan'
import { advertenciasPlan } from '#network/tipos_plan'
import { velocidadDePlan } from '#network/actions/obtener_implementacion_plan'
import { columnasPlanRouter, verPlan, type PlanRouterVista, type PlanVista } from '#network/consultas/planes'
import { CAMPOS_VELOCIDAD } from '#network/velocidad'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import type { CampoCatalogoCambiado } from '#shared/eventos'
import { capacidadesDe } from '#core/tipos_servicio'

export interface EntradaEditarPlan extends DatosPlan {
    id: number
    version: number
}

/** Campos de velocidad que difieren entre dos lecturas del plan o de su implementación. */
export function camposVelocidadCambiados(
    antes: Record<string, unknown> | null,
    despues: Record<string, unknown>,
    campos: readonly string[] = CAMPOS_VELOCIDAD,
): string[] {
    return campos.filter((campo) => (antes?.[campo] ?? null) !== (despues[campo] ?? null))
}

/**
 * Edita un plan (control optimista por `version`). El precio nuevo aplica a las facturas que se
 * generen después (A3 toma `precio` al facturar). Los servicios del plan toman la velocidad nueva
 * en su próxima autorización RADIUS: después del COMMIT se reescribe `aaa:user:*` de cada
 * servicio no retirado del plan.
 *
 * Velocidad (`contratos/velocidad.md`): valida la coherencia del plan y la de cada excepción por
 * router con los valores nuevos (422; la de un router lleva su id en el detalle). Si cambió un
 * campo de velocidad, emite `plan.velocidad_cambiada` con `router_id: null` (A2 recalcula padres
 * y perfiles en todos los routers).
 *
 * `tipo` se edita como cualquier campo (diff en `audit.cambios`); no cambia la velocidad, así que no
 * emite evento. La respuesta trae `warnings[]` (`advertenciasPlan`).
 *
 * Tipo de servicio (`contratos/tipos-servicio.md`): `tipo_servicio`, `componentes`, `precio_cable` y
 * `precio_iptv` se validan juntos con el plan resultante (422 por campo). Si cambia el tipo y el plan
 * ya tiene servicios, cada uno pasa al tipo nuevo en esta transacción (con su diff en `audit.cambios`)
 * y emite `servicio.config_cambiada` con `tipo_servicio` en `campos[]`; el plan emite
 * `catalogo.cambiado` con `tipo_servicio` y/o `componentes`. Pasar a un tipo con router un plan cuyos
 * servicios no tienen router, o a `cable` uno con servicios, responde 422 sin efectos.
 *
 * Renombrarlo, desactivarlo o reactivarlo emite `catalogo.cambiado` (`catalogo: 'plan'`, `campos`
 * con `nombre` y/o `activo`, `empresa_id: null`; contrato Iris 0.5.0, pedido A15); cambiar su
 * `precio` agrega `precio` (contrato Iris 0.8.0);
 * `plan.velocidad_cambiada` no lo cubre.
 */
export default class EditarPlan extends DomainAction<EntradaEditarPlan, PlanConAdvertencias> {
    readonly nombre = 'planes.editar'

    protected async handle(input: EntradaEditarPlan, t: Transaccion): Promise<PlanConAdvertencias> {
        const { id, version, ...datos } = input
        t.fijarEntidad('plan', id)
        const antes = await verPlan(id, t.trx)
        if (datos.nombre !== undefined) {
            const repetido = await t.trx
                .from('network.planes')
                .where('nombre', datos.nombre)
                .whereNot('id', id)
                .first()
            if (repetido) throw new Conflicto(`Ya existe el plan ${datos.nombre}`, 'plan_duplicado')
        }
        // se valida antes del UPDATE: los CHECK de la base responderían 500 en vez de 422
        const propuesto = { ...antes, ...columnasPlan(datos) } as PlanVista
        const cambiaTipoPlan =
            datos.tipo_servicio !== undefined && datos.tipo_servicio !== antes.tipo_servicio
        const tipoPlan = exigirTipoPlanValido(
            {
                ...propuesto,
                // al cambiar de tipo sin decir los componentes, se recalculan (el mixto sí los exige)
                componentes: datos.componentes ?? (cambiaTipoPlan ? undefined : antes.componentes),
            },
            { exigirLimitadas: false },
        )
        propuesto.tipo_servicio = tipoPlan.tipo_servicio
        propuesto.componentes = tipoPlan.componentes
        const cambiaTipo = tipoPlan.tipo_servicio !== antes.tipo_servicio
        const cambiaComponentes = tipoPlan.componentes.join(',') !== antes.componentes.join(',')
        const serviciosDelPlan = cambiaTipo
            ? ((await t.trx
                  .from('core.servicios')
                  .where('plan_id', id)
                  .orderBy('id')
                  .select('id', 'empresa_id', 'router_id', 'version')) as Array<{
                  id: number
                  empresa_id: number
                  router_id: number | null
                  version: number
              }>)
            : []
        if (serviciosDelPlan.length > 0) {
            const capacidades = capacidadesDe(tipoPlan.tipo_servicio, tipoPlan.componentes)
            if (!capacidades.requiereRouter) {
                throw new ReglaNegocio(
                    'Pasar a cable un plan con servicios llega en el lote T2 del plan v3',
                    'alta_cable_pendiente',
                )
            }
            if (serviciosDelPlan.some((s) => s.router_id === null)) {
                throw new ReglaNegocio(
                    `Hay servicios del plan sin router: no pueden pasar a ${tipoPlan.tipo_servicio}`,
                    'tipo_sin_router',
                )
            }
        }
        if (
            capacidadesDe(tipoPlan.tipo_servicio, tipoPlan.componentes).requiereVelocidad &&
            camposVelocidadCambiados(antes as never, propuesto as never).length > 0
        ) {
            exigirVelocidadValida(velocidadDePlan(propuesto, null))
            const implementaciones = (await t.trx
                .from('network.planes_routers')
                .where('plan_id', id)
                .select(columnasPlanRouter())) as PlanRouterVista[]
            for (const implementacion of implementaciones) {
                exigirVelocidadValida(
                    velocidadDePlan(propuesto, implementacion),
                    `Con la excepción del router ${implementacion.router_id}`,
                )
            }
        }
        await actualizarConVersion(t.trx, 'network.planes', id, version, {
            ...columnasPlan(datos),
            tipo_servicio: tipoPlan.tipo_servicio,
            componentes: tipoPlan.componentes,
        })
        const despues = await verPlan(id, t.trx)
        const campos = camposVelocidadCambiados(antes as never, despues as never)

        await t.registrarCambios({ tipo: 'plan', id }, antes, despues)
        // cada servicio del plan sigue al tipo nuevo, con su diff y su evento (nunca un UPDATE masivo mudo)
        for (const servicio of serviciosDelPlan) {
            await t.trx
                .from('core.servicios')
                .where('id', servicio.id)
                .update({
                    tipo_servicio: despues.tipo_servicio,
                    version: Number(servicio.version) + 1,
                    updated_at: new Date(),
                })
            await t.registrarCambios(
                { tipo: 'servicio', id: servicio.id },
                { tipo_servicio: antes.tipo_servicio },
                { tipo_servicio: despues.tipo_servicio },
            )
            await t.emit('servicio.config_cambiada', {
                servicio_id: servicio.id,
                empresa_id: servicio.empresa_id,
                campos: ['tipo_servicio'],
            })
        }
        if (campos.length > 0) {
            await t.emit('plan.velocidad_cambiada', { plan_id: id, router_id: null, campos })
        }
        const camposCatalogo: CampoCatalogoCambiado[] = []
        if (despues.nombre !== antes.nombre) camposCatalogo.push('nombre')
        if (despues.activo !== antes.activo) camposCatalogo.push('activo')
        // contrato Iris 0.8.0: cambia el precio efectivo de los servicios del plan sin `costo_override`
        if (despues.precio !== antes.precio) camposCatalogo.push('precio')
        // contrato Iris 0.10.0 (A40): Iris guarda `modo` y `routers` del plan en su instantánea
        if (despues.modo !== antes.modo) camposCatalogo.push('modo')
        if (despues.global !== antes.global) camposCatalogo.push('routers')
        if (cambiaTipo) camposCatalogo.push('tipo_servicio')
        if (cambiaComponentes) camposCatalogo.push('componentes')
        if (camposCatalogo.length > 0) {
            // los planes no son de una empresa: `empresa_id` siempre null (contrato Iris 0.5.0)
            await t.emit('catalogo.cambiado', {
                catalogo: 'plan',
                id,
                empresa_id: null,
                campos: camposCatalogo,
            })
        }
        refrescarAaaAlConfirmar(t, { planId: id })
        return { ...despues, warnings: advertenciasPlan(despues) }
    }
}
