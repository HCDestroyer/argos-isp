import type { Transaccion } from '#shared/domain_action'
import { NoEncontrado, Problema, Prohibido, ReglaNegocio } from '#shared/errores'
import { verificarVersion } from '#shared/version'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { alcanceDePermiso } from '#core/acl'
import type { DocumentoIdentidad, MetodoIdentidad, TipoFoto } from '#core/identidad'
import { exigirPersonaDelPanel } from '#core/actions/verificar_nit_cliente'
import {
    normalizarRevision,
    type RevisionTitularEmpresaResumen,
} from '#core/consultas/titulares_empresa_revision'

/**
 * Revisión de un cambio de titular a una empresa (contrato Iris 0.14.1 §3.4.4, ajuste a): lo que
 * quedó en `422 titular_empresa_en_revision` lo decide **una persona de Argos con
 * `clientes.ver_identidad`** desde el panel: nunca un token (tampoco el de Iris) ni un agente.
 */

export interface FilaRevision {
    id: number
    empresa_id: number
    servicio_id: number
    de_cliente_id: number
    candidatos: Array<number | string>
    estado: string
    nit: string
    representante_documento_tipo: DocumentoIdentidad
    representante_documento_cifrado: string | null
    representante_nombre_cifrado: string | null
    frente: Buffer | null
    frente_tipo: TipoFoto | null
    reverso: Buffer | null
    reverso_tipo: TipoFoto | null
    verificado_en: Date
    metodo: MetodoIdentidad
    motivo_codigo: string
    origen_tipo: string | null
    origen_id: string | null
    version: number
}

/** 422 `revision_no_pendiente`: la revisión ya se decidió o la reemplazó otra. */
export class RevisionNoPendiente extends ReglaNegocio {
    constructor(estado: string) {
        super(`La revisión ya no está pendiente (${estado})`, 'revision_no_pendiente')
    }
}

/** 409 `titular_ya_cambiado`: el servicio cambió de titular después de pedir la revisión. */
export class TitularYaCambiado extends Problema {
    constructor() {
        super(
            409,
            'titular_ya_cambiado',
            'El titular ya cambió',
            'El servicio cambió de titular después de pedir la revisión: recházala',
        )
    }
}

/** Persona del panel con `clientes.ver_identidad` (además del permiso de la ruta). */
export async function exigirRevisor(t: Transaccion): Promise<number> {
    const usuarioId = exigirPersonaDelPanel(
        t.ctx,
        'La revisión del titular empresa la decide una persona desde el panel',
    )
    if (!(await alcanceDePermiso(usuarioId, 'clientes.ver_identidad'))) {
        throw new Prohibido('Decidir la revisión exige además clientes.ver_identidad')
    }
    return usuarioId
}

export async function bloquearRevision(t: Transaccion, id: number, version: number): Promise<FilaRevision> {
    t.fijarEntidad('titular_empresa_revision', id)
    const fila = (await t.trx
        .from('core.titulares_empresa_revision')
        .where('id', id)
        .forUpdate()
        .first()) as FilaRevision | null
    if (!fila) throw new NoEncontrado(`La revisión ${id} no existe`)
    t.fijarEmpresa(Number(fila.empresa_id))
    exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
    verificarVersion('titular_empresa_revision', id, Number(fila.version), version)
    if (fila.estado !== 'pendiente') throw new RevisionNoPendiente(fila.estado)
    return fila
}

/** Cierra la revisión: estado, quién y cuándo, y borra el documento y las fotos de la solicitud. */
export async function cerrarRevision(
    t: Transaccion,
    fila: FilaRevision,
    cambios: {
        estado: 'aprobada' | 'rechazada'
        decidida_por: number
        motivo: string
        cliente_asignado_id?: number
        identidad_id?: number
    },
): Promise<RevisionTitularEmpresaResumen> {
    await t.trx
        .from('core.titulares_empresa_revision')
        .where('id', fila.id)
        .update({
            estado: cambios.estado,
            decidida_por: cambios.decidida_por,
            decidida_en: t.trx.knexRawQuery('now()'),
            decision_motivo: cambios.motivo,
            cliente_asignado_id: cambios.cliente_asignado_id ?? null,
            identidad_id: cambios.identidad_id ?? null,
            frente: null,
            frente_tipo: null,
            reverso: null,
            reverso_tipo: null,
            representante_documento_cifrado: null,
            representante_nombre_cifrado: null,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        })
    await t.registrarCambios(
        { tipo: 'titular_empresa_revision', id: Number(fila.id) },
        { estado: 'pendiente', cliente_asignado_id: null },
        {
            estado: cambios.estado,
            cliente_asignado_id: cambios.cliente_asignado_id ?? null,
            decidida_por: cambios.decidida_por,
            representante_documento_numero: '***',
            representante_nombre: '***',
        },
    )
    const despues = (await t.trx
        .from('core.titulares_empresa_revision')
        .where('id', fila.id)
        .first()) as Record<string, any>
    return normalizarRevision(despues)
}
