import type { Schema } from '@argosisp/contracts'
import { impuestosPaquete, parametrosPaquete } from './paquete'

/**
 * Localización fiscal de las dos empresas de los fixtures (A3, fase 2; `contratos/localizacion-fiscal.md`).
 * La 1 (ArgosNet) está en el régimen sobre utilidades con dos establecimientos; la 2 (Fibra del
 * Sur) en pequeño contribuyente. Las dos nacieron con `gt-2026.1` instalado: el instalador deja en
 * el nivel instalación `inicio_libros` y el régimen que tenía `core.empresas.regimen_isr`.
 */

type ValorParametro = Schema<'ValorParametroFiscal'>
type Regimen = 'utilidades' | 'opcional_simplificado' | 'pequeno_contribuyente'

const INSTALADA_EN = '2026-10-17T19:46:01.086Z'
const INICIO_LIBROS = '2026-10-17'

export const paisesFiscales: Schema<'PaisLocalizacion'>[] = [{ codigo: 'GT', nombre: 'Guatemala' }]

export const localizacionesFiscales: Schema<'LocalizacionFiscal'>[] = [
    {
        codigo: 'gt-2026.1',
        pais: 'GT',
        version: '2026.1.0',
        publicada_en: '2026-10-17',
        checksum: '4efb31169d1d6c1ca3b1a9d7a6d17e453f929979e41d6ef11a78714e614ee195',
        mas_reciente: true,
    },
]

export type InstalacionFiscal = Schema<'LocalizacionEmpresa'>['instalaciones'][number]

function instalacion(id: number, empresaId: number, establecimientos: number[]): InstalacionFiscal {
    return {
        id,
        localizacion_codigo: 'gt-2026.1',
        de_codigo: null,
        instalada_en: INSTALADA_EN,
        instalada_por: null,
        instalada_por_nombre: null,
        resumen: {
            empresa_id: empresaId,
            codigo: 'gt-2026.1',
            de_codigo: null,
            ya_instalada: false,
            cuentas: ['1', '1.1', '1.1.01', '1.1.02'],
            parametros: parametrosPaquete.map(p => p.clave),
            valores: [{ clave: 'inicio_libros', empresa_id: empresaId, vigente_desde: '2013-01-01' }, { clave: 'regimen', empresa_id: empresaId, vigente_desde: INICIO_LIBROS }],
            impuestos: impuestosPaquete.map(i => `${i.codigo}@${i.vigente_desde}`),
            establecimientos,
        },
    }
}

/** Instalaciones del paquete por empresa (la vigente primero). */
export function instalacionesIniciales(): Record<number, InstalacionFiscal[]> {
    return { 1: [instalacion(1, 1, [1])], 2: [instalacion(2, 2, [3])] }
}

/** Régimen que el instalador tomó de `core.empresas.regimen_isr` (nivel instalación). */
const REGIMEN_INSTALADO: Record<number, Regimen> = { 1: 'utilidades', 2: 'pequeno_contribuyente' }

/**
 * Filas de `fiscal.parametros_valores`: las del paquete (sin empresa) y las de instalación de cada
 * empresa. Las del usuario se agregan con `POST /fiscal/parametros/:clave/valores` y `POST /fiscal/regimen`.
 */
export function valoresIniciales(): ValorParametro[] {
    const filas: ValorParametro[] = []
    for (const p of parametrosPaquete) {
        if (p.nivel !== 'paquete' || p.vigente_desde === null) {
            continue
        }
        filas.push({
            id: filas.length + 1,
            pais: 'GT',
            empresa_id: null,
            clave: p.clave,
            valor: p.valor,
            vigente_desde: p.vigente_desde,
            origen: 'paquete',
            motivo: null,
            creado_por: null,
            created_at: INSTALADA_EN,
            nivel: 'paquete',
        })
    }
    // Como `instalarPaquete`: `inicio_libros` con fecha base del paquete y el régimen desde el día de la instalación.
    for (const empresaId of [1, 2]) {
        const regimen = REGIMEN_INSTALADO[empresaId]
        const instalados = [
            { clave: 'inicio_libros', valor: INICIO_LIBROS, desde: '2013-01-01', motivo: 'Instalación de gt-2026.1: fecha de inicio de los libros en ArgosIsp' },
            { clave: 'regimen', valor: regimen, desde: INICIO_LIBROS, motivo: `Instalación de gt-2026.1: régimen de core.empresas.regimen_isr (${regimen === 'utilidades' ? 'sujeto_pagos_trimestrales' : 'pequeno_contribuyente'})` },
        ]
        for (const { clave, valor, desde, motivo } of instalados) {
            filas.push({
                id: filas.length + 1,
                pais: 'GT',
                empresa_id: empresaId,
                clave,
                valor,
                vigente_desde: desde,
                origen: 'instalacion',
                motivo,
                creado_por: null,
                created_at: INSTALADA_EN,
                nivel: 'instalacion',
            })
        }
    }
    return filas
}

export function impuestosIniciales(): Schema<'ImpuestoFiscal'>[] {
    return impuestosPaquete.map(i => ({ ...i }))
}

export function establecimientosIniciales(): Schema<'EstablecimientoFiscal'>[] {
    return [
        {
            id: 1,
            empresa_id: 1,
            codigo: 1,
            nombre: 'Casa matriz',
            direccion: '6a avenida 12-30, zona 1',
            municipio: 'Guatemala',
            departamento: 'Guatemala',
            activo: true,
            por_defecto: true,
            version: 1,
            created_at: INSTALADA_EN,
            updated_at: INSTALADA_EN,
        },
        {
            id: 2,
            empresa_id: 1,
            codigo: 2,
            nombre: 'Sucursal Mixco',
            direccion: 'Calzada San Juan 10-20, zona 1',
            municipio: 'Mixco',
            departamento: 'Guatemala',
            activo: true,
            por_defecto: false,
            version: 1,
            created_at: INSTALADA_EN,
            updated_at: INSTALADA_EN,
        },
        {
            id: 3,
            empresa_id: 2,
            codigo: 1,
            nombre: 'Fibra del Sur',
            direccion: 'Calzada Aguilar Batres 35-12, zona 12',
            municipio: 'Villa Nueva',
            departamento: 'Guatemala',
            activo: true,
            por_defecto: true,
            version: 1,
            created_at: INSTALADA_EN,
            updated_at: INSTALADA_EN,
        },
    ]
}

/** Una frase manual de la empresa 1 (exportaciones), como `POST /fiscal/frases`. */
export function frasesIniciales(): Schema<'FraseFiscal'>[] {
    return [
        {
            id: 1,
            empresa_id: 1,
            clave: 'manual:4-1',
            tipo_frase: 4,
            escenario: 1,
            texto: 'Exenta de IVA (art. 7 Ley IVA)',
            tipos_dte: ['FACT'],
            origen: 'manual',
            activa: true,
            vigente_desde: '2026-10-17',
            resolucion: null,
            confirmar_contador: false,
            fuente: null,
            motivo: 'Exportaciones de servicio',
            creado_por: 1,
            created_at: INSTALADA_EN,
        },
    ]
}

/** Frases del régimen de `l10n/gt/index.ts` (`FRASES_POR_REGIMEN_GT`): no se guardan, se derivan al leer. */
export const FRASES_REGIMEN: Record<Regimen, Pick<Schema<'FraseFiscal'>, 'clave' | 'tipo_frase' | 'escenario' | 'texto' | 'tipos_dte' | 'confirmar_contador' | 'fuente'>[]> = {
    utilidades: [{
        clave: 'isr_pagos_trimestrales',
        tipo_frase: 1,
        escenario: 1,
        texto: 'Sujeto a pagos trimestrales ISR',
        tipos_dte: ['FACT', 'NCRE', 'NDEB'],
        confirmar_contador: false,
        fuente: 'inv. C.2 (LAT, art. 42.1; Reglas y Validaciones v1.7.3)',
    }],
    opcional_simplificado: [{
        clave: 'isr_retencion_definitiva',
        tipo_frase: 1,
        escenario: 2,
        texto: 'Sujeto a retención definitiva ISR',
        tipos_dte: ['FACT', 'NCRE', 'NDEB'],
        confirmar_contador: false,
        fuente: 'inv. C.2 (LAT, art. 49; Reglas y Validaciones v1.7.3)',
    }],
    pequeno_contribuyente: [{
        clave: 'pc_sin_credito_fiscal',
        tipo_frase: null,
        escenario: null,
        texto: 'No genera derecho a crédito fiscal',
        tipos_dte: ['FPEQ'],
        confirmar_contador: true,
        fuente: 'inv. C.2 (Ley IVA, art. 49; matriz de frases de 2018); NO VERIFICADO 6',
    }],
}

/** Tipos de DTE del paquete GT (`TIPOS_DTE_GT`). */
export const TIPOS_DTE_GT = ['FACT', 'FCAM', 'FPEQ', 'FCAP', 'NCRE', 'NDEB'] as const

/** `tipos_dte` de `GET /fiscal/empresas/:id/localizacion` (capturado de la API con `gt-2026.1`). */
export const CATALOGO_DTE_GT: Schema<'LocalizacionEmpresa'>['tipos_dte'] = [
    { codigo: 'FACT', nombre: 'Factura', regimenes: ['utilidades', 'opcional_simplificado'], fuente: 'inv. C.1' },
    { codigo: 'FCAM', nombre: 'Factura cambiaria', regimenes: ['utilidades', 'opcional_simplificado'], fuente: 'inv. C.1' },
    { codigo: 'FPEQ', nombre: 'Factura de pequeño contribuyente', regimenes: ['pequeno_contribuyente'], fuente: 'inv. C.1 (Ley IVA, art. 29 b)' },
    { codigo: 'FCAP', nombre: 'Factura cambiaria de pequeño contribuyente', regimenes: ['pequeno_contribuyente'], fuente: 'inv. C.1' },
    { codigo: 'NCRE', nombre: 'Nota de crédito', regimenes: ['utilidades', 'opcional_simplificado'], fuente: 'inv. C.1 (Ley IVA, art. 29 d)' },
    { codigo: 'NDEB', nombre: 'Nota de débito', regimenes: ['utilidades', 'opcional_simplificado'], fuente: 'inv. C.1 (Ley IVA, art. 29 c)' },
]

export interface FiscalFixtures {
    instalaciones: Record<number, InstalacionFiscal[]>
    valores: ValorParametro[]
    impuestos: Schema<'ImpuestoFiscal'>[]
    establecimientos: Schema<'EstablecimientoFiscal'>[]
    frases: Schema<'FraseFiscal'>[]
}

export function fiscalInicial(): FiscalFixtures {
    return {
        instalaciones: instalacionesIniciales(),
        valores: valoresIniciales(),
        impuestos: impuestosIniciales(),
        establecimientos: establecimientosIniciales(),
        frases: frasesIniciales(),
    }
}
