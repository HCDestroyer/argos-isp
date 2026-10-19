import type { Problem, Schema, paths } from '@argosisp/contracts'

/**
 * Etiquetas de la FEL (A3, fase 3; `contratos/localizacion-fiscal.md` §8 y §17). Todo lo que se
 * muestra sale de la API: aquí solo se traduce a texto legible, con color por urgencia, icono
 * por identidad y texto siempre (`docs/identidad.md`).
 */

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export type Dte = Schema<'Dte'>
export type EstadoDte = Dte['estado']
export type ConfiguracionFel = Schema<'ConfiguracionFel'>
export type CredencialesFel = Schema<'CredencialesFel'>
export type ModoFel = ConfiguracionFel['modo']
export type AmbienteFel = ConfiguracionFel['ambiente']
export type ProveedorFel = NonNullable<paths['/api/v1/fel/configuracion']['put']['requestBody']['content']['application/json']['proveedor']>

/** El código del catálogo es uno de los que acepta `PUT /fel/configuracion`. */
export function esProveedorFel(codigo: string | null | undefined): codigo is ProveedorFel {
    return codigo === 'infile' || codigo === 'falso'
}
export type CertificarAl = Schema<'PlantillaFacturacion'>['certificar_al']

export const ESTADOS_DTE: Record<EstadoDte, { etiqueta: string, color: BadgeColor, icono: string, ayuda: string }> = {
    pendiente: { etiqueta: 'Pendiente', color: 'info', icono: 'i-lucide-clock', ayuda: 'En cola: el worker lo envía al certificador.' },
    enviando: { etiqueta: 'Enviando', color: 'info', icono: 'i-lucide-send', ayuda: 'Se está enviando al certificador.' },
    certificado: { etiqueta: 'Certificado', color: 'success', icono: 'i-lucide-badge-check', ayuda: 'La SAT lo autorizó.' },
    error_temporal: { etiqueta: 'Error temporal', color: 'warning', icono: 'i-lucide-refresh-cw-off', ayuda: 'El certificador no respondió; se reintenta solo.' },
    rechazado: { etiqueta: 'Rechazado', color: 'error', icono: 'i-lucide-octagon-x', ayuda: 'Rechazo definitivo: corrige el dato y reintenta.' },
    contingencia: { etiqueta: 'En contingencia', color: 'warning', icono: 'i-lucide-cloud-off', ayuda: 'Emitido en contingencia; se transmite al levantarla.' },
    anulacion_pendiente: { etiqueta: 'Anulación pendiente', color: 'warning', icono: 'i-lucide-hourglass', ayuda: 'Se pidió la anulación; falta que el certificador la confirme.' },
    anulado: { etiqueta: 'Anulado', color: 'neutral', icono: 'i-lucide-ban', ayuda: 'La SAT confirmó la anulación.' },
}

/** `Factura.fel_estado` llega como texto libre (`string | null`): el estado conocido o `null`. */
export function estadoDteDe(valor: string | null | undefined): EstadoDte | null {
    return typeof valor === 'string' && valor in ESTADOS_DTE ? (valor as EstadoDte) : null
}

export const DOCUMENTOS_DTE: Record<Dte['documento_tipo'], string> = {
    factura: 'Factura',
    nota_credito: 'Nota de crédito',
    nota_debito: 'Nota de débito (mora)',
}

export const TIPOS_RECEPTOR: Record<Dte['receptor']['tipo'], string> = {
    nit: 'NIT',
    cui: 'CUI',
    pasaporte: 'Pasaporte',
    cf: 'Consumidor final',
}

export const MODOS_FEL: Record<ModoFel, { etiqueta: string, color: BadgeColor, icono: string, descripcion: string }> = {
    obligatoria: {
        etiqueta: 'Obligatoria',
        color: 'success',
        icono: 'i-lucide-shield-check',
        descripcion: 'Toda factura sale con DTE. Con «al emitir» nace por certificar y se emite al certificarse; con «al pagar» nace como aviso de cobro y se certifica al cubrirse.',
    },
    opcional: {
        etiqueta: 'Opcional',
        color: 'info',
        icono: 'i-lucide-shield-half',
        descripcion: 'Se certifica a mano desde la factura. Los avisos con «al pagar» se certifican al cubrirse.',
    },
    desactivada: {
        etiqueta: 'Desactivada',
        color: 'error',
        icono: 'i-lucide-shield-off',
        descripcion: 'Sin DTE: las facturas salen como aviso de cobro interno.',
    },
}

/** Aviso permanente con la FEL desactivada (contrato §8.3; fila 17 de §15: confirmar con contador). */
export const AVISO_FEL_DESACTIVADA = 'La FEL es obligatoria para el régimen general: sin ella las facturas no tienen validez fiscal. Actívala en Configuración → FEL.'

export const AMBIENTES_FEL: Record<AmbienteFel, string> = {
    pruebas: 'Pruebas',
    produccion: 'Producción',
}

export type ProveedorFelCatalogo = Schema<'ProveedorFelCatalogo'>

/** Nombre del certificador según `GET /fel/proveedores`; sin catálogo, su código. */
export function etiquetaProveedor(codigo: string | null | undefined, catalogo: readonly ProveedorFelCatalogo[] = []): string {
    if (!codigo) {
        return 'Sin proveedor'
    }
    return catalogo.find(p => p.codigo === codigo)?.nombre ?? codigo
}

/** Etiqueta legible de un campo de credenciales (`usuario_firma` → «Usuario firma»). */
export function etiquetaCampo(campo: string): string {
    const texto = campo.replace(/_/g, ' ')
    return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** Un campo de credenciales es secreto si la API no lo devuelve (`campos_visibles`). */
export function campoSecreto(proveedor: ProveedorFelCatalogo, campo: string): boolean {
    return !proveedor.campos_visibles.includes(campo)
}

export const CERTIFICAR_AL: Record<CertificarAl, { etiqueta: string, descripcion: string }> = {
    emitir: { etiqueta: 'Al emitir', descripcion: 'El DTE se pide al emitir la factura (en obligatoria nace por certificar).' },
    pagar: { etiqueta: 'Al pagar', descripcion: 'Aviso de cobro: su IVA queda por certificar hasta que el pago lo cubre.' },
    nunca: { etiqueta: 'Nunca', descripcion: 'Sin DTE. No se admite con la FEL obligatoria.' },
}

/** Acciones de un DTE según su estado (la API decide; esto solo evita ofrecer lo que responde 409). */
export function dteReintentable(dte: Pick<Dte, 'estado'>): boolean {
    return dte.estado === 'rechazado' || dte.estado === 'error_temporal'
}

/** El XML existe cuando la SAT lo certificó (también después de anular). */
export function dteConXml(dte: Pick<Dte, 'estado' | 'autorizacion'>): boolean {
    return dte.autorizacion !== null && ['certificado', 'anulacion_pendiente', 'anulado'].includes(dte.estado)
}

/** Serie y número del DTE (`A1B2C3D4 · 3197816679`), o `null` sin autorización. */
export function serieNumeroDte(dte: Pick<Dte, 'serie' | 'numero'>): string | null {
    if (!dte.serie && !dte.numero) {
        return null
    }
    return `${dte.serie ?? '—'} · ${dte.numero ?? '—'}`
}

const TITULOS_FEL: Record<string, string> = {
    fel_no_configurada: 'La FEL no está configurada',
    fel_proveedor_no_disponible: 'El certificador no responde',
    receptor_requerido: 'El cliente necesita NIT, CUI o pasaporte',
    certificar_al_incompatible: 'Hay servicios que no se certifican nunca',
    avisos_por_certificar: 'Hay avisos de cobro sin certificar',
    dte_en_proceso: 'El DTE está en proceso',
    dte_no_reintentable: 'Este DTE no se puede reintentar',
    anulacion_en_proceso: 'La anulación ya está en proceso',
    anulacion_fuera_de_plazo: 'Venció el plazo para anular el DTE',
    nota_fuera_de_plazo: 'La factura ya no admite notas',
    nota_requiere_ncre: 'Esta nota necesita NCRE',
    nota_por_linea_no_disponible: 'Esta factura no admite nota por línea',
    nota_anulada: 'La nota ya está anulada',
    ncre_certificada: 'La NCRE ya está certificada',
    nota_sin_ncre_rechazada: 'La NCRE de esta nota no fue rechazada',
    tipo_dte_no_permitido: 'Ese DTE no corresponde al régimen',
    factura_anulada: 'La factura está anulada',
    factura_castigada: 'La factura está castigada',
    factura_acreditada: 'La factura está acreditada: no es una venta',
    factura_con_ndeb: 'Primero anula la mora (NDEB)',
    factura_con_pagos: 'La factura tiene pagos',
    factura_sin_saldo: 'La factura no tiene saldo',
    sustitucion_no_permitida: 'No se puede sustituir esta factura',
    contingencia_sin_cambio: 'La contingencia ya estaba así',
    conflicto_version: 'Otra persona cambió la configuración',
    ncre_sin_certificar: 'Hay notas de crédito sin certificar',
    integridad_rota: 'La cadena del libro no verifica',
}

/** Qué hacer, cuando el `detail` de la API no lo dice. */
const SUGERENCIAS_FEL: Record<string, string> = {
    receptor_requerido: 'Corrige los datos fiscales del cliente y vuelve a intentar.',
    anulacion_fuera_de_plazo: 'Emite una nota de crédito por el saldo.',
    nota_requiere_ncre: 'El documento ya tiene DTE certificado: la nota solo puede salir como NCRE. Activa la FEL de la empresa para emitirla.',
    certificar_al_incompatible: 'Cambia el momento de certificar de esas plantillas o excepciones a «al emitir» o «al pagar».',
    ncre_sin_certificar: 'Certifica las NCRE pendientes o anula las rechazadas antes de cerrar el mes.',
    integridad_rota: 'Revisa la integridad del libro: nadie debe cerrar un mes con la cadena rota.',
    conflicto_version: 'Recarga la configuración y vuelve a guardar.',
    factura_acreditada: 'Se cubrió entera con notas de crédito internas sin ningún cobro: no se certifica.',
}

/**
 * Problema RFC 9457 con título legible para la FEL. El `detail` de la API se conserva (trae el
 * estado real del DTE, la cuenta de avisos o el plazo); solo se agrega qué hacer.
 */
export function problemaFelLegible(problema: Problem): Problem {
    const codigo = codigoProblema(problema)
    const titulo = codigo ? TITULOS_FEL[codigo] : undefined
    if (!codigo || !titulo) {
        return problema
    }
    const sugerencia = SUGERENCIAS_FEL[codigo]
    const detalle = sugerencia && !(problema.detail ?? '').includes(sugerencia) ? `${problema.detail ?? ''} ${sugerencia}`.trim() : problema.detail
    return { ...problema, title: titulo, ...(detalle ? { detail: detalle } : {}) }
}

/**
 * Las NCRE de un 409 `ncre_sin_certificar` (A3): `errors[] { field: 'nota_id', message: <estado>,
 * rule: <dte_id> }` más `nota_id` como dato extra (fuera del esquema `Problem`, se lee con cuidado).
 */
export function ncreDeProblema(problema: Problem | null): { notaId: number | null, dteId: number, estado: EstadoDte | null }[] {
    return (problema?.errors ?? [])
        .filter(e => e.field === 'nota_id')
        .map((e) => {
            const extra: unknown = 'nota_id' in e ? e.nota_id : null
            return {
                notaId: typeof extra === 'number' ? extra : null,
                dteId: Number(e.rule),
                estado: estadoDteDe(e.message),
            }
        })
        .filter(n => Number.isInteger(n.dteId) && n.dteId > 0)
}

/** La cuenta de un 422 `avisos_por_certificar` (`errors[0].message` = `6 avisos por certificar`), o `null`. */
export function avisosPorCertificar(problema: Problem): number | null {
    if (codigoProblema(problema) !== 'avisos_por_certificar') {
        return null
    }
    const texto = problema.errors?.find(e => e.rule === 'avisos_por_certificar')?.message ?? problema.detail ?? ''
    const cuenta = Number(/(\d+)\s+avisos/.exec(texto)?.[1])
    return Number.isInteger(cuenta) ? cuenta : null
}
