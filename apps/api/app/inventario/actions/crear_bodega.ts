import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { verBodega, type BodegaVista, type TipoBodega } from '#inventario/bodegas'

/**
 * `bodegas.crear` (`POST /bodegas`): una bodega (`bodega`, un lugar) o la de un técnico (`tecnico`,
 * con `usuario_id`; una activa por usuario y empresa: 409 `bodega_tecnico_duplicada`). Nombre único
 * por empresa (409 `bodega_duplicada`). `zona_id` y `router_id` opcionales para el alcance ACL.
 */

export interface DatosBodega {
    nombre?: string | null
    usuario_id?: number | null
    zona_id?: number | null
    router_id?: number | null
}

export interface EntradaCrearBodega extends DatosBodega {
    empresa_id?: number | null
    nombre: string
    tipo: TipoBodega
}

/** Valida usuario, zona y router (422 de campo) y la unicidad de nombre y técnico (409). */
export async function validarDatosBodega(
    t: Transaccion,
    empresaId: number,
    datos: {
        nombre: string
        tipo: TipoBodega
        usuario_id: number | null
        zona_id: number | null
        router_id: number | null
    },
    excepto?: number,
): Promise<void> {
    const errores: ErrorCampo[] = []
    if (datos.tipo === 'tecnico' && !datos.usuario_id) {
        errores.push({
            field: 'usuario_id',
            message: 'La bodega de un técnico lleva su usuario',
            rule: 'required',
        })
    }
    if (datos.tipo === 'bodega' && datos.usuario_id) {
        errores.push({
            field: 'usuario_id',
            message: 'Solo la bodega de un técnico lleva usuario',
            rule: 'no_aplica',
        })
    }
    if (datos.usuario_id) {
        const usuario = await t.trx
            .from('core.usuarios')
            .where('id', datos.usuario_id)
            .select('activo')
            .first()
        if (!usuario || !usuario.activo) {
            errores.push({
                field: 'usuario_id',
                message: `El usuario ${datos.usuario_id} no existe o está inactivo`,
                rule: 'exists',
            })
        }
    }
    if (datos.zona_id && !(await t.trx.from('core.zonas').where('id', datos.zona_id).select('id').first())) {
        errores.push({ field: 'zona_id', message: `La zona ${datos.zona_id} no existe`, rule: 'exists' })
    }
    if (
        datos.router_id &&
        !(await t.trx.from('network.routers').where('id', datos.router_id).select('id').first())
    ) {
        errores.push({
            field: 'router_id',
            message: `El router ${datos.router_id} no existe`,
            rule: 'exists',
        })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)

    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3062, empresaId])
    const repetida = await t.trx
        .from('inventario.bodegas')
        .where('empresa_id', empresaId)
        .whereRaw('lower(nombre) = lower(?)', [datos.nombre])
        .if(excepto !== undefined, (q) => q.whereNot('id', excepto!))
        .select('id')
        .first()
    if (repetida) {
        throw new Conflicto(
            `La empresa ya tiene la bodega ${repetida.id} «${datos.nombre}»`,
            'bodega_duplicada',
            'Bodega duplicada',
        )
    }
    if (datos.tipo === 'tecnico') {
        const otra = await t.trx
            .from('inventario.bodegas')
            .where({ empresa_id: empresaId, usuario_id: datos.usuario_id, tipo: 'tecnico', activo: true })
            .if(excepto !== undefined, (q) => q.whereNot('id', excepto!))
            .select('id')
            .first()
        if (otra) {
            throw new Conflicto(
                `El usuario ${datos.usuario_id} ya tiene la bodega de técnico ${otra.id} en esta empresa`,
                'bodega_tecnico_duplicada',
                'Bodega de técnico duplicada',
            )
        }
    }
}

export default class CrearBodega extends DomainAction<EntradaCrearBodega, BodegaVista> {
    readonly nombre = 'bodegas.crear'

    protected async handle(input: EntradaCrearBodega, t: Transaccion): Promise<BodegaVista> {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const datos = {
            nombre: input.nombre.trim(),
            tipo: input.tipo,
            usuario_id: input.usuario_id ?? null,
            zona_id: input.zona_id ?? null,
            router_id: input.router_id ?? null,
        }
        await validarDatosBodega(t, empresaId, datos)
        const [fila] = (await t.trx
            .insertQuery()
            .table('inventario.bodegas')
            .insert({ empresa_id: empresaId, ...datos })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('bodega', id)
        await t.registrarCambios({ tipo: 'bodega', id }, null, { ...datos, activo: true })
        return verBodega(id, t.trx)
    }
}
