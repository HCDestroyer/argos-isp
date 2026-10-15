import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { actualizarConVersion } from '#shared/version'
import { normalizarReglasPromesa, type ReglasPromesaParciales } from '#billing/reglas_promesa'
import {
    obtenerPlantilla,
    paraAuditoria,
    serializarPlantilla,
    validarCoherencia,
    type CamposPlantilla,
    type PlantillaPublica,
} from '#billing/plantillas'
import type { EntradaCrearPlantilla } from '#billing/actions/crear_plantilla'

/**
 * `plantillas.editar`: edición con control optimista (`version` → 409). Solo cambia los campos
 * enviados; `reglas_promesa`, si se envía, **reemplaza** el objeto completo (las claves faltantes
 * vuelven a su valor por defecto). Registra el diff por campo en `audit.cambios`.
 *
 * Las facturas ya emitidas no cambian: cada una guarda `reglas_snapshot` de su plantilla.
 */

const CAMPOS_EDITABLES = [
    'nombre',
    'ciclo',
    'dia',
    'prorrateo',
    'dias_gracia',
    'facturas_para_limitar',
    'facturas_para_cortar',
    'mora_tipo',
    'mora_valor',
    'mora_recurrente',
    'hora_corte',
    'certificar_al',
] as const

export interface EntradaEditarPlantilla extends Partial<EntradaCrearPlantilla> {
    id: number
    version: number
}

export default class EditarPlantilla extends DomainAction<EntradaEditarPlantilla, PlantillaPublica> {
    readonly nombre = 'plantillas.editar'

    protected async handle(input: EntradaEditarPlantilla, t: Transaccion) {
        t.fijarEntidad('plantilla_facturacion', input.id)
        const antes = await obtenerPlantilla(input.id, t.trx)
        if (antes.version !== input.version) throw new ConflictoVersion('plantilla_facturacion', input.id)

        const definidos: Record<string, unknown> = {}
        for (const campo of CAMPOS_EDITABLES) {
            if (input[campo] !== undefined) definidos[campo] = input[campo]
        }
        const reglas = input.reglas_promesa

        const campos = validarCoherencia({
            nombre: antes.nombre,
            ciclo: antes.ciclo,
            dia: antes.dia,
            prorrateo: antes.prorrateo,
            dias_gracia: antes.dias_gracia,
            facturas_para_limitar: antes.facturas_para_limitar,
            facturas_para_cortar: antes.facturas_para_cortar,
            mora_tipo: antes.mora_tipo,
            mora_valor: antes.mora_valor,
            mora_recurrente: antes.mora_recurrente,
            hora_corte: antes.hora_corte,
            certificar_al: antes.certificar_al,
            ...(definidos as Partial<CamposPlantilla>),
            reglas_promesa:
                reglas === undefined
                    ? antes.reglas_promesa
                    : normalizarReglasPromesa(reglas as ReglasPromesaParciales),
        })

        await actualizarConVersion(t.trx, 'billing.plantillas_facturacion', input.id, input.version, {
            ...campos,
            reglas_promesa: JSON.stringify(campos.reglas_promesa),
        })

        const despues = await obtenerPlantilla(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'plantilla_facturacion', id: input.id },
            paraAuditoria(antes),
            paraAuditoria(despues),
        )
        return serializarPlantilla(despues)
    }
}
