import type { Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, empresaActivaDe, idDe, noEncontrado, problemaTipado, registrarAccion } from '../comun'

type Consentimiento = Schema<'ConsentimientoWhatsapp'>

export const CLAVE_WHATSAPP_ACTIVO = 'argos_fixtures_whatsapp_activo'

function forzadoActivo(): boolean {
    try {
        return globalThis.localStorage?.getItem(CLAVE_WHATSAPP_ACTIVO) === '1'
    }
    catch {
        return false
    }
}

/** Como `estadoWhatsappIris` (A6): interruptor de la configuración y conector Iris con contrato ≥ 0.6.0. */
function canal(): Schema<'WhatsappCliente'>['canal'] {
    // Para Playwright: `localStorage.argos_fixtures_whatsapp_activo = '1'` enciende el canal sin recorrer la configuración.
    if (forzadoActivo()) {
        return { activo: true, disponible: true, motivo: null }
    }
    const activo = bd.notificaciones.global.whatsapp.activo
    const conector = bd.iris.conector
    const contratoOk = conector.contrato !== null && conector.contrato.localeCompare('0.6.0', undefined, { numeric: true }) >= 0
    let motivo: string | null = null
    if (!activo) {
        motivo = 'WhatsApp está apagado en la configuración de notificaciones'
    }
    else if (!conector.activo) {
        motivo = 'El conector con Iris está apagado'
    }
    else if (!contratoOk) {
        motivo = 'Iris no habla el contrato 0.6.0'
    }
    return { activo, disponible: motivo === null, motivo }
}

/** Como `verAvisoPagoWhatsapp`: el primer sondeo ve el envío en cola; los siguientes, entregado. */
function avisoDePago(pagoId: number, clienteId: number, empresaId: number): Schema<'AvisoPagoWhatsapp'> {
    const canalPago = canal()
    const plantillaActiva = bd.plantillasNotificacion.some(p => p.canal === 'whatsapp' && p.evento === 'pago.registrado' && p.activa)
    const lecturas = (bd.whatsapp.lecturasPago[pagoId] ?? 0) + 1
    bd.whatsapp.lecturasPago[pagoId] = lecturas
    const hora = ahora()
    const envia = canalPago.disponible && plantillaActiva
    return {
        pago_id: pagoId,
        cliente_id: clienteId,
        empresa_id: empresaId,
        canal: canalPago,
        plantilla_activa: plantillaActiva,
        envio: envia
            ? {
                    id: pagoId,
                    evento: 'pago.registrado',
                    estado: lecturas === 1 ? 'encolado' : 'enviado',
                    error: null,
                    motivo: null,
                    enviado_en: lecturas === 1 ? null : hora,
                    entregado_en: lecturas === 1 ? null : hora,
                    leido_en: null,
                    created_at: hora,
                }
            : null,
    }
}

export const rutasWhatsapp: RutasFixture = {
    'GET /api/v1/notificaciones/pagos/:id/whatsapp': conPermiso('pagos.ver', (solicitud) => {
        const pagoId = idDe(solicitud)
        const pago = pagoId === null ? undefined : bd.pagos.find(p => p.id === pagoId)
        if (!pago) {
            return noEncontrado('el pago')
        }
        return { status: 200, cuerpo: avisoDePago(pago.id, pago.cliente_id, pago.empresa_id) }
    }),

    'GET /api/v1/notificaciones/whatsapp/clientes/:id': conPermiso('notificaciones.ver', (solicitud) => {
        const clienteId = idDe(solicitud)
        if (clienteId === null || !bd.clientes.some(c => c.id === clienteId)) {
            return noEncontrado('el cliente')
        }
        const consentimientos = bd.whatsapp.consentimientos.filter(c => c.cliente_id === clienteId)
        const cuerpo: Schema<'WhatsappCliente'> = {
            cliente_id: clienteId,
            canal: canal(),
            contacto: bd.whatsapp.contactos[clienteId] ?? null,
            ultimo_consentimiento: consentimientos.at(-1) ?? null,
        }
        return { status: 200, cuerpo }
    }),

    'POST /api/v1/notificaciones/consentimientos': conPermiso('notificaciones.registrar_consentimiento', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const cliente = bd.clientes.find(c => c.id === cuerpo.cliente_id)
        if (!cliente) {
            return datosInvalidos([{ field: 'cliente_id', message: 'El cliente no existe', rule: 'exists' }])
        }
        if (cuerpo.estado !== 'acepta' && cuerpo.estado !== 'baja') {
            return datosInvalidos([{ field: 'estado', message: 'acepta o baja', rule: 'enum' }])
        }
        // Como `RegistrarConsentimientoWhatsapp`: la empresa del cuerpo, la activa o la única de sus servicios.
        const empresas = [...new Set(bd.servicios.filter(s => s.cliente_id === cliente.id).map(s => s.empresa_id))]
        const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? (empresas.length === 1 ? empresas[0] : undefined))
        if (empresaId === undefined) {
            return problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'El cliente tiene servicios en varias empresas: elige la empresa del permiso')
        }
        const ocurrido = ahora()
        const nuevo: Consentimiento = {
            id: siguienteId(bd.whatsapp.consentimientos),
            empresa_id: empresaId,
            cliente_id: cliente.id,
            canal: 'whatsapp',
            estado: cuerpo.estado,
            origen: 'argos_panel',
            ocurrido_en: ocurrido,
            idempotency_key: `argos:consentimiento:${cliente.id}:whatsapp:${ocurrido}`,
            entrega: 'pendiente',
            intentos: 0,
            ultimo_error: null,
            enviado_en: null,
            consentimiento_id: null,
            estado_vigente: null,
        }
        bd.whatsapp.consentimientos.push(nuevo)
        bd.whatsapp.contactos[cliente.id] = { estado: nuevo.estado, ocurrido_en: ocurrido, origen: 'argos_panel' }
        registrarAccion(solicitud, 'notificaciones.registrar_consentimiento', { tipo: 'cliente', id: cliente.id }, { cliente_id: cliente.id, estado: nuevo.estado, empresa_id: empresaId })
        return { status: 201, cuerpo: nuevo }
    })),
}
