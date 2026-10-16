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
import { METODOS_PAGO } from '#shared/eventos'

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

export const PortalTelegram = definirEsquema(
    'PortalTelegram',
    objeto({
        vinculado: { ...booleano, description: 'El cliente tiene un chat de Telegram vinculado' },
        disponible: { ...booleano, description: 'Hay bot configurado: se puede pedir un enlace' },
        bot: nulable({ ...texto, description: 'Usuario del bot sin @' }),
    }),
)

export const PortalVinculoTelegram = definirEsquema(
    'PortalVinculoTelegram',
    objeto({
        codigo: {
            ...texto,
            description:
                'Código de un solo uso (10 caracteres A-Z 2-9) para escribir `/start <código>` a mano',
        },
        enlace: { ...texto, description: 'https://t.me/<bot>?start=<código>' },
        bot: { ...texto, description: 'Usuario del bot sin @' },
        vence_en: instante,
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
        metodo: enumerado(METODOS_PAGO),
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

export const PortalCondicionesPromesa = definirEsquema(
    'PortalCondicionesPromesa',
    objeto({
        disponible: { ...booleano, description: 'Se puede enviar una solicitud ahora' },
        motivo: { ...nulable(texto), description: 'Por qué no está disponible, en palabras del cliente' },
        promesa_abierta: nulable(
            objeto({
                estado: enumerado(['activa', 'pendiente_aprobacion']),
                vence_en: instante,
                monto: Dinero,
            }),
        ),
        fecha_minima: { ...nulable(fecha), description: 'Primer día de pago admitido (hoy en Guatemala)' },
        fecha_maxima: {
            ...nulable(fecha),
            description:
                'Último día de pago admitido: plazo máximo del canal portal y antes de la siguiente factura',
        },
        plazo_max_dias: nulable({ ...entero, minimum: 0 }),
        monto_maximo: { ...nulable(Dinero), description: 'Deuda pendiente del servicio' },
        monto_sugerido: { ...nulable(Dinero), description: 'Saldo vencido (o pendiente si no hay vencido)' },
        abono_inicial: {
            ...nulable(
                objeto({
                    porcentaje: { ...entero, minimum: 1, maximum: 100 },
                    requerido: Dinero,
                    abonado: Dinero,
                    faltante: Dinero,
                }),
            ),
            description: 'La plantilla exige abonar este porcentaje de la deuda antes de prometer',
        },
        requiere_aprobacion: { ...booleano, description: 'La promesa quedará pendiente de aprobación' },
    }),
)

export const PortalPromesaSolicitada = definirEsquema(
    'PortalPromesaSolicitada',
    objeto({
        id,
        resultado: enumerado(['aprobada', 'rechazada', 'pendiente_aprobacion']),
        vence_en: instante,
        monto: Dinero,
        motivo: { ...texto, description: 'Resultado en palabras del cliente (nunca el código de la regla)' },
        servicio_estado: {
            ...nulable(EstadoServicio),
            description: 'Estado del servicio tras la promesa (solo si quedó aprobada)',
        },
    }),
)

/*
|--------------------------------------------------------------------------
| Configuración de empresa (tarea 9)
|--------------------------------------------------------------------------
*/

const camposEmpresa = {
    nombre: texto,
    nit: nulable(texto),
    direccion: nulable(texto),
    telefono: nulable(texto),
    telefono_alterno: nulable(texto),
    whatsapp: { ...nulable(texto), description: 'Número de WhatsApp tal como se marca (p. ej. "5555-1234")' },
    correo: nulable(texto),
    horario: { ...nulable(texto), description: 'Texto libre: "Lunes a viernes de 8:00 a 17:00"' },
    instrucciones_pago: { ...nulable(texto), description: 'Texto que acompaña los datos de depósito' },
}

export const Empresa = definirEsquema(
    'Empresa',
    objeto({
        ...camposEmpresa,
        version: {
            ...entero,
            minimum: 0,
            description: '0 = valores por defecto (nunca se guardó). Envíala al editar (409 si cambió)',
        },
    }),
)

export const CuentaDeposito = definirEsquema(
    'CuentaDeposito',
    objeto({
        id: { ...id, description: 'Se envía como `cuenta_bancaria_id` al subir un comprobante' },
        banco: texto,
        alias: { ...texto, description: 'Nombre visible de la cuenta (p. ej. "Monetaria ArgosIsp")' },
        numero: texto,
        moneda: enumerado(['GTQ', 'USD']),
    }),
)

export const EmpresaPublica = definirEsquema(
    'EmpresaPublica',
    objeto({
        ...camposEmpresa,
        cuentas_deposito: {
            ...lista(CuentaDeposito),
            description:
                'Cuentas bancarias activas en quetzales para depósito (fuente: billing.cuentas_bancarias de A3; las de USD no se muestran). Vacía = no se muestran',
        },
    }),
)

/*
|--------------------------------------------------------------------------
| Documentos (tarea 8)
|--------------------------------------------------------------------------
*/

/** Respuesta binaria: el cuerpo es el PDF (`Content-Type: application/pdf`). */
export const ArchivoPdf = {
    type: 'string',
    format: 'binary',
    description:
        'PDF. La respuesta real es `Content-Type: application/pdf` con `Content-Disposition: inline; filename=…` ' +
        '(el generador de OpenAPI aún declara application/json; ver .claude/integration/a5.md)',
}

export const VariableDocumento = definirEsquema(
    'VariableDocumento',
    objeto({ nombre: texto, descripcion: texto }),
)

export const PlantillaDocumento = definirEsquema(
    'PlantillaDocumento',
    objeto({
        tipo: enumerado(['aviso_cobro']),
        html: { ...texto, description: 'HTML con variables Mustache (`{{factura.total}}`)' },
        version: {
            ...entero,
            minimum: 0,
            description: '0 = plantilla de fábrica (nadie la ha guardado). Envíala al editar',
        },
        variables: lista(VariableDocumento),
    }),
)

/*
|--------------------------------------------------------------------------
| Comprobantes de depósito (tarea 5)
|--------------------------------------------------------------------------
*/

export const PortalBanco = definirEsquema('PortalBanco', objeto({ id, nombre: texto }))

export const PortalComprobante = definirEsquema(
    'PortalComprobante',
    objeto({
        id,
        servicio_id: nulable(id),
        metodo: enumerado(['deposito', 'transferencia', 'ach', 'remesa']),
        cuenta_destino: { ...texto, description: 'Banco y alias de la cuenta: "Banrural · Monetaria"' },
        banco_origen: {
            ...nulable(texto),
            description: 'Banco desde el que transfirió (transferencia y ACH)',
        },
        referencia: texto,
        monto: Dinero,
        fecha_deposito: fecha,
        archivo_tipo: enumerado(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
        archivo_nombre: nulable(texto),
        estado: enumerado(['pendiente', 'aprobado', 'rechazado']),
        motivo_rechazo: { ...nulable(texto), description: 'Por qué se rechazó (lo escribe quien lo revisó)' },
        created_at: instante,
        verificado_en: nulable(instante),
    }),
)
