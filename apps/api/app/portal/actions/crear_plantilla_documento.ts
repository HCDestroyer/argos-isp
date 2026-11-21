import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import {
    camposAuditados,
    exigirNombreLibre,
    filaPlantilla,
    plantillaPorId,
    validarConEjemplo,
    type FormatoDocumento,
    type PlantillaDocumento,
    type TipoDocumento,
} from '#portal/documentos/render'

export interface EntradaCrearPlantillaDocumento {
    tipo: TipoDocumento
    nombre: string
    /** sin él: el de la plantilla copiada o carta */
    formato?: FormatoDocumento
    /** copia el HTML de otra plantilla del mismo tipo (422 si es de otro tipo) */
    copiar_de_id?: number | null
    /** HTML propio; sin él ni `copiar_de_id`, la de fábrica del tipo y formato */
    html?: string | null
}

/**
 * Crea otra plantilla para un tipo de documento (`POST /plantillas-documentos`): desde la de fábrica
 * de su formato (sigue a la versión instalada hasta que se edite), copiando otra del mismo tipo o con
 * HTML propio. Nace activa y no predeterminada. Nombre único por tipo (422). Diff en `audit.cambios`.
 */
export default class CrearPlantillaDocumento extends DomainAction<
    EntradaCrearPlantillaDocumento,
    PlantillaDocumento
> {
    readonly nombre = 'documentos.crear'

    protected async handle(
        input: EntradaCrearPlantillaDocumento,
        t: Transaccion,
    ): Promise<PlantillaDocumento> {
        await t.trx.rawQuery('LOCK TABLE core.plantillas_documentos IN SHARE ROW EXCLUSIVE MODE')
        let formato: FormatoDocumento = input.formato ?? 'carta'
        let html: string | null = input.html ?? null

        if (input.copiar_de_id !== undefined && input.copiar_de_id !== null) {
            const origen = await filaPlantilla(input.copiar_de_id, t.trx).catch(() => null)
            if (!origen || origen.tipo !== input.tipo) {
                throw new ValidacionFallida([
                    {
                        field: 'copiar_de_id',
                        message: origen
                            ? 'Solo se puede copiar una plantilla del mismo documento'
                            : 'La plantilla a copiar no existe',
                        rule: 'plantilla',
                    },
                ])
            }
            formato = input.formato ?? origen.formato
            // copiar una de fábrica en su mismo formato la deja siguiendo a la de fábrica
            const copiada = await plantillaPorId(origen.id, t.trx)
            html = input.html ?? copiada.html
            if (origen.html === null && formato === origen.formato && input.html === undefined) html = null
        }

        await exigirNombreLibre(input.tipo, input.nombre, null, t.trx)
        if (html !== null) await validarConEjemplo(input.tipo, formato, html, t.trx)

        const fila = {
            tipo: input.tipo,
            nombre: input.nombre,
            formato,
            predeterminada: false,
            activa: true,
            html,
        }
        const [creada] = (await t.trx
            .insertQuery()
            .table('core.plantillas_documentos')
            .insert(fila)
            .returning('id')) as Array<{ id: number }>
        const id = Number(creada!.id)
        t.fijarEntidad('plantilla_documento', id)
        await t.registrarCambios({ tipo: 'plantilla_documento', id }, null, {
            tipo: input.tipo,
            ...camposAuditados(fila),
        })
        return plantillaPorId(id, t.trx)
    }
}
