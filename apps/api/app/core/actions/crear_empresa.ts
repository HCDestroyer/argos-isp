import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import {
    CAMPOS_DATOS_EMPRESA,
    normalizarNitEmpresa,
    verEmpresaCompleta,
    type DatosEmpresaCompleta,
    type EmpresaCompleta,
} from '#core/empresas'

export type EntradaCrearEmpresa = Partial<DatosEmpresaCompleta> & {
    nit: string
    razon_social: string
    nombre_comercial: string
}

/** Limpia los campos enviados: texto recortado, vacío = null, NIT normalizado. */
export function limpiarDatosEmpresa(input: Partial<DatosEmpresaCompleta>): Record<string, unknown> {
    const datos: Record<string, unknown> = {}
    for (const campo of CAMPOS_DATOS_EMPRESA) {
        const valor = input[campo]
        if (valor === undefined) continue
        const limpio = typeof valor === 'string' ? valor.trim() : valor
        datos[campo] = limpio === '' ? null : limpio
    }
    if (datos.nit !== undefined) datos.nit = normalizarNitEmpresa(datos.nit as string | null)
    if (typeof datos.color_marca === 'string') datos.color_marca = datos.color_marca.toUpperCase()
    return datos
}

/** 409 `nit_duplicado` si otra empresa activa ya tiene ese NIT. */
export async function exigirNitLibre(t: Transaccion, nit: string | null | undefined, excepto?: number) {
    if (!nit) return
    const consulta = t.trx
        .from('core.empresas')
        .where('activa', true)
        .whereRaw(`upper(regexp_replace(nit, '[\\s-]', '', 'g')) = ?`, [nit])
    if (excepto) consulta.whereNot('id', excepto)
    if (await consulta.first()) {
        throw new Conflicto(`Ya existe una empresa activa con el NIT ${nit}`, 'nit_duplicado')
    }
}

/** Instantánea auditable (sin campos derivados). */
export function sinDerivados(empresa: EmpresaCompleta) {
    const { logo_url: url, principal, ...resto } = empresa
    void principal
    return { ...resto, logo: url }
}

/**
 * Alta de una empresa (NIT) de la instalación (`empresas.crear`). Exige NIT válido, razón social y
 * nombre comercial; el NIT es único entre las empresas activas (409 `nit_duplicado`). El logo se
 * sube aparte (`empresas.cambiar_logo`).
 */
export default class CrearEmpresa extends DomainAction<EntradaCrearEmpresa, EmpresaCompleta> {
    readonly nombre = 'empresas.crear'

    protected async handle(input: EntradaCrearEmpresa, t: Transaccion): Promise<EmpresaCompleta> {
        const datos = limpiarDatosEmpresa(input)
        await t.trx.rawQuery('LOCK TABLE core.empresas IN SHARE ROW EXCLUSIVE MODE')
        await exigirNitLibre(t, datos.nit as string | null)
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.empresas')
            .insert(datos)
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('empresa', id)
        t.fijarEmpresa(id)
        const empresa = await verEmpresaCompleta(id, t.trx)
        await t.registrarCambios({ tipo: 'empresa', id }, null, sinDerivados(empresa))
        return empresa
    }
}
