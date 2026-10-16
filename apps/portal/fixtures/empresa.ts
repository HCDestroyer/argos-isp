/**
 * `GET /api/v1/portal/empresa` para el modo fixtures y las pruebas (tipado contra el contrato).
 * Las cuentas para depósito vienen en la API de `billing.cuentas_bancarias` (A3).
 */
import type { Schema } from '@argosisp/contracts'

export const EMPRESA_FIXTURE: Schema<'EmpresaPublica'> = {
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
}

/** Empresa recién instalada: nada configurado todavía (sin cuentas ni contacto). */
export const EMPRESA_SIN_CONFIGURAR: Schema<'EmpresaPublica'> = {
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
}
