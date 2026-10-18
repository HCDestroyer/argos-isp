import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { empresaFiscal } from '#fiscal/comun'
import { camposAuditables, verEstablecimiento, type EstablecimientoVista } from '#fiscal/establecimientos'

/**
 * `fiscal.crear_establecimiento` (`POST /fiscal/establecimientos`, permiso `fiscal.configurar`):
 * da de alta un establecimiento de la SAT de la empresa (`empresa_id` o la activa). El primero de
 * la empresa queda `por_defecto`; si se pide `por_defecto` en otro, el anterior deja de serlo
 * (queda en `audit.cambios`). 409 `establecimiento_duplicado` si el código ya existe en la empresa.
 * Emite `fiscal.config_cambiada` (`establecimientos`).
 */

export interface EntradaCrearEstablecimiento {
    empresa_id?: number | null
    codigo: number
    nombre: string
    direccion?: string | null
    municipio?: string | null
    departamento?: string | null
    por_defecto?: boolean
}

const limpio = (valor: string | null | undefined) => {
    const texto = valor?.trim()
    return texto ? texto : null
}

export default class CrearEstablecimiento extends DomainAction<
    EntradaCrearEstablecimiento,
    EstablecimientoVista
> {
    readonly nombre = 'fiscal.crear_establecimiento'

    protected async handle(
        input: EntradaCrearEstablecimiento,
        t: Transaccion,
    ): Promise<EstablecimientoVista> {
        const { empresaId } = await empresaFiscal(t, input.empresa_id)
        // un alta a la vez por empresa: el por defecto no se pisa
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3012, ?::int)', [empresaId])
        const repetido = await t.trx
            .from('fiscal.establecimientos')
            .where({ empresa_id: empresaId, codigo: input.codigo })
            .select('id')
            .first()
        if (repetido) {
            throw new Conflicto(
                `La empresa ya tiene el establecimiento ${input.codigo} (${repetido.id})`,
                'establecimiento_duplicado',
                'Establecimiento duplicado',
            )
        }
        const actual = (await t.trx
            .from('fiscal.establecimientos')
            .where({ empresa_id: empresaId, por_defecto: true })
            .select('id')
            .first()) as { id: number } | null
        const porDefecto = !actual || input.por_defecto === true
        if (actual && porDefecto) {
            const antes = await verEstablecimiento(Number(actual.id), t.trx)
            await t.trx
                .from('fiscal.establecimientos')
                .where('id', actual.id)
                .update({
                    por_defecto: false,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            await t.registrarCambios(
                { tipo: 'establecimiento', id: antes.id },
                { por_defecto: true },
                { por_defecto: false },
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('fiscal.establecimientos')
            .insert({
                empresa_id: empresaId,
                codigo: input.codigo,
                nombre: input.nombre.trim(),
                direccion: limpio(input.direccion),
                municipio: limpio(input.municipio),
                departamento: limpio(input.departamento),
                activo: true,
                por_defecto: porDefecto,
            })
            .returning('id')) as Array<{ id: number }>
        const creado = await verEstablecimiento(Number(fila!.id), t.trx)
        t.fijarEntidad('establecimiento', creado.id)
        await t.registrarCambios({ tipo: 'establecimiento', id: creado.id }, null, camposAuditables(creado))
        await t.emit('fiscal.config_cambiada', { empresa_id: empresaId, campos: ['establecimientos'] })
        return creado
    }
}
