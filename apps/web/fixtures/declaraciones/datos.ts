import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import { huellaFixture } from '../libros/datos'

/**
 * Declaraciones de IVA y de pequeño contribuyente (A3, fase 7 PR B; contrato fiscal §21 PR B). Lo que
 * la API lee de los libros (ventas, compras y constancias de retención del mes) vive aquí como
 * `DatosMes`; `calcularTotales` es `calcularDatos` de `#fiscal/declaraciones` con los mismos nombres de
 * totales y remanentes del mes anterior. `datos_hash` = huella de renglones, totales, parámetros y la
 * declaración anterior: si los datos del mes cambian (`cambiarDatosDeclaracionFixture`), la versión
 * queda `desactualizada`.
 *
 * ArgosNet (1, IVA SAT-2237): julio revisada, presentada y pagada a tiempo; agosto v1 sustituida y v2
 * sustitutiva presentada el 02/10 (venció el 30/09) y sin pagar, así su pago lleva mora y multa;
 * septiembre y octubre sin calcular. Fibra del Sur (2, pequeño contribuyente SAT-2046, 5 %): agosto
 * presentada y pagada; septiembre sin calcular.
 */

export type Declaracion = Schema<'Declaracion'>
type Renglon = Schema<'RenglonDeclaracion'>
type ImpuestoDeclarable = 'iva_mensual' | 'pc_mensual'

/** Lo que la API leería hoy de los libros de un mes. */
export interface DatosMes {
    empresa_id: number
    /** AAAA-MM */
    periodo: string
    renglones: Renglon[]
}

function venta(documento: string, fecha: string, base: string, iva: string, tipo = 'FACT', nit: string | null = 'CF'): Renglon {
    return { seccion: 'ventas', origen: 'dte', documento, fecha, tipo, nit, base, iva, total: new Decimal(base).plus(iva).toFixed(2), estado: 'certificado' }
}

function compra(id: number, documento: string, fecha: string, base: string, iva: string, nit: string): Renglon {
    return { seccion: 'compras', origen: 'compra', documento: `Compra ${id} · ${documento}`, fecha, tipo: 'FACT', nit, base, iva, total: new Decimal(base).plus(iva).toFixed(2), estado: 'registro' }
}

function retencion(documento: string, fecha: string, base: string, retenido: string, nit: string): Renglon {
    return { seccion: 'retenciones', origen: 'constancia', documento, fecha, tipo: 'RET_IVA', nit, base, iva: retenido, total: retenido, estado: null }
}

export function datosIniciales(): DatosMes[] {
    return [
        {
            empresa_id: 1,
            periodo: '2026-07',
            renglones: [
                venta('FACT A-1001', '2026-07-05', '8500.00', '1020.00', 'FACT', '4512378-9'),
                venta('FACT A-1002', '2026-07-20', '4200.00', '504.00'),
                compra(3, 'FACT B-551', '2026-07-12', '2500.00', '300.00', '3321456-1'),
                retencion('Constancia R-118', '2026-07-28', '1000.00', '18.00', '4512378-9'),
            ],
        },
        {
            empresa_id: 1,
            periodo: '2026-08',
            renglones: [
                venta('FACT A-1050', '2026-08-04', '6000.00', '720.00', 'FACT', '4512378-9'),
                venta('FACT A-1051', '2026-08-18', '4500.00', '540.00'),
                compra(7, 'FACT C-90', '2026-08-10', '4000.00', '480.00', '3321456-1'),
                retencion('Constancia R-131', '2026-08-29', '1500.00', '25.00', '4512378-9'),
            ],
        },
        {
            empresa_id: 1,
            periodo: '2026-09',
            renglones: [
                venta('FACT A-1101', '2026-09-03', '7200.00', '864.00', 'FACT', '4512378-9'),
                venta('FACT A-1102', '2026-09-17', '4000.00', '480.00'),
                { ...venta('NCRE A-12', '2026-09-22', '-500.00', '-60.00', 'NCRE'), origen: 'dte' },
                compra(9, 'FACT B-602', '2026-09-08', '6000.00', '720.00', '3321456-1'),
                retencion('Constancia R-140', '2026-09-30', '2000.00', '30.00', '4512378-9'),
            ],
        },
        {
            empresa_id: 1,
            periodo: '2026-10',
            renglones: [
                venta('FACT A-1150', '2026-10-02', '3000.00', '360.00'),
            ],
        },
        { empresa_id: 2, periodo: '2026-08', renglones: [venta('FPEQ S-301', '2026-08-30', '18000.00', '0.00', 'FPEQ')] },
        { empresa_id: 2, periodo: '2026-09', renglones: [venta('FPEQ S-340', '2026-09-30', '21000.00', '0.00', 'FPEQ')] },
        { empresa_id: 2, periodo: '2026-10', renglones: [venta('FPEQ S-371', '2026-10-10', '6400.00', '0.00', 'FPEQ')] },
    ]
}

const CERO = new Decimal(0)
const texto = (valor: Decimal) => valor.toFixed(2)
const max0 = (valor: Decimal) => Decimal.max(valor, CERO)
const suma = (filas: readonly Renglon[], seccion: Renglon['seccion'], campo: 'base' | 'iva' | 'total') => filas.filter(r => r.seccion === seccion).reduce((s, r) => s.plus(r[campo]), CERO)

/** Remanentes que deja la declaración del mes anterior (sus totales, de la última versión revisada). */
export interface Remanentes {
    credito: Decimal
    retenciones: Decimal
    id: number | null
}

/** Totales como `calcularDatos` (IVA o pequeño contribuyente con su tasa). */
export function calcularTotales(impuesto: ImpuestoDeclarable, renglones: readonly Renglon[], anterior: Remanentes, tasaPc = '5.00'): Record<string, string> {
    const D = suma(renglones, 'ventas', 'iva')
    const totalVentas = suma(renglones, 'ventas', 'total')
    const R = suma(renglones, 'retenciones', 'iva')
    if (impuesto === 'iva_mensual') {
        const C = suma(renglones, 'compras', 'iva')
        const credito = C.plus(anterior.credito).plus(max0(D.negated()))
        const debito = max0(D)
        const creditoUsado = Decimal.min(debito, credito)
        const resto = debito.minus(creditoUsado)
        const disponibleRet = R.plus(anterior.retenciones)
        const retencionesUsadas = Decimal.min(resto, max0(disponibleRet))
        return {
            debito: texto(D),
            credito: texto(C),
            retenciones: texto(R),
            remanente_credito_anterior: texto(anterior.credito),
            remanente_retenciones_anterior: texto(anterior.retenciones),
            impuesto_determinado: texto(D.minus(C).minus(R)),
            credito_usado: texto(creditoUsado),
            retenciones_usadas: texto(retencionesUsadas),
            a_pagar: texto(resto.minus(retencionesUsadas)),
            remanente_credito: texto(credito.minus(creditoUsado)),
            remanente_retenciones: texto(disponibleRet.minus(retencionesUsadas)),
            base_ventas: texto(suma(renglones, 'ventas', 'base')),
            base_compras: texto(suma(renglones, 'compras', 'base')),
            total_ventas: texto(totalVentas),
        }
    }
    const base = max0(totalVentas)
    const imp = base.times(tasaPc).dividedBy(100).toDecimalPlaces(2)
    const disponibleRet = R.plus(anterior.retenciones)
    const usadas = Decimal.min(imp, max0(disponibleRet))
    return {
        ventas: texto(totalVentas),
        base: texto(base),
        impuesto: texto(imp),
        retenciones: texto(R),
        remanente_retenciones_anterior: texto(anterior.retenciones),
        retenciones_usadas: texto(usadas),
        a_pagar: texto(imp.minus(usadas)),
        remanente_retenciones: texto(disponibleRet.minus(usadas)),
        iva_en_ventas: texto(D),
    }
}

/** Parámetros que guarda el borrador: el plazo y formulario y, en pequeño contribuyente, la tasa. */
export function parametrosDe(impuesto: ImpuestoDeclarable): Declaracion['parametros'] {
    return impuesto === 'iva_mensual'
        ? [{ clave: 'iva_declaracion', valor: { periodo: 'mensual', plazo: 'mes_siguiente', formulario: 'SAT-2237' }, vigente_desde: '2013-01-01', nivel: 'paquete' }]
        : [
                { clave: 'pc_declaracion', valor: { periodo: 'mensual', plazo: 'mes_siguiente', formulario: 'SAT-2046' }, vigente_desde: '2013-01-01', nivel: 'paquete' },
                { clave: 'impuesto:IVA_PC', valor: '5.00', vigente_desde: '2013-01-01', nivel: 'paquete' },
            ]
}

/** `datos_hash`: huella canónica de renglones, totales, parámetros y la declaración anterior. */
export function hashDatos(renglones: readonly Renglon[], totales: Record<string, string>, parametros: Declaracion['parametros'], anteriorId: number | null): string {
    return huellaFixture(JSON.stringify({ renglones, totales, parametros, anterior: anteriorId }))
}

export function finDeMes(periodo: string): string {
    const [anio = 0, mes = 0] = periodo.split('-').map(Number)
    return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10)
}

interface Semilla {
    id: number
    empresa_id: number
    impuesto: ImpuestoDeclarable
    periodo: string
    version: number
    obligacion_id: number
    vence_en: string
    renglones: Renglon[]
    anterior: Remanentes
    estado: Declaracion['estado']
    sustituye_a?: number | null
    sustitutiva?: boolean
    revisada_en?: string | null
    presentada?: { numero: string, fecha: string, en: string } | null
    pago?: Schema<'PagoDeclaracion'> | null
    asiento_id?: number | null
}

function semilla(s: Semilla): Declaracion {
    const parametros = parametrosDe(s.impuesto)
    const totales = calcularTotales(s.impuesto, s.renglones, s.anterior)
    const calculada = `${finDeMes(s.periodo)}T23:00:00.000Z`
    return {
        id: s.id,
        empresa_id: s.empresa_id,
        impuesto: s.impuesto,
        periodo_desde: `${s.periodo}-01`,
        periodo_hasta: finDeMes(s.periodo),
        version: s.version,
        sustitutiva: s.sustitutiva ?? false,
        sustituye_a: s.sustituye_a ?? null,
        obligacion_id: s.obligacion_id,
        formulario: s.impuesto === 'iva_mensual' ? 'SAT-2237' : 'SAT-2046',
        vence_en: s.vence_en,
        parametros,
        detalle: { renglones: s.renglones, libros: [], anterior_id: s.anterior.id },
        totales,
        datos_hash: hashDatos(s.renglones, totales, parametros, s.anterior.id),
        calculada_por: 1,
        calculada_en: calculada,
        estado: s.estado,
        revisada_por: s.revisada_en ? 1 : null,
        revisada_en: s.revisada_en ?? null,
        asiento_id: s.asiento_id ?? null,
        numero_formulario: s.presentada?.numero ?? null,
        fecha_presentacion: s.presentada?.fecha ?? null,
        boleta: null,
        presentada_por: s.presentada ? 1 : null,
        presentada_en: s.presentada?.en ?? null,
        pago: s.pago ?? null,
        created_at: calculada,
        updated_at: s.presentada?.en ?? s.revisada_en ?? calculada,
    }
}

const SIN_ANTERIOR: Remanentes = { credito: CERO, retenciones: CERO, id: null }

export function declaracionesIniciales(datos: readonly DatosMes[]): Declaracion[] {
    const de = (empresa: number, periodo: string) => datos.find(d => d.empresa_id === empresa && d.periodo === periodo)?.renglones ?? []
    const julio = semilla({
        id: 1,
        empresa_id: 1,
        impuesto: 'iva_mensual',
        periodo: '2026-07',
        version: 1,
        obligacion_id: 1,
        vence_en: '2026-08-31',
        renglones: de(1, '2026-07'),
        anterior: SIN_ANTERIOR,
        estado: 'presentada',
        revisada_en: '2026-08-05T16:00:00.000Z',
        asiento_id: 801,
        presentada: { numero: '2237-0004518890', fecha: '2026-08-20', en: '2026-08-20T17:00:00.000Z' },
        pago: { id: 1, fecha: '2026-08-20', impuesto: '1206.00', mora: '0.00', multa: '0.00', total: '1206.00', dias_atraso: 0, boleta: 'BI-778812', asiento_id: 802, registrado_por: 1, created_at: '2026-08-20T17:05:00.000Z' },
    })
    const remanenteJulio: Remanentes = { credito: new Decimal(julio.totales.remanente_credito ?? '0'), retenciones: new Decimal(julio.totales.remanente_retenciones ?? '0'), id: 1 }
    const agosto = de(1, '2026-08')
    // La v1 se calculó antes de que llegara la constancia de retención: la v2 la corrige.
    const agostoV1 = semilla({
        id: 2,
        empresa_id: 1,
        impuesto: 'iva_mensual',
        periodo: '2026-08',
        version: 1,
        obligacion_id: 4,
        vence_en: '2026-09-30',
        renglones: agosto.filter(r => r.seccion !== 'retenciones'),
        anterior: remanenteJulio,
        estado: 'sustituida',
        revisada_en: '2026-09-10T16:00:00.000Z',
        asiento_id: 803,
    })
    const agostoV2 = semilla({
        id: 3,
        empresa_id: 1,
        impuesto: 'iva_mensual',
        periodo: '2026-08',
        version: 2,
        obligacion_id: 4,
        vence_en: '2026-09-30',
        renglones: agosto,
        anterior: remanenteJulio,
        estado: 'presentada',
        sustitutiva: true,
        sustituye_a: 2,
        revisada_en: '2026-10-02T15:00:00.000Z',
        asiento_id: 804,
        presentada: { numero: '2237-0004602217', fecha: '2026-10-02', en: '2026-10-02T16:00:00.000Z' },
    })
    const pcAgosto = semilla({
        id: 4,
        empresa_id: 2,
        impuesto: 'pc_mensual',
        periodo: '2026-08',
        version: 1,
        obligacion_id: 17,
        vence_en: '2026-09-30',
        renglones: de(2, '2026-08'),
        anterior: SIN_ANTERIOR,
        estado: 'presentada',
        revisada_en: '2026-09-04T16:00:00.000Z',
        asiento_id: 805,
        presentada: { numero: '2046-0000981234', fecha: '2026-09-15', en: '2026-09-15T16:00:00.000Z' },
        pago: { id: 2, fecha: '2026-09-15', impuesto: '900.00', mora: '0.00', multa: '0.00', total: '900.00', dias_atraso: 0, boleta: 'BI-801144', asiento_id: 806, registrado_por: 1, created_at: '2026-09-15T16:10:00.000Z' },
    })
    return [julio, agostoV1, agostoV2, pcAgosto]
}
