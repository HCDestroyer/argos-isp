import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import {
    ACCION_QOS,
    auditableClase,
    camposCambiados,
    clasesDePerfil,
    emitirQos,
    exigirEscrituraPerfil,
    exigirNombreLibre,
    exigirPerfilValido,
    filaClase,
    reglaCompleta,
    verPerfil,
    type DatosClaseQos,
} from '#network/actions/qos_comun'
import { verClase, type ClaseQosVista } from '#network/consultas/qos'
import type { ClaseQos } from '#network/qos'

export interface EntradaEditarClaseQos extends DatosClaseQos {
    id: number
    version: number
}

/**
 * Edita una clase de QoS (`PUT /qos/clases/:id`, control optimista por `version`). Lo ausente queda
 * igual. Valida el perfil como quedaría y el costo; diff en `audit.cambios` y `qos.config_cambiada`
 * con los campos que cambiaron. Sin cambios: 200 sin evento.
 */
export default class EditarClaseQos extends DomainAction<EntradaEditarClaseQos, ClaseQosVista> {
    readonly nombre = ACCION_QOS

    protected async handle(input: EntradaEditarClaseQos, t: Transaccion): Promise<ClaseQosVista> {
        t.fijarEntidad('qos_clase', input.id)
        const antes = await verClase(input.id, t.trx)
        const perfil = await verPerfil(antes.perfil_id, t.trx)
        exigirEscrituraPerfil(t, perfil)
        await t.trx.rawQuery('SELECT 1 FROM network.qos_perfiles WHERE id = ? FOR UPDATE', [perfil.id])
        verificarVersion('network.qos_clases', input.id, antes.version, input.version)
        const clases: ClaseQos[] = await clasesDePerfil(perfil.id, t.trx)
        const despues: ClaseQos = {
            ...antes,
            nombre: input.nombre?.trim() ?? antes.nombre,
            orden: input.orden ?? antes.orden,
            prioridad: input.prioridad ?? antes.prioridad,
            garantizado_pct: input.garantizado_pct ?? antes.garantizado_pct,
            tope_pct: input.tope_pct === undefined ? antes.tope_pct : input.tope_pct,
            reglas: input.reglas ? input.reglas.map(reglaCompleta) : antes.reglas,
            bytes_minimo: input.bytes_minimo === undefined ? antes.bytes_minimo : input.bytes_minimo,
            reclasifica_de: input.reclasifica_de ?? antes.reclasifica_de,
        }
        const campos = camposCambiados(antes, despues)
        if (campos.length === 0) return antes
        if (campos.includes('nombre')) exigirNombreLibre(clases, despues.nombre, antes.id)
        await exigirPerfilValido(
            t,
            perfil.id,
            clases.map((c) => (c.id === antes.id ? despues : c)),
            antes.id,
        )
        const { es_resto: resto, activa, ...cambios } = filaClase(despues)
        void [resto, activa]
        await actualizarConVersion(t.trx, 'network.qos_clases', input.id, input.version, cambios)
        const clase = await verClase(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'qos_clase', id: input.id },
            auditableClase(antes),
            auditableClase(clase),
        )
        await emitirQos(t, { perfil_id: perfil.id, clase_id: input.id, campos })
        return clase
    }
}
