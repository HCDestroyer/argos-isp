import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import {
    ACCION_QOS,
    auditableClase,
    clasesDePerfil,
    emitirQos,
    exigirEscrituraPerfil,
    exigirPerfilValido,
    verPerfil,
} from '#network/actions/qos_comun'
import { verClase, type ClaseQosVista } from '#network/consultas/qos'

export interface EntradaEstadoClaseQos {
    id: number
    version: number
    motivo?: string
}

/**
 * Desactiva o vuelve a activar una clase de QoS (`POST /qos/clases/:id/desactivar|activar`). Nunca se
 * borra. `resto` no se desactiva (422 `qos_resto`); una clase origen de una de descargas tampoco
 * (`qos_reclasifica`). Activar revisa el perfil y el costo. Sin cambios: 200 sin evento.
 */
abstract class CambiarEstadoClaseQos extends DomainAction<EntradaEstadoClaseQos, ClaseQosVista> {
    readonly nombre = ACCION_QOS
    protected abstract readonly activa: boolean

    protected async handle(input: EntradaEstadoClaseQos, t: Transaccion): Promise<ClaseQosVista> {
        t.fijarEntidad('qos_clase', input.id)
        const antes = await verClase(input.id, t.trx)
        const perfil = await verPerfil(antes.perfil_id, t.trx)
        exigirEscrituraPerfil(t, perfil)
        await t.trx.rawQuery('SELECT 1 FROM network.qos_perfiles WHERE id = ? FOR UPDATE', [perfil.id])
        verificarVersion('network.qos_clases', input.id, antes.version, input.version)
        if (antes.activa === this.activa) return antes
        if (antes.es_resto && !this.activa) {
            throw new ValidacionFallida(
                [
                    {
                        field: 'id',
                        rule: 'qos_resto',
                        message: '«resto» no se desactiva: es lo que no coincide con nada',
                    },
                ],
                'La clase resto no se puede desactivar',
            )
        }
        const clases = await clasesDePerfil(perfil.id, t.trx)
        await exigirPerfilValido(
            t,
            perfil.id,
            clases.map((c) => (c.id === antes.id ? { ...c, activa: this.activa } : c)),
            antes.id,
        )
        await actualizarConVersion(t.trx, 'network.qos_clases', input.id, input.version, {
            activa: this.activa,
        })
        const clase = await verClase(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'qos_clase', id: input.id },
            auditableClase(antes),
            auditableClase(clase),
        )
        await emitirQos(t, { perfil_id: perfil.id, clase_id: input.id, campos: ['activa'] })
        return clase
    }
}

export class DesactivarClaseQos extends CambiarEstadoClaseQos {
    protected readonly activa = false
}

export class ActivarClaseQos extends CambiarEstadoClaseQos {
    protected readonly activa = true
}
