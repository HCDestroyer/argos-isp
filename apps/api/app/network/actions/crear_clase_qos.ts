import { DomainAction, type Transaccion } from '#shared/domain_action'
import {
    ACCION_QOS,
    auditableClase,
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

export interface EntradaCrearClaseQos extends DatosClaseQos {
    perfil_id: number
    nombre: string
    orden: number
    prioridad: number
}

/**
 * Agrega una clase a un perfil de QoS (`contratos/qos.md` §1 y §4). Valida el perfil como quedaría
 * (resto, máximo de clases, Σ garantizado, reglas, reclasificación) y el costo en cada router que lo
 * usa (422 `qos_*`). Emite `qos.config_cambiada` para reconciliar esos routers.
 */
export default class CrearClaseQos extends DomainAction<EntradaCrearClaseQos, ClaseQosVista> {
    readonly nombre = ACCION_QOS

    protected async handle(input: EntradaCrearClaseQos, t: Transaccion): Promise<ClaseQosVista> {
        const perfil = await verPerfil(input.perfil_id, t.trx)
        exigirEscrituraPerfil(t, perfil)
        await t.trx.rawQuery('SELECT 1 FROM network.qos_perfiles WHERE id = ? FOR UPDATE', [perfil.id])
        const clases: ClaseQos[] = await clasesDePerfil(perfil.id, t.trx)
        exigirNombreLibre(clases, input.nombre, null)
        const nueva: Omit<ClaseQos, 'id'> = {
            nombre: input.nombre.trim(),
            orden: input.orden,
            prioridad: input.prioridad,
            garantizado_pct: input.garantizado_pct ?? 0,
            tope_pct: input.tope_pct ?? null,
            es_resto: false,
            reglas: (input.reglas ?? []).map(reglaCompleta),
            bytes_minimo: input.bytes_minimo ?? null,
            reclasifica_de: input.reclasifica_de ?? [],
            activa: true,
        }
        // Id provisional (negativo) para validar el perfil como quedaría.
        await exigirPerfilValido(t, perfil.id, [...clases, { ...nueva, id: -1 }], -1)
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.qos_clases')
            .insert({ ...filaClase(nueva), perfil_id: perfil.id })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('qos_clase', id)
        const clase = await verClase(id, t.trx)
        await t.registrarCambios({ tipo: 'qos_clase', id }, null, auditableClase(clase))
        await emitirQos(t, { perfil_id: perfil.id, clase_id: id, campos: ['activa'] })
        return clase
    }
}
