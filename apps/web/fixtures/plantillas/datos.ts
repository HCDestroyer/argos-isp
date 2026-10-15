import type { Schema } from '@argosisp/contracts'

const creado = '2026-09-01T15:00:00.000Z'
const meta = { version: 1, created_at: creado, updated_at: creado }

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
        hora_corte: '08:00:00',
        certificar_al: 'pagar',
        reglas_promesa: {},
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
        hora_corte: '09:00:00',
        certificar_al: 'emitir',
        reglas_promesa: {},
        ...meta,
    },
]
