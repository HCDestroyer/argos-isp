import type { Problem, Schema } from '@argosisp/contracts'
import type { ManejadorFixture, RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import {
    ahora,
    conIdempotencia,
    conPermiso,
    cuerpoObjeto,
    datosInvalidos,
    deLaEmpresa,
    idDe,
    noEncontrado,
    paginar,
    problemaTipado,
    registrarAccion,
    usuariosPorToken,
} from '../comun'

type Revision = Schema<'RevisionTitularEmpresa'>
type Detalle = Schema<'RevisionTitularEmpresaDetalle'>

const ESTADOS: readonly Revision['estado'][] = ['pendiente', 'aprobada', 'rechazada', 'reemplazada']

/**
 * Revisión de titular empresa (A1, contrato Iris 0.14.1): lista, detalle y fotos con
 * `clientes.ver_identidad` (cada vista auditada); aprobar y rechazar con su permiso y además
 * `clientes.ver_identidad`, con `version` (409) y los mismos códigos de error que la API.
 */

/** La lista no lleva datos del representante (salvo el tipo de documento). */
function resumen(detalle: Detalle): Revision {
    return {
        id: detalle.id,
        empresa_id: detalle.empresa_id,
        servicio_id: detalle.servicio_id,
        de_cliente_id: detalle.de_cliente_id,
        candidatos: [...detalle.candidatos],
        motivo_revision: detalle.motivo_revision,
        estado: detalle.estado,
        razon_social: detalle.razon_social,
        nit: detalle.nit,
        representante_documento_tipo: detalle.representante_documento_tipo,
        motivo_codigo: detalle.motivo_codigo,
        origen_tipo: detalle.origen_tipo,
        origen_id: detalle.origen_id,
        cliente_asignado_id: detalle.cliente_asignado_id,
        decidida_por: detalle.decidida_por,
        decidida_en: detalle.decidida_en,
        version: detalle.version,
        created_at: detalle.created_at,
    }
}

/** Como `exigirRevisor`: además del permiso de la acción, ver la identidad. */
function conRevisor(permiso: string, manejador: ManejadorFixture): ManejadorFixture {
    return conPermiso(permiso, conPermiso('clientes.ver_identidad', manejador))
}

function errorMotivo(cuerpo: Record<string, unknown>): NonNullable<Problem['errors']> {
    const texto = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
    return texto.length < 10 || texto.length > 500
        ? [{ field: 'motivo', message: 'El motivo debe tener entre 10 y 500 caracteres', rule: 'minLength' }]
        : []
}

/** Revisión bloqueada para decidir (`bloquearRevision` de A1): existe, misma versión y pendiente. */
function paraDecidir(solicitud: SolicitudFixture, cuerpo: Record<string, unknown>): Detalle | RespuestaFixture {
    const revision = bd.revisionesTitularEmpresa.find(r => r.id === idDe(solicitud))
    if (!revision) {
        return noEncontrado('la revisión')
    }
    const errores = errorMotivo(cuerpo)
    if (typeof cuerpo.version !== 'number') {
        errores.push({ field: 'version', message: 'La versión es obligatoria', rule: 'required' })
    }
    if (errores.length) {
        return datosInvalidos(errores)
    }
    if (cuerpo.version !== revision.version) {
        return problemaTipado(409, 'conflicto_version', 'Conflicto de versión', `La revisión ${revision.id} cambió desde que la leíste; vuelve a cargarla`)
    }
    if (revision.estado !== 'pendiente') {
        return problemaTipado(422, 'revision_no_pendiente', 'Regla de negocio', `La revisión ya no está pendiente (${revision.estado})`)
    }
    return revision
}

function esRespuesta(valor: Detalle | RespuestaFixture): valor is RespuestaFixture {
    return 'status' in valor
}

/** `cerrarRevision`: estado, quién y cuándo; borra el documento y las fotos de la solicitud. */
function cerrar(solicitud: SolicitudFixture, revision: Detalle, estado: 'aprobada' | 'rechazada', motivo: string, asignado: number | null): void {
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    Object.assign(revision, {
        estado,
        decidida_por: usuario?.id ?? null,
        decidida_en: ahora(),
        decision_motivo: motivo.trim(),
        cliente_asignado_id: asignado,
        representante: { documento_tipo: revision.representante.documento_tipo, documento_numero: null, nombre: null },
        tiene_frente: false,
        tiene_reverso: false,
        version: revision.version + 1,
    })
    bd.fotosTitularEmpresa[revision.id] = { frente: null, reverso: null }
}

function foto(parte: 'frente' | 'reverso'): ManejadorFixture {
    return conPermiso('clientes.ver_identidad', (solicitud) => {
        const revision = deLaEmpresa(bd.revisionesTitularEmpresa, solicitud).find(r => r.id === idDe(solicitud))
        const bytes = revision ? bd.fotosTitularEmpresa[revision.id]?.[parte] : undefined
        if (!revision || !bytes) {
            return noEncontrado('la foto')
        }
        registrarAccion(solicitud, 'clientes.ver_identidad', { tipo: 'titular_empresa_revision', id: revision.id }, { revision_id: revision.id, parte })
        return { status: 200, cuerpo: bytes, contentType: 'image/png' }
    })
}

export const rutasTitularesEmpresa: RutasFixture = {
    'GET /api/v1/titulares-empresa/revisiones': conPermiso('clientes.ver_identidad', (solicitud) => {
        const estado = solicitud.query.get('estado')
        if (estado && !ESTADOS.includes(estado as Revision['estado'])) {
            return datosInvalidos([{ field: 'estado', message: 'Uno de: pendiente, aprobada, rechazada, reemplazada', rule: 'enum' }])
        }
        const filas = deLaEmpresa(bd.revisionesTitularEmpresa, solicitud)
            .filter(r => !estado || r.estado === estado)
            .sort((a, b) => b.id - a.id)
            .map(resumen)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/titulares-empresa/revisiones/:id': conPermiso('clientes.ver_identidad', (solicitud) => {
        const revision = deLaEmpresa(bd.revisionesTitularEmpresa, solicitud).find(r => r.id === idDe(solicitud))
        if (!revision) {
            return noEncontrado('la revisión')
        }
        registrarAccion(solicitud, 'clientes.ver_identidad', { tipo: 'titular_empresa_revision', id: revision.id }, { revision_id: revision.id })
        return { status: 200, cuerpo: structuredClone(revision) }
    }),

    'GET /api/v1/titulares-empresa/revisiones/:id/fotos/frente': foto('frente'),
    'GET /api/v1/titulares-empresa/revisiones/:id/fotos/reverso': foto('reverso'),

    'POST /api/v1/titulares-empresa/revisiones/:id/aprobar': conRevisor('servicios.aprobar_titular_empresa', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const revision = paraDecidir(solicitud, cuerpo)
        if (esRespuesta(revision)) {
            return revision
        }
        const elegido = typeof cuerpo.cliente_id === 'number' ? cuerpo.cliente_id : (revision.candidatos.length === 1 ? revision.candidatos[0] : undefined)
        if (elegido === undefined || !revision.candidatos.includes(elegido)) {
            return datosInvalidos([{ field: 'cliente_id', message: 'Elige uno de los candidatos de la revisión', rule: 'candidato' }])
        }
        const candidato = bd.clientes.find(c => c.id === elegido)
        if (!candidato || candidato.tipo !== 'empresa' || !candidato.nit_verificado_en) {
            return problemaTipado(422, 'candidato_no_valido', 'Regla de negocio', 'El candidato ya no es una empresa con ese NIT verificado')
        }
        const servicio = bd.servicios.find(s => s.id === revision.servicio_id)
        if (!servicio) {
            return noEncontrado('el servicio')
        }
        if (servicio.estado !== 'pendiente_instalacion') {
            return problemaTipado(422, 'servicio_no_pendiente', 'Regla de negocio', `El servicio ya no está pendiente de instalación (${servicio.estado})`)
        }
        if (servicio.cliente_id !== revision.de_cliente_id) {
            return problemaTipado(409, 'titular_ya_cambiado', 'Titular ya cambiado', 'El titular del servicio cambió desde que se pidió la revisión')
        }
        Object.assign(servicio, { cliente_id: candidato.id, cliente_nombre: candidato.nombre, version: servicio.version + 1, updated_at: ahora() })
        // El cliente anterior sin servicios ni movimientos se elimina (como A39).
        const anterior = revision.de_cliente_id
        const eliminado = !bd.servicios.some(s => s.cliente_id === anterior)
            && !bd.facturas.some(f => f.cliente_id === anterior)
            && !bd.pagos.some(p => p.cliente_id === anterior)
        if (eliminado) {
            bd.clientes = bd.clientes.filter(c => c.id !== anterior)
        }
        cerrar(solicitud, revision, 'aprobada', String(cuerpo.motivo), candidato.id)
        registrarAccion(solicitud, 'servicios.aprobar_titular_empresa', { tipo: 'titular_empresa_revision', id: revision.id }, { cliente_id: candidato.id, motivo: cuerpo.motivo, version: cuerpo.version })
        const respuesta: Schema<'TitularEmpresaAprobado'> = {
            revision: resumen(revision),
            servicio_id: servicio.id,
            titular: { cliente_id: candidato.id, existente: true },
            identidad_id: 900 + revision.id,
            de_cliente_id: anterior,
            de_cliente_eliminado: eliminado,
        }
        return { status: 200, cuerpo: respuesta }
    })),

    'POST /api/v1/titulares-empresa/revisiones/:id/rechazar': conRevisor('servicios.rechazar_titular_empresa', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const revision = paraDecidir(solicitud, cuerpo)
        if (esRespuesta(revision)) {
            return revision
        }
        cerrar(solicitud, revision, 'rechazada', String(cuerpo.motivo), null)
        registrarAccion(solicitud, 'servicios.rechazar_titular_empresa', { tipo: 'titular_empresa_revision', id: revision.id }, { motivo: cuerpo.motivo, version: cuerpo.version })
        return { status: 200, cuerpo: resumen(revision) }
    })),
}
