import { PLAN_CUENTAS } from '#ledger/plan_cuentas'
import type { CategoriaFlujo, DefinicionCuentaPaquete } from '#fiscal/localizacion'

/**
 * Cuentas de Guatemala que agrega `gt-2026.1` (contrato §6.1). Se respetan los códigos actuales
 * (`1.1.03` es CxC, `2.1.02` es IVA débito); no se copian los de Odoo (inv. D.1).
 *
 * El paquete parte del plan base de `#ledger/plan_cuentas` (que siembra el seeder): en una base
 * nueva la migración corre antes que el seeder y las cuentas GT necesitan a sus padres.
 */

export const CUENTAS_GT = {
    IVA_CREDITO: '1.1.04',
    IVA_RETENIDO_CLIENTES: '1.1.05',
    ISR_RETENIDO_CLIENTES: '1.1.06',
    ISR_PAGOS_TRIMESTRALES: '1.1.07',
    ISO_POR_ACREDITAR: '1.1.08',
    PAGOS_ANTICIPADOS_IMPUESTOS: '1.1.09',
    PROPIEDAD_PLANTA_EQUIPO: '1.2.01',
    DEPRECIACION_ACUMULADA: '1.2.02',
    PROVEEDORES: '2.1.03',
    RETENCIONES_IVA_POR_PAGAR: '2.1.04',
    RETENCIONES_ISR_POR_PAGAR: '2.1.05',
    IVA_POR_PAGAR: '2.1.06',
    ISR_POR_PAGAR: '2.1.07',
    ISO_POR_PAGAR: '2.1.08',
    PC_POR_PAGAR: '2.1.09',
    PASIVO_LEALTAD: '2.1.10',
    IVA_POR_CERTIFICAR: '2.1.11',
    CAPITAL_SOCIAL: '3.1.01',
    RESERVA_LEGAL: '3.2.01',
    UTILIDADES_ACUMULADAS: '3.3.01',
    RESULTADO_EJERCICIO: '3.3.02',
    PERDIDAS_GANANCIAS: '3.3.03',
    INGRESOS_DIFERIDOS_LEALTAD: '4.1.05',
    INGRESOS_PUNTOS: '4.1.06',
    DIFERENCIAL_CAMBIARIO: '4.2.01',
    PREMIOS_PROMOCIONES: '5.1.03',
    DEPRECIACIONES: '5.3.01',
    CUENTAS_INCOBRABLES: '5.3.02',
    IMPUESTOS_DEDUCIBLES: '5.3.03',
    IMPUESTO_PC: '5.3.04',
    GASTOS_NO_DEDUCIBLES: '5.4.01',
    MULTAS_TRIBUTARIAS: '5.4.02',
    IMPUESTO_SOBRE_RENTA: '5.5.01',
} as const

/** Clases de activo fijo: una cuenta de costo y una de depreciación acumulada por clase. */
export const CLASES_ACTIVO = [
    { sufijo: '01', clave: 'equipo_red', nombre: 'Equipo de red' },
    { sufijo: '02', clave: 'computacion', nombre: 'Equipo de computación' },
    { sufijo: '03', clave: 'mobiliario', nombre: 'Mobiliario y equipo de oficina' },
    { sufijo: '04', clave: 'vehiculos', nombre: 'Vehículos' },
    { sufijo: '05', clave: 'herramientas', nombre: 'Herramientas' },
    { sufijo: '06', clave: 'edificios', nombre: 'Edificios e instalaciones' },
    { sufijo: '07', clave: 'otros', nombre: 'Otros bienes muebles' },
] as const

const hoja = (
    codigo: string,
    nombre: string,
    tipo: DefinicionCuentaPaquete['tipo'],
    padre: string,
    extra: Partial<DefinicionCuentaPaquete> = {},
): DefinicionCuentaPaquete => ({ codigo, nombre, tipo, padre, imputable: true, ...extra })

const grupo = (
    codigo: string,
    nombre: string,
    tipo: DefinicionCuentaPaquete['tipo'],
    padre: string | null,
    extra: Partial<DefinicionCuentaPaquete> = {},
): DefinicionCuentaPaquete => ({ codigo, nombre, tipo, padre, imputable: false, ...extra })

const C = CUENTAS_GT

/** En orden: cada padre antes que sus hijas. */
const AGREGADAS: readonly DefinicionCuentaPaquete[] = [
    hoja(C.IVA_CREDITO, 'IVA crédito fiscal', 'activo', '1.1'),
    hoja(C.IVA_RETENIDO_CLIENTES, 'IVA retenido por clientes', 'activo', '1.1'),
    hoja(C.ISR_RETENIDO_CLIENTES, 'ISR retenido por clientes', 'activo', '1.1'),
    hoja(C.ISR_PAGOS_TRIMESTRALES, 'ISR pagos trimestrales', 'activo', '1.1'),
    hoja(C.ISO_POR_ACREDITAR, 'ISO por acreditar', 'activo', '1.1'),
    hoja(C.PAGOS_ANTICIPADOS_IMPUESTOS, 'Pagos anticipados de impuestos', 'activo', '1.1'),
    grupo('1.2', 'Activo no corriente', 'activo', '1'),
    grupo(C.PROPIEDAD_PLANTA_EQUIPO, 'Propiedad, planta y equipo', 'activo', '1.2'),
    ...CLASES_ACTIVO.map((clase) =>
        hoja(
            `${C.PROPIEDAD_PLANTA_EQUIPO}.${clase.sufijo}`,
            clase.nombre,
            'activo',
            C.PROPIEDAD_PLANTA_EQUIPO,
            {
                libro_inventario: true,
            },
        ),
    ),
    grupo(C.DEPRECIACION_ACUMULADA, 'Depreciación acumulada', 'activo', '1.2', { contracuenta: true }),
    ...CLASES_ACTIVO.map((clase) =>
        hoja(
            `${C.DEPRECIACION_ACUMULADA}.${clase.sufijo}`,
            `Depreciación acumulada de ${clase.nombre.toLowerCase()}`,
            'activo',
            C.DEPRECIACION_ACUMULADA,
            { contracuenta: true },
        ),
    ),

    hoja(C.PROVEEDORES, 'Proveedores', 'pasivo', '2.1', { auxiliar_proveedor: true }),
    hoja(C.RETENCIONES_IVA_POR_PAGAR, 'Retenciones de IVA por pagar', 'pasivo', '2.1'),
    hoja(C.RETENCIONES_ISR_POR_PAGAR, 'Retenciones de ISR por pagar', 'pasivo', '2.1'),
    hoja(C.IVA_POR_PAGAR, 'IVA por pagar', 'pasivo', '2.1'),
    hoja(C.ISR_POR_PAGAR, 'ISR por pagar', 'pasivo', '2.1'),
    hoja(C.ISO_POR_PAGAR, 'ISO por pagar', 'pasivo', '2.1'),
    hoja(C.PC_POR_PAGAR, 'Impuesto de pequeño contribuyente por pagar', 'pasivo', '2.1'),
    hoja(C.PASIVO_LEALTAD, 'Pasivo del programa de lealtad', 'pasivo', '2.1'),
    hoja(C.IVA_POR_CERTIFICAR, 'IVA por certificar', 'pasivo', '2.1'),

    grupo('3', 'Patrimonio', 'patrimonio', null),
    grupo('3.1', 'Capital', 'patrimonio', '3'),
    hoja(C.CAPITAL_SOCIAL, 'Capital social', 'patrimonio', '3.1'),
    grupo('3.2', 'Reservas', 'patrimonio', '3'),
    hoja(C.RESERVA_LEGAL, 'Reserva legal', 'patrimonio', '3.2'),
    grupo('3.3', 'Resultados', 'patrimonio', '3'),
    hoja(C.UTILIDADES_ACUMULADAS, 'Utilidades acumuladas', 'patrimonio', '3.3'),
    hoja(C.RESULTADO_EJERCICIO, 'Resultado del ejercicio', 'patrimonio', '3.3'),
    hoja(C.PERDIDAS_GANANCIAS, 'Pérdidas y ganancias', 'patrimonio', '3.3'),

    hoja(C.INGRESOS_DIFERIDOS_LEALTAD, 'Ingresos diferidos por lealtad', 'ingreso', '4.1', {
        contracuenta: true,
    }),
    hoja(C.INGRESOS_PUNTOS, 'Ingresos por puntos canjeados o vencidos', 'ingreso', '4.1'),
    grupo('4.2', 'Ingresos no operativos', 'ingreso', '4'),
    hoja(C.DIFERENCIAL_CAMBIARIO, 'Diferencial cambiario', 'ingreso', '4.2'),

    hoja(C.PREMIOS_PROMOCIONES, 'Premios y promociones', 'gasto', '5.1'),
    grupo('5.3', 'Depreciaciones, reservas e impuestos', 'gasto', '5'),
    hoja(C.DEPRECIACIONES, 'Depreciaciones', 'gasto', '5.3', { categoria_fiscal: 'depreciacion' }),
    hoja(C.CUENTAS_INCOBRABLES, 'Cuentas incobrables', 'gasto', '5.3'),
    hoja(C.IMPUESTOS_DEDUCIBLES, 'Impuestos y tasas deducibles', 'gasto', '5.3'),
    hoja(C.IMPUESTO_PC, 'Impuesto de pequeño contribuyente', 'gasto', '5.3'),
    grupo('5.4', 'Gastos no deducibles', 'gasto', '5'),
    hoja(C.GASTOS_NO_DEDUCIBLES, 'Gastos no deducibles', 'gasto', '5.4', {
        categoria_fiscal: 'no_deducible',
    }),
    // inv. E.2 y A.2 (LAT, art. 21.15): multas, recargos e intereses tributarios no son deducibles
    hoja(C.MULTAS_TRIBUTARIAS, 'Multas, recargos e intereses tributarios', 'gasto', '5.4', {
        categoria_fiscal: 'no_deducible',
    }),
    grupo('5.5', 'Impuesto sobre la renta', 'gasto', '5'),
    // inv. A.2 (LAT, art. 21.15): el ISR no es deducible
    hoja(C.IMPUESTO_SOBRE_RENTA, 'Impuesto sobre la renta', 'gasto', '5.5', {
        categoria_fiscal: 'no_deducible',
    }),
]

/**
 * Flujo de efectivo por cuenta (método indirecto; estudio de Odoo, tabla final #1). Propuesta de A3
 * por prefijo, a revisar con el contador: cajas y bancos son el efectivo; propiedad, planta y
 * equipo es inversión; capital y reservas, financiamiento; la depreciación acumulada es un ajuste
 * de operación; los resultados (3.3) son el punto de partida del método y las transitorias de
 * importación (2.9) no mueven efectivo (sin categoría).
 */
export function categoriaFlujoGt(codigo: string): CategoriaFlujo | undefined {
    const empieza = (prefijo: string) => codigo === prefijo || codigo.startsWith(`${prefijo}.`)
    if (['1', '1.1', '1.2', '2', '2.1', '3', '4', '5'].includes(codigo)) return undefined
    if (empieza('1.1.01') || empieza('1.1.02')) return 'efectivo'
    if (empieza(C.PROPIEDAD_PLANTA_EQUIPO)) return 'inversion'
    if (empieza(C.DEPRECIACION_ACUMULADA)) return 'operacion'
    if (empieza('3.1') || empieza('3.2')) return 'financiamiento'
    if (empieza('3.3') || empieza('2.9')) return undefined
    return 'operacion'
}

/** Plan base + cuentas GT, en orden de inserción, con su categoría de flujo. */
export const CUENTAS_PAQUETE_GT: readonly DefinicionCuentaPaquete[] = [...PLAN_CUENTAS, ...AGREGADAS].map(
    (cuenta) => {
        const flujo = categoriaFlujoGt(cuenta.codigo)
        return flujo ? { ...cuenta, categoria_flujo: flujo } : cuenta
    },
)

/** Solo las que agrega GT sobre el plan base. */
export const CUENTAS_AGREGADAS_GT = AGREGADAS
