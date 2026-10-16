import { DomainAction, type Transaccion } from '#shared/domain_action'
import { normalizarReglasPromesa, type ReglasPromesaParciales } from '#billing/reglas_promesa'
import {
    desmarcarPorDefecto,
    obtenerPlantilla,
    paraAuditoria,
    serializarPlantilla,
    validarCoherencia,
    type CamposPlantilla,
    type PlantillaPublica,
} from '#billing/plantillas'

/**
 * `plantillas.crear`: crea una plantilla de facturación con valores por defecto para lo que no
 * venga, valida la coherencia entre campos y registra los valores iniciales en `audit.cambios`.
 */

export interface EntradaCrearPlantilla {
    nombre: string
    ciclo: 'dia_fijo' | 'aniversario'
    dia?: number | null
    prorrateo?: boolean
    dias_gracia?: number
    facturas_para_limitar?: number
    facturas_para_cortar?: number
    mora_tipo?: 'ninguna' | 'fija' | 'porcentaje'
    mora_valor?: string
    mora_recurrente?: boolean
    hora_corte?: string
    certificar_al?: 'emitir' | 'pagar' | 'nunca'
    reglas_promesa?: ReglasPromesaParciales
    /** true: pasa a ser la plantilla por defecto (la anterior deja de serlo) */
    por_defecto?: boolean
}

export const VALORES_POR_DEFECTO = {
    prorrateo: true,
    dias_gracia: 0,
    facturas_para_limitar: 1,
    facturas_para_cortar: 1,
    mora_tipo: 'ninguna',
    mora_valor: '0.00',
    mora_recurrente: false,
    hora_corte: '08:00',
    certificar_al: 'nunca',
} as const

export default class CrearPlantilla extends DomainAction<EntradaCrearPlantilla, PlantillaPublica> {
    readonly nombre = 'plantillas.crear'

    protected async handle(input: EntradaCrearPlantilla, t: Transaccion) {
        const campos: CamposPlantilla = validarCoherencia({
            nombre: input.nombre,
            ciclo: input.ciclo,
            dia: input.dia ?? null,
            prorrateo: input.prorrateo ?? VALORES_POR_DEFECTO.prorrateo,
            dias_gracia: input.dias_gracia ?? VALORES_POR_DEFECTO.dias_gracia,
            facturas_para_limitar: input.facturas_para_limitar ?? VALORES_POR_DEFECTO.facturas_para_limitar,
            facturas_para_cortar: input.facturas_para_cortar ?? VALORES_POR_DEFECTO.facturas_para_cortar,
            mora_tipo: input.mora_tipo ?? VALORES_POR_DEFECTO.mora_tipo,
            mora_valor: input.mora_valor ?? VALORES_POR_DEFECTO.mora_valor,
            mora_recurrente: input.mora_recurrente ?? VALORES_POR_DEFECTO.mora_recurrente,
            hora_corte: input.hora_corte ?? VALORES_POR_DEFECTO.hora_corte,
            certificar_al: input.certificar_al ?? VALORES_POR_DEFECTO.certificar_al,
            reglas_promesa: normalizarReglasPromesa(input.reglas_promesa),
        })

        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.plantillas_facturacion')
            .insert({ ...campos, reglas_promesa: JSON.stringify(campos.reglas_promesa) })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('plantilla_facturacion', fila!.id)
        if (input.por_defecto) {
            // a lo sumo una por defecto (índice único parcial): primero se desmarca la anterior
            await desmarcarPorDefecto(t, fila!.id)
            await t.trx
                .from('billing.plantillas_facturacion')
                .where('id', fila!.id)
                .update({ por_defecto: true })
        }

        const plantilla = await obtenerPlantilla(fila!.id, t.trx)
        await t.registrarCambios(
            { tipo: 'plantilla_facturacion', id: plantilla.id },
            null,
            paraAuditoria(plantilla),
        )
        return serializarPlantilla(plantilla)
    }
}
