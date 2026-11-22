import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirDefinicion } from '#billing/reportes/catalogo'
import { proximoEnvio, verEnvio, type EnvioReporte, type Frecuencia } from '#billing/reportes/envios'
import {
    diaDeEnvio,
    exigirAutorPuedeVer,
    guardarDestinatarios,
    validarDestinatarios,
    type CamposEnvio,
} from '#billing/reportes/envios_reglas'

export interface EntradaEditarEnvio extends CamposEnvio {
    id: number
    activo?: boolean
    version: number
    ahora?: Date
}

/**
 * `reportes.editar_envio`: cambia un envío programado (todos sus campos) o lo pausa y reanuda con
 * `activo`. 409 si `version` cambió. La próxima hora se recalcula si cambió la programación o al
 * reanudar (nunca manda los envíos que se perdieron mientras estuvo pausado). Diff en `audit.cambios`.
 */
export default class EditarEnvioReporte extends DomainAction<EntradaEditarEnvio, EnvioReporte> {
    readonly nombre = 'reportes.editar_envio'

    protected async handle(input: EntradaEditarEnvio, t: Transaccion): Promise<EnvioReporte> {
        const antes = (await t.trx
            .from('billing.reportes_envios')
            .where('id', input.id)
            .forUpdate()
            .first()) as Record<string, unknown> | null
        if (!antes) throw new NoEncontrado(`El envío programado ${input.id} no existe`)
        const empresaId = antes.empresa_id === null ? null : Number(antes.empresa_id)
        if (empresaId !== null) exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('envio_reporte', input.id)
        if (Number(antes.version) !== input.version) throw new ConflictoVersion('envio_reporte', input.id)

        const def = exigirDefinicion(String(antes.reporte))
        await exigirAutorPuedeVer(t, def)
        const filtros = await def.validar(input.filtros ?? (antes.filtros as Record<string, unknown>))
        const dia = diaDeEnvio(input)
        const destinatarios = await validarDestinatarios(t, def, filtros, input.destinatarios)
        const previos = (await t.trx
            .from('billing.reportes_envios_destinatarios')
            .where('envio_id', input.id)
            .orderBy('id')
            .select('usuario_id', 'correo_externo_id')) as Array<{
            usuario_id: number | null
            correo_externo_id: number | null
        }>
        const destAntes = {
            usuarios: previos
                .filter((p) => p.usuario_id)
                .map((p) => Number(p.usuario_id))
                .sort(),
            correos: previos
                .filter((p) => p.correo_externo_id)
                .map((p) => Number(p.correo_externo_id))
                .sort(),
        }
        const destDespues = {
            usuarios: [...destinatarios.usuarios].sort(),
            correos: [...destinatarios.correos].sort(),
        }
        const activo = input.activo ?? Boolean(antes.activo)
        const nuevo = {
            nombre: input.nombre,
            filtros,
            formato: input.formato,
            frecuencia: input.frecuencia,
            dia,
            hora: input.hora,
            activo,
        }
        const viejo = {
            nombre: antes.nombre,
            filtros: antes.filtros,
            formato: antes.formato,
            frecuencia: antes.frecuencia,
            dia: antes.dia === null ? null : Number(antes.dia),
            hora: Number(antes.hora),
            activo: Boolean(antes.activo),
        }
        const campos = (Object.keys(nuevo) as Array<keyof typeof nuevo>).filter(
            (k) => JSON.stringify(nuevo[k]) !== JSON.stringify(viejo[k]),
        ) as string[]
        if (JSON.stringify(destAntes) !== JSON.stringify(destDespues)) campos.push('destinatarios')
        if (campos.length === 0) return verEnvio(input.id, t.trx)

        const reprogramar =
            campos.some((c) => ['frecuencia', 'dia', 'hora'].includes(c)) || (activo && !viejo.activo)
        const proximo = reprogramar
            ? proximoEnvio(input.frecuencia as Frecuencia, dia, input.hora, input.ahora ?? new Date())
            : new Date(antes.proximo_en as string)
        await t.trx
            .from('billing.reportes_envios')
            .where('id', input.id)
            .update({
                nombre: nuevo.nombre,
                filtros: JSON.stringify(filtros),
                formato: nuevo.formato,
                frecuencia: nuevo.frecuencia,
                dia,
                hora: nuevo.hora,
                activo,
                proximo_en: proximo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        if (campos.includes('destinatarios')) await guardarDestinatarios(t, input.id, destinatarios)
        await t.registrarCambios(
            { tipo: 'envio_reporte', id: input.id },
            { ...viejo, destinatarios: destAntes },
            { ...nuevo, destinatarios: destDespues },
        )
        const soloActivo = campos.length === 1 && campos[0] === 'activo'
        await t.emit('reportes.envio_cambiado', {
            envio_id: input.id,
            empresa_id: empresaId,
            reporte: def.codigo,
            accion: soloActivo ? (activo ? 'reanudado' : 'pausado') : 'editado',
            campos,
            activo,
            proximo_en: proximo.toISOString(),
        })
        return verEnvio(input.id, t.trx)
    }
}
