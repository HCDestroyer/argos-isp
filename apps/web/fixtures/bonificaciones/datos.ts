import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { CUENTA_BONIFICACIONES, CUENTA_INGRESOS, fechaGuatemala, movimiento } from '../libro/datos'

/**
 * Cargo único y bonificaciones (A3, decisión del PM: nunca una factura de Q0). Catálogos de
 * conceptos y motivos por empresa, y tres bonificaciones de ArgosNet: un mes gratis canjeado con
 * puntos, un descuento del 100 % y una instalación regalada (cargo sin costo).
 */

type Bonificacion = Schema<'Bonificacion'>
type Asiento = Schema<'Asiento'>

const creado = '2026-09-01T15:00:00.000Z'

export const conceptosCargo: Schema<'ConceptoCargo'>[] = [
    { id: 1, empresa_id: 1, nombre: 'Instalación', tipo: 'otro', cuenta_codigo: '4.1.03', cuenta_nombre: 'Otros ingresos', gravable: true, activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 2, empresa_id: 1, nombre: 'Router Wi-Fi', tipo: 'producto', cuenta_codigo: '4.1.03', cuenta_nombre: 'Otros ingresos', gravable: true, activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 3, empresa_id: 1, nombre: 'Visita técnica', tipo: 'otro', cuenta_codigo: '4.1.03', cuenta_nombre: 'Otros ingresos', gravable: true, activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 4, empresa_id: 1, nombre: 'Cable UTP (por metro)', tipo: 'producto', cuenta_codigo: '4.1.03', cuenta_nombre: 'Otros ingresos', gravable: true, activo: false, version: 2, created_at: creado, updated_at: '2026-10-01T15:00:00.000Z' },
    { id: 5, empresa_id: 2, nombre: 'Instalación Sur', tipo: 'otro', cuenta_codigo: '4.1.03', cuenta_nombre: 'Otros ingresos', gravable: true, activo: true, version: 1, created_at: creado, updated_at: creado },
]

export const motivosSinCosto: Schema<'MotivoSinCosto'>[] = [
    { id: 1, empresa_id: 1, nombre: 'Promoción de instalación', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 2, empresa_id: 1, nombre: 'Cortesía comercial', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 3, empresa_id: 1, nombre: 'Garantía', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 4, empresa_id: 1, nombre: 'Programa de lealtad', activo: true, version: 1, created_at: creado, updated_at: creado },
    { id: 5, empresa_id: 2, nombre: 'Promoción Sur', activo: true, version: 1, created_at: creado, updated_at: creado },
]

/** IVA incluido (12 %): base = bruto / 1.12 a centavos; el IVA es el resto. */
export function baseSinIva(bruto: Decimal, gravable: boolean): Decimal {
    return gravable ? bruto.div('1.12').toDecimalPlaces(2) : bruto
}

/** Asiento interno de la bonificación: 5.1.01 al debe y el ingreso al haber, por la base (sin CxC, IVA ni DTE). */
export function asientoBonificacion(id: number, b: Pick<Bonificacion, 'id' | 'empresa_id' | 'concepto' | 'base' | 'created_at'>): Asiento {
    return {
        id,
        empresa_id: b.empresa_id,
        fecha: fechaGuatemala(b.created_at),
        descripcion: `Bonificación ${b.id} · ${b.concepto}`,
        origen_tipo: 'bonificacion',
        origen_id: b.id,
        diario: 'VAR',
        reversa_de: null,
        created_by: null,
        created_at: b.created_at,
        movimientos: [
            movimiento(CUENTA_BONIFICACIONES, 'debe', b.base),
            movimiento(CUENTA_INGRESOS, 'haber', b.base),
        ],
    }
}

/** Primer id de los asientos de bonificación de la semilla (después de los de `libro/datos`). */
export const ASIENTO_BONIFICACION_INICIAL = 8800

function bonificacion(id: number, datos: Omit<Bonificacion, 'id' | 'empresa_id' | 'base' | 'asiento_id' | 'lineas' | 'canje_id'> & { canje_id?: number | null, precio: string }): Bonificacion {
    const bruto = new Decimal(datos.bruto)
    const base = baseSinIva(bruto, true)
    const { precio, ...resto } = datos
    return {
        id,
        empresa_id: 1,
        canje_id: null,
        ...resto,
        base: base.toFixed(2),
        asiento_id: ASIENTO_BONIFICACION_INICIAL + id,
        lineas: [{
            concepto: datos.concepto,
            tipo: datos.origen === 'cargo_sin_costo' ? 'otro' : 'servicio',
            cantidad: '1.000',
            precio_unitario: precio,
            gravable: true,
            iva: bruto.minus(base).toFixed(2),
            total: bruto.toFixed(2),
            cuenta_codigo: datos.origen === 'cargo_sin_costo' ? '4.1.03' : '4.1.01',
        }],
    }
}

export const bonificaciones: Bonificacion[] = [
    bonificacion(1, {
        cliente_id: 4,
        servicio_id: 5,
        periodo: '2026-08-01',
        clave_unica: '5-2026-08-01',
        concepto: 'Internet Hogar 10 Mbps · periodo 2026-08',
        origen: 'canje',
        bruto: '150.00',
        precio: '150.00',
        motivo_id: 4,
        motivo_nombre: 'Programa de lealtad',
        motivo_texto: 'Canje de 2,500 puntos: un mes gratis',
        canje_id: 12,
        created_at: '2026-08-01T12:05:00.000Z',
    }),
    bonificacion(2, {
        cliente_id: 6,
        servicio_id: 7,
        periodo: '2026-08-01',
        clave_unica: '7-2026-08-01',
        concepto: 'Internet Pyme 50 Mbps · periodo 2026-08',
        origen: 'descuento_100',
        bruto: '450.00',
        precio: '450.00',
        motivo_id: 2,
        motivo_nombre: 'Cortesía comercial',
        motivo_texto: 'Compensación por la falla de agosto en Villa Nueva',
        created_at: '2026-08-01T12:00:00.000Z',
    }),
    bonificacion(3, {
        cliente_id: 1,
        servicio_id: 1,
        periodo: '2026-10-05',
        clave_unica: 'cargo-3b1f6a52-0c1d-4e7a-9f21-7d0a1e2b3c4d',
        concepto: 'Instalación',
        origen: 'cargo_sin_costo',
        bruto: '250.00',
        precio: '250.00',
        motivo_id: 1,
        motivo_nombre: 'Promoción de instalación',
        motivo_texto: 'Instalación gratis por la campaña de octubre',
        created_at: '2026-10-05T16:30:00.000Z',
    }),
]

export function asientosBonificaciones(): Asiento[] {
    return bonificaciones.map(b => asientoBonificacion(b.asiento_id, b))
}
