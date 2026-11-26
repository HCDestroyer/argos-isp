import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import {
    exigirNombreLibre,
    guardarPasos,
    normalizarPasos,
    obtenerPlantillaRecordatorio,
    paraAuditoria,
    type EntradaPaso,
    type PlantillaRecordatorio,
} from '#notify/plantillas_recordatorio'
import { desmarcarPorDefecto } from '#notify/actions/fijar_plantilla_recordatorio_por_defecto'

export interface EntradaCrearPlantillaRecordatorio {
    /** sin ella, la empresa activa (o la única activa) */
    empresa_id?: number
    nombre: string
    descripcion?: string | null
    /** true: pasa a ser la por defecto de su empresa (la anterior deja de serlo) */
    por_defecto?: boolean
    pasos: EntradaPaso[]
}

/**
 * `recordatorios.crear` (`POST /plantillas-recordatorio`): plantilla con nombre de una empresa y sus
 * pasos (hasta 8). Nombre único en la empresa (409 `plantilla_duplicada`); pasos inválidos, 422.
 * Con `por_defecto` desplaza a la anterior en la misma transacción. Diff en `audit.cambios` y
 * `recordatorios.plantilla_cambiada` (y otro de la que dejó de ser por defecto).
 */
export default class CrearPlantillaRecordatorio extends DomainAction<
    EntradaCrearPlantillaRecordatorio,
    PlantillaRecordatorio
> {
    readonly nombre = 'recordatorios.crear'

    protected async handle(input: EntradaCrearPlantillaRecordatorio, t: Transaccion) {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            exigirAccesoEmpresa(t.ctx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        t.fijarEmpresa(empresaId)
        const pasos = normalizarPasos(input.pasos)
        await exigirNombreLibre(t.trx, empresaId, input.nombre)

        const [fila] = (await t.trx
            .insertQuery()
            .table('notify.plantillas_recordatorio')
            .insert({
                empresa_id: empresaId,
                nombre: input.nombre.trim(),
                descripcion: input.descripcion?.trim() || null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('plantilla_recordatorio', id)
        await guardarPasos(t.trx, id, pasos)
        if (input.por_defecto) {
            await desmarcarPorDefecto(t, empresaId, id)
            await t.trx.from('notify.plantillas_recordatorio').where('id', id).update({ por_defecto: true })
        }

        const plantilla = await obtenerPlantillaRecordatorio(id, t.trx)
        const campos = await t.registrarCambios(
            { tipo: 'plantilla_recordatorio', id },
            null,
            paraAuditoria(plantilla),
        )
        await t.emit('recordatorios.plantilla_cambiada', {
            plantilla_id: id,
            empresa_id: empresaId,
            campos: campos.filter((c) => c !== 'pasos'),
            pasos: true,
        })
        return plantilla
    }
}
