import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import {
    AprovisionamientoNoDisponible,
    EquipoInvalido,
    gestionDeEmpresa,
    validarWifi,
} from '#integraciones/equipos/equipos'

export interface EntradaAprovisionar {
    servicio_id: number
    equipo: {
        tipo: 'ont' | 'cpe_wireless' | 'router_tr069'
        serie?: string | null
        mac?: string | null
        unidad_id?: number | null
        modelo?: string | null
    }
    planta?: {
        olt?: string | null
        slot?: number | null
        pon?: number | null
        caja?: string | null
        puerto?: number | null
    } | null
    wireless?: { ap?: string | null; sector?: string | null } | null
    wifi?: { ssid?: string | null; clave?: string | null } | null
    tecnico?: { id_externo: string } | null
    origen_tipo?: 'iris_orden' | null
    origen_id?: string | null
}

/**
 * `servicios.aprovisionar` (`POST /servicios/:id/aprovisionar`, contrato Iris 0.9.0 §12.2, A32).
 *
 * Valida como pide el contrato (servicio `pendiente_instalacion`, combinación de equipo y planta,
 * formato del Wi-Fi) y responde `422 aprovisionamiento_no_disponible`: Argos no tiene SmartOLT ni ACS
 * (`#integraciones/equipos/equipos`), así que no puede aprovisionar nada y no lo finge. Cada intento
 * queda en la auditoría como error, con `wifi` como `***`. No cambia estado ni emite eventos.
 */
export default class AprovisionarServicio extends DomainAction<EntradaAprovisionar, never> {
    readonly nombre = 'servicios.aprovisionar'
    protected override readonly camposEntradaOcultos = ['wifi']

    protected async handle(input: EntradaAprovisionar, t: Transaccion): Promise<never> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .select('estado', 'empresa_id')
            .first()) as { estado: string; empresa_id: number | null } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        const empresaId = servicio.empresa_id === null ? null : Number(servicio.empresa_id)
        t.fijarEmpresa(empresaId)
        if (servicio.estado !== 'pendiente_instalacion') {
            throw new Conflicto(
                `El servicio ${input.servicio_id} no está pendiente de instalación (está ${servicio.estado})`,
                'servicio_no_pendiente',
                'El servicio no está pendiente de instalación',
            )
        }
        const { equipo } = input
        if (equipo.tipo === 'ont' && !equipo.serie) {
            throw new EquipoInvalido('Una ONT se identifica por su serie', [
                { field: 'equipo.serie', rule: 'requerido', message: 'La ONT necesita su serie' },
            ])
        }
        if (equipo.tipo === 'cpe_wireless' && !equipo.mac) {
            throw new EquipoInvalido('Un CPE o radio se identifica por su MAC', [
                { field: 'equipo.mac', rule: 'requerido', message: 'El CPE necesita su MAC' },
            ])
        }
        if (equipo.tipo === 'router_tr069' && !equipo.mac && !equipo.serie) {
            throw new EquipoInvalido('Un router TR-069 se identifica por su MAC o su serie', [
                { field: 'equipo.mac', rule: 'requerido', message: 'Manda la MAC o la serie' },
            ])
        }
        if (input.planta && equipo.tipo !== 'ont') {
            throw new EquipoInvalido('`planta` solo va con una ONT', [
                { field: 'planta', rule: 'combinacion', message: 'Solo con `equipo.tipo = ont`' },
            ])
        }
        if (input.wireless && equipo.tipo !== 'cpe_wireless') {
            throw new EquipoInvalido('`wireless` solo va con un CPE inalámbrico', [
                { field: 'wireless', rule: 'combinacion', message: 'Solo con `equipo.tipo = cpe_wireless`' },
            ])
        }
        if (input.wifi) validarWifi(input.wifi, 'wifi.')

        // Sin SmartOLT ni ACS no hay tecnología gestionada (`gestionDeEmpresa` siempre false): hoy
        // termina aquí. Con la integración, aquí se registra el aprovisionamiento y se responde 202.
        const gestion = await gestionDeEmpresa(empresaId)
        if (gestion.ftth || gestion.wireless || gestion.tr069) {
            throw new Error('servicios.aprovisionar: gestión habilitada sin implementación')
        }
        throw new AprovisionamientoNoDisponible()
    }
}
