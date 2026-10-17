import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import { frasesVigentes } from '#fiscal/frases'
import { valorParametro } from '#fiscal/parametros'
import { datosFiscalesEmpresas } from '#fiscal/instalador_localizacion'
import type {
    DteCertificado,
    DteParaEnviar,
    LineaDte,
    ReceptorDte,
    ReferenciaDte,
    TipoDte,
} from '#fiscal/fel/proveedor'

/**
 * `fiscal.dte`: la certificación de un documento (contrato §3.6 y §8.2). La factura es dinero; el
 * DTE es su certificación, con su propio ciclo y reintentos:
 *
 * ```
 * pendiente → enviando → certificado → anulacion_pendiente → anulado
 *               ↘ error_temporal → (reintento) enviando
 *               ↘ rechazado (definitivo)
 * pendiente → contingencia → enviando → certificado
 * ```
 *
 * `enviando` no se ve fuera de la transacción de `fel.certificar_dte` (la fila queda bloqueada
 * mientras se habla con el certificador); el intento queda en `fiscal.dte_intentos` antes de
 * enviar, así un reintento tras una caída consulta primero por `identificador` y no duplica.
 */

export type DocumentoTipo = 'factura' | 'nota_credito' | 'nota_debito'
export type EstadoDte =
    | 'pendiente'
    | 'enviando'
    | 'certificado'
    | 'error_temporal'
    | 'rechazado'
    | 'contingencia'
    | 'anulacion_pendiente'
    | 'anulado'

/** DTE que siguen vivos (cuentan como "el" DTE del documento). */
export const ESTADOS_VIGENTES: readonly EstadoDte[] = [
    'pendiente',
    'enviando',
    'certificado',
    'error_temporal',
    'contingencia',
    'anulacion_pendiente',
    'anulado',
]

/** Errores locales (sin enviar) que no son un rechazo de la SAT. */
export const ERROR_RECEPTOR = 'receptor_requerido'
export const ERROR_AVISO_SIN_CUBRIR = 'aviso_sin_cubrir'
export const ERROR_DOCUMENTO_ANULADO = 'documento_anulado'

/** Reintentos: 1, 5, 15 y 60 minutos y luego cada hora, hasta `TOPE_REINTENTOS` (contrato §8.3). */
export const ESPERAS_MIN = [1, 5, 15, 60] as const
export const TOPE_REINTENTOS = 30

export function esperaReintento(intentos: number): number {
    return ESPERAS_MIN[Math.min(Math.max(intentos, 1), ESPERAS_MIN.length) - 1] ?? 60
}

export interface DteFila {
    id: number
    empresa_id: number
    establecimiento_id: number | null
    documento_tipo: DocumentoTipo
    documento_id: number
    tipo_dte: TipoDte
    estado: EstadoDte
    proveedor: string
    ambiente: 'pruebas' | 'produccion'
    identificador: string
    autorizacion: string | null
    serie: string | null
    numero: string | null
    fecha_emision: Date
    certificado_en: Date | null
    receptor: ReceptorDte
    referencia: ReferenciaDte | null
    total: string
    iva: string
    contingencia: boolean
    intentos: number
    proximo_intento: Date | null
    ultimo_error: string | null
    definitivo: boolean
    solicitud: 'automatico' | 'manual'
    anulado_en: Date | null
    motivo_anulacion: string | null
    version: number
    created_at: Date
    updated_at: Date
}

const COLUMNAS = [
    'id',
    'empresa_id',
    'establecimiento_id',
    'documento_tipo',
    'documento_id',
    'tipo_dte',
    'estado',
    'proveedor',
    'ambiente',
    'identificador',
    'autorizacion',
    'serie',
    'numero',
    'fecha_emision',
    'certificado_en',
    'receptor',
    'referencia',
    'total',
    'iva',
    'contingencia',
    'intentos',
    'proximo_intento',
    'ultimo_error',
    'definitivo',
    'solicitud',
    'anulado_en',
    'motivo_anulacion',
    'version',
    'created_at',
    'updated_at',
]

function normalizar(f: DteFila): DteFila {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        establecimiento_id: f.establecimiento_id === null ? null : Number(f.establecimiento_id),
        documento_id: Number(f.documento_id),
    }
}

export async function verDte(id: number, cliente: QueryClientContract = db.connection()): Promise<DteFila> {
    const fila = (await cliente.from('fiscal.dte').where('id', id).select(COLUMNAS).first()) as DteFila | null
    if (!fila) throw new NoEncontrado(`El DTE ${id} no existe`)
    return normalizar(fila)
}

/** El DTE vigente (no rechazado) del documento, o null. */
export async function dteVigente(
    cliente: QueryClientContract,
    documentoTipo: DocumentoTipo,
    documentoId: number,
    bloquear = false,
): Promise<DteFila | null> {
    const consulta = cliente
        .from('fiscal.dte')
        .where('documento_tipo', documentoTipo)
        .where('documento_id', documentoId)
        .whereNot('estado', 'rechazado')
        .select(COLUMNAS)
    if (bloquear) consulta.forUpdate()
    const fila = (await consulta.first()) as DteFila | null
    return fila ? normalizar(fila) : null
}

/** El DTE más reciente del documento (también rechazado). */
export async function ultimoDte(
    cliente: QueryClientContract,
    documentoTipo: DocumentoTipo,
    documentoId: number,
): Promise<DteFila | null> {
    const fila = (await cliente
        .from('fiscal.dte')
        .where('documento_tipo', documentoTipo)
        .where('documento_id', documentoId)
        .orderBy('id', 'desc')
        .select(COLUMNAS)
        .first()) as DteFila | null
    return fila ? normalizar(fila) : null
}

export interface FiltrosDte extends OpcionesPaginacion {
    estado?: EstadoDte
    documento_tipo?: DocumentoTipo
    documento_id?: number
}

export async function listarDte(filtros: FiltrosDte, empresas: number[] | null) {
    const consulta = db
        .from('fiscal.dte as d')
        .select(COLUMNAS.map((c) => `d.${c}`))
        .if(filtros.estado, (q) => q.where('d.estado', filtros.estado!))
        .if(filtros.documento_tipo, (q) => q.where('d.documento_tipo', filtros.documento_tipo!))
        .if(filtros.documento_id, (q) => q.where('d.documento_id', filtros.documento_id!))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('d.empresa_id', ids))
    const pagina = await paginar<DteFila>(consulta, filtros, { columna: 'd.id' })
    return { ...pagina, data: pagina.data.map(normalizar) }
}

export async function xmlDeDte(id: number): Promise<{ empresa_id: number; xml: string | null }> {
    const fila = (await db.from('fiscal.dte').where('id', id).select('empresa_id', 'xml').first()) as {
        empresa_id: number
        xml: string | null
    } | null
    if (!fila) throw new NoEncontrado(`El DTE ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id), xml: fila.xml }
}

export async function pdfDeDte(id: number): Promise<{ empresa_id: number; pdf: string | null }> {
    const fila = (await db.from('fiscal.dte').where('id', id).select('empresa_id', 'pdf').first()) as {
        empresa_id: number
        pdf: string | null
    } | null
    if (!fila) throw new NoEncontrado(`El DTE ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id), pdf: fila.pdf }
}

/** Bitácora ante el certificador (sin credenciales). */
export async function registrarIntento(
    cliente: QueryClientContract,
    dteId: number,
    operacion: 'certificar' | 'anular' | 'consultar' | 'validar',
    resultado: string,
    respuesta: Record<string, unknown>,
    duracionMs = 0,
): Promise<void> {
    await cliente
        .insertQuery()
        .table('fiscal.dte_intentos')
        .insert({
            dte_id: dteId,
            operacion,
            resultado,
            respuesta: JSON.stringify(respuesta),
            duracion_ms: Math.max(0, Math.round(duracionMs)),
        })
}

/** ¿Hubo un envío al certificador (aunque el proceso cayera antes de guardar su respuesta)? */
export async function huboEnvio(
    cliente: QueryClientContract,
    dteId: number,
    operacion: string,
): Promise<boolean> {
    const fila = await cliente
        .from('fiscal.dte_intentos')
        .where('dte_id', dteId)
        .where('operacion', operacion)
        .first()
    return Boolean(fila)
}

/*
|--------------------------------------------------------------------------
| Receptor y tipo de DTE
|--------------------------------------------------------------------------
*/

export interface ReceptorFiscal {
    tipo_documento_fiscal?: 'nit' | 'cui' | 'pasaporte' | 'cf'
    nit_cui?: string | null
    nombre_fiscal?: string | null
    direccion_fiscal?: string | null
}

/** Receptor de la factura: el dato fiscal del cliente o el corregido al sustituir. */
export async function receptorDe(
    cliente: QueryClientContract,
    clienteId: number,
    corregido?: ReceptorFiscal | null,
): Promise<ReceptorDte> {
    const c = (await cliente
        .from('core.clientes')
        .where('id', clienteId)
        .select(
            'nombre',
            'nit_cui',
            'nombre_fiscal',
            'direccion_fiscal',
            'email',
            'tipo_documento_fiscal',
            'nit_cui_invalido',
        )
        .firstOrFail()) as {
        nombre: string
        nit_cui: string | null
        nombre_fiscal: string | null
        direccion_fiscal: string | null
        email: string | null
        tipo_documento_fiscal: ReceptorDte['tipo']
        nit_cui_invalido: boolean
    }
    const tipo = corregido?.tipo_documento_fiscal ?? (c.nit_cui_invalido ? 'cf' : c.tipo_documento_fiscal)
    const id =
        tipo === 'cf' ? 'CF' : (corregido?.nit_cui ?? c.nit_cui ?? '').replace(/[\s-]/g, '').toUpperCase()
    return {
        tipo,
        id: id || 'CF',
        nombre:
            tipo === 'cf' ? 'Consumidor Final' : (corregido?.nombre_fiscal ?? c.nombre_fiscal ?? c.nombre),
        direccion: corregido?.direccion_fiscal ?? c.direccion_fiscal,
        correo: c.email,
    }
}

/**
 * Consumidor final (contrato §8.3, inv. C.2): total menor que `consumidor_final_limite` admite CF;
 * desde el límite exige NIT, CUI o pasaporte. Devuelve true si el receptor no sirve.
 */
export async function receptorFaltante(
    empresaId: number,
    receptor: ReceptorDte,
    total: string,
    fecha: string,
    cliente?: QueryClientContract,
): Promise<boolean> {
    if (receptor.tipo !== 'cf') return false
    const limite = await valorParametro<string>(empresaId, 'consumidor_final_limite', fecha, cliente)
    return dec(total).gte(dec(limite))
}

/** Régimen vigente → tipo de DTE de una factura (FACT o FPEQ). */
export async function tipoFacturaDte(
    empresaId: number,
    fecha: string,
    cliente?: QueryClientContract,
): Promise<TipoDte> {
    const regimen = await valorParametro<string>(empresaId, 'regimen', fecha, cliente).catch(() => null)
    return regimen === 'pequeno_contribuyente' ? 'FPEQ' : 'FACT'
}

export function fechaGt(instante: Date): string {
    return DateTime.fromJSDate(instante).setZone(ZONA_NEGOCIO).toISODate()!
}

/**
 * Plazo de anulación de un DTE (`dte_anulacion_plazo`, regla `mes_emision_hasta_vencimiento_iva`;
 * contrato §8.3, inv. C.3): hasta el vencimiento de la declaración mensual del IVA del mes de
 * emisión, que tomamos como el último día del mes siguiente. **Confirmar con contador**: días
 * hábiles y feriados (fase 6, calendario).
 */
export function finPlazoAnulacion(fechaEmision: Date): string {
    return DateTime.fromJSDate(fechaEmision)
        .setZone(ZONA_NEGOCIO)
        .plus({ months: 1 })
        .endOf('month')
        .toISODate()!
}

/** ¿`fecha` (YYYY-MM-DD) cae dentro de la ventana de notas (`nota_ventana_meses`) desde `origen`? */
export function dentroDeVentana(origen: Date, fecha: string, meses: number): boolean {
    const limite = DateTime.fromJSDate(origen).setZone(ZONA_NEGOCIO).plus({ months: meses }).toISODate()!
    return fecha <= limite
}

/*
|--------------------------------------------------------------------------
| Alta del DTE
|--------------------------------------------------------------------------
*/

export interface DatosNuevoDte {
    empresa_id: number
    documento_tipo: DocumentoTipo
    documento_id: number
    tipo_dte: TipoDte
    proveedor: string
    ambiente: 'pruebas' | 'produccion'
    receptor: ReceptorDte
    referencia?: ReferenciaDte | null
    total: string
    iva: string
    estado?: EstadoDte
    contingencia?: boolean
    ultimo_error?: string | null
    definitivo?: boolean
    solicitud?: 'automatico' | 'manual'
}

export async function insertarDte(trx: TransactionClientContract, datos: DatosNuevoDte): Promise<DteFila> {
    const establecimiento = (await trx
        .from('fiscal.establecimientos')
        .where('empresa_id', datos.empresa_id)
        .where('activo', true)
        .orderBy([
            { column: 'por_defecto', order: 'desc' },
            { column: 'id', order: 'asc' },
        ])
        .select('id')
        .first()) as { id: number } | null
    const [fila] = (await trx
        .insertQuery()
        .table('fiscal.dte')
        .insert({
            empresa_id: datos.empresa_id,
            establecimiento_id: establecimiento?.id ?? null,
            documento_tipo: datos.documento_tipo,
            documento_id: datos.documento_id,
            tipo_dte: datos.tipo_dte,
            estado: datos.estado ?? 'pendiente',
            proveedor: datos.proveedor,
            ambiente: datos.ambiente,
            identificador: randomUUID(),
            receptor: JSON.stringify(datos.receptor),
            referencia: datos.referencia ? JSON.stringify(datos.referencia) : null,
            total: datos.total,
            iva: datos.iva,
            contingencia: datos.contingencia ?? false,
            ultimo_error: datos.ultimo_error ?? null,
            definitivo: datos.definitivo ?? false,
            solicitud: datos.solicitud ?? 'automatico',
            proximo_intento: trx.knexRawQuery('now()'),
        })
        .returning('id')) as Array<{ id: number }>
    return verDte(fila!.id, trx)
}

/*
|--------------------------------------------------------------------------
| DTE para enviar
|--------------------------------------------------------------------------
*/

interface LineaDocumento {
    concepto: string
    tipo: string
    cantidad: string
    precio_unitario: string
    gravable: boolean
    iva: string
    total: string
}

function lineaDte(numero: number, l: LineaDocumento): LineaDte {
    const total = dec(l.total)
    const iva = dec(l.iva)
    return {
        numero,
        bien_o_servicio: l.tipo === 'producto' ? 'B' : 'S',
        descripcion: l.concepto,
        cantidad: dec(l.cantidad).toString(),
        unidad: 'UNI',
        precio_unitario: aTexto(dec(l.precio_unitario)),
        precio: aTexto(total),
        descuento: '0.00',
        gravable: aTexto(total.minus(iva)),
        iva: aTexto(iva),
        total: aTexto(total),
    }
}

/** Líneas de una nota: las suyas (nota por línea) o una sola por el monto. */
async function lineasNota(
    cliente: QueryClientContract,
    notaId: number,
): Promise<{ lineas: LineaDocumento[]; factura_id: number; motivo: string }> {
    const nota = (await cliente
        .from('billing.notas_credito')
        .where('id', notaId)
        .select('factura_id', 'monto', 'iva', 'motivo')
        .firstOrFail()) as { factura_id: number; monto: string; iva: string; motivo: string }
    const porLinea = (await cliente
        .from('billing.notas_credito_lineas as nl')
        .join('billing.facturas_lineas as l', 'l.id', 'nl.linea_id')
        .where('nl.nota_id', notaId)
        .orderBy('nl.id')
        .select('l.concepto', 'l.tipo', 'nl.monto', 'nl.iva')) as Array<{
        concepto: string
        tipo: string
        monto: string
        iva: string
    }>
    const lineas = porLinea.length
        ? porLinea.map((l) => ({
              concepto: `Crédito: ${l.concepto}`,
              tipo: l.tipo,
              cantidad: '1',
              precio_unitario: l.monto,
              gravable: dec(l.iva).gt(0),
              iva: l.iva,
              total: l.monto,
          }))
        : [
              {
                  concepto: `Nota de crédito: ${nota.motivo}`,
                  tipo: 'servicio',
                  cantidad: '1',
                  precio_unitario: nota.monto,
                  gravable: dec(nota.iva).gt(0),
                  iva: nota.iva,
                  total: nota.monto,
              },
          ]
    return { lineas, factura_id: Number(nota.factura_id), motivo: nota.motivo }
}

/** Arma el DTE neutral para el certificador (contrato §8.1). */
export async function dteParaEnviar(cliente: QueryClientContract, dte: DteFila): Promise<DteParaEnviar> {
    const fecha = fechaGt(dte.fecha_emision)
    const empresa = (await cliente
        .from('core.empresas')
        .where('id', dte.empresa_id)
        .select(
            'nit',
            'razon_social',
            'nombre_comercial',
            'direccion_fiscal',
            'municipio',
            'departamento',
            'correo',
        )
        .firstOrFail()) as Record<string, string | null>
    const establecimiento = dte.establecimiento_id
        ? ((await cliente
              .from('fiscal.establecimientos')
              .where('id', dte.establecimiento_id)
              .select('codigo', 'nombre', 'direccion', 'municipio', 'departamento')
              .first()) as Record<string, string | number | null> | null)
        : null
    const fiscales = await datosFiscalesEmpresas([dte.empresa_id], cliente).then((r) => r.get(dte.empresa_id))

    let lineas: LineaDocumento[]
    if (dte.documento_tipo === 'nota_credito') {
        lineas = await lineasNota(cliente, dte.documento_id).then((r) => r.lineas)
    } else {
        lineas = (await cliente
            .from('billing.facturas_lineas')
            .where('factura_id', dte.documento_id)
            .orderBy('id')
            .select(
                'concepto',
                'tipo',
                cliente.raw('cantidad::text as cantidad'),
                'precio_unitario',
                'gravable',
                'iva',
                'total',
            )) as LineaDocumento[]
    }
    const vigentes = await frasesVigentes(dte.empresa_id, fecha, cliente)
    const frases = vigentes
        .filter((f) => f.tipos_dte.includes(dte.tipo_dte) && f.tipo_frase !== null && f.escenario !== null)
        .map((f) => ({ tipo: Number(f.tipo_frase), escenario: Number(f.escenario) }))
    const totalIva = lineas.reduce((s: Dec, l) => s.plus(dec(l.iva)), CERO)
    return {
        identificador: dte.identificador,
        tipo: dte.tipo_dte,
        fecha_emision: DateTime.fromJSDate(dte.fecha_emision)
            .setZone(ZONA_NEGOCIO)
            .toISO({ suppressMilliseconds: true })!,
        moneda: 'GTQ',
        emisor: {
            nit: String(empresa.nit ?? '')
                .replace(/[\s-]/g, '')
                .toUpperCase(),
            nombre: String(empresa.razon_social ?? empresa.nombre_comercial ?? ''),
            nombre_comercial: String(establecimiento?.nombre ?? empresa.nombre_comercial ?? ''),
            establecimiento: Number(establecimiento?.codigo ?? fiscales?.codigo_establecimiento ?? 1),
            direccion: String(establecimiento?.direccion ?? empresa.direccion_fiscal ?? 'Ciudad'),
            municipio: String(establecimiento?.municipio ?? empresa.municipio ?? 'Guatemala'),
            departamento: String(establecimiento?.departamento ?? empresa.departamento ?? 'Guatemala'),
            codigo_postal: '01001',
            correo: empresa.correo ?? null,
            afiliacion_iva: dte.tipo_dte === 'FPEQ' || dte.tipo_dte === 'FCAP' ? 'PEQ' : 'GEN',
        },
        receptor: dte.receptor,
        frases,
        lineas: lineas.map((l, i) => lineaDte(i + 1, l)),
        total: aTexto(redondear(dte.total)),
        iva: aTexto(totalIva),
        referencia: dte.referencia,
        contingencia: dte.contingencia,
    }
}

export function dteCertificado(dte: DteFila): DteCertificado {
    return {
        identificador: dte.identificador,
        autorizacion: dte.autorizacion ?? '',
        serie: dte.serie,
        numero: dte.numero,
        fecha_emision: DateTime.fromJSDate(dte.certificado_en ?? dte.fecha_emision)
            .setZone(ZONA_NEGOCIO)
            .toISO({ suppressMilliseconds: true })!,
        emisor_nit: '',
        receptor_id: dte.receptor.id,
    }
}

/** NIT del emisor de la empresa (para la anulación). */
export async function nitEmisor(cliente: QueryClientContract, empresaId: number): Promise<string> {
    const fila = (await cliente.from('core.empresas').where('id', empresaId).select('nit').firstOrFail()) as {
        nit: string
    }
    return String(fila.nit ?? '')
        .replace(/[\s-]/g, '')
        .toUpperCase()
}

/** Referencia de una NCRE o NDEB al DTE certificado de su factura de origen. */
export function referenciaA(origen: DteFila, motivo: string): ReferenciaDte {
    return {
        autorizacion: origen.autorizacion ?? '',
        serie: origen.serie,
        numero: origen.numero,
        fecha: fechaGt(origen.certificado_en ?? origen.fecha_emision),
        motivo,
    }
}

export { lineasNota }
