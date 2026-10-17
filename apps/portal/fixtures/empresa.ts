/**
 * `GET /api/v1/portal/empresa` para el modo fixtures y las pruebas (tipado contra el contrato).
 * Las cuentas para depósito vienen en la API de `billing.cuentas_bancarias` (A3).
 */
import type { Schema } from '@argosisp/contracts'

/** Marca de la empresa principal (la 1) tal como la devuelve la API en servicios y facturas. */
export const MARCA_FIXTURE: Schema<'PortalMarcaEmpresa'> = {
    id: 1,
    nombre_comercial: 'Red Altiplano',
    logo_url: null,
    nit: '1234567-8',
    direccion_fiscal: '4a calle 12-30 zona 3, Quetzaltenango',
    telefono: '7765-4321',
    whatsapp: '5555-0000',
}

/** Segunda empresa del grupo (multiempresa): otro NIT, otro soporte y otras cuentas. */
export const MARCA_SUR_FIXTURE: Schema<'PortalMarcaEmpresa'> = {
    id: 2,
    nombre_comercial: 'Fibra Sur',
    logo_url: null,
    nit: '7654321-0',
    direccion_fiscal: '2a avenida 3-20 zona 2, Escuintla',
    telefono: '7888-2000',
    whatsapp: '5000-2000',
}

export const EMPRESA_FIXTURE: Schema<'EmpresaPublica'> = {
    id: 1,
    logo_url: null,
    nombre: 'Red Altiplano',
    nit: '1234567-8',
    direccion: '4a calle 12-30 zona 3, Quetzaltenango',
    telefono: '7765-4321',
    telefono_alterno: null,
    whatsapp: '5555-0000',
    correo: 'cobros@redaltiplano.example',
    horario: 'Lunes a sábado de 8:00 a 18:00',
    instrucciones_pago: 'Escribe tu NIT en la boleta y sube la foto del comprobante.',
    cuentas_deposito: [
        { id: 3, banco: 'Banco Industrial', alias: 'Monetaria Red Altiplano', numero: '123-456789-0', moneda: 'GTQ' },
        { id: 5, banco: 'Banrural', alias: 'Ahorro Red Altiplano', numero: '3-033-12345-6', moneda: 'GTQ' },
    ],
    pago_en_linea: true,
}

/** Empresa recién instalada: nada configurado todavía (sin cuentas ni contacto). */
export const EMPRESA_SIN_CONFIGURAR: Schema<'EmpresaPublica'> = {
    id: 1,
    logo_url: null,
    nombre: 'ArgosIsp',
    nit: null,
    direccion: null,
    telefono: null,
    telefono_alterno: null,
    whatsapp: null,
    correo: null,
    horario: null,
    instrucciones_pago: null,
    cuentas_deposito: [],
    pago_en_linea: false,
}

/** `GET /portal/empresa?empresa_id=2`: los datos de pago y contacto de Fibra Sur. */
export const EMPRESA_SUR_FIXTURE: Schema<'EmpresaPublica'> = {
    id: 2,
    logo_url: null,
    nombre: 'Fibra Sur',
    nit: '7654321-0',
    direccion: '2a avenida 3-20 zona 2, Escuintla',
    telefono: '7888-2000',
    telefono_alterno: null,
    whatsapp: '5000-2000',
    correo: 'pagos@fibrasur.example',
    horario: 'Lunes a viernes de 8:00 a 17:00',
    instrucciones_pago: 'Deposita a nombre de Fibra del Sur, S.A. y sube la boleta.',
    cuentas_deposito: [
        { id: 9, banco: 'Banco G&T Continental', alias: 'Monetaria Fibra Sur', numero: '900-111222-3', moneda: 'GTQ' },
    ],
    pago_en_linea: true,
}
