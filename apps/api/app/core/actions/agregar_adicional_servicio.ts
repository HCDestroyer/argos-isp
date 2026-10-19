import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Prohibido, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import type { ModalidadAdicional } from '#shared/eventos'
import {
    exigirMotivoCortesia,
    exigirPrecioPositivo,
    insertarAsignacion,
    servicioParaAdicional,
    verAsignacion,
    type AsignacionAdicionalVista,
} from '#core/adicionales'

export interface EntradaAgregarAdicionalServicio {
    servicio_id: number
    adicional_id: number
    modalidad: ModalidadAdicional
    /** usuario de IPTV, correo de la cuenta… */
    identificador?: string | null
    /** se guarda cifrada; nunca vuelve en listas ni en la auditoría */
    credencial?: string | null
    /** obligatorio y > 0 con `cobrado`; prohibido con las demás */
    precio?: string | null
    /** obligatorio con `cortesia` (catálogo de motivos); prohibido con las demás */
    motivo_id?: number | null
    motivo_detalle?: string | null
    /**
     * El actor tiene `servicios.adicional_cortesia` (lo resuelve la ruta con el ACL). Sin él, una
     * cortesía responde 403. Ausente = sí (llamadas internas: crons, importador, consola).
     */
    permiteCortesia?: boolean
}

/** 403 si se da o se cambia una cortesía sin `servicios.adicional_cortesia`. */
export function exigirPermisoCortesia(permite: boolean | undefined) {
    if (permite === false) {
        throw new Prohibido('Dar un adicional de cortesía requiere el permiso servicios.adicional_cortesia')
    }
}

/** 422 por campo si `precio` y `motivo_id` no corresponden a la modalidad. */
export function validarModalidad(datos: {
    modalidad: ModalidadAdicional
    precio: string | null
    motivo_id: number | null
    motivo_detalle: string | null
}) {
    if (datos.modalidad === 'cobrado') {
        if (datos.precio === null) {
            throw new ValidacionFallida([
                { field: 'precio', message: 'Un adicional cobrado necesita precio', rule: 'required' },
            ])
        }
        exigirPrecioPositivo(datos.precio)
    } else if (datos.precio !== null) {
        throw new ValidacionFallida([
            { field: 'precio', message: 'Solo un adicional cobrado lleva precio', rule: 'modalidad' },
        ])
    }
    if (datos.modalidad === 'cortesia') {
        if (datos.motivo_id === null) {
            throw new ValidacionFallida([
                { field: 'motivo_id', message: 'Una cortesía necesita su motivo', rule: 'required' },
            ])
        }
    } else if (datos.motivo_id !== null || datos.motivo_detalle !== null) {
        throw new ValidacionFallida([
            {
                field: datos.motivo_id !== null ? 'motivo_id' : 'motivo_detalle',
                message: 'Solo una cortesía lleva motivo',
                rule: 'modalidad',
            },
        ])
    }
}

/**
 * Agrega un adicional a un servicio (`servicios.agregar_adicional`). El adicional debe ser de la
 * empresa del servicio (422 `adicional_de_otra_empresa`) y estar activo (422
 * `adicional_inactivo`). Un mismo adicional puede ir varias veces (3 usuarios de IPTV). La
 * cortesía exige además `servicios.adicional_cortesia` (lo revisa la ruta). Emite
 * `servicio.adicional_agregado` (`origen: manual`).
 */
export default class AgregarAdicionalServicio extends DomainAction<
    EntradaAgregarAdicionalServicio,
    AsignacionAdicionalVista
> {
    readonly nombre = 'servicios.agregar_adicional'

    protected async handle(
        input: EntradaAgregarAdicionalServicio,
        t: Transaccion,
    ): Promise<AsignacionAdicionalVista> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = await servicioParaAdicional(t, input.servicio_id)
        const adicional = (await t.trx
            .from('core.adicionales')
            .where('id', input.adicional_id)
            .select('empresa_id', 'activo', 'nombre')
            .first()) as { empresa_id: number; activo: boolean; nombre: string } | null
        if (!adicional) {
            throw new ValidacionFallida([
                { field: 'adicional_id', message: 'El adicional no existe', rule: 'exists' },
            ])
        }
        if (Number(adicional.empresa_id) !== servicio.empresa_id) {
            throw new ReglaNegocio(
                `El adicional ${adicional.nombre} es de otra empresa que el servicio`,
                'adicional_de_otra_empresa',
            )
        }
        if (!adicional.activo) {
            throw new ReglaNegocio(`El adicional ${adicional.nombre} está desactivado`, 'adicional_inactivo')
        }
        const datos = {
            modalidad: input.modalidad,
            precio: input.precio ?? null,
            motivo_id: input.motivo_id ?? null,
            motivo_detalle: input.motivo_detalle ?? null,
        }
        validarModalidad(datos)
        if (datos.modalidad === 'cortesia') exigirPermisoCortesia(input.permiteCortesia)
        if (datos.motivo_id !== null) await exigirMotivoCortesia(t, datos.motivo_id, servicio.empresa_id)

        const fila = await insertarAsignacion(
            t,
            servicio,
            {
                ...datos,
                adicional_id: input.adicional_id,
                identificador: input.identificador ?? null,
                credencial: input.credencial ? cifrar(input.credencial) : null,
            },
            'manual',
        )
        return verAsignacion(servicio.id, fila.id, t.trx)
    }
}
