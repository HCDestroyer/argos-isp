import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import {
    normalizarOpciones,
    verCampoPersonalizado,
    type CampoPersonalizadoVista,
    type TipoCampoPersonalizado,
} from '#core/campos_personalizados'

export interface EntradaCrearCampoPersonalizado {
    clave: string
    etiqueta: string
    tipo: TipoCampoPersonalizado
    opciones?: string[]
    requerido?: boolean
    orden?: number
}

/**
 * Agrega un campo al catálogo de campos personalizados del cliente
 * (`campos_personalizados.crear`). `clave` y `tipo` quedan fijos. 409 `campo_duplicado` si la
 * clave ya existe (activa o no). Un campo requerido se exige en las altas y ediciones siguientes;
 * los clientes que ya existen no se tocan.
 */
export default class CrearCampoPersonalizado extends DomainAction<
    EntradaCrearCampoPersonalizado,
    CampoPersonalizadoVista
> {
    readonly nombre = 'campos_personalizados.crear'

    protected async handle(
        input: EntradaCrearCampoPersonalizado,
        t: Transaccion,
    ): Promise<CampoPersonalizadoVista> {
        const repetido = await t.trx.from('core.campos_personalizados').where('clave', input.clave).first()
        if (repetido) throw new Conflicto(`Ya existe el campo ${input.clave}`, 'campo_duplicado')
        const opciones = normalizarOpciones(input.tipo, input.opciones)
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.campos_personalizados')
            .insert({
                clave: input.clave,
                etiqueta: input.etiqueta.trim(),
                tipo: input.tipo,
                opciones: JSON.stringify(opciones),
                requerido: input.requerido ?? false,
                orden: input.orden ?? 0,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('campo_personalizado', id)
        const campo = await verCampoPersonalizado(id, t.trx)
        await t.registrarCambios({ tipo: 'campo_personalizado', id }, null, campo)
        return campo
    }
}
