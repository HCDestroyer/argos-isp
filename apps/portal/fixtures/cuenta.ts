/**
 * Respuestas del portal autenticado (acceso por código, cuenta, facturas, pagos, promesas,
 * contacto) para el modo fixtures y las pruebas. Tipadas contra el contrato y con los mismos
 * valores por defecto que devuelve la API.
 *
 * En fixtures el código correcto es siempre `123456`.
 */
import type { Schema } from '@argosisp/contracts'
import { MARCA_FIXTURE, MARCA_SUR_FIXTURE } from './empresa'

export const CODIGO_FIXTURE = '123456'

export const SOLICITUD_FIXTURE: Schema<'PortalSolicitudCodigo'> = {
    solicitud: '6f1c2a4e-9b1d-4c1e-8f2a-1d2e3f4a5b6c',
    expira_en: '2026-10-20T15:10:00.000Z',
    destino: null,
}

export const SOLICITUD_POR_IP_FIXTURE: Schema<'PortalSolicitudCodigo'> = {
    ...SOLICITUD_FIXTURE,
    destino: 'j***z@e***.com',
}

export const SESION_FIXTURE: Schema<'PortalSesion'> = {
    cliente: { nombre_parcial: 'Juan P.' },
    expira_en: '2026-10-20T15:30:00.000Z',
    empresa_principal: MARCA_FIXTURE,
}

export const CONTACTO_FIXTURE: Schema<'PortalContacto'> = {
    nombre: 'Juan Pérez López',
    nit_cui: '12345679',
    email: 'juan.perez@example.com',
    telefono: '2222-3333',
    movil: '5555-1234',
    canal_preferido: 'correo',
    telegram_vinculado: false,
    version: 3,
}

/** Factura pendiente de la sección de una empresa (`PortalFacturaPendiente`), como la devuelve la API. */
function pendiente(datos: Partial<Schema<'PortalFacturaPendiente'>> & { id: number }): Schema<'PortalFacturaPendiente'> {
    return {
        numero: String(datos.id),
        servicio_id: 41,
        vence_en: '2026-10-10',
        estado: 'vencida',
        vencida: true,
        total: '175.00',
        saldo: '175.00',
        ...datos,
    }
}

/** Adicionales activos del servicio 41: incluido con su usuario, de cortesía y cobrado aparte. */
export const ADICIONALES_FIXTURE: Schema<'PortalAdicional'>[] = [
    { id: 301, nombre: 'Streaming Plus', identificador: 'maria@example.com', modalidad: 'incluido', precio: null },
    { id: 302, nombre: 'IPTV básico', identificador: null, modalidad: 'cortesia', precio: null },
    { id: 303, nombre: 'IPTV deportes', identificador: 'mgarcia-tv', modalidad: 'cobrado', precio: '35.00' },
]

export const CUENTA_FIXTURE: Schema<'PortalCuenta'> = {
    cliente: CONTACTO_FIXTURE,
    servicios: [
        {
            id: 41,
            estado: 'suspendido',
            plan: 'Hogar 20 Mbps',
            plan_tipo: 'residencial',
            // Uno de cada modalidad, como los devuelve `GET /portal/cuenta` (sin credencial).
            adicionales: ADICIONALES_FIXTURE,
            direccion: '5a avenida 10-20 zona 1',
            promesa_activa: false,
            monto_adeudado: '550.00',
            empresa: MARCA_FIXTURE,
        },
    ],
    monto_adeudado: '550.00',
    empresa_principal: MARCA_FIXTURE,
    // Las pendientes de `FACTURAS_FIXTURE`, la más antigua primero.
    empresas: [
        {
            empresa: MARCA_FIXTURE,
            saldo: '550.00',
            saldo_a_favor: '0.00',
            facturas_pendientes: [
                pendiente({ id: 1101, vence_en: '2026-08-10' }),
                pendiente({ id: 1150, vence_en: '2026-09-10' }),
                pendiente({ id: 1160, vence_en: '2026-09-25', estado: 'parcial', total: '30.00', saldo: '25.00' }),
                pendiente({ id: 1203, vence_en: '2026-10-10' }),
            ],
        },
    ],
}

/**
 * Cliente con servicios en dos empresas (multiempresa): el de Red Altiplano (la principal) y uno
 * de Fibra Sur suspendido. Escenario `?cuenta=dos_empresas` en desarrollo.
 */
export const CUENTA_DOS_EMPRESAS_FIXTURE: Schema<'PortalCuenta'> = {
    cliente: CONTACTO_FIXTURE,
    servicios: [
        { ...CUENTA_FIXTURE.servicios[0]!, estado: 'activo', monto_adeudado: '175.00' },
        {
            id: 57,
            estado: 'suspendido',
            plan: 'Fibra 50 Mbps',
            plan_tipo: 'empresarial',
            adicionales: [],
            direccion: 'Lotificación El Rosario, casa 14',
            promesa_activa: false,
            monto_adeudado: '398.00',
            empresa: MARCA_SUR_FIXTURE,
        },
    ],
    monto_adeudado: '573.00',
    empresa_principal: MARCA_FIXTURE,
    empresas: [
        {
            empresa: MARCA_FIXTURE,
            saldo: '175.00',
            saldo_a_favor: '0.00',
            facturas_pendientes: [
                pendiente({ id: 1203, vence_en: '2099-10-10', estado: 'emitida', vencida: false }),
            ],
        },
        {
            empresa: MARCA_SUR_FIXTURE,
            saldo: '398.00',
            saldo_a_favor: '25.00',
            facturas_pendientes: [
                pendiente({ id: 2201, servicio_id: 57, vence_en: '2026-09-05', total: '199.00', saldo: '199.00' }),
                pendiente({ id: 2250, servicio_id: 57, vence_en: '2026-10-05', total: '199.00', saldo: '199.00' }),
            ],
        },
    ],
}

function factura(datos: Partial<Schema<'PortalFactura'>> & { id: number }): Schema<'PortalFactura'> {
    return {
        numero: String(datos.id),
        documento: 'aviso_cobro',
        tipo: 'servicio',
        servicio_id: 41,
        periodo: '2026-10-01',
        emitida_en: '2026-10-01T06:00:00.000Z',
        vence_en: '2026-10-10',
        estado: 'emitida',
        subtotal: '156.25',
        iva: '18.75',
        total: '175.00',
        pagado: '0.00',
        acreditado: '0.00',
        saldo: '175.00',
        fel_uuid: null,
        fel_serie: null,
        fel_numero: null,
        dte: null,
        sustituida: false,
        sustituida_por: null,
        sustituye_a: null,
        empresa: MARCA_FIXTURE,
        ...datos,
    }
}

/** DTE certificado como lo devuelve la API (`PortalDte`), con serie y número del certificador. */
function dte(datos: Partial<Schema<'PortalDte'>> & Pick<Schema<'PortalDte'>, 'autorizacion' | 'serie' | 'numero'>): Schema<'PortalDte'> {
    return {
        tipo_dte: 'FACT',
        estado: 'certificado',
        certificado_en: '2026-07-08T16:21:00.000Z',
        xml_disponible: true,
        ...datos,
    }
}

/** Factura con su DTE certificado: número, documento y `fel_*` salen del DTE, como en la API. */
function certificada(datos: Partial<Schema<'PortalFactura'>> & { id: number, dte: Schema<'PortalDte'> }): Schema<'PortalFactura'> {
    return factura({
        documento: datos.tipo === 'mora' ? 'nota_debito' : 'factura',
        numero: `${datos.dte.serie}-${datos.dte.numero}`,
        fel_uuid: datos.dte.autorizacion,
        fel_serie: datos.dte.serie,
        fel_numero: datos.dte.numero,
        ...datos,
    })
}

const DTE_1040 = dte({ autorizacion: 'A1B2C3D4-A7C1-4E2B-9F10-5D6E7F8A9B0C', serie: 'A1B2C3D4', numero: '2814509' })
const DTE_1020 = dte({
    autorizacion: '7E3F21A0-1B2C-4D5E-8F90-1A2B3C4D5E6F',
    serie: '7E3F21A0',
    numero: '1190032',
    certificado_en: '2026-06-05T15:02:00.000Z',
})
const DTE_1021 = dte({
    autorizacion: '0C9D8E7F-6A5B-4C3D-9E2F-1A0B9C8D7E6F',
    serie: '0C9D8E7F',
    numero: '3301457',
    certificado_en: '2026-06-12T17:40:00.000Z',
})

export const FACTURAS_FIXTURE: Schema<'PortalFactura'>[] = [
    factura({ id: 1203, periodo: '2026-10-01', vence_en: '2026-10-10', estado: 'vencida' }),
    factura({ id: 1150, periodo: '2026-09-01', vence_en: '2026-09-10', estado: 'vencida' }),
    factura({
        id: 1101,
        periodo: '2026-08-01',
        vence_en: '2026-08-10',
        estado: 'vencida',
    }),
    // Mora: recargo por vencimiento de la 1150.
    factura({
        id: 1160,
        tipo: 'mora',
        periodo: '2026-09-01',
        vence_en: '2026-09-25',
        estado: 'parcial',
        subtotal: '26.79',
        iva: '3.21',
        total: '30.00',
        pagado: '5.00',
        saldo: '25.00',
    }),
    // Pagada y certificada: ya es «Factura» con su serie y número.
    certificada({ id: 1040, periodo: '2026-07-01', vence_en: '2026-07-10', estado: 'pagada', pagado: '175.00', saldo: '0.00', dte: DTE_1040 }),
    // Sustitución de junio (NIT equivocado): la original se acreditó con una NCRE y la nueva la reemplaza.
    certificada({
        id: 1021,
        periodo: '2026-06-01',
        emitida_en: '2026-06-12T17:39:00.000Z',
        vence_en: '2026-06-22',
        estado: 'pagada',
        pagado: '175.00',
        saldo: '0.00',
        dte: DTE_1021,
        sustituye_a: { id: 1020, numero: `${DTE_1020.serie}-${DTE_1020.numero}` },
    }),
    certificada({
        id: 1020,
        periodo: '2026-06-01',
        emitida_en: '2026-06-01T06:00:00.000Z',
        vence_en: '2026-06-10',
        estado: 'pagada',
        pagado: '175.00',
        acreditado: '175.00',
        saldo: '0.00',
        dte: DTE_1020,
        sustituida: true,
        sustituida_por: { id: 1021, numero: `${DTE_1021.serie}-${DTE_1021.numero}` },
    }),
]

/**
 * Notas de crédito: la NCRE que acreditó la 1020 (sustituida) y una nota de la 1150 que se anuló
 * porque la SAT rechazó su NCRE (el monto volvió al saldo).
 */
export const NOTAS_CREDITO_FIXTURE: Schema<'PortalNotaCredito'>[] = [
    {
        id: 312,
        numero: '312',
        documento: 'nota_credito',
        factura_id: 1150,
        factura_numero: '1150',
        servicio_id: 41,
        fecha: '2026-09-18',
        subtotal: '17.86',
        iva: '2.14',
        monto: '20.00',
        motivo: 'Descuento por falla de servicio',
        estado: 'anulada',
        dte: null,
        empresa: MARCA_FIXTURE,
    },
    {
        id: 298,
        numero: '5D41402A-2874519',
        documento: 'ncre',
        factura_id: 1020,
        factura_numero: `${DTE_1020.serie}-${DTE_1020.numero}`,
        servicio_id: 41,
        fecha: '2026-06-12',
        subtotal: '156.25',
        iva: '18.75',
        monto: '175.00',
        motivo: 'Sustitución: NIT equivocado',
        estado: 'vigente',
        dte: dte({
            tipo_dte: 'NCRE',
            autorizacion: '5D41402A-BC4B-4A76-B971-9D911017C592',
            serie: '5D41402A',
            numero: '2874519',
            certificado_en: '2026-06-12T17:38:00.000Z',
        }),
        empresa: MARCA_FIXTURE,
    },
]

export const PAGOS_FIXTURE: Schema<'PortalPago'>[] = [
    {
        id: 880,
        metodo: 'deposito',
        monto: '175.00',
        referencia: 'BI-99812',
        estado: 'registrado',
        created_at: '2026-07-08T16:20:00.000Z',
        aplicaciones: [{ factura_id: 1040, monto: '175.00' }],
    },
]

export const PROMESAS_FIXTURE: Schema<'PortalPromesa'>[] = [
    {
        id: 77,
        servicio_id: 41,
        vence_en: '2026-08-20T05:59:59.000Z',
        monto: '175.00',
        estado: 'incumplida',
        canal: 'operador',
        created_at: '2026-08-15T14:00:00.000Z',
    },
]
