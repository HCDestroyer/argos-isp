import db from '@adonisjs/lucid/services/db'
import { ValidacionFallida } from '#shared/errores'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { resumenEmpresas } from '#billing/empresa'

/**
 * Balance de comprobación (`GET /libro/comprobacion`, contrato de localización fiscal §10.8): por
 * cuenta y por grupo (las cuentas padre del catálogo), saldo inicial (antes de `desde`), debe y
 * haber del rango y saldo final, cada saldo en su columna deudora o acreedora. `cuadra` = Σ debe =
 * Σ haber y, al inicio y al final, Σ deudor = Σ acreedor.
 *
 * Se emite antes y después del cierre anual: `sin_cierre_anual` deja fuera los asientos
 * `cierre_anual` (y sus reversos), así el del 31-dic muestra los resultados antes de cancelarlos.
 * Una sección por empresa (cada NIT tiene su libro) y `total` del grupo en el consolidado.
 */

interface FilaCuenta {
    id: number
    codigo: string
    nombre: string
    tipo: string
    padre_id: number | null
    imputable: boolean
}

interface Acumulado {
    inicial: Dec
    debe: Dec
    haber: Dec
}

export interface LineaComprobacion {
    cuenta_id: number
    codigo: string
    nombre: string
    tipo: string
    /** 1 = grupo raíz (1 Activo…); las imputables son las hojas */
    nivel: number
    padre_id: number | null
    imputable: boolean
    saldo_inicial_deudor: string
    saldo_inicial_acreedor: string
    debe: string
    haber: string
    saldo_final_deudor: string
    saldo_final_acreedor: string
}

export interface TotalesComprobacion {
    saldo_inicial_deudor: string
    saldo_inicial_acreedor: string
    debe: string
    haber: string
    saldo_final_deudor: string
    saldo_final_acreedor: string
    cuadra: boolean
}

export interface FiltrosComprobacion {
    desde?: string
    hasta?: string
    sin_cierre_anual?: boolean
}

function columnas(a: Acumulado) {
    const final = a.inicial.plus(a.debe).minus(a.haber)
    return {
        saldo_inicial_deudor: aTexto(a.inicial.gt(0) ? a.inicial : CERO),
        saldo_inicial_acreedor: aTexto(a.inicial.lt(0) ? a.inicial.negated() : CERO),
        debe: aTexto(a.debe),
        haber: aTexto(a.haber),
        saldo_final_deudor: aTexto(final.gt(0) ? final : CERO),
        saldo_final_acreedor: aTexto(final.lt(0) ? final.negated() : CERO),
    }
}

function armar(
    catalogo: Map<number, FilaCuenta>,
    hojas: Map<number, Acumulado>,
): { cuentas: LineaComprobacion[]; grupos: LineaComprobacion[]; totales: TotalesComprobacion } {
    const nivel = (c: FilaCuenta): number => {
        let n = 1
        let p = c.padre_id
        while (p !== null && catalogo.has(p)) {
            n++
            p = catalogo.get(p)!.padre_id
        }
        return n
    }
    const grupos = new Map<number, Acumulado>()
    for (const [id, a] of hojas) {
        let p = catalogo.get(id)?.padre_id ?? null
        while (p !== null && catalogo.has(p)) {
            const g = grupos.get(p) ?? { inicial: CERO, debe: CERO, haber: CERO }
            grupos.set(p, { inicial: g.inicial.plus(a.inicial), debe: g.debe.plus(a.debe), haber: g.haber.plus(a.haber) })
            p = catalogo.get(p)!.padre_id
        }
    }
    const linea = (id: number, a: Acumulado): LineaComprobacion => {
        const c = catalogo.get(id)!
        return {
            cuenta_id: id,
            codigo: c.codigo,
            nombre: c.nombre,
            tipo: c.tipo,
            nivel: nivel(c),
            padre_id: c.padre_id,
            imputable: c.imputable,
            ...columnas(a),
        }
    }
    const porCodigo = (x: LineaComprobacion, y: LineaComprobacion) =>
        x.codigo.localeCompare(y.codigo, 'es', { numeric: true })
    const cuentas = [...hojas].map(([id, a]) => linea(id, a)).sort(porCodigo)
    const listaGrupos = [...grupos].map(([id, a]) => linea(id, a)).sort(porCodigo)
    const suma = (campo: keyof ReturnType<typeof columnas>) =>
        cuentas.reduce((s, c) => s.plus(dec(c[campo])), CERO)
    const totales = {
        saldo_inicial_deudor: suma('saldo_inicial_deudor'),
        saldo_inicial_acreedor: suma('saldo_inicial_acreedor'),
        debe: suma('debe'),
        haber: suma('haber'),
        saldo_final_deudor: suma('saldo_final_deudor'),
        saldo_final_acreedor: suma('saldo_final_acreedor'),
    }
    return {
        cuentas,
        grupos: listaGrupos,
        totales: {
            saldo_inicial_deudor: aTexto(totales.saldo_inicial_deudor),
            saldo_inicial_acreedor: aTexto(totales.saldo_inicial_acreedor),
            debe: aTexto(totales.debe),
            haber: aTexto(totales.haber),
            saldo_final_deudor: aTexto(totales.saldo_final_deudor),
            saldo_final_acreedor: aTexto(totales.saldo_final_acreedor),
            cuadra:
                totales.debe.equals(totales.haber) &&
                totales.saldo_inicial_deudor.equals(totales.saldo_inicial_acreedor) &&
                totales.saldo_final_deudor.equals(totales.saldo_final_acreedor),
        },
    }
}

export async function balanceComprobacion(filtros: FiltrosComprobacion, empresas: number[] | null) {
    const hasta = filtros.hasta ?? hoyGuatemala()
    const desde = filtros.desde ?? `${hasta.slice(0, 4)}-01-01`
    if (desde > hasta) {
        throw new ValidacionFallida([{ field: 'desde', message: 'desde debe ser ≤ hasta', rule: 'rango' }])
    }
    const sinCierre = filtros.sin_cierre_anual === true
    const filas = (await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .where('a.fecha', '<=', hasta)
        .if(empresas !== null, (q) => q.whereIn('a.empresa_id', empresas!))
        .if(sinCierre, (q) => q.whereNot('a.origen_tipo', 'cierre_anual'))
        .groupBy('a.empresa_id', 'm.cuenta_id')
        .select(
            'a.empresa_id',
            'm.cuenta_id',
            db.raw('coalesce(sum(m.debe - m.haber) FILTER (WHERE a.fecha < ?), 0)::text as inicial', [desde]),
            db.raw('coalesce(sum(m.debe) FILTER (WHERE a.fecha >= ?), 0)::text as debe', [desde]),
            db.raw('coalesce(sum(m.haber) FILTER (WHERE a.fecha >= ?), 0)::text as haber', [desde]),
        )) as Array<{ empresa_id: number; cuenta_id: number; inicial: string; debe: string; haber: string }>

    const catalogo = new Map<number, FilaCuenta>()
    for (const c of (await db
        .from('ledger.cuentas')
        .select('id', 'codigo', 'nombre', 'tipo', 'padre_id', 'imputable')) as FilaCuenta[]) {
        catalogo.set(Number(c.id), { ...c, id: Number(c.id), padre_id: c.padre_id === null ? null : Number(c.padre_id) })
    }
    const acumular = (lista: typeof filas) => {
        const hojas = new Map<number, Acumulado>()
        for (const f of lista) {
            const id = Number(f.cuenta_id)
            const a = hojas.get(id) ?? { inicial: CERO, debe: CERO, haber: CERO }
            hojas.set(id, {
                inicial: a.inicial.plus(dec(f.inicial)),
                debe: a.debe.plus(dec(f.debe)),
                haber: a.haber.plus(dec(f.haber)),
            })
        }
        // fuera las cuentas sin saldo inicial ni movimiento en el rango
        for (const [id, a] of hojas) if (a.inicial.isZero() && a.debe.isZero() && a.haber.isZero()) hojas.delete(id)
        return armar(catalogo, hojas)
    }

    const ids = [...new Set([...(empresas ?? []), ...filas.map((f) => Number(f.empresa_id))])].sort((a, b) => a - b)
    const datos = await resumenEmpresas(ids)
    return {
        desde,
        hasta,
        sin_cierre_anual: sinCierre,
        consolidado: empresas === null,
        empresas: ids.map((id) => {
            const empresa = datos.get(id)
            return {
                empresa_id: id,
                nombre_comercial: empresa?.nombre_comercial ?? null,
                nit: empresa?.nit ?? null,
                ...acumular(filas.filter((f) => Number(f.empresa_id) === id)),
            }
        }),
        total: acumular(filas),
    }
}
