import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { verBancoOrigen, type BancoOrigenVista } from '#billing/cuentas_bancarias'

/**
 * `bancos_origen.crear` (`POST /bancos-origen`, decisión del PM 23): agrega un banco al catálogo único
 * de bancos de origen (lo ven todas las empresas; cada una puede ocultarlo). De fábrica solo `admin`.
 * 409 `banco_duplicado` si el nombre ya existe (sin distinguir mayúsculas). Evento
 * `banco_origen.cambiado` con `creado: true`.
 */

export interface EntradaCrearBancoOrigen {
    nombre: string
    orden?: number
}

export default class CrearBancoOrigen extends DomainAction<EntradaCrearBancoOrigen, BancoOrigenVista> {
    readonly nombre = 'bancos_origen.crear'

    protected async handle(input: EntradaCrearBancoOrigen, t: Transaccion): Promise<BancoOrigenVista> {
        const nombre = input.nombre?.trim() ?? ''
        if (nombre.length < 2) {
            throw new ValidacionFallida([
                { field: 'nombre', message: 'Escribe el nombre del banco', rule: 'minLength' },
            ])
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3023, 0)')
        const repetido = await t.trx
            .from('billing.bancos')
            .whereRaw('lower(nombre) = lower(?)', [nombre])
            .select('id')
            .first()
        if (repetido) {
            throw new Conflicto(
                `El banco «${nombre}» ya está en el catálogo (${repetido.id})`,
                'banco_duplicado',
                'Banco duplicado',
            )
        }
        const orden =
            input.orden ??
            Number(
                (
                    (await t.trx
                        .from('billing.bancos')
                        .where('orden', '<', 1000)
                        .max('orden as m')
                        .first()) as { m: number | null }
                ).m ?? 0,
            ) + 10
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.bancos')
            .insert({ nombre, orden })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('banco', id)
        await t.registrarCambios({ tipo: 'banco', id }, null, { nombre, orden, activo: true })
        await t.emit('banco_origen.cambiado', {
            banco_id: id,
            empresa_id: null,
            campos: ['nombre', 'orden', 'activo'],
            creado: true,
            activo: true,
            oculto: null,
        })
        return verBancoOrigen(id, t.ctx.empresaId ?? null, t.trx)
    }
}
