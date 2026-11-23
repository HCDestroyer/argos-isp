import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { FotoIdentidad, descifrarBytes, descifrarTexto, sqlNitNormalizado } from '#core/identidad'
import { ServicioNoPendiente, bloquearServicio } from '#core/instalacion_iris'
import { aplicarCambioTitular } from '#core/actions/cambiar_titular_servicio'
import type { RevisionTitularEmpresaResumen } from '#core/consultas/titulares_empresa_revision'
import { TitularYaCambiado, bloquearRevision, cerrarRevision, exigirRevisor } from '#core/titulares_empresa'

export interface EntradaAprobarTitularEmpresa {
    id: number
    /** con varios candidatos, a cuál se asigna */
    cliente_id?: number
    motivo: string
    version: number
}

export interface TitularEmpresaAprobado {
    revision: RevisionTitularEmpresaResumen
    servicio_id: number
    titular: { cliente_id: number; existente: true }
    identidad_id: number
    de_cliente_id: number
    de_cliente_eliminado: boolean
}

/**
 * `servicios.aprobar_titular_empresa` (`POST /titulares-empresa/revisiones/:id/aprobar`): la persona
 * aprueba al representante y el servicio pasa al cliente empresa como en A39 (mueve el servicio,
 * registra la identidad del representante en la empresa, elimina al anterior sin historial y emite
 * `servicio.titular_cambiado` con `existente: true` y `tipo_titular: empresa`, más
 * `cliente.identidad_registrada`). Solo si el servicio sigue `pendiente_instalacion` (422
 * `servicio_no_pendiente`) y con el mismo titular que al pedirla (409 `titular_ya_cambiado`), y el
 * candidato sigue siendo una empresa con ese NIT verificado (422 `candidato_no_valido`).
 */
export default class AprobarTitularEmpresa extends DomainAction<
    EntradaAprobarTitularEmpresa,
    TitularEmpresaAprobado
> {
    readonly nombre = 'servicios.aprobar_titular_empresa'

    protected async handle(
        input: EntradaAprobarTitularEmpresa,
        t: Transaccion,
    ): Promise<TitularEmpresaAprobado> {
        const revisor = await exigirRevisor(t)
        const fila = await bloquearRevision(t, input.id, input.version)
        const candidatos = fila.candidatos.map(Number)
        const elegido = input.cliente_id ?? (candidatos.length === 1 ? candidatos[0] : undefined)
        if (elegido === undefined || !candidatos.includes(elegido)) {
            throw new ValidacionFallida([
                {
                    field: 'cliente_id',
                    rule: 'candidato',
                    message: 'Elige uno de los candidatos de la revisión',
                },
            ])
        }
        const vigente = await t.trx
            .from('core.clientes')
            .where({ id: elegido, tipo: 'empresa' })
            .whereNotNull('nit_verificado_en')
            .whereRaw(`${sqlNitNormalizado('nit_cui')} = ?`, [fila.nit])
            .select('id')
            .first()
        if (!vigente) {
            throw new ReglaNegocio(
                'El candidato ya no es una empresa con ese NIT verificado',
                'candidato_no_valido',
            )
        }
        const servicio = await bloquearServicio(t.trx, Number(fila.servicio_id))
        if (!servicio) throw new NoEncontrado(`El servicio ${fila.servicio_id} no existe`)
        if (servicio.estado !== 'pendiente_instalacion') throw new ServicioNoPendiente(servicio.estado)
        const actual = (await t.trx
            .from('core.servicios')
            .where('id', fila.servicio_id)
            .select('cliente_id')
            .first()) as { cliente_id: number }
        if (Number(actual.cliente_id) !== Number(fila.de_cliente_id)) throw new TitularYaCambiado()

        const aplicado = await aplicarCambioTitular(t, {
            servicioId: Number(fila.servicio_id),
            empresaId: Number(fila.empresa_id),
            deClienteId: Number(fila.de_cliente_id),
            titularId: elegido,
            existente: true,
            posibleDuplicado: false,
            tipoTitular: 'empresa',
            identidad: {
                documento_tipo: fila.representante_documento_tipo,
                documento_numero: descifrarTexto(fila.representante_documento_cifrado!),
                nombre: descifrarTexto(fila.representante_nombre_cifrado!),
                mayor_de_edad: true,
                verificado_en: new Date(fila.verificado_en),
                metodo: fila.metodo,
                frente: new FotoIdentidad(descifrarBytes(fila.frente!), fila.frente_tipo!),
                reverso:
                    fila.reverso && fila.reverso_tipo
                        ? new FotoIdentidad(descifrarBytes(fila.reverso), fila.reverso_tipo)
                        : null,
            },
            motivo_codigo: fila.motivo_codigo,
            origen_tipo: fila.origen_tipo,
            origen_id: fila.origen_id,
        })
        const revision = await cerrarRevision(t, fila, {
            estado: 'aprobada',
            decidida_por: revisor,
            motivo: input.motivo,
            cliente_asignado_id: elegido,
            identidad_id: aplicado.identidad_id,
        })
        return {
            revision,
            servicio_id: Number(fila.servicio_id),
            titular: { cliente_id: elegido, existente: true },
            identidad_id: aplicado.identidad_id,
            de_cliente_id: Number(fila.de_cliente_id),
            de_cliente_eliminado: aplicado.de_cliente_eliminado,
        }
    }
}
