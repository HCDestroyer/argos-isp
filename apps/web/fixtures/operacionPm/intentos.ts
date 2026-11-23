import type { Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { texto } from './comun'
import type { VerificacionIntento } from './datos'

type Intento = Schema<'IntentoRecuperacionVerificado'>

const TECNICOS_MINIMOS = 2
const CUENTAN = new Set(['no_aplica', 'verificado', 'aceptado'])
const AVISO = 'La ubicación y la autoría de cada intento las afirma Iris. Argos las verifica con Iris antes de contarlas.'

function verificacionDe(intentoId: number, origenExterno: string | null): VerificacionIntento {
    return bd.operacionPm.verificaciones[intentoId] ?? {
        verificacion: origenExterno ? 'pendiente' : 'no_aplica',
        motivo: origenExterno ? 'envio_en_curso' : null,
        verificado_en: null,
        consultas: 0,
        decidido_por: null,
        decidido_en: null,
        motivo_decision: null,
    }
}

/**
 * Como `GET /inventario/unidades/:id/intentos-recuperacion` (A3, contrato Iris 0.14.0 §3.10): cada
 * intento con su verificación, si cuenta, y el mínimo de técnicos distintos.
 */
function intentosDe(unidadId: number): Schema<'IntentosRecuperacionDeUnidad'> {
    const intentos: Intento[] = (bd.equipos.intentos[unidadId] ?? []).map((i) => {
        const v = verificacionDe(i.id, i.origen_externo_id)
        return {
            ...i,
            verificacion_id: i.id,
            verificacion: v.verificacion,
            verificacion_motivo: v.motivo,
            verificado_en: v.verificado_en,
            verificacion_consultas: v.consultas,
            verificacion_proxima_en: null,
            decidido_por: v.decidido_por,
            decidido_en: v.decidido_en,
            motivo_decision: v.motivo_decision,
            cuenta: CUENTAN.has(v.verificacion),
            afirmado_por_iris: i.origen_externo_id !== null,
        }
    }).sort((a, b) => b.intento_n - a.intento_n)
    const tecnicos = new Set(intentos.filter(i => i.cuenta).map(i => i.actor_tecnico ?? i.actor_tecnico_id)).size
    return {
        unidad_id: unidadId,
        aviso: AVISO,
        tecnicos_minimos: TECNICOS_MINIMOS,
        tecnicos_que_cuentan: tecnicos,
        contactos: (bd.equipos.contactos[unidadId] ?? []).length,
        intentos,
    }
}

function unidadDe(solicitud: SolicitudFixture) {
    return bd.unidadesInventario.find(u => u.id === idDe(solicitud)) ?? null
}

export const rutasIntentosRecuperacion: RutasFixture = {
    /** «Ver en Iris» (A1, contrato Iris §1.3): URL de autologin de un solo uso; 422 `iris_apagado`. */
    'POST /api/v1/integraciones/iris/abrir': conPermiso('iris.abrir', (solicitud) => {
        const destino = cuerpoObjeto(solicitud).destino
        const tipo = typeof destino === 'object' && destino !== null && 'tipo' in destino ? String(destino.tipo) : ''
        const id = typeof destino === 'object' && destino !== null && 'id_externo' in destino ? String(destino.id_externo) : ''
        if (!['ticket', 'orden', 'prospecto'].includes(tipo) || !id) {
            return datosInvalidos([{ field: 'destino', message: 'El destino no es válido', rule: 'enum' }])
        }
        if (!bd.iris.conector.activo || !bd.iris.conector.url_base) {
            return problemaTipado(422, 'iris_apagado', 'Iris apagado', 'El conector de Iris está apagado o sin configurar')
        }
        const ticket: Schema<'TicketIris'> = { url: `${bd.iris.conector.url_base}/sso/entrar#ticket-${tipo}-${id}`, expira_en: new Date(Date.now() + 60_000).toISOString() }
        return { status: 200, cuerpo: ticket }
    }),

    'GET /api/v1/inventario/unidades/:id/intentos-recuperacion': conPermiso('inventario.ver', (solicitud) => {
        const unidad = unidadDe(solicitud)
        return unidad ? { status: 200, cuerpo: intentosDe(unidad.id) } : noEncontrado('el equipo')
    }),

    /** Vuelve a consultar a Iris los pendientes: en los fixtures, los pendientes quedan verificados. */
    'POST /api/v1/inventario/unidades/:id/intentos-recuperacion/verificar': conPermiso('inventario.verificar_operacion_iris', (solicitud) => {
        const unidad = unidadDe(solicitud)
        if (!unidad) {
            return noEncontrado('el equipo')
        }
        for (const intento of bd.equipos.intentos[unidad.id] ?? []) {
            const v = verificacionDe(intento.id, intento.origen_externo_id)
            if (v.verificacion === 'pendiente') {
                bd.operacionPm.verificaciones[intento.id] = { ...v, verificacion: 'verificado', motivo: null, verificado_en: ahora(), consultas: v.consultas + 1 }
            }
        }
        return { status: 200, cuerpo: intentosDe(unidad.id) }
    }),

    'POST /api/v1/inventario/intentos-recuperacion/:id/decidir': conPermiso('inventario.decidir_intento_recuperacion', conIdempotencia((solicitud) => {
        const id = idDe(solicitud)
        const cuerpo = cuerpoObjeto(solicitud)
        const motivo = texto(cuerpo.motivo)
        if (typeof cuerpo.aceptar !== 'boolean' || motivo.length < 3 || motivo.length > 500) {
            return datosInvalidos([
                ...(typeof cuerpo.aceptar !== 'boolean' ? [{ field: 'aceptar', message: 'El campo aceptar es obligatorio', rule: 'required' }] : []),
                ...(motivo.length < 3 || motivo.length > 500 ? [{ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' }] : []),
            ])
        }
        const unidadId = Object.entries(bd.equipos.intentos).find(([, lista]) => lista.some(i => i.id === id))?.[0]
        const intento = unidadId ? bd.equipos.intentos[Number(unidadId)]?.find(i => i.id === id) : undefined
        if (!intento || !unidadId) {
            return noEncontrado('el intento')
        }
        const v = verificacionDe(intento.id, intento.origen_externo_id)
        if (v.verificacion !== 'anterior') {
            return problemaTipado(409, 'intento_ya_decidido', 'Intento ya decidido', 'Este intento ya no espera la decisión de una persona')
        }
        const verificacion = cuerpo.aceptar ? 'aceptado' : 'descartado'
        bd.operacionPm.verificaciones[intento.id] = { ...v, verificacion, decidido_por: solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? null : null, decidido_en: ahora(), motivo_decision: motivo }
        registrarAccion(solicitud, 'inventario.decidir_intento_recuperacion', { tipo: 'intento_recuperacion', id: intento.id }, cuerpo)
        const unidad = bd.unidadesInventario.find(u => u.id === Number(unidadId))
        const decision: Schema<'DecisionIntentoRecuperacion'> = { intento_id: intento.id, verificacion, por_recuperar: unidad?.estado === 'por_recuperar' }
        return { status: 200, cuerpo: decision }
    })),

    'GET /api/v1/inventario/vinculos-tecnicos': conPermiso('inventario.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        if (estado !== null && !['vinculado', 'rechazado', 'desvinculado'].includes(estado)) {
            return datosInvalidos([{ field: 'estado', message: 'El valor de estado no es válido', rule: 'enum' }])
        }
        return { status: 200, cuerpo: bd.operacionPm.vinculos.filter(v => estado === null || v.estado === estado) }
    }),

    /** Lee el técnico en Iris: el `iris-u-131` se aplica (vinculado); los demás siguen igual; `iris-u-404` no existe. */
    'POST /api/v1/inventario/vinculos-tecnicos/conciliar': conPermiso('inventario.sincronizar_vinculo_tecnico', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const usuarioIris = texto(cuerpo.usuario_id)
        if (!/^[\w-]{1,64}$/.test(usuarioIris) || typeof cuerpo.empresa_id !== 'number') {
            return datosInvalidos([{ field: 'usuario_id', message: 'El campo usuario_id no es válido', rule: 'regex' }])
        }
        if (!bd.iris.conector.activo || !bd.iris.conector.url_base) {
            const sinConector: Schema<'ConciliacionVinculoTecnico'> = { resultado: 'error', estado: null, ignorado: null, motivo: 'sin_conector' }
            return { status: 200, cuerpo: sinConector }
        }
        const vinculo = bd.operacionPm.vinculos.find(v => v.iris_usuario_id === usuarioIris && v.empresa_id === cuerpo.empresa_id)
        if (!vinculo) {
            const resultado: Schema<'ConciliacionVinculoTecnico'> = { resultado: 'no_encontrado', estado: null, ignorado: null, motivo: null }
            return { status: 200, cuerpo: resultado }
        }
        if (usuarioIris === 'iris-u-131') {
            Object.assign(vinculo, { estado: 'vinculado', motivo: null, usuario_id: 4, usuario_nombre: 'Pedro Técnico', origen: 'conciliacion', version: vinculo.version + 1, updated_at: ahora() })
            registrarAccion(solicitud, 'inventario.sincronizar_vinculo_tecnico', { tipo: 'vinculo_tecnico', id: vinculo.id }, cuerpo)
            const resultado: Schema<'ConciliacionVinculoTecnico'> = { resultado: 'aplicado', estado: 'vinculado', ignorado: null, motivo: null }
            return { status: 200, cuerpo: resultado }
        }
        const resultado: Schema<'ConciliacionVinculoTecnico'> = { resultado: 'aplicado', estado: vinculo.estado, ignorado: 'misma_version', motivo: vinculo.motivo }
        return { status: 200, cuerpo: resultado }
    }),
}
