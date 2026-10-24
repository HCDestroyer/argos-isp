import type { DefinicionFrase, DefinicionTipoDte, PaqueteLocalizacion } from '#fiscal/localizacion'
import {
    CUENTAS_PAQUETE_GT,
    CUENTAS_PAQUETE_GT_2026_2,
    CUENTAS_PAQUETE_GT_2026_3,
} from '#fiscal/l10n/gt/cuentas'
import { PARAMETROS_GT, REGIMENES_GT, type RegimenGt } from '#fiscal/l10n/gt/parametros'
import { CUADRICULAS_GT, IMPUESTOS_GT } from '#fiscal/l10n/gt/impuestos'

/**
 * Paquete de localización de Guatemala, versión `gt-2026.1` (contrato §2, §5 y §6).
 *
 * Una versión publicada no se edita: un cambio de ley es otra versión (`gt-2027.1`) que agrega
 * cuentas, parámetros o valores con su `vigente_desde`. El `checksum` se calcula del contenido
 * (`checksumPaquete` de `#fiscal/instalador`) para que una edición accidental de una versión ya
 * instalada se note.
 */

/**
 * Tipos de DTE por régimen (inv. C.1; contrato §6.2). Lista provisional: el catálogo completo de
 * «Reglas y Validaciones» v2.x y la diferencia NABN/NCRE quedan para el contador (§14 #6); NABN no
 * se emite hasta aclararla.
 */
export const TIPOS_DTE_GT: readonly DefinicionTipoDte[] = [
    {
        codigo: 'FACT',
        nombre: 'Factura',
        regimenes: ['utilidades', 'opcional_simplificado'],
        fuente: 'inv. C.1',
    },
    {
        codigo: 'FCAM',
        nombre: 'Factura cambiaria',
        regimenes: ['utilidades', 'opcional_simplificado'],
        fuente: 'inv. C.1',
    },
    {
        codigo: 'FPEQ',
        nombre: 'Factura de pequeño contribuyente',
        regimenes: ['pequeno_contribuyente'],
        fuente: 'inv. C.1 (Ley IVA, art. 29 b)',
    },
    {
        codigo: 'FCAP',
        nombre: 'Factura cambiaria de pequeño contribuyente',
        regimenes: ['pequeno_contribuyente'],
        fuente: 'inv. C.1',
    },
    {
        codigo: 'NCRE',
        nombre: 'Nota de crédito',
        regimenes: ['utilidades', 'opcional_simplificado'],
        fuente: 'inv. C.1 (Ley IVA, art. 29 d)',
    },
    {
        codigo: 'NDEB',
        nombre: 'Nota de débito',
        regimenes: ['utilidades', 'opcional_simplificado'],
        fuente: 'inv. C.1 (Ley IVA, art. 29 c)',
    },
]

/**
 * Frases que se derivan del régimen vigente en la fecha del documento (inv. C.2; contrato §6.2).
 * La de pequeño contribuyente no tiene código de frase verificado (matriz de 2018): queda sin
 * tipo ni escenario y con la marca «confirmar con contador».
 */
export const FRASES_POR_REGIMEN_GT: Readonly<Record<RegimenGt, readonly DefinicionFrase[]>> = {
    utilidades: [
        {
            clave: 'isr_pagos_trimestrales',
            tipo_frase: 1,
            escenario: 1,
            texto: 'Sujeto a pagos trimestrales ISR',
            tipos_dte: ['FACT', 'NCRE', 'NDEB'],
            fuente: 'inv. C.2 (LAT, art. 42.1; Reglas y Validaciones v1.7.3)',
            confirmar_contador: false,
        },
    ],
    opcional_simplificado: [
        {
            clave: 'isr_retencion_definitiva',
            tipo_frase: 1,
            escenario: 2,
            texto: 'Sujeto a retención definitiva ISR',
            tipos_dte: ['FACT', 'NCRE', 'NDEB'],
            fuente: 'inv. C.2 (LAT, art. 49; Reglas y Validaciones v1.7.3)',
            confirmar_contador: false,
        },
    ],
    pequeno_contribuyente: [
        {
            clave: 'pc_sin_credito_fiscal',
            tipo_frase: null,
            escenario: null,
            texto: 'No genera derecho a crédito fiscal',
            tipos_dte: ['FPEQ'],
            fuente: 'inv. C.2 (Ley IVA, art. 49; matriz de frases de 2018); NO VERIFICADO 6',
            confirmar_contador: true,
        },
    ],
}

/** `core.empresas.regimen_isr` (A1) → régimen del paquete (contrato §11.2). */
export const REGIMEN_DESDE_ISR: Readonly<Record<string, RegimenGt>> = {
    sujeto_pagos_trimestrales: 'utilidades',
    retencion_definitiva: 'opcional_simplificado',
    pequeno_contribuyente: 'pequeno_contribuyente',
}

export const PAQUETE_GT_2026_1: PaqueteLocalizacion = {
    codigo: 'gt-2026.1',
    pais: 'GT',
    version: '2026.1.0',
    publicada_en: '2026-10-17',
    cuentas: CUENTAS_PAQUETE_GT,
    parametros: PARAMETROS_GT,
    impuestos: IMPUESTOS_GT,
    cuadriculas: CUADRICULAS_GT,
    regimenes: REGIMENES_GT,
    frases_por_regimen: FRASES_POR_REGIMEN_GT,
    tipos_dte: TIPOS_DTE_GT,
    regimenInicial: (datos) => (datos.regimen_isr ? (REGIMEN_DESDE_ISR[datos.regimen_isr] ?? null) : null),
}

/**
 * `gt-2026.2` (fase 4): igual que 2026.1 más la cuenta `4.2.03 Recuperación de cuentas incobrables`
 * (decisión (g) del líder). Instalarla sobre 2026.1 solo agrega esa cuenta.
 */
export const PAQUETE_GT_2026_2: PaqueteLocalizacion = {
    ...PAQUETE_GT_2026_1,
    codigo: 'gt-2026.2',
    version: '2026.2.0',
    publicada_en: '2026-10-18',
    cuentas: CUENTAS_PAQUETE_GT_2026_2,
}

/**
 * `gt-2026.3` (inventario interno, `contratos/inventario.md` §3): igual que 2026.2 más `1.1.14
 * Inventarios`, `5.2.07`, `4.2.04` y el grupo `5.6 Costo de ventas` (`5.6.01`, `5.6.02`). Instalarla
 * sobre 2026.2 solo agrega esas cuentas.
 */
export const PAQUETE_GT_2026_3: PaqueteLocalizacion = {
    ...PAQUETE_GT_2026_2,
    codigo: 'gt-2026.3',
    version: '2026.3.0',
    publicada_en: '2026-10-24',
    cuentas: CUENTAS_PAQUETE_GT_2026_3,
}
