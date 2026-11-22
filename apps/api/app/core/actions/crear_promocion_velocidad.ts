import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa, exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import {
    verPromocion,
    type ModoPromocion,
    type PromocionVelocidadVista,
    type TipoVelocidadPromocion,
} from '#core/promociones_velocidad'
import AsignarPromocionVelocidad from '#core/actions/asignar_promocion_velocidad'

export interface EntradaCrearPromocionVelocidad {
    empresa_id?: number | null
    nombre: string
    descripcion?: string | null
    tipo_velocidad: TipoVelocidadPromocion
    multiplicador?: number | null
    plan_destino_id?: number | null
    modo: ModoPromocion
    inicio: Date
    fin: Date
    franja_inicio?: string | null
    franja_fin?: string | null
    dias_semana?: number[] | null
    /** precio mensual mientras dure (lo factura A3); null/ausente = no cambia el precio */
    precio?: string | null
    servicio_ids?: number[]
    ahora?: Date
}

/**
 * Crea una promoción de velocidad (`promociones_velocidad.crear`, decisión del PM 18) y, si vienen
 * `servicio_ids`, la asigna en la misma transacción (`promociones_velocidad.asignar`).
 *
 * - `multiplicador` (más de 1, hasta 10) o `plan_destino_id` (activo), uno de los dos.
 * - `dias`: la velocidad sube de `inicio` a `fin`. `franja`: cada día de `franja_inicio` a `franja_fin`
 *   (hora de Guatemala; en la base, UTC), con `dias_semana` opcional.
 * - El precio no cambia salvo `precio`.
 * - Emite `promocion_velocidad.cambiada` (`accion: creada`).
 */
export default class CrearPromocionVelocidad extends DomainAction<
    EntradaCrearPromocionVelocidad,
    PromocionVelocidadVista
> {
    readonly nombre = 'promociones_velocidad.crear'

    protected async handle(
        input: EntradaCrearPromocionVelocidad,
        t: Transaccion,
    ): Promise<PromocionVelocidadVista> {
        const empresaId = input.empresa_id ?? exigirEmpresaActivaDelContexto(t.ctx)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const falla = (field: string, message: string): never => {
            throw new ValidacionFallida([{ field, message, rule: 'promocion' }], message)
        }
        if (input.fin <= input.inicio) falla('fin', 'El fin debe ser posterior al inicio')
        const multiplicador = input.tipo_velocidad === 'multiplicador' ? (input.multiplicador ?? null) : null
        const planDestino = input.tipo_velocidad === 'plan_destino' ? (input.plan_destino_id ?? null) : null
        if (input.tipo_velocidad === 'multiplicador' && multiplicador === null) {
            falla('multiplicador', 'Indica el multiplicador (por ejemplo 2 para duplicar)')
        }
        if (input.tipo_velocidad === 'plan_destino' && planDestino === null) {
            falla('plan_destino_id', 'Indica el plan cuya velocidad se dará')
        }
        if (planDestino !== null) {
            const plan = (await t.trx
                .from('network.planes')
                .where('id', planDestino)
                .select('activo')
                .first()) as {
                activo: boolean
            } | null
            if (!plan) falla('plan_destino_id', 'El plan no existe')
            if (!plan!.activo) throw new ReglaNegocio('El plan destino está inactivo', 'plan_inactivo')
        }
        const franja = input.modo === 'franja'
        if (franja && (!input.franja_inicio || !input.franja_fin)) {
            falla('franja_inicio', 'Una promoción por franja necesita hora de inicio y de fin')
        }
        if (franja && input.franja_inicio === input.franja_fin) {
            falla('franja_fin', 'La franja debe durar algo: inicio y fin no pueden ser iguales')
        }
        const dias = franja && input.dias_semana?.length ? [...new Set(input.dias_semana)].sort() : null

        const [fila] = (await t.trx
            .insertQuery()
            .table('core.promociones_velocidad')
            .insert({
                empresa_id: empresaId,
                nombre: input.nombre.trim(),
                descripcion: input.descripcion ?? null,
                tipo_velocidad: input.tipo_velocidad,
                multiplicador,
                plan_destino_id: planDestino,
                modo: input.modo,
                inicio: input.inicio,
                fin: input.fin,
                franja_inicio: franja ? input.franja_inicio : null,
                franja_fin: franja ? input.franja_fin : null,
                dias_semana: dias,
                precio: input.precio ?? null,
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('promocion_velocidad', id)
        const vista = await verPromocion(id, t.trx)
        const auditable: Record<string, unknown> = { ...vista }
        for (const campo of ['servicios', 'created_at', 'updated_at', 'plan_destino_nombre']) {
            delete auditable[campo]
        }
        await t.registrarCambios({ tipo: 'promocion_velocidad', id }, null, auditable)
        await t.emit('promocion_velocidad.cambiada', {
            promocion_id: id,
            empresa_id: empresaId,
            accion: 'creada',
            servicios: [],
        })
        if (input.servicio_ids?.length) {
            return new AsignarPromocionVelocidad().execute(
                { promocion_id: id, servicio_ids: input.servicio_ids, ahora: input.ahora },
                t.ctx,
                { trx: t.trx },
            )
        }
        return vista
    }
}
