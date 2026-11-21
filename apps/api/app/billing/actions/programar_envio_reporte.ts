import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Prohibido } from '#shared/errores'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { exigirDefinicion } from '#billing/reportes/catalogo'
import { proximoEnvio, verEnvio, type EnvioReporte } from '#billing/reportes/envios'
import {
    diaDeEnvio,
    exigirAutorPuedeVer,
    guardarDestinatarios,
    validarDestinatarios,
    type CamposEnvio,
} from '#billing/reportes/envios_reglas'

export interface EntradaProgramarEnvio extends CamposEnvio {
    reporte: string
    /** todas las empresas (solo con alcance global); si no, la empresa activa */
    consolidado?: boolean
    /** para pruebas: «ahora» del cálculo de la primera hora */
    ahora?: Date
}

/**
 * `reportes.programar_envio` (decisión 6 del PM): envío periódico de un reporte del catálogo por
 * correo. El reporte y sus filtros se validan al programar y otra vez en cada envío; en cada envío se
 * revisan el permiso, el alcance y la empresa de cada destinatario (`reportes.ejecutar_envio`).
 */
export default class ProgramarEnvioReporte extends DomainAction<EntradaProgramarEnvio, EnvioReporte> {
    readonly nombre = 'reportes.programar_envio'

    protected async handle(input: EntradaProgramarEnvio, t: Transaccion): Promise<EnvioReporte> {
        const def = exigirDefinicion(input.reporte)
        let empresaId: number | null
        if (input.consolidado) {
            if (t.ctx.empresasPermitidas !== null && t.ctx.empresasPermitidas !== undefined) {
                throw new Prohibido('El consolidado de todas las empresas requiere alcance global')
            }
            empresaId = null
        } else {
            empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        }
        t.fijarEmpresa(empresaId)
        await exigirAutorPuedeVer(t, def)
        const filtros = await def.validar(input.filtros ?? {})
        const dia = diaDeEnvio(input)
        const destinatarios = await validarDestinatarios(t, def, filtros, input.destinatarios)
        const proximo = proximoEnvio(input.frecuencia, dia, input.hora, input.ahora ?? new Date())
        const [fila] = (await t.trx
            .table('billing.reportes_envios')
            .insert({
                empresa_id: empresaId,
                nombre: input.nombre,
                reporte: def.codigo,
                filtros: JSON.stringify(filtros),
                formato: input.formato,
                frecuencia: input.frecuencia,
                dia,
                hora: input.hora,
                proximo_en: proximo,
                creado_por: t.ctx.actor.id,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('envio_reporte', id)
        await guardarDestinatarios(t, id, destinatarios)
        await t.emit('reportes.envio_cambiado', {
            envio_id: id,
            empresa_id: empresaId,
            reporte: def.codigo,
            accion: 'creado',
            campos: ['nombre', 'filtros', 'formato', 'frecuencia', 'dia', 'hora', 'destinatarios'],
            activo: true,
            proximo_en: proximo.toISOString(),
        })
        return verEnvio(id, t.trx)
    }
}
