import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { empresaLealtad } from '#lealtad/comun'
import { ReferidoInvalido } from '#lealtad/errores'
import {
    duenoDeCodigo,
    normalizarCodigo,
    referidoDeCliente,
    verReferido,
    type ReferidoVista,
} from '#lealtad/referidos'

/**
 * `lealtad.registrar_referido` (§4): el cliente `referido_id` llegó con el código de otro cliente.
 * Cuenta en `empresa_id`, la del servicio nuevo del referido (§9). La llama A1 al dar de alta el
 * cliente o su primer servicio con `codigo_referido` (fase 2; hoy, sin ruta propia).
 *
 * 422 `referido_invalido`: código inexistente, autorreferido, mismo NIT o CUI que el referidor, o
 * el cliente ya fue referido en la empresa (un cliente es referido una vez por empresa). Queda
 * `pendiente`: el consumidor lo califica cuando paga las facturas mínimas de la regla.
 */

export interface EntradaRegistrarReferido {
    empresa_id?: number | null
    referido_id: number
    codigo: string
}

const documento = (valor: string | null) => {
    const limpio = (valor ?? '').replace(/[\s-]/g, '').toUpperCase()
    return limpio === '' || limpio === 'CF' ? null : limpio
}

export default class RegistrarReferido extends DomainAction<EntradaRegistrarReferido, ReferidoVista> {
    readonly nombre = 'lealtad.registrar_referido'

    protected async handle(input: EntradaRegistrarReferido, t: Transaccion): Promise<ReferidoVista> {
        const empresaId = await empresaLealtad(t, input.empresa_id)
        const codigo = normalizarCodigo(input.codigo)
        const dueno = await duenoDeCodigo(t.trx, codigo)
        if (!dueno) throw new ReferidoInvalido(`El código de referido ${codigo} no existe`)
        if (dueno.cliente_id === input.referido_id) {
            throw new ReferidoInvalido('Un cliente no se refiere a sí mismo')
        }
        const clientes = (await t.trx
            .from('core.clientes')
            .whereIn('id', [dueno.cliente_id, input.referido_id])
            .select('id', 'nit_cui')) as Array<{ id: number; nit_cui: string | null }>
        const referido = clientes.find((c) => Number(c.id) === input.referido_id)
        if (!referido) throw new NoEncontrado(`El cliente ${input.referido_id} no existe`)
        const referidor = clientes.find((c) => Number(c.id) === dueno.cliente_id)
        const doc = documento(referido.nit_cui)
        if (doc !== null && doc === documento(referidor?.nit_cui ?? null)) {
            throw new ReferidoInvalido('El referido tiene el mismo NIT o CUI que quien lo refiere')
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(5103, ?::int)', [input.referido_id])
        if (await referidoDeCliente(t.trx, empresaId, input.referido_id)) {
            throw new ReferidoInvalido(
                `El cliente ${input.referido_id} ya fue referido en la empresa ${empresaId}`,
            )
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('lealtad.referidos')
            .insert({
                empresa_id: empresaId,
                referidor_id: dueno.cliente_id,
                referido_id: input.referido_id,
                codigo,
            })
            .returning('id')) as Array<{ id: number }>
        const vista = await verReferido(Number(fila!.id), t.trx)
        t.fijarEntidad('referido_lealtad', vista.id)
        await t.registrarCambios({ tipo: 'referido_lealtad', id: vista.id }, null, {
            referidor_id: vista.referidor_id,
            referido_id: vista.referido_id,
            codigo,
            estado: vista.estado,
        })
        return vista
    }
}
