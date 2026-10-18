import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { camposAuditables, verEstablecimiento, type EstablecimientoVista } from '#fiscal/establecimientos'

/**
 * `fiscal.editar_establecimiento` (`PUT /fiscal/establecimientos/:id`, permiso `fiscal.configurar`,
 * con `version`; 409 si cambió). Edita nombre, dirección, municipio, departamento, `activo` y
 * `por_defecto`. El código de la SAT no se edita (se da de alta otro establecimiento).
 *
 * - Marcar `por_defecto` quita la marca al anterior; el por defecto no se desmarca ni se desactiva
 *   directamente (422 `establecimiento_por_defecto`: marque otro primero).
 * - Un inactivo no puede ser el por defecto.
 * - `audit.cambios` por campo; evento `fiscal.config_cambiada` (`establecimientos`).
 */

export interface EntradaEditarEstablecimiento {
    id: number
    version: number
    nombre?: string
    direccion?: string | null
    municipio?: string | null
    departamento?: string | null
    activo?: boolean
    por_defecto?: boolean
}

const limpio = (valor: string | null | undefined, previo: string | null) => {
    if (valor === undefined) return previo
    const texto = valor?.trim()
    return texto ? texto : null
}

export default class EditarEstablecimiento extends DomainAction<
    EntradaEditarEstablecimiento,
    EstablecimientoVista
> {
    readonly nombre = 'fiscal.editar_establecimiento'

    protected async handle(
        input: EntradaEditarEstablecimiento,
        t: Transaccion,
    ): Promise<EstablecimientoVista> {
        t.fijarEntidad('establecimiento', input.id)
        const previo = await verEstablecimiento(input.id, t.trx)
        exigirAccesoEmpresa(t.ctx, previo.empresa_id)
        t.fijarEmpresa(previo.empresa_id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3012, ?::int)', [previo.empresa_id])
        const actual = await verEstablecimiento(input.id, t.trx)
        if (actual.version !== input.version) throw new ConflictoVersion('El establecimiento', input.id)

        const despues = {
            nombre: input.nombre?.trim() || actual.nombre,
            direccion: limpio(input.direccion, actual.direccion),
            municipio: limpio(input.municipio, actual.municipio),
            departamento: limpio(input.departamento, actual.departamento),
            activo: input.activo ?? actual.activo,
            por_defecto: input.por_defecto ?? actual.por_defecto,
        }
        if (actual.por_defecto && (!despues.por_defecto || !despues.activo)) {
            throw new ReglaNegocio(
                'El establecimiento por defecto no se desmarca ni se desactiva: marque otro como por defecto primero',
                'establecimiento_por_defecto',
            )
        }
        if (despues.por_defecto && !despues.activo) {
            throw new ReglaNegocio(
                'Un establecimiento inactivo no puede ser el por defecto',
                'establecimiento_por_defecto',
            )
        }

        if (despues.por_defecto && !actual.por_defecto) {
            const otro = (await t.trx
                .from('fiscal.establecimientos')
                .where({ empresa_id: actual.empresa_id, por_defecto: true })
                .select('id')
                .first()) as { id: number } | null
            if (otro) {
                await t.trx
                    .from('fiscal.establecimientos')
                    .where('id', otro.id)
                    .update({
                        por_defecto: false,
                        version: t.trx.knexRawQuery('version + 1'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    })
                await t.registrarCambios(
                    { tipo: 'establecimiento', id: Number(otro.id) },
                    { por_defecto: true },
                    { por_defecto: false },
                )
            }
        }

        await t.trx
            .from('fiscal.establecimientos')
            .where('id', actual.id)
            .update({
                ...despues,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const editado = await verEstablecimiento(actual.id, t.trx)
        const campos = await t.registrarCambios(
            { tipo: 'establecimiento', id: actual.id },
            camposAuditables(actual),
            camposAuditables(editado),
        )
        if (campos.length > 0) {
            await t.emit('fiscal.config_cambiada', {
                empresa_id: actual.empresa_id,
                campos: ['establecimientos'],
            })
        }
        return editado
    }
}
