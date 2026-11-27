import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'
import {
    guardarPasos,
    normalizarPasos,
    obtenerPlantillaRecordatorio,
    paraAuditoria,
    type EntradaPaso,
    type PlantillaRecordatorio,
} from '#notify/plantillas_recordatorio'

export interface EntradaPersonalizarRecordatorios {
    servicio_id: number
    /** 0 = el servicio aún no tiene personalizados; si no, la `version` de su plantilla personalizada */
    version: number
    descripcion?: string | null
    /** el conjunto completo de pasos que sustituye al de la plantilla para este servicio */
    pasos: EntradaPaso[]
}

/**
 * `recordatorios.personalizar` (`PUT /servicios/:id/recordatorios/personalizados`): recordatorios
 * propios de un servicio (excepción del cliente). Crea o reemplaza la plantilla personalizada del
 * servicio (`servicio_id` con valor: única por servicio, de su empresa, nunca por defecto ni
 * asignable a otros); sus pasos sustituyen completos a los de la plantilla asignada o por defecto.
 *
 * `version` 0 crea (409 si ya tiene); con valor, debe ser la de la personalizada (409 si cambió).
 * Diff en `audit.cambios`, `recordatorios.plantilla_cambiada` y, al crearla,
 * `recordatorios.asignacion_cambiada` con `personalizada: true`.
 */
export default class PersonalizarRecordatoriosServicio extends DomainAction<
    EntradaPersonalizarRecordatorios,
    PlantillaRecordatorio
> {
    readonly nombre = 'recordatorios.personalizar'

    protected async handle(input: EntradaPersonalizarRecordatorios, t: Transaccion) {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .forUpdate()
            .select('empresa_id')
            .first()) as { empresa_id: number } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        const empresaId = Number(servicio.empresa_id)
        t.fijarEmpresa(empresaId)
        exigirAccesoEmpresa(t.ctx, empresaId)
        const pasos = normalizarPasos(input.pasos)

        const existente = (await t.trx
            .from('notify.plantillas_recordatorio')
            .where('servicio_id', input.servicio_id)
            .forUpdate()
            .select('id', 'version', 'empresa_id')
            .first()) as { id: number; version: number; empresa_id: number } | null
        const versionActual = existente ? Number(existente.version) : 0
        if (versionActual !== input.version) {
            throw new ConflictoVersion(
                'plantilla_recordatorio',
                existente?.id ?? `servicio ${input.servicio_id}`,
            )
        }

        let antes: PlantillaRecordatorio | null = null
        let id: number
        // una personalizada de la empresa anterior (el servicio cambió de empresa) se reemplaza
        if (existente && Number(existente.empresa_id) !== empresaId) {
            antes = await obtenerPlantillaRecordatorio(existente.id, t.trx)
            await t.trx.from('notify.plantillas_recordatorio').where('id', existente.id).delete()
        }
        const creada = !existente || antes !== null
        if (!creada) {
            id = existente!.id
            antes = await obtenerPlantillaRecordatorio(id, t.trx)
            await t.trx
                .from('notify.plantillas_recordatorio')
                .where('id', id)
                .update({
                    ...(input.descripcion !== undefined
                        ? { descripcion: input.descripcion?.trim() || null }
                        : {}),
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        } else {
            const [fila] = (await t.trx
                .insertQuery()
                .table('notify.plantillas_recordatorio')
                .insert({
                    empresa_id: empresaId,
                    servicio_id: input.servicio_id,
                    nombre: `Personalizada · servicio ${input.servicio_id}`,
                    descripcion: input.descripcion?.trim() || null,
                })
                .returning('id')) as Array<{ id: number }>
            id = Number(fila!.id)
        }
        const pasosCambiaron = await guardarPasos(t.trx, id, pasos)
        const despues = await obtenerPlantillaRecordatorio(id, t.trx)
        const campos = await t.registrarCambios(
            { tipo: 'plantilla_recordatorio', id },
            creada ? null : paraAuditoria(antes!),
            paraAuditoria(despues),
        )
        // también en la línea de tiempo del servicio
        await t.registrarCambios(
            { tipo: 'servicio', id: input.servicio_id },
            { recordatorios_personalizados: creada ? null : antes!.pasos },
            { recordatorios_personalizados: despues.pasos },
        )
        const camposPlantilla = campos.filter((c) => c !== 'pasos')
        if (creada || pasosCambiaron || camposPlantilla.length > 0) {
            await t.emit('recordatorios.plantilla_cambiada', {
                plantilla_id: id,
                empresa_id: empresaId,
                campos: camposPlantilla,
                pasos: creada || pasosCambiaron,
            })
        }
        if (creada) {
            await t.emit('recordatorios.asignacion_cambiada', {
                empresa_id: empresaId,
                servicio_id: input.servicio_id,
                suscripcion_id: null,
                plantilla_id: id,
                personalizada: true,
            })
        }
        return despues
    }
}
