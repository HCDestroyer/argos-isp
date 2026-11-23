import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { descifrarBytes, descifrarTexto, type TipoFoto } from '#core/identidad'
import {
    normalizarRevision,
    type RevisionTitularEmpresaResumen,
} from '#core/consultas/titulares_empresa_revision'
import type { FilaRevision } from '#core/titulares_empresa'

export interface EntradaVerRevision {
    id: number
    parte?: 'frente' | 'reverso'
}

export type SalidaVerRevision =
    | {
          tipo: 'datos'
          revision: RevisionTitularEmpresaResumen & {
              telefono: string | null
              email: string | null
              relacion: string | null
              motivo: string
              decision_motivo: string | null
              representante: {
                  documento_tipo: string
                  documento_numero: string | null
                  nombre: string | null
              }
              tiene_frente: boolean
              tiene_reverso: boolean
          }
      }
    | { tipo: 'foto'; contenido: Buffer; mime: TipoFoto }

/**
 * `clientes.ver_identidad` sobre una revisión de titular empresa: el detalle con el documento y el
 * nombre del representante descifrados (mientras siga pendiente) o una de sus fotos. Cada vista
 * queda auditada (qué revisión y qué parte; nunca el contenido).
 */
export default class VerRevisionTitularEmpresa extends DomainAction<EntradaVerRevision, SalidaVerRevision> {
    readonly nombre = 'clientes.ver_identidad'

    protected async handle(input: EntradaVerRevision, t: Transaccion): Promise<SalidaVerRevision> {
        t.fijarEntidad('titular_empresa_revision', input.id)
        const fila = (await t.trx.from('core.titulares_empresa_revision').where('id', input.id).first()) as
            (FilaRevision & Record<string, any>) | null
        if (!fila) throw new NoEncontrado(`La revisión ${input.id} no existe`)
        t.fijarEmpresa(Number(fila.empresa_id))
        exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
        if (input.parte) {
            const datos = input.parte === 'frente' ? fila.frente : fila.reverso
            const mime = input.parte === 'frente' ? fila.frente_tipo : fila.reverso_tipo
            if (!datos || !mime) throw new NoEncontrado('La foto no existe')
            t.anotarAuditoria({ revision_id: input.id, parte: input.parte })
            return { tipo: 'foto', contenido: descifrarBytes(datos), mime }
        }
        t.anotarAuditoria({ revision_id: input.id })
        return {
            tipo: 'datos',
            revision: {
                ...normalizarRevision(fila),
                telefono: fila.telefono,
                email: fila.email,
                relacion: fila.relacion,
                motivo: fila.motivo,
                decision_motivo: fila.decision_motivo,
                representante: {
                    documento_tipo: fila.representante_documento_tipo,
                    documento_numero: fila.representante_documento_cifrado
                        ? descifrarTexto(fila.representante_documento_cifrado)
                        : null,
                    nombre: fila.representante_nombre_cifrado
                        ? descifrarTexto(fila.representante_nombre_cifrado)
                        : null,
                },
                tiene_frente: fila.frente !== null,
                tiene_reverso: fila.reverso !== null,
            },
        }
    }
}
