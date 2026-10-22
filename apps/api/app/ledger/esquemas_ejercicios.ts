import {
    Dinero,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    jsonLibre,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'

/**
 * Schemas del cierre anual y del balance de comprobación (fase 6 PR C, contrato §9.1 y §10.8).
 */

export const CierreAnual = definirEsquema(
    'CierreAnual',
    objeto({
        id,
        empresa_id: id,
        anio: entero,
        estado: enumerado(['cerrado', 'reabierto']),
        isr: { ...Dinero, description: 'ISR del ejercicio que escribió el usuario (provisión 5.5.01)' },
        isr_acreditado_trimestral: { ...Dinero, description: 'Acreditado de 1.1.07 (pagos trimestrales)' },
        isr_acreditado_iso: { ...Dinero, description: 'Acreditado de 1.1.08 (ISO)' },
        isr_nota: nulable(texto),
        resultado_antes_isr: {
            ...Dinero,
            description: 'Resultado contable del año antes de la provisión del cierre (negativo = pérdida)',
        },
        resultado: { ...Dinero, description: 'resultado_antes_isr − isr: lo que pasa a 3.3.01' },
        reserva_legal: { ...Dinero, description: '3.3.01 → 3.2.01 (0.00 sin utilidad)' },
        resumen: {
            ...jsonLibre,
            description:
                'desde, hasta, cuentas[] (codigo, nombre, tipo, neto debe − haber cancelado), isr_por_pagar, reserva_legal_pct, reserva_legal_base, base_reserva',
        },
        asientos: { ...lista(id), description: 'Asientos del cierre (y de sus reversos al reabrir), en orden' },
        cerrado_en: instante,
        cerrado_por: nulable(id),
        cerrado_por_nombre: nulable(texto),
        reabierto_en: nulable(instante),
        reabierto_por: nulable(id),
        reabierto_por_nombre: nulable(texto),
        motivo_reapertura: nulable(texto),
    }),
)

const lineaComprobacion = objeto({
    cuenta_id: id,
    codigo: texto,
    nombre: texto,
    tipo: enumerado(['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto']),
    nivel: { ...entero, description: '1 = grupo raíz' },
    padre_id: nulable(id),
    imputable: booleano,
    saldo_inicial_deudor: Dinero,
    saldo_inicial_acreedor: Dinero,
    debe: Dinero,
    haber: Dinero,
    saldo_final_deudor: Dinero,
    saldo_final_acreedor: Dinero,
})

const totalesComprobacion = objeto({
    saldo_inicial_deudor: Dinero,
    saldo_inicial_acreedor: Dinero,
    debe: Dinero,
    haber: Dinero,
    saldo_final_deudor: Dinero,
    saldo_final_acreedor: Dinero,
    cuadra: {
        ...booleano,
        description: 'Σ debe = Σ haber y Σ deudor = Σ acreedor al inicio y al final',
    },
})

const cuerpoComprobacion = {
    cuentas: { ...lista(lineaComprobacion), description: 'Cuentas imputables con saldo o movimiento' },
    grupos: { ...lista(lineaComprobacion), description: 'Cuentas de agrupación: suma de sus hijas' },
    totales: totalesComprobacion,
}

export const BalanceComprobacion = definirEsquema(
    'BalanceComprobacion',
    objeto({
        desde: fecha,
        hasta: fecha,
        sin_cierre_anual: { ...booleano, description: 'true = sin los asientos del cierre anual (antes del cierre)' },
        consolidado: booleano,
        empresas: lista(
            objeto({
                empresa_id: id,
                nombre_comercial: nulable(texto),
                nit: nulable(texto),
                ...cuerpoComprobacion,
            }),
        ),
        total: { ...objeto(cuerpoComprobacion), description: 'Total del grupo' },
    }),
)
