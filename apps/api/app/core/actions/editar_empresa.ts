import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { verEmpresaCompleta, type DatosEmpresaCompleta, type EmpresaCompleta } from '#core/empresas'
import { exigirNitLibre, limpiarDatosEmpresa, sinDerivados } from '#core/actions/crear_empresa'

export type EntradaEditarEmpresa = Partial<DatosEmpresaCompleta> & {
    id: number
    version: number
}

/**
 * Edita los datos de una empresa (`empresas.editar`) con control optimista por `version` (409).
 * Solo cambia los campos enviados; `null` o vacío borra el dato (salvo `nombre_comercial`). Diff
 * por campo en `audit.cambios` (entidad `empresa`).
 */
export default class EditarEmpresa extends DomainAction<EntradaEditarEmpresa, EmpresaCompleta> {
    readonly nombre = 'empresas.editar'

    protected async handle(input: EntradaEditarEmpresa, t: Transaccion): Promise<EmpresaCompleta> {
        const { id, version, ...resto } = input
        t.fijarEntidad('empresa', id)
        t.fijarEmpresa(id)
        const antes = await verEmpresaCompleta(id, t.trx)
        const datos = limpiarDatosEmpresa(resto)
        if (datos.nombre_comercial === null) {
            throw new ValidacionFallida([
                {
                    field: 'nombre_comercial',
                    message: 'El nombre comercial es obligatorio',
                    rule: 'required',
                },
            ])
        }
        if (datos.nit !== undefined && antes.activa) {
            await t.trx.rawQuery('LOCK TABLE core.empresas IN SHARE ROW EXCLUSIVE MODE')
            await exigirNitLibre(t, datos.nit as string | null, id)
        }
        await actualizarConVersion(t.trx, 'core.empresas', id, version, datos)
        const despues = await verEmpresaCompleta(id, t.trx)
        await t.registrarCambios({ tipo: 'empresa', id }, sinDerivados(antes), sinDerivados(despues))
        return despues
    }
}
