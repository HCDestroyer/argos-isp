import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import { Problema } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverCuentaBanco, type CuentaBanco } from '#ledger/cuentas_banco'
import { huellasDeLineas } from '#ledger/conciliacion'
import { CERO, D, aTexto } from '#ledger/dinero'
import { leerHoja, sha256, type Celda, type TipoArchivo } from '#importacion/extractos/hoja'
import {
    detectarFormato,
    perfilDelCatalogo,
    perfilPorCodigo,
    ubicarMapeoGuardado,
    type MapeoExtracto,
    type PerfilBanco,
} from '#importacion/extractos/formatos'
import { interpretarFilas, type ErrorFila, type LineaInterpretada } from '#importacion/extractos/interpretar'
import { verMapeoGuardado } from '#importacion/extractos/mapeos'

/**
 * Vista previa de un estado de cuenta del banco (`POST /bancos/extractos/vista-previa`, A6). No
 * escribe nada: lee el archivo, decide el mapeo y calcula lo que se importaría.
 *
 * Orden del mapeo: el que manda el panel (`mapeo`, confirmado por la persona) → el guardado para la
 * cuenta bancaria, si su fila de títulos aparece en el archivo → el del banco reconocido → una
 * sugerencia (`requiere_confirmacion: true`).
 */

export interface EntradaVistaPrevia {
    contenido: Buffer
    nombre: string
    cuenta_bancaria_id: number
    hoja?: string | null
    mapeo?: MapeoExtracto | null
    /** saldos del extracto si el archivo no los trae (o para corregirlos) */
    saldo_inicial?: string | null
    saldo_final?: string | null
    desde?: string | null
    hasta?: string | null
}

export type OrigenMapeo = 'manual' | 'mapeo_guardado' | 'banco' | 'sugerencia'

export interface ColumnaVista {
    indice: number
    /** letra de Excel (A, B, …) */
    letra: string
    encabezado: string | null
    muestra: Array<string | null>
    /** papel que cumple en el mapeo (fecha, descripcion…), o null */
    papel: string | null
}

export interface VistaPreviaExtracto {
    archivo: {
        nombre: string
        tipo: TipoArchivo
        tamano: number
        sha256: string
        hojas: string[]
        hoja: string
    }
    cuenta: {
        cuenta_bancaria_id: number
        cuenta_id: number
        codigo: string
        nombre: string
        empresa_id: number
        banco: string | null
    }
    formato: {
        /** banco reconocido (`banrural`, `industrial`, `bac`, `gyt`, `promerica`) o null */
        codigo: string | null
        banco: string | null
        reconocido: boolean
        origen: OrigenMapeo
    }
    requiere_confirmacion: boolean
    mapeo: MapeoExtracto
    columnas: ColumnaVista[]
    periodo: { desde: string; hasta: string } | null
    saldo_inicial: string | null
    saldo_final: string | null
    origen_saldos: 'etiquetas' | 'columna_saldo' | 'extracto_anterior' | 'manual' | 'calculado' | null
    entradas: string
    salidas: string
    lineas: number
    ignoradas: number
    invertido: boolean
    revisiones: {
        cuadra: { ok: boolean; diferencia: string | null; filas_saldo_no_encadena: number[] }
        encadena: { ok: boolean | null; extracto_anterior_id: number | null; saldo_anterior: string | null }
        repetidos: { cantidad: number; filas: number[] }
    }
    errores: ErrorFila[]
    /** primeras 10 líneas interpretadas */
    filas: LineaInterpretada[]
}

/** Resultado interno: la vista más todas las líneas (para importar). */
export interface PreparacionExtracto {
    vista: VistaPreviaExtracto
    todas: LineaInterpretada[]
    cuenta: CuentaBanco
    perfil: PerfilBanco | null
}

function letra(indice: number): string {
    let n = indice + 1
    let s = ''
    while (n > 0) {
        const r = (n - 1) % 26
        s = String.fromCharCode(65 + r) + s
        n = Math.floor((n - 1) / 26)
    }
    return s
}

function validarMapeo(mapeo: MapeoExtracto, ancho: number, filas: number) {
    const fuera = Object.entries(mapeo.columnas).filter(
        ([, v]) => v !== null && (v < 0 || v >= Math.max(ancho, 1)),
    )
    const errores = fuera.map(([papel]) => ({
        field: `mapeo.columnas.${papel}`,
        message: `La columna no existe (el archivo tiene ${ancho})`,
        rule: 'columna',
    }))
    if (
        mapeo.columnas.monto === null &&
        (mapeo.columnas.debito === null || mapeo.columnas.credito === null)
    ) {
        errores.push({
            field: 'mapeo.columnas',
            message: 'Indica débito y crédito, o un monto con signo',
            rule: 'required',
        })
    }
    if (mapeo.fila_datos < 1 || mapeo.fila_datos > Math.max(filas, 1)) {
        errores.push({ field: 'mapeo.fila_datos', message: 'Fila fuera del archivo', rule: 'fila' })
    }
    if (errores.length > 0) {
        throw new Problema(
            422,
            'mapeo_invalido',
            'Mapeo inválido',
            'El mapeo no corresponde al archivo',
            errores,
        )
    }
}

export async function prepararExtracto(
    trx: QueryClientContract,
    ctx: ContextoAccion,
    input: EntradaVistaPrevia,
): Promise<PreparacionExtracto> {
    const cuenta = (await resolverCuentaBanco(trx, { cuenta_bancaria_id: input.cuenta_bancaria_id }))!
    const empresaId = Number(
        cuenta.empresa_id ??
            (
                (await trx
                    .from('billing.cuentas_bancarias')
                    .where('id', input.cuenta_bancaria_id)
                    .select('empresa_id')
                    .first()) as { empresa_id: number }
            ).empresa_id,
    )
    exigirAccesoEmpresa(ctx, empresaId)
    const banco = (await trx
        .from('billing.cuentas_bancarias as cb')
        .join('billing.bancos as b', 'b.id', 'cb.banco_id')
        .where('cb.id', input.cuenta_bancaria_id)
        .select('b.nombre')
        .first()) as { nombre: string } | null

    const hojaPedida = input.mapeo?.hoja ?? input.hoja ?? null
    const guardado = await verMapeoGuardado(trx, input.cuenta_bancaria_id)
    const leida = leerHoja(input.contenido, input.nombre, hojaPedida ?? guardado?.mapeo.hoja ?? null)
    const filas: Celda[][] = leida.filas
    const ancho = Math.max(0, ...filas.map((f) => f.length))

    let mapeo: MapeoExtracto
    let origen: OrigenMapeo
    let perfil: PerfilBanco | null
    let reconocido: boolean
    const bancoCuenta = perfilDelCatalogo(banco?.nombre)
    if (input.mapeo) {
        mapeo = { ...input.mapeo, hoja: leida.tipo === 'csv' ? null : leida.hoja }
        validarMapeo(mapeo, ancho, filas.length)
        origen = 'manual'
        perfil = bancoCuenta
        reconocido = true
    } else {
        const ubicado = guardado ? ubicarMapeoGuardado(filas, guardado.mapeo) : null
        const deteccion = detectarFormato(
            filas,
            input.nombre,
            leida.tipo === 'csv' ? null : leida.hoja,
            bancoCuenta,
        )
        if (ubicado) {
            mapeo = ubicado
            origen = 'mapeo_guardado'
            perfil = perfilPorCodigo(guardado!.formato) ?? deteccion.perfil
            reconocido = true
        } else {
            mapeo = deteccion.mapeo
            perfil = deteccion.perfil
            reconocido = deteccion.reconocido
            origen = reconocido ? 'banco' : 'sugerencia'
        }
    }

    const interpretacion = interpretarFilas(filas, mapeo)
    const lineas = interpretacion.lineas
    let entradas = CERO
    let salidas = CERO
    for (const l of lineas) {
        if (new D(l.monto).isPositive()) entradas = entradas.plus(l.monto)
        else salidas = salidas.plus(new D(l.monto).abs())
    }
    const neto = entradas.minus(salidas)

    const anterior = (await trx
        .from('ledger.extractos')
        .where({ empresa_id: empresaId, cuenta_id: cuenta.cuenta_id })
        .orderBy('hasta', 'desc')
        .orderBy('id', 'desc')
        .select('id', 'saldo_final')
        .first()) as { id: number; saldo_final: string } | null

    let saldoInicial = input.saldo_inicial ?? interpretacion.saldo_inicial
    let saldoFinal = input.saldo_final ?? interpretacion.saldo_final
    let origenSaldos: VistaPreviaExtracto['origen_saldos'] =
        input.saldo_inicial || input.saldo_final ? 'manual' : interpretacion.origen_saldos
    if (saldoInicial === null && saldoFinal !== null) {
        saldoInicial = aTexto(new D(saldoFinal).minus(neto))
        origenSaldos = origenSaldos ?? 'calculado'
    }
    if (saldoInicial === null && anterior) {
        saldoInicial = aTexto(anterior.saldo_final)
        origenSaldos = 'extracto_anterior'
    }
    if (saldoFinal === null && saldoInicial !== null) {
        saldoFinal = aTexto(new D(saldoInicial).plus(neto))
        origenSaldos = origenSaldos ?? 'calculado'
    }

    const diferencia =
        saldoInicial !== null && saldoFinal !== null
            ? new D(saldoFinal).minus(saldoInicial).minus(neto)
            : null
    const huellas = huellasDeLineas(lineas)
    const repetidas = huellas.length
        ? ((await trx
              .from('ledger.extractos_lineas')
              .where({ empresa_id: empresaId, cuenta_id: cuenta.cuenta_id })
              .whereIn('huella', huellas)
              .select('huella')) as Array<{ huella: string }>)
        : []
    const repetidasSet = new Set(repetidas.map((r) => r.huella))
    const filasRepetidas = lineas.filter((_, i) => repetidasSet.has(huellas[i]!)).map((l) => l.fila)

    const papeles = new Map<number, string>()
    for (const [papel, indice] of Object.entries(mapeo.columnas)) {
        if (indice !== null && !papeles.has(indice)) papeles.set(indice, papel)
    }
    const encabezado = mapeo.fila_encabezado === null ? null : (filas[mapeo.fila_encabezado - 1] ?? null)
    const muestras = filas
        .slice(mapeo.fila_datos - 1)
        .filter((f) => f.some((c) => c !== null))
        .slice(0, 3)
    const columnas: ColumnaVista[] = Array.from({ length: ancho }, (_, i) => ({
        indice: i,
        letra: letra(i),
        encabezado: encabezado?.[i] ?? null,
        muestra: muestras.map((f) => f[i] ?? null),
        papel: papeles.get(i) ?? null,
    }))

    const fechas = lineas.map((l) => l.fecha).sort()
    const periodo =
        fechas.length > 0
            ? { desde: input.desde ?? fechas[0]!, hasta: input.hasta ?? fechas[fechas.length - 1]! }
            : null

    const vista: VistaPreviaExtracto = {
        archivo: {
            nombre: input.nombre,
            tipo: leida.tipo,
            tamano: input.contenido.length,
            sha256: sha256(input.contenido),
            hojas: leida.hojas,
            hoja: leida.hoja,
        },
        cuenta: {
            cuenta_bancaria_id: input.cuenta_bancaria_id,
            cuenta_id: cuenta.cuenta_id,
            codigo: cuenta.codigo,
            nombre: cuenta.nombre,
            empresa_id: empresaId,
            banco: banco?.nombre ?? null,
        },
        formato: { codigo: perfil?.codigo ?? null, banco: perfil?.nombre ?? null, reconocido, origen },
        requiere_confirmacion: !reconocido,
        mapeo,
        columnas,
        periodo,
        saldo_inicial: saldoInicial,
        saldo_final: saldoFinal,
        origen_saldos: origenSaldos,
        entradas: aTexto(entradas),
        salidas: aTexto(salidas),
        lineas: lineas.length,
        ignoradas: interpretacion.ignoradas,
        invertido: interpretacion.invertido,
        revisiones: {
            cuadra: {
                ok:
                    diferencia !== null &&
                    diferencia.isZero() &&
                    interpretacion.saldos_que_no_encadenan.length === 0,
                diferencia: diferencia === null ? null : aTexto(diferencia),
                filas_saldo_no_encadena: interpretacion.saldos_que_no_encadenan,
            },
            encadena: {
                ok:
                    anterior && saldoInicial !== null
                        ? new D(anterior.saldo_final).equals(saldoInicial)
                        : null,
                extracto_anterior_id: anterior ? Number(anterior.id) : null,
                saldo_anterior: anterior ? aTexto(anterior.saldo_final) : null,
            },
            repetidos: { cantidad: filasRepetidas.length, filas: filasRepetidas },
        },
        errores: interpretacion.errores,
        filas: lineas.slice(0, 10),
    }
    return { vista, todas: lineas, cuenta, perfil }
}
