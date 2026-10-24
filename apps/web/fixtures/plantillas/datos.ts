import type { Schema } from '@argosisp/contracts'

const creado = '2026-09-01T15:00:00.000Z'
const meta = { version: 1, created_at: creado, updated_at: creado }

// Espejo de REGLAS_PROMESA_POR_DEFECTO (apps/api/app/billing/reglas_promesa.ts): la API
// siempre devuelve las reglas normalizadas con todos los campos.
const sinLimitesCanal = {
    permitido: true,
    requiere_aprobacion: false,
    plazo_max_dias: null,
    max_por_periodo: null,
    deuda_maxima: null,
}

const reglasPromesa: Schema<'PlantillaFacturacion'>['reglas_promesa'] = {
    habilitadas: true,
    max_por_periodo: 1,
    max_por_periodo_buen_historial: 2,
    buen_historial_pct: 100,
    historial_ventana: 6,
    plazo_max_dias: 5,
    no_exceder_siguiente_facturacion: true,
    deuda_maxima: null,
    abono_inicial_pct: 0,
    antiguedad_minima_dias: 0,
    cumplimiento_minimo_pct: null,
    bloqueo_tras_incumplida_dias: 30,
    canales: {
        portal: { ...sinLimitesCanal, plazo_max_dias: 3 },
        ia: { ...sinLimitesCanal, plazo_max_dias: 3 },
        operador: { ...sinLimitesCanal },
        supervisor: { ...sinLimitesCanal, plazo_max_dias: 15, max_por_periodo: 3 },
    },
}

// `hora_corte` en HH:MM (`to_char(hora_corte, 'HH24:MI')`) y `por_defecto` siempre presente, como la API.
export const plantillas: Schema<'PlantillaFacturacion'>[] = [
    {
        id: 1,
        nombre: 'Mensual día 1',
        ciclo: 'dia_fijo',
        dia: 1,
        prorrateo: true,
        dias_gracia: 5,
        facturas_para_limitar: 1,
        facturas_para_cortar: 2,
        mora_tipo: 'fija',
        mora_valor: '25.00',
        mora_recurrente: false,
        hora_corte: '08:00',
        por_defecto: true,
        certificar_al: 'pagar',
        reglas_promesa: structuredClone(reglasPromesa),
        ...meta,
    },
    {
        id: 2,
        nombre: 'Aniversario empresas',
        ciclo: 'aniversario',
        dia: null,
        prorrateo: false,
        dias_gracia: 10,
        facturas_para_limitar: 2,
        facturas_para_cortar: 3,
        mora_tipo: 'ninguna',
        mora_valor: '0.00',
        mora_recurrente: false,
        hora_corte: '09:00',
        por_defecto: false,
        certificar_al: 'emitir',
        // Empresas: la promesa que pide un operador queda pendiente de aprobación.
        reglas_promesa: {
            ...structuredClone(reglasPromesa),
            canales: { ...structuredClone(reglasPromesa.canales), operador: { ...sinLimitesCanal, requiere_aprobacion: true } },
        },
        ...meta,
    },
]
