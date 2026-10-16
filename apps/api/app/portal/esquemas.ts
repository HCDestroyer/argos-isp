import {
    Dinero,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { EstadoServicio } from '#core/esquemas'

/**
 * Schemas del portal del cliente (A5). Desde la IP solo se muestra información mínima:
 * nombre recortado, estado del servicio y montos. Nunca datos personales completos.
 */

export const FacturasVencidasResumen = definirEsquema(
    'FacturasVencidasResumen',
    objeto({
        cantidad: { ...entero, minimum: 0, description: 'Número de facturas vencidas con saldo' },
        total: { ...Dinero, description: 'Saldo pendiente de las facturas vencidas' },
    }),
)

export const QuienSoy = definirEsquema(
    'QuienSoy',
    objeto({
        identificado: {
            ...booleano,
            description: 'false si la IP de origen no pertenece a ningún servicio',
        },
        ip: { ...texto, description: 'IP de origen con la que la API identificó la petición' },
        nombre_parcial: { ...nulable(texto), description: 'Nombre recortado, p. ej. "Juan P."' },
        estado: nulable(EstadoServicio),
        promesa_activa: { ...nulable(booleano), description: 'Hay una promesa de pago activa' },
        monto_adeudado: {
            ...nulable(Dinero),
            description:
                'Suma del saldo de las facturas pendientes del servicio (emitidas, parciales y vencidas)',
        },
        facturas_vencidas: nulable(FacturasVencidasResumen),
    }),
)

export const EstadoPortal = definirEsquema(
    'EstadoPortal',
    objeto({
        identificado: {
            ...booleano,
            description: 'false si la IP de origen no pertenece a ningún servicio',
        },
        estado: nulable(EstadoServicio),
        monto_adeudado: {
            ...nulable(Dinero),
            description: 'Saldo de las facturas pendientes del servicio (emitidas, parciales y vencidas)',
        },
    }),
)

/*
|--------------------------------------------------------------------------
| Acceso por código y portal autenticado (tarea 7)
|--------------------------------------------------------------------------
*/

export const PortalSolicitudCodigo = definirEsquema(
    'PortalSolicitudCodigo',
    objeto({
        solicitud: {
            ...texto,
            format: 'uuid',
            description: 'Se envía con el código a POST /portal/verificar',
        },
        expira_en: { ...instante, description: 'Hasta cuándo vale el código' },
        destino: {
            ...nulable(texto),
            description:
                'Destino enmascarado ("m***a@e***.com", "tu Telegram vinculado"). Solo al pedir por IP; ' +
                'por identificador siempre null, exista o no el cliente',
        },
    }),
)

export const PortalSesion = definirEsquema(
    'PortalSesion',
    objeto({
        cliente: objeto({ nombre_parcial: nulable(texto) }),
        expira_en: { ...instante, description: 'Vence por inactividad; cada consulta la extiende' },
    }),
)

export const PortalContacto = definirEsquema(
    'PortalContacto',
    objeto({
        nombre: texto,
        nit_cui: nulable(texto),
        email: nulable(texto),
        telefono: nulable(texto),
        movil: nulable(texto),
        canal_preferido: enumerado(['correo', 'telegram', 'whatsapp']),
        telegram_vinculado: booleano,
        version: { ...entero, minimum: 1, description: 'Envíala al editar (409 si cambió)' },
    }),
)

export const PortalServicio = definirEsquema(
    'PortalServicio',
    objeto({
        id,
        estado: EstadoServicio,
        plan: nulable(texto),
        direccion: nulable(texto),
        promesa_activa: booleano,
        monto_adeudado: Dinero,
    }),
)

export const PortalCuenta = definirEsquema(
    'PortalCuenta',
    objeto({
        cliente: PortalContacto,
        servicios: lista(PortalServicio),
        monto_adeudado: { ...Dinero, description: 'Saldo pendiente de todos los servicios' },
    }),
)

export const PortalFactura = definirEsquema(
    'PortalFactura',
    objeto({
        id,
        numero: { ...texto, description: 'Serie-número FEL si está certificada; si no, número del aviso' },
        documento: {
            ...enumerado(['aviso_cobro', 'factura']),
            description: 'factura cuando tiene fel_uuid (semana 5); aviso_cobro mientras tanto',
        },
        tipo: enumerado(['servicio', 'mora']),
        servicio_id: nulable(id),
        periodo: fecha,
        emitida_en: instante,
        vence_en: fecha,
        estado: enumerado(['emitida', 'parcial', 'pagada', 'vencida', 'anulada']),
        subtotal: Dinero,
        iva: Dinero,
        total: Dinero,
        pagado: Dinero,
        saldo: { ...Dinero, description: 'total - pagado (0.00 si está anulada)' },
        fel_uuid: nulable(texto),
        fel_serie: nulable(texto),
        fel_numero: nulable(texto),
    }),
)

export const PortalFacturaLinea = definirEsquema(
    'PortalFacturaLinea',
    objeto({
        concepto: texto,
        cantidad: { ...texto, description: 'Decimal con hasta 3 decimales' },
        precio_unitario: Dinero,
        iva: Dinero,
        total: Dinero,
    }),
)

export const PortalFacturaDetalle = definirEsquema('PortalFacturaDetalle', {
    allOf: [PortalFactura, objeto({ lineas: lista(PortalFacturaLinea) })],
})

export const PortalPago = definirEsquema(
    'PortalPago',
    objeto({
        id,
        metodo: enumerado(['caja', 'pasarela', 'deposito', 'agente', 'debito']),
        monto: Dinero,
        referencia: nulable(texto),
        estado: enumerado(['registrado', 'pendiente_verificacion', 'anulado']),
        created_at: instante,
        aplicaciones: lista(objeto({ factura_id: id, monto: Dinero })),
    }),
)

export const PortalPromesa = definirEsquema(
    'PortalPromesa',
    objeto({
        id,
        servicio_id: id,
        vence_en: instante,
        monto: Dinero,
        estado: enumerado([
            'activa',
            'cumplida',
            'incumplida',
            'cancelada',
            'pendiente_aprobacion',
            'rechazada',
        ]),
        canal: enumerado(['portal', 'ia', 'operador', 'supervisor']),
        created_at: instante,
    }),
)
