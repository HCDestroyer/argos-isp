import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, ValidacionFallida } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import {
    CAMPOS_SOLO_LECTURA_EMPRESA,
    verEmpresaCompleta,
    type DatosEmpresaCompleta,
    type EmpresaCompleta,
} from '#core/empresas'
import { exigirNitLibre, limpiarDatosEmpresa, sinDerivados } from '#core/actions/crear_empresa'

export type EntradaEditarEmpresa = Partial<DatosEmpresaCompleta> & {
    id: number
    version: number
}

/**
 * Edita los datos de una empresa (`empresas.editar`) con control optimista por `version` (409).
 * Solo cambia los campos enviados; `null` o vacío borra el dato (salvo `nombre_comercial`). Diff
 * por campo en `audit.cambios` (entidad `empresa`).
 *
 * `regimen_isr` y `codigo_establecimiento` son de solo lectura (localización fiscal §11): si llegan
 * con el valor vigente se ignoran (el formulario manda todo); con otro valor, 422
 * `campo_solo_lectura` (se cambian en `/fiscal/regimen` y `/fiscal/establecimientos`). El país
 * cambia con `empresas.cambiar_pais`.
 */
export default class EditarEmpresa extends DomainAction<EntradaEditarEmpresa, EmpresaCompleta> {
    readonly nombre = 'empresas.editar'

    protected async handle(input: EntradaEditarEmpresa, t: Transaccion): Promise<EmpresaCompleta> {
        const { id, version, ...resto } = input
        t.fijarEntidad('empresa', id)
        t.fijarEmpresa(id)
        const antes = await verEmpresaCompleta(id, t.trx)
        const datos = limpiarDatosEmpresa(resto)
        const soloLectura = CAMPOS_SOLO_LECTURA_EMPRESA.filter(
            (campo) => datos[campo] !== undefined && datos[campo] !== antes[campo],
        )
        if (soloLectura.length > 0) {
            throw new Problema(
                422,
                'campo_solo_lectura',
                'Campo de solo lectura',
                'El régimen de ISR y el establecimiento se cambian en la configuración fiscal',
                soloLectura.map((campo) => ({
                    field: campo,
                    message:
                        campo === 'regimen_isr'
                            ? 'Se cambia con POST /fiscal/regimen (con vigencia)'
                            : 'Se cambia en /fiscal/establecimientos',
                    rule: 'solo_lectura',
                })),
            )
        }
        for (const campo of CAMPOS_SOLO_LECTURA_EMPRESA) delete datos[campo]
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
