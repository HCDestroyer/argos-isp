import logger from '@adonisjs/core/services/logger'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { canalWhatsappIris } from '#notify/canales/whatsapp'
import { aplicarAcuseIris } from '#notify/acuses_iris'
import { estadoConectorWhatsapp } from '#notify/whatsapp'

export interface EntradaConciliarAvisos {
    /** envíos en cola hace más de estas horas (por defecto 24, contrato Iris §6.6) */
    horas?: number
    limite?: number
    ahora?: Date
}

export interface ResultadoConciliarAvisos {
    revisados: number
    entregados: number
    fallidos: number
    /** Iris lo dejó `bloqueado`: el envío queda `omitido` */
    omitidos: number
    /** Iris no respondió la consulta de alguno (se vuelve a intentar en la próxima vuelta) */
    errores: number
}

/**
 * `notificaciones.conciliar_avisos_iris`: por si Argos perdió un webhook de Iris (contrato Iris
 * 0.6.0 §6.6), consulta `GET /mensajeria/avisos/:id` de los envíos de WhatsApp que siguen
 * `encolado` (aceptados por Iris) hace más de 24 h y les aplica el acuse (`#notify/acuses_iris`).
 * Lo corre `iris:worker` cada hora. Solo deja fila de auditoría si cambió algún envío o falló.
 */
export default class ConciliarAvisosIris extends DomainAction<
    EntradaConciliarAvisos,
    ResultadoConciliarAvisos
> {
    readonly nombre = 'notificaciones.conciliar_avisos_iris'

    protected override auditarExito(salida: ResultadoConciliarAvisos): boolean {
        return salida.entregados + salida.fallidos + salida.omitidos > 0
    }

    protected async handle(input: EntradaConciliarAvisos, t: Transaccion): Promise<ResultadoConciliarAvisos> {
        t.fijarEmpresa(null)
        const resultado: ResultadoConciliarAvisos = {
            revisados: 0,
            entregados: 0,
            fallidos: 0,
            omitidos: 0,
            errores: 0,
        }
        const conector = await estadoConectorWhatsapp(t.trx)
        if (!conector.disponible) return resultado
        const ahora = input.ahora ?? new Date()
        const limite = new Date(ahora.getTime() - (input.horas ?? 24) * 3600 * 1000)
        const filas = (await t.trx
            .from('notify.envios')
            .where('canal', 'whatsapp')
            .where('estado', 'encolado')
            .whereNotNull('proveedor_id')
            .where('created_at', '<', limite)
            .orderBy('id')
            .limit(input.limite ?? 100)
            .select('id', 'proveedor_id')) as Array<{ id: number; proveedor_id: string }>
        const canal = canalWhatsappIris()
        for (const fila of filas) {
            resultado.revisados++
            let consulta
            try {
                consulta = await canal.consultar(fila.proveedor_id)
            } catch (error) {
                resultado.errores++
                logger.warn({ envioId: fila.id, err: error }, 'notify: no se pudo consultar un aviso en Iris')
                continue
            }
            // Iris 0.6.1: entregado → enviado, fallido → fallido, bloqueado → omitido, en_cola sigue
            const tipo =
                consulta.estado === 'entregado' ||
                consulta.estado === 'fallido' ||
                consulta.estado === 'bloqueado'
                    ? consulta.estado
                    : null
            if (!tipo) continue
            const acuse = await aplicarAcuseIris(t, {
                envioId: Number(fila.id),
                tipo,
                avisoId: fila.proveedor_id,
                entregadoEn: consulta.entregado_en,
                leidoEn: consulta.leido_en,
                motivo: consulta.motivo,
                detalle: consulta.detalle ?? 'conciliado con GET /mensajeria/avisos/:id',
            })
            if (acuse.cambio) {
                resultado[
                    tipo === 'entregado' ? 'entregados' : tipo === 'fallido' ? 'fallidos' : 'omitidos'
                ]++
            }
        }
        return resultado
    }
}
