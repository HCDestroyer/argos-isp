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

/**
 * Marca de la empresa que factura (multiempresa): la del servicio o la de la factura. Sale también
 * por la IP: son datos públicos de la empresa (los mismos del aviso de cobro), no del cliente.
 */
export const PortalMarcaEmpresa = definirEsquema(
    'PortalMarcaEmpresa',
    objeto({
        id,
        nombre_comercial: texto,
        logo_url: {
            ...nulable(texto),
            description:
                'Logo por el mismo origen del portal (`/api/v1/portal/empresas/:id/logo?v=…`); null sin logo',
        },
        nit: nulable(texto),
        direccion_fiscal: nulable(texto),
        telefono: { ...nulable(texto), description: 'Teléfono de soporte' },
        whatsapp: { ...nulable(texto), description: 'WhatsApp de soporte' },
    }),
)

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
        empresa: {
            ...nulable(PortalMarcaEmpresa),
            description: 'Empresa del servicio de esa IP (su marca y su soporte); null sin identificar',
        },
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
        empresa_principal: {
            ...PortalMarcaEmpresa,
            description: 'Empresa con más servicios sin retirar del cliente (título y marca del portal)',
        },
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

export const PortalTelegramEmpresa = definirEsquema(
    'PortalTelegramEmpresa',
    objeto({
        empresa: PortalMarcaEmpresa,
        disponible: {
            ...booleano,
            description: 'La empresa tiene bot (el suyo o el global): se pide el código con su `empresa_id`',
        },
        bot: nulable({ ...texto, description: 'Usuario del bot de la empresa sin @' }),
        vinculado: { ...booleano, description: 'El bot de esta empresa ya le puede escribir al cliente' },
    }),
)

export const PortalTelegram = definirEsquema(
    'PortalTelegram',
    objeto({
        vinculado: { ...booleano, description: 'El cliente tiene un chat de Telegram vinculado' },
        disponible: { ...booleano, description: 'Hay bot global configurado: se puede pedir un enlace' },
        bot: nulable({ ...texto, description: 'Usuario del bot global sin @' }),
        empresas: {
            ...lista(PortalTelegramEmpresa),
            description:
                'Una por empresa con servicios vigentes del cliente (vinculación por bot, `contratos/telegram.md` ' +
                '"Varios bots"). Con varias, el portal muestra una tarjeta por empresa',
        },
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
        empresa_id: { ...nulable(id), description: 'Empresa cuyo bot se vincula (null = el bot global)' },
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
        empresa: { ...PortalMarcaEmpresa, description: 'Empresa que factura este servicio' },
    }),
)

export const PortalFacturaPendiente = definirEsquema(
    'PortalFacturaPendiente',
    objeto({
        id,
        numero: { ...texto, description: 'Serie-número FEL si está certificada; si no, número del aviso' },
        servicio_id: nulable(id),
        vence_en: fecha,
        estado: enumerado(['emitida', 'parcial', 'vencida']),
        vencida: {
            ...booleano,
            description: 'Vencida o con fecha de vencimiento anterior a hoy (Guatemala)',
        },
        total: Dinero,
        saldo: { ...Dinero, description: 'total - pagado' },
    }),
)

export const PortalCuentaEmpresa = definirEsquema(
    'PortalCuentaEmpresa',
    objeto({
        empresa: PortalMarcaEmpresa,
        saldo: {
            ...Dinero,
            description: 'Saldo del cliente con esta empresa (auxiliar CxC de su libro; positivo = debe)',
        },
        saldo_a_favor: { ...Dinero, description: 'Anticipos del cliente en esta empresa' },
        facturas_pendientes: {
            ...lista(PortalFacturaPendiente),
            description: 'Emitidas, parciales y vencidas de esta empresa, la más antigua primero',
        },
    }),
)

export const PortalCuenta = definirEsquema(
    'PortalCuenta',
    objeto({
        cliente: PortalContacto,
        servicios: lista(PortalServicio),
        monto_adeudado: {
            ...Dinero,
            description:
                'Saldo pendiente de todos los servicios (solo informativo con varias empresas: cada una cobra lo suyo)',
        },
        empresa_principal: {
            ...PortalMarcaEmpresa,
            description: 'Empresa con más servicios sin retirar (encabezado, título y manifiesto)',
        },
        empresas: {
            ...lista(PortalCuentaEmpresa),
            description:
                'Una sección por empresa con facturas, movimientos o anticipos del cliente (estado de cuenta ' +
                'de A3): cada NIT cobra lo suyo. La principal del cliente primero; luego por id',
        },
    }),
)

/** DTE certificado de un documento (contrato `localizacion-fiscal.md` §8). */
export const PortalDte = definirEsquema(
    'PortalDte',
    objeto({
        tipo_dte: { ...texto, description: 'Tipo de DTE de la SAT: FACT, FCAM, NDEB, NCRE…' },
        estado: {
            ...enumerado(['certificado', 'anulacion_pendiente', 'anulado']),
            description:
                'certificado; anulacion_pendiente (sigue vigente hasta que la SAT confirme); anulado ante la SAT',
        },
        autorizacion: { ...texto, description: 'Número de autorización (UUID de la SAT)' },
        serie: nulable(texto),
        numero: nulable(texto),
        certificado_en: nulable(instante),
        xml_disponible: { ...booleano, description: 'Se puede descargar el XML certificado' },
    }),
)

const ReferenciaFactura = objeto({
    id,
    numero: { ...texto, description: 'Serie-número FEL o número del aviso' },
})

export const PortalFactura = definirEsquema(
    'PortalFactura',
    objeto({
        id,
        numero: { ...texto, description: 'Serie-número FEL si está certificada; si no, número del aviso' },
        documento: {
            ...enumerado(['aviso_cobro', 'factura', 'nota_debito']),
            description:
                'factura (nota_debito para la mora) solo cuando su DTE está certificado; aviso_cobro mientras tanto',
        },
        tipo: enumerado(['servicio', 'mora']),
        servicio_id: nulable(id),
        periodo: fecha,
        emitida_en: instante,
        vence_en: fecha,
        estado: {
            ...enumerado(['emitida', 'parcial', 'pagada', 'vencida', 'anulada']),
            description: 'Las facturas por_certificar (FEL obligatoria con emitir) no salen en el portal',
        },
        subtotal: Dinero,
        iva: Dinero,
        total: Dinero,
        pagado: { ...Dinero, description: 'Cubierto: pagos, saldos a favor y notas de crédito' },
        acreditado: { ...Dinero, description: 'Parte de pagado que viene de notas de crédito vigentes' },
        saldo: { ...Dinero, description: 'total - pagado (0.00 si está anulada)' },
        fel_uuid: {
            ...nulable(texto),
            description: 'Autorización del DTE certificado (igual a dte.autorizacion)',
        },
        fel_serie: nulable(texto),
        fel_numero: nulable(texto),
        dte: { ...nulable(PortalDte), description: 'DTE certificado; null mientras es aviso de cobro' },
        sustituida: { ...booleano, description: 'Otra factura la reemplazó (billing.sustituciones)' },
        sustituida_por: {
            ...nulable(ReferenciaFactura),
            description: 'La factura que la reemplaza, si ya es visible en el portal',
        },
        sustituye_a: { ...nulable(ReferenciaFactura), description: 'La factura a la que reemplaza' },
        empresa: { ...PortalMarcaEmpresa, description: 'Empresa que emite la factura' },
    }),
)

export const PortalNotaCredito = definirEsquema(
    'PortalNotaCredito',
    objeto({
        id,
        numero: { ...texto, description: 'Serie-número de la NCRE certificada; si no, número interno' },
        documento: {
            ...enumerado(['nota_credito', 'ncre']),
            description: 'ncre cuando su DTE está certificado; nota_credito (interna) mientras tanto',
        },
        factura_id: id,
        factura_numero: texto,
        servicio_id: nulable(id),
        fecha,
        subtotal: Dinero,
        iva: Dinero,
        monto: { ...Dinero, description: 'Lo que la nota acredita a la factura' },
        motivo: texto,
        estado: {
            ...enumerado(['vigente', 'anulada']),
            description: 'anulada: la SAT rechazó su NCRE y el monto volvió al saldo de la factura',
        },
        dte: nulable(PortalDte),
        empresa: { ...PortalMarcaEmpresa, description: 'Empresa de la factura acreditada' },
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
        deuda_maxima: {
            ...nulable(
                objeto({
                    maximo: Dinero,
                    vencida: Dinero,
                    faltante: {
                        ...Dinero,
                        description: 'Lo que hay que pagar para quedar dentro del máximo',
                    },
                }),
            ),
            description: 'La plantilla no admite promesas con más deuda vencida que `maximo`',
        },
        pago_previo: {
            ...nulable(Dinero),
            description:
                'Lo que el cliente debe pagar antes de que la promesa pueda aprobarse (el mayor faltante entre abono inicial y deuda máxima); null = nada',
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
        corregible: {
            ...booleano,
            description:
                'Rechazada por una regla que se cumple con otra fecha (plazo o próxima factura). Si es false, ' +
                'cambiar fecha o monto no sirve: el portal ofrece el contacto',
        },
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
        id: { ...id, description: 'Empresa de la que son estos datos' },
        logo_url: {
            ...nulable(texto),
            description: 'Logo por el mismo origen del portal; null sin logo',
        },
        ...camposEmpresa,
        cuentas_deposito: {
            ...lista(CuentaDeposito),
            description:
                'Cuentas bancarias activas en quetzales de ESTA empresa para depósito (fuente: billing.cuentas_bancarias de A3; las de USD no se muestran). Vacía = no se muestran',
        },
        pago_en_linea: {
            ...booleano,
            description: 'Hay pasarela de pago en línea configurada (el botón "Pagar en línea" se habilita)',
        },
    }),
)

/*
|--------------------------------------------------------------------------
| Documentos (tarea 8)
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| Pago en línea (semana 2)
|--------------------------------------------------------------------------
*/

export const PortalPagoEnLinea = definirEsquema(
    'PortalPagoEnLinea',
    objeto({
        id: { ...id, description: 'Cobro en línea; el retorno es `/corte?pago=<id>`' },
        estado: enumerado(['pendiente', 'pagado', 'fallido', 'expirado']),
        monto: Dinero,
        url_pago: {
            ...nulable(texto),
            description: 'Página de pago del proveedor (solo mientras el cobro está pendiente)',
        },
        expira_en: nulable(instante),
        pagado_en: nulable(instante),
    }),
)
