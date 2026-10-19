import { Decimal } from 'decimal.js'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { cifrar, descifrar } from '#shared/cifrado'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import type { CampoAdicionalCambiado, ModalidadAdicional } from '#shared/eventos'
import {
    exigirMotivoCortesia,
    filaAsignacion,
    servicioParaAdicional,
    verAsignacion,
    type AsignacionAdicionalVista,
} from '#core/adicionales'
import { exigirPermisoCortesia, validarModalidad } from '#core/actions/agregar_adicional_servicio'

export interface EntradaEditarAdicionalServicio {
    servicio_id: number
    /** id de la asignación (`core.servicios_adicionales`) */
    id: number
    version: number
    modalidad?: ModalidadAdicional
    /** `null` lo borra; ausente no se toca */
    identificador?: string | null
    /** `null` la borra; ausente no se toca. Se guarda cifrada */
    credencial?: string | null
    precio?: string | null
    motivo_id?: number | null
    motivo_detalle?: string | null
    /** ver `AgregarAdicionalServicio`; ausente = sí */
    permiteCortesia?: boolean
}

function mismoPrecio(a: unknown, b: string | null): boolean {
    if (a === null || a === undefined || b === null) return (a ?? null) === b
    return new Decimal(String(a)).equals(b)
}

/**
 * Edita un adicional de un servicio (`servicios.editar_adicional`, control optimista por
 * `version`: 409 en conflicto). No cambia el adicional (para eso se quita y se agrega otro).
 *
 * - Al dejar de ser `cobrado` se borra el precio; al dejar de ser `cortesia`, el motivo; al dejar
 *   de ser `incluido`, el plan que lo trajo (un cambio de plan ya no lo da de baja).
 * - Pasar a `cobrado` exige `precio`; a `cortesia`, `motivo_id` y `servicios.adicional_cortesia`.
 * - Dado de baja: 422 `adicional_dado_de_baja`. Sin cambios: 200 sin tocar la versión.
 * - Emite `servicio.adicional_cambiado` con `campos` (`credencial` sin su valor).
 */
export default class EditarAdicionalServicio extends DomainAction<
    EntradaEditarAdicionalServicio,
    AsignacionAdicionalVista
> {
    readonly nombre = 'servicios.editar_adicional'

    protected async handle(
        input: EntradaEditarAdicionalServicio,
        t: Transaccion,
    ): Promise<AsignacionAdicionalVista> {
        t.fijarEntidad('servicio', input.servicio_id)
        const servicio = await servicioParaAdicional(t, input.servicio_id)
        const antes = await filaAsignacion(t, input.id, true)
        if (antes.servicio_id !== servicio.id) {
            throw new NoEncontrado(`El servicio ${servicio.id} no tiene el adicional asignado ${input.id}`)
        }
        verificarVersion('adicional asignado', input.id, antes.version, input.version)
        if (antes.estado === 'baja') {
            throw new ReglaNegocio('El adicional ya está dado de baja: no se edita', 'adicional_dado_de_baja')
        }

        const modalidad = input.modalidad ?? antes.modalidad
        const conservar = <T>(valor: T | undefined, actual: T, aplica: boolean): T | null =>
            valor !== undefined ? valor : aplica ? actual : null
        const precio = conservar(
            input.precio,
            (antes.precio as string | null) ?? null,
            modalidad === 'cobrado',
        )
        const motivoId = conservar(
            input.motivo_id,
            antes.motivo_id === null ? null : Number(antes.motivo_id),
            modalidad === 'cortesia',
        )
        const motivoDetalle = conservar(
            input.motivo_detalle,
            (antes.motivo_detalle as string | null) ?? null,
            modalidad === 'cortesia',
        )
        const final = { modalidad, precio, motivo_id: motivoId, motivo_detalle: motivoDetalle }
        validarModalidad(final)

        const campos: CampoAdicionalCambiado[] = []
        const columnas: Record<string, unknown> = {}
        if (modalidad !== antes.modalidad) {
            campos.push('modalidad')
            columnas.modalidad = modalidad
            if (modalidad !== 'incluido') columnas.plan_id = null
        }
        if (input.identificador !== undefined && input.identificador !== (antes.identificador ?? null)) {
            campos.push('identificador')
            columnas.identificador = input.identificador
        }
        if (input.credencial !== undefined) {
            const actual = (antes.credencial as string | null) ?? null
            const igual =
                input.credencial === null
                    ? actual === null
                    : actual !== null && descifrar(actual) === input.credencial
            if (!igual) {
                campos.push('credencial')
                columnas.credencial = input.credencial === null ? null : cifrar(input.credencial)
            }
        }
        if (!mismoPrecio(antes.precio, precio)) {
            campos.push('precio')
            columnas.precio = precio
        }
        const motivoAntes = antes.motivo_id === null ? null : Number(antes.motivo_id)
        if (motivoId !== motivoAntes || motivoDetalle !== ((antes.motivo_detalle as string | null) ?? null)) {
            campos.push('motivo')
            columnas.motivo_id = motivoId
            columnas.motivo_detalle = motivoDetalle
        }
        if (campos.length === 0) return verAsignacion(servicio.id, input.id, t.trx)

        if (modalidad === 'cortesia' && (campos.includes('modalidad') || campos.includes('motivo'))) {
            exigirPermisoCortesia(input.permiteCortesia)
        }
        if (motivoId !== null && motivoId !== motivoAntes) {
            await exigirMotivoCortesia(t, motivoId, servicio.empresa_id)
        }

        await actualizarConVersion(t.trx, 'core.servicios_adicionales', input.id, input.version, columnas)
        const despues = await filaAsignacion(t, input.id)
        await t.registrarCambios({ tipo: 'servicio_adicional', id: input.id }, antes, despues)
        await t.emit('servicio.adicional_cambiado', {
            servicio_id: servicio.id,
            cliente_id: servicio.cliente_id,
            empresa_id: servicio.empresa_id,
            adicional_id: Number(antes.adicional_id),
            asignacion_id: input.id,
            modalidad,
            modalidad_anterior: antes.modalidad,
            campos,
        })
        return verAsignacion(servicio.id, input.id, t.trx)
    }
}
