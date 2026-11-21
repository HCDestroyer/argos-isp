import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { verBancoOrigen, type BancoOrigenVista } from '#billing/cuentas_bancarias'

/**
 * `bancos_origen.editar` (`PUT /bancos-origen/:id`, decisión del PM 23): nombre, orden o `activo` de
 * un banco del catálogo único (afecta a todas las empresas; desactivar lo saca de todas las listas).
 * Con `version` (409). Los pagos y comprobantes que ya lo usan no cambian. Evento
 * `banco_origen.cambiado` con los campos que cambiaron.
 */

export interface EntradaEditarBancoOrigen {
    id: number
    version: number
    nombre?: string
    orden?: number
    activo?: boolean
}

export default class EditarBancoOrigen extends DomainAction<EntradaEditarBancoOrigen, BancoOrigenVista> {
    readonly nombre = 'bancos_origen.editar'

    protected async handle(input: EntradaEditarBancoOrigen, t: Transaccion): Promise<BancoOrigenVista> {
        t.fijarEntidad('banco', input.id)
        const antes = (await t.trx
            .from('billing.bancos')
            .where('id', input.id)
            .forUpdate()
            .select('nombre', 'orden', 'activo', 'version')
            .first()) as { nombre: string; orden: number; activo: boolean; version: number } | null
        if (!antes) throw new NoEncontrado(`El banco ${input.id} no existe`)
        if (Number(antes.version) !== input.version) throw new ConflictoVersion('banco', input.id)
        const nombre = input.nombre?.trim()
        if (nombre !== undefined && nombre.length < 2) {
            throw new ValidacionFallida([
                { field: 'nombre', message: 'Escribe el nombre del banco', rule: 'minLength' },
            ])
        }
        if (nombre !== undefined && nombre.toLowerCase() !== antes.nombre.toLowerCase()) {
            const repetido = await t.trx
                .from('billing.bancos')
                .whereRaw('lower(nombre) = lower(?)', [nombre])
                .whereNot('id', input.id)
                .select('id')
                .first()
            if (repetido) {
                throw new Conflicto(
                    `El banco «${nombre}» ya está en el catálogo`,
                    'banco_duplicado',
                    'Banco duplicado',
                )
            }
        }
        const previo = { nombre: antes.nombre, orden: Number(antes.orden), activo: antes.activo }
        const despues = {
            nombre: nombre ?? previo.nombre,
            orden: input.orden ?? previo.orden,
            activo: input.activo ?? previo.activo,
        }
        const campos = (['nombre', 'orden', 'activo'] as const).filter((c) => previo[c] !== despues[c])
        if (campos.length > 0) {
            await t.trx
                .from('billing.bancos')
                .where('id', input.id)
                .update({
                    ...despues,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios({ tipo: 'banco', id: input.id }, previo, despues)
            await t.emit('banco_origen.cambiado', {
                banco_id: input.id,
                empresa_id: null,
                campos: [...campos],
                creado: false,
                activo: despues.activo,
                oculto: null,
            })
        }
        return verBancoOrigen(input.id, t.ctx.empresaId ?? null, t.trx)
    }
}
