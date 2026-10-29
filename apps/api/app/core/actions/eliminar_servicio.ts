import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { enmascarar } from '#shared/enmascarar'
import { verificarVersion } from '#shared/version'
import { verServicio } from '#core/consultas/servicios'
import { asignacionesVigentes } from '#core/asignaciones_servicio'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { ConHistorial, servicioEliminable } from '#core/eliminacion'

export interface EntradaEliminarServicio {
    id: number
    version: number
}

export interface SalidaEliminarServicio {
    id: number
    eliminado: true
}

/**
 * Elimina un servicio que nunca se usó (decisión del PM, 29 oct; `contratos/eliminar.md`). Con
 * historial (facturas, pagos, asientos, DTE, sesiones, inventario, lealtad, Horus…) responde 422
 * `servicio_con_historial` con lo que lo impide: ese servicio se retira (`servicios.retirar`).
 *
 * - Borra lo que depende solo de él: asignaciones IPv4/IPv6 (la IP y los prefijos quedan libres),
 *   tramos del historial, adicionales y sus bloqueos, planes temporales, excepciones e ids externos.
 * - `audit.acciones` guarda la foto del registro y de esas filas (credenciales como `***`) y
 *   `audit.cambios` el diff campo → null. `audit.*` nunca se borra.
 * - Emite `servicio.eliminado` y `asignacion.cambiada` (ips vacías: el dispatcher de RouterOS limpia
 *   lo que creó y los mapas IP → servicio se invalidan).
 * - Redis: lápida en `aaa:user:<user_ppp>` (write-through; contrato `aaa.md`: nunca solo `DEL`).
 */
export default class EliminarServicio extends DomainAction<EntradaEliminarServicio, SalidaEliminarServicio> {
    readonly nombre = 'servicios.eliminar'

    protected async handle(input: EntradaEliminarServicio, t: Transaccion): Promise<SalidaEliminarServicio> {
        const id = input.id
        t.fijarEntidad('servicio', id)
        const fila = (await t.trx.from('core.servicios').where('id', id).forUpdate().first()) as Record<
            string,
            unknown
        > | null
        if (!fila) throw new NoEncontrado(`El servicio ${id} no existe`)
        const empresaId = Number(fila.empresa_id)
        t.fijarEmpresa(empresaId)
        verificarVersion('servicio', id, Number(fila.version), input.version)

        const { motivos } = await servicioEliminable(id, t.trx)
        if (motivos.length > 0) {
            throw new ConHistorial(
                'servicio_con_historial',
                `El servicio ${id} tiene historial y no se puede eliminar; retíralo (POST /servicios/${id}/retirar)`,
                motivos,
            )
        }

        const antes = await verServicio(id, t.trx)
        const vigentes = await asignacionesVigentes(t.trx, id)
        const dependientes = {
            ipv4_asignaciones: await t.trx.from('network.ipv4_asignaciones').where('servicio_id', id),
            ipv6_asignaciones: await t.trx.from('network.ipv6_asignaciones').where('servicio_id', id),
            adicionales: await t.trx.from('core.servicios_adicionales').where('servicio_id', id),
            excepciones: await t.trx.from('core.servicios_excepciones').where('servicio_id', id),
            planes_temporales: await t.trx.from('core.servicios_planes_temporales').where('servicio_id', id),
            ids_externos: await t.trx
                .from('core.ids_externos')
                .where({ entidad_tipo: 'servicio', entidad_id: id }),
        }
        t.anotarAuditoria({
            foto: enmascarar({ servicio: fila, ...dependientes }) as Record<string, unknown>,
        })

        // Hijos primero (FK sin cascada).
        await t.trx.from('core.servicios_adicionales_bloqueos').where('servicio_id', id).delete()
        await t.trx.from('core.servicios_adicionales').where('servicio_id', id).delete()
        await t.trx.from('core.servicios_planes_temporales').where('servicio_id', id).delete()
        await t.trx.from('core.servicios_excepciones').where('servicio_id', id).delete()
        await t.trx.from('network.ipv4_asignaciones').where('servicio_id', id).delete()
        await t.trx.from('network.ipv6_asignaciones').where('servicio_id', id).delete()
        await t.trx.from('network.asignaciones_historial').where('servicio_id', id).delete()
        await t.trx.from('core.ids_externos').where({ entidad_tipo: 'servicio', entidad_id: id }).delete()
        await t.trx.from('core.servicios').where('id', id).delete()

        await t.registrarCambios({ tipo: 'servicio', id }, antes, null)
        await t.emit('servicio.eliminado', {
            servicio_id: id,
            empresa_id: empresaId,
            cliente_id: Number(fila.cliente_id),
            router_id: Number(fila.router_id),
        })
        const ahora = new Date().toISOString()
        await t.emit('asignacion.cambiada', {
            servicio_id: id,
            empresa_id: empresaId,
            ipv4: [],
            prefijo_enlace_v6: null,
            prefijo_delegado_v6: null,
            inicio: ahora,
            fin: ahora,
        })
        t.anotarAuditoria({ liberadas: vigentes })

        const userPpp = typeof fila.user_ppp === 'string' ? fila.user_ppp : null
        if (userPpp) {
            // versión mayor que cualquier registro publicado del servicio: la lápida no se pisa
            refrescarAaaAlConfirmar(t, {
                lapida: { userPpp, servicioId: id, version: Number(fila.version) + 1 },
            })
        }
        return { id, eliminado: true }
    }
}
