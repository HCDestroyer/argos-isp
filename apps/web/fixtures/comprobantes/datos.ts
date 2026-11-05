import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { bancos, cuentasBancarias, nombreCuentaDestino } from '../bancos/datos'
import { clientes } from '../clientes/datos'
import { dinero, facturas } from '../facturacion/datos'
import { servicios } from '../servicios/datos'
import { BOLETA_PNG, TRANSFERENCIA_PDF } from './archivos'

type Comprobante = Schema<'Comprobante'>

/** Archivo de cada comprobante (`GET /comprobantes/:id/archivo`), por id. */
export const archivosComprobante: Record<number, Uint8Array> = {}

/** Lo que el servicio del cliente debe (sus facturas con saldo), para un monto creíble. */
function deudaDe(clienteId: number): { servicioId: number | null, monto: string } {
    const servicio = servicios.find(s => s.cliente_id === clienteId)
    const pendiente = facturas
        .filter(f => f.servicio_id === servicio?.id && f.estado !== 'pagada' && f.estado !== 'anulada' && f.estado !== 'por_certificar')
        .reduce((suma, f) => suma.plus(f.total).minus(f.pagado), new Decimal(0))
    return { servicioId: servicio?.id ?? null, monto: dinero(pendiente.gt(0) ? pendiente : new Decimal('150')) }
}

interface Semilla {
    id: number
    clienteId: number
    metodo: Comprobante['metodo']
    cuentaId: number
    bancoOrigenId: number | null
    referencia: string
    fecha: string
    subido: string
    archivo: 'png' | 'pdf'
    canal: Comprobante['canal']
    nota?: string
    monto?: string
    rechazo?: { motivo: string, en: string, causa?: Comprobante['causa_rechazo'] }
    /** Solo `canal: 'iris'` (contrato Iris 0.6.0 §7.2): lo que mandó Iris con la boleta. */
    iris?: Pick<Comprobante, 'leido_por' | 'confianza' | 'canal_contacto' | 'iris_actor' | 'iris_conversacion'>
    servicioId?: number
}

function comprobante(semilla: Semilla): Comprobante {
    const cliente = clientes.find(c => c.id === semilla.clienteId)
    const cuenta = cuentasBancarias.find(c => c.id === semilla.cuentaId)
    const banco = bancos.find(b => b.id === semilla.bancoOrigenId)
    const deuda = deudaDe(semilla.clienteId)
    archivosComprobante[semilla.id] = semilla.archivo === 'png' ? BOLETA_PNG : TRANSFERENCIA_PDF
    const actualizado = semilla.rechazo?.en ?? semilla.subido
    return {
        id: semilla.id,
        // Multiempresa (A3): la empresa de la cuenta bancaria de destino.
        empresa_id: cuenta?.empresa_id ?? 1,
        cliente_id: semilla.clienteId,
        cliente_nombre: cliente?.nombre ?? '',
        servicio_id: semilla.servicioId ?? (semilla.canal === 'portal' ? deuda.servicioId : null),
        metodo: semilla.metodo,
        cuenta_bancaria_id: semilla.cuentaId,
        cuenta_bancaria_nombre: cuenta ? nombreCuentaDestino(cuenta) : '',
        banco_origen_id: banco?.id ?? null,
        banco_origen_nombre: banco?.nombre ?? null,
        referencia: semilla.referencia,
        monto: semilla.monto ?? deuda.monto,
        fecha_deposito: semilla.fecha,
        archivo_tipo: semilla.archivo === 'png' ? 'image/png' : 'application/pdf',
        archivo_tamano: semilla.archivo === 'png' ? BOLETA_PNG.byteLength : TRANSFERENCIA_PDF.byteLength,
        archivo_nombre: semilla.archivo === 'png' ? 'boleta.png' : 'transferencia.pdf',
        canal: semilla.canal,
        // Como la API: null fuera de Iris; la causa solo en los rechazados desde 0.6.0.
        leido_por: semilla.iris?.leido_por ?? null,
        confianza: semilla.iris?.confianza ?? null,
        canal_contacto: semilla.iris?.canal_contacto ?? null,
        iris_actor: semilla.iris?.iris_actor ?? null,
        iris_conversacion: semilla.iris?.iris_conversacion ?? null,
        causa_rechazo: semilla.rechazo?.causa ?? null,
        nota: semilla.nota ?? null,
        estado: semilla.rechazo ? 'rechazado' : 'pendiente',
        motivo_rechazo: semilla.rechazo?.motivo ?? null,
        pago_id: null,
        // Panel: el cajero; Iris: su usuario técnico (id 90 en los fixtures).
        registrado_por: semilla.canal === 'panel' ? 2 : (semilla.canal === 'iris' ? COMPROBANTE_IRIS.usuarioTecnico : null),
        verificado_por: semilla.rechazo ? 1 : null,
        verificado_por_nombre: semilla.rechazo ? 'Ana Administradora' : null,
        verificado_en: semilla.rechazo?.en ?? null,
        version: semilla.rechazo ? 2 : 1,
        created_at: semilla.subido,
        updated_at: actualizado,
    }
}

/** Boleta que llegó por WhatsApp de Iris y sostiene una reconexión temporal (promesa 5). */
export const COMPROBANTE_IRIS = {
    id: 5,
    clienteId: 8,
    usuarioTecnico: 90,
    conversacion: 'wa:conv-7731',
} as const

/**
 * Cola de comprobantes (`billing.comprobantes`): cuatro pendientes (un depósito de un servicio
 * suspendido, una transferencia en PDF de uno limitado, un ACH registrado desde el panel y una boleta
 * que llegó por WhatsApp de Iris con su reconexión temporal) y uno rechazado. Ninguno aprobado: un aprobado necesita su pago, y los pagos de los fixtures son de caja.
 */
export const comprobantes: Comprobante[] = [
    comprobante({ id: 1, clienteId: 3, metodo: 'deposito', cuentaId: 1, bancoOrigenId: null, referencia: '40021877', fecha: '2026-10-12', subido: '2026-10-12T22:10:00.000Z', archivo: 'png', canal: 'portal', rechazo: { motivo: 'La boleta no aparece en el estado de cuenta de Banrural', en: '2026-10-13T15:30:00.000Z' } }),
    comprobante({ id: 2, clienteId: 2, metodo: 'deposito', cuentaId: 1, bancoOrigenId: null, referencia: '40022931', fecha: '2026-10-14', subido: '2026-10-14T23:45:00.000Z', archivo: 'png', canal: 'portal', nota: 'Pagué los dos meses' }),
    comprobante({ id: 3, clienteId: 5, metodo: 'transferencia', cuentaId: 2, bancoOrigenId: 2, referencia: 'TRX-88120455', fecha: '2026-10-15', subido: '2026-10-15T14:05:00.000Z', archivo: 'pdf', canal: 'portal' }),
    comprobante({
        id: COMPROBANTE_IRIS.id,
        clienteId: COMPROBANTE_IRIS.clienteId,
        servicioId: servicios.find(s => s.cliente_id === COMPROBANTE_IRIS.clienteId)?.id,
        metodo: 'deposito',
        cuentaId: 1,
        bancoOrigenId: null,
        referencia: '40023355',
        fecha: '2026-10-15',
        subido: '2026-10-15T23:20:00.000Z',
        archivo: 'png',
        canal: 'iris',
        monto: '175.00',
        nota: 'El cliente dice que depositó en la agencia del parque',
        iris: { leido_por: 'ia', confianza: '0.92', canal_contacto: 'whatsapp', iris_actor: 'asistente_ia', iris_conversacion: COMPROBANTE_IRIS.conversacion },
    }),
    comprobante({ id: 4, clienteId: 7, metodo: 'ach', cuentaId: 2, bancoOrigenId: 5, referencia: 'ACH-5531002', fecha: '2026-10-15', subido: '2026-10-15T16:40:00.000Z', archivo: 'png', canal: 'panel', monto: '150.00', nota: 'El cliente mandó la foto por WhatsApp' }),
]
