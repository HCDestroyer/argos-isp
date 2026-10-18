import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { verEmpresaCompleta, type EmpresaCompleta } from '#core/empresas'
import { instaladorLocalizacion } from '#core/localizacion'
import { exigirPaisSoportado, sinDerivados } from '#core/actions/crear_empresa'

export interface EntradaCambiarPaisEmpresa {
    id: number
    version: number
    pais: string
}

/**
 * Documentos de una empresa que impiden cambiarle el país: lo que ya se emitió o asentó con la
 * localización actual. `fiscal` agrega los suyos (DTE, compras…) con
 * `InstaladorLocalizacion.tieneDocumentos`.
 */
const TABLAS_DOCUMENTOS = [
    'billing.facturas',
    'billing.notas_credito',
    'billing.pagos',
    'billing.saldos_iniciales',
    'ledger.asientos',
    'ledger.egresos',
] as const

async function tieneDocumentos(t: Transaccion, empresaId: number): Promise<boolean> {
    for (const tabla of TABLAS_DOCUMENTOS) {
        if (await t.trx.from(tabla).where('empresa_id', empresaId).select(t.trx.raw('1')).first()) return true
    }
    return (await instaladorLocalizacion()?.tieneDocumentos?.(empresaId, t.trx)) ?? false
}

/**
 * Cambia el país de la localización fiscal de una empresa (`empresas.cambiar_pais`,
 * `contratos/localizacion-fiscal.md` §3.1 y §10).
 *
 * - 422 `pais_no_soportado` si el país no tiene paquete.
 * - Mismo país: 200 sin cambios (no toca `version` ni reinstala).
 * - 409 `empresa_con_documentos` si la empresa ya tiene facturas, notas, pagos, saldos iniciales,
 *   asientos, egresos o documentos de `fiscal`.
 * - 409 si `version` no es la vigente.
 *
 * El instalador de `fiscal` corre en esta misma transacción: si falla, el país no cambia.
 */
export default class CambiarPaisEmpresa extends DomainAction<EntradaCambiarPaisEmpresa, EmpresaCompleta> {
    readonly nombre = 'empresas.cambiar_pais'

    protected async handle(input: EntradaCambiarPaisEmpresa, t: Transaccion): Promise<EmpresaCompleta> {
        t.fijarEntidad('empresa', input.id)
        t.fijarEmpresa(input.id)
        const pais = input.pais.toUpperCase()
        exigirPaisSoportado(pais)
        // la fila queda bloqueada: nadie emite un documento mientras se decide
        await t.trx.from('core.empresas').where('id', input.id).forUpdate().select('id')
        const antes = await verEmpresaCompleta(input.id, t.trx)
        verificarVersion('core.empresas', input.id, antes.version, input.version)
        if (antes.pais === pais) return antes
        if (await tieneDocumentos(t, input.id)) {
            throw new Conflicto(
                `La empresa ya tiene documentos con la localización ${antes.pais}; su país no puede cambiar`,
                'empresa_con_documentos',
            )
        }
        await actualizarConVersion(t.trx, 'core.empresas', input.id, input.version, { pais })
        await instaladorLocalizacion()?.instalar({
            trx: t.trx,
            ctx: t.ctx,
            empresaId: input.id,
            pais,
            paisAnterior: antes.pais,
        })
        const despues = await verEmpresaCompleta(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'empresa', id: input.id },
            sinDerivados(antes),
            sinDerivados(despues),
        )
        return despues
    }
}
