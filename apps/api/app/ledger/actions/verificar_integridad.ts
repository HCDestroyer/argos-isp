import { DomainAction, type Transaccion } from '#shared/domain_action'
import { avisarRuptura, verificarCadena, type IntegridadEmpresa } from '#ledger/sellos'

/**
 * `libro.verificar_integridad`: recalcula toda la cadena de hash de cada empresa (o de
 * `empresa_id`) desde el sello 1 y emite `libro.integridad_rota` por la primera ruptura de cada
 * una (una vez por empresa y sello). La llama el cron diario `integridad` del worker de billing.
 * `GET /libro/integridad` hace el mismo recálculo como lectura, sin emitir.
 */

export interface EntradaVerificarIntegridad {
    empresa_id?: number | null
}

export default class VerificarIntegridad extends DomainAction<
    EntradaVerificarIntegridad,
    { data: IntegridadEmpresa[] }
> {
    readonly nombre = 'libro.verificar_integridad'

    protected async handle(input: EntradaVerificarIntegridad, t: Transaccion) {
        let empresas: number[]
        if (input.empresa_id) {
            empresas = [input.empresa_id]
            t.fijarEmpresa(input.empresa_id)
        } else {
            const filas = (await t.trx.from('core.empresas').orderBy('id').select('id')) as Array<{
                id: number
            }>
            empresas = filas.map((f) => Number(f.id))
        }
        const data: IntegridadEmpresa[] = []
        for (const empresaId of empresas) {
            const resultado = await verificarCadena(empresaId, {}, t.trx)
            if (resultado.ruptura) await avisarRuptura(t, empresaId, resultado.ruptura)
            data.push(resultado)
        }
        return { data }
    }
}
