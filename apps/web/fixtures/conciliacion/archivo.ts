/**
 * Estado de cuenta tal como lo descarga el banco (A3): vista previa (`POST
 * /bancos/extractos/vista-previa`), importación del archivo (`POST /bancos/extractos/archivo`) y
 * el mapeo de columnas guardado por cuenta (`GET/PUT /bancos/cuentas-bancarias/:id/mapeo-extracto`).
 *
 * El fixture lee CSV (separado por coma o punto y coma). Reconoce el formato «Banrural» (títulos
 * Fecha, Descripción, No. Documento, Débito, Crédito, Saldo) y el neutral de Argos (fecha,
 * descripcion, referencia, monto, saldo); con otros títulos sugiere un mapeo y pide confirmarlo
 * (`requiere_confirmacion`), como la API.
 */
import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { invalido, regla422 } from '../cobros/rutas'
import { ahora, conIdempotencia, conPermiso, idDe, noEncontrado, usuariosPorToken, versionCambiada } from '../comun'
import { importar } from './rutas'

type Mapeo = Schema<'MapeoExtracto'>
type Vista = Schema<'VistaPreviaExtracto'>
type MapeoGuardado = Schema<'MapeoExtractoGuardado'>

/** Mapeos guardados por cuenta bancaria (uno por cuenta, con versión). */
const mapeos = new Map<number, MapeoGuardado>()

function sinAcentos(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function celdas(fila: string, separador: string): string[] {
    return fila.split(separador).map(c => c.trim().replace(/^"|"$/g, ''))
}

function letra(indice: number): string {
    return String.fromCharCode(65 + indice)
}

/** Lee el CSV en filas de celdas (sin filas vacías). */
function filasDe(texto: string): string[][] {
    const lineas = texto.replace(/^\uFEFF/, '').split(/\r?\n/).filter(f => f.trim() !== '')
    const primera = lineas.find(l => /fecha/i.test(l)) ?? lineas[0] ?? ''
    const separador = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ','
    return lineas.map(l => celdas(l, separador))
}

const BANRURAL = ['fecha', 'descripcion', 'no. documento', 'debito', 'credito', 'saldo']
const NEUTRAL = ['fecha', 'descripcion', 'referencia', 'monto', 'saldo']

/** El mapeo que corresponde a los títulos: el del banco, el neutral o una sugerencia. */
function mapeoPorTitulos(filas: string[][]): { mapeo: Mapeo, codigo: 'banrural' | null, banco: string | null, reconocido: boolean } | null {
    const fila = filas.findIndex(f => f.some(c => /^fecha$/i.test(sinAcentos(c))))
    if (fila < 0) {
        return null
    }
    const titulos = (filas[fila] ?? []).map(sinAcentos)
    const indice = (...nombres: string[]) => {
        const i = titulos.findIndex(t => nombres.some(n => t === n || t.includes(n)))
        return i >= 0 ? i : null
    }
    const columnas: Mapeo['columnas'] = {
        fecha: indice('fecha') ?? 0,
        descripcion: indice('descripcion', 'concepto', 'detalle') ?? 1,
        referencia: indice('referencia', 'no. documento', 'documento', 'no. doc'),
        debito: indice('debito', 'cargo', 'retiro'),
        credito: indice('credito', 'abono', 'deposito'),
        monto: indice('monto', 'importe'),
        saldo: indice('saldo'),
    }
    if (columnas.debito !== null || columnas.credito !== null) {
        columnas.monto = null
    }
    const mapeo: Mapeo = { hoja: null, fila_encabezado: fila + 1, fila_datos: fila + 2, columnas, formato_fecha: 'dmy', decimal: 'punto', encabezados: titulos }
    const igual = (lista: string[]) => lista.length === titulos.length && lista.every((t, i) => titulos[i] === t)
    if (igual(BANRURAL)) {
        return { mapeo, codigo: 'banrural', banco: 'Banrural', reconocido: true }
    }
    if (igual(NEUTRAL)) {
        return { mapeo: { ...mapeo, formato_fecha: 'ymd' }, codigo: null, banco: null, reconocido: true }
    }
    return { mapeo, codigo: null, banco: null, reconocido: false }
}

function fechaIso(texto: string, formato: Mapeo['formato_fecha']): string | null {
    const partes = texto.split(/[/-]/).map(p => p.trim())
    if (partes.length !== 3) {
        return null
    }
    const [a = '', b = '', c = ''] = partes
    const [dia, mes, anio] = formato === 'dmy' ? [a, b, c] : formato === 'mdy' ? [b, a, c] : [c, b, a]
    if (!/^\d{4}$/.test(anio) || !/^\d{1,2}$/.test(mes) || !/^\d{1,2}$/.test(dia)) {
        return null
    }
    const iso = `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
    return Number.isNaN(Date.parse(iso)) ? null : iso
}

function montoDe(texto: string | undefined, decimal: Mapeo['decimal']): Decimal | null {
    if (!texto) {
        return null
    }
    const limpio = decimal === 'coma' ? texto.replace(/\./g, '').replace(',', '.') : texto.replace(/,/g, '')
    const valor = limpio.replace(/[Q\s]/g, '')
    return /^-?\d+(\.\d+)?$/.test(valor) ? new Decimal(valor) : null
}

interface Lectura {
    filas: Schema<'LineaExtractoInterpretada'>[]
    errores: Vista['errores']
    ignoradas: number
}

function interpretar(filas: string[][], mapeo: Mapeo): Lectura {
    const resultado: Lectura = { filas: [], errores: [], ignoradas: 0 }
    filas.slice(mapeo.fila_datos - 1).forEach((fila, posicion) => {
        const numero = mapeo.fila_datos + posicion
        const c = mapeo.columnas
        const textoFecha = fila[c.fecha] ?? ''
        if (!textoFecha.trim()) {
            resultado.ignoradas++
            return
        }
        const fecha = fechaIso(textoFecha, mapeo.formato_fecha)
        let monto: Decimal | null
        if (c.monto !== null) {
            monto = montoDe(fila[c.monto], mapeo.decimal)
        }
        else {
            const sale = c.debito !== null ? montoDe(fila[c.debito], mapeo.decimal) : null
            const entra = c.credito !== null ? montoDe(fila[c.credito], mapeo.decimal) : null
            monto = (entra ?? new Decimal(0)).minus(sale ?? new Decimal(0))
            if (!sale && !entra) {
                monto = null
            }
        }
        const descripcion = (fila[c.descripcion] ?? '').trim()
        if (!fecha) {
            resultado.errores.push({ fila: numero, campo: 'fecha', mensaje: `Fecha inválida: "${textoFecha}"` })
            return
        }
        if (!monto) {
            resultado.errores.push({ fila: numero, campo: 'monto', mensaje: 'Sin monto legible' })
            return
        }
        const saldo = c.saldo !== null ? montoDe(fila[c.saldo], mapeo.decimal) : null
        const referencia = c.referencia !== null ? (fila[c.referencia] ?? '').trim() : ''
        resultado.filas.push({ fila: numero, fecha, descripcion: descripcion || '(sin descripción)', referencia: referencia && referencia !== '—' ? referencia : null, monto: monto.toFixed(2), saldo: saldo ? saldo.toFixed(2) : null })
    })
    return resultado
}

interface Entrada {
    cuentaBancariaId: number
    archivo: File
    mapeo: Mapeo | null
}

function entradaDe(solicitud: SolicitudFixture): Entrada | RespuestaFixture {
    const cuerpo = (solicitud.cuerpo ?? {}) as Record<string, unknown>
    const cuentaBancariaId = Number(cuerpo.cuenta_bancaria_id)
    const archivo = cuerpo.archivo
    if (!Number.isInteger(cuentaBancariaId) || cuentaBancariaId < 1) {
        return invalido([{ field: 'cuenta_bancaria_id', message: 'Elige la cuenta bancaria', rule: 'required' }])
    }
    if (!(archivo instanceof File)) {
        return invalido([{ field: 'archivo', message: 'Sube el estado de cuenta (.xlsx, .xls o .csv)', rule: 'required' }])
    }
    let mapeo: Mapeo | null = null
    if (typeof cuerpo.mapeo === 'string' && cuerpo.mapeo) {
        try {
            mapeo = JSON.parse(cuerpo.mapeo) as Mapeo
        }
        catch {
            return regla422('mapeo_invalido', 'Mapeo inválido', 'El mapeo no es JSON válido', [{ field: 'mapeo', message: 'JSON inválido', rule: 'mapeo_invalido' }])
        }
    }
    return { cuentaBancariaId, archivo, mapeo }
}

async function vistaPrevia(entrada: Entrada): Promise<Vista | RespuestaFixture> {
    const cuenta = bd.cuentasBancarias.find(c => c.id === entrada.cuentaBancariaId)
    if (!cuenta) {
        return invalido([{ field: 'cuenta_bancaria_id', message: 'La cuenta bancaria no existe', rule: 'exists' }])
    }
    const nombre = entrada.archivo.name
    const tipo = nombre.toLowerCase().endsWith('.xlsx') ? 'xlsx' : nombre.toLowerCase().endsWith('.xls') ? 'xls' : 'csv'
    const texto = await entrada.archivo.text()
    const filas = filasDe(texto)
    const porTitulos = mapeoPorTitulos(filas)
    if (!porTitulos && !entrada.mapeo) {
        return regla422('archivo_no_legible', 'Archivo no legible', 'No se encontró una fila de títulos con la fecha. Revisa que sea el estado de cuenta tal como lo descarga el banco.', [{ field: 'archivo', message: 'Sin fila de títulos', rule: 'archivo_no_legible' }])
    }
    const guardado = mapeos.get(cuenta.id)
    let formato: Vista['formato']
    let mapeo: Mapeo
    if (entrada.mapeo) {
        mapeo = entrada.mapeo
        formato = { codigo: null, banco: null, reconocido: true, origen: 'manual' }
    }
    else if (guardado && porTitulos && guardado.mapeo.encabezados.join('|') === porTitulos.mapeo.encabezados.join('|')) {
        mapeo = guardado.mapeo
        formato = { codigo: null, banco: cuenta.banco_nombre, reconocido: true, origen: 'mapeo_guardado' }
    }
    else if (porTitulos?.reconocido) {
        mapeo = porTitulos.mapeo
        formato = { codigo: porTitulos.codigo, banco: porTitulos.banco ?? cuenta.banco_nombre, reconocido: true, origen: 'banco' }
    }
    else {
        mapeo = porTitulos?.mapeo ?? { hoja: null, fila_encabezado: null, fila_datos: 1, columnas: { fecha: 0, descripcion: 1, referencia: null, debito: null, credito: null, monto: 2, saldo: null }, formato_fecha: 'dmy', decimal: 'punto', encabezados: [] }
        formato = { codigo: null, banco: null, reconocido: false, origen: 'sugerencia' }
    }
    const lectura = interpretar(filas, mapeo)
    const encabezados = mapeo.fila_encabezado ? (filas[mapeo.fila_encabezado - 1] ?? []) : []
    const anchura = Math.max(0, ...filas.slice(mapeo.fila_datos - 1, mapeo.fila_datos + 2).map(f => f.length), encabezados.length)
    const papeles = new Map<number, string>()
    Object.entries(mapeo.columnas).forEach(([papel, indice]) => {
        if (indice !== null) {
            papeles.set(indice, papel)
        }
    })
    const entradas = lectura.filas.filter(f => !f.monto.startsWith('-')).reduce((s, f) => s.plus(f.monto), new Decimal(0))
    const salidas = lectura.filas.filter(f => f.monto.startsWith('-')).reduce((s, f) => s.plus(new Decimal(f.monto).abs()), new Decimal(0))
    const primera = lectura.filas[0]
    const ultima = lectura.filas.at(-1)
    const saldoInicial = primera?.saldo ? new Decimal(primera.saldo).minus(primera.monto) : null
    const saldoFinal = ultima?.saldo ? new Decimal(ultima.saldo) : null
    const cuadra = saldoInicial && saldoFinal ? saldoFinal.minus(saldoInicial).equals(entradas.minus(salidas)) : false
    const anterior = bd.extractos.filter(e => e.cuenta_id === cuenta.cuenta_id).sort((a, b) => b.id - a.id)[0]
    const repetidas = lectura.filas.filter(f => bd.lineasExtracto.some(l => l.cuenta_id === cuenta.cuenta_id && l.fecha === f.fecha && new Decimal(l.monto).equals(f.monto) && l.descripcion === f.descripcion))
    const fechas = lectura.filas.map(f => f.fecha).sort()
    return {
        archivo: { nombre, tipo, tamano: entrada.archivo.size, sha256: '0'.repeat(64), hojas: ['Hoja1'], hoja: 'Hoja1' },
        cuenta: { cuenta_bancaria_id: cuenta.id, cuenta_id: cuenta.cuenta_id, codigo: cuenta.cuenta_codigo, nombre: `${cuenta.banco_nombre} · ${cuenta.alias}`, empresa_id: cuenta.empresa_id ?? 1, banco: cuenta.banco_nombre },
        formato,
        requiere_confirmacion: !formato.reconocido,
        mapeo,
        columnas: Array.from({ length: anchura }, (_, indice) => ({
            indice,
            letra: letra(indice),
            encabezado: encabezados[indice] ?? null,
            muestra: filas.slice(mapeo.fila_datos - 1, mapeo.fila_datos + 2).map(f => f[indice] ?? null),
            papel: papeles.get(indice) ?? null,
        })),
        periodo: fechas.length ? { desde: fechas[0] ?? '', hasta: fechas.at(-1) ?? '' } : null,
        saldo_inicial: saldoInicial ? saldoInicial.toFixed(2) : null,
        saldo_final: saldoFinal ? saldoFinal.toFixed(2) : null,
        origen_saldos: saldoInicial ? 'columna_saldo' : null,
        entradas: entradas.toFixed(2),
        salidas: salidas.toFixed(2),
        lineas: lectura.filas.length,
        ignoradas: lectura.ignoradas,
        invertido: false,
        revisiones: {
            cuadra: { ok: cuadra, diferencia: cuadra || !saldoInicial || !saldoFinal ? null : saldoFinal.minus(saldoInicial).minus(entradas.minus(salidas)).toFixed(2), filas_saldo_no_encadena: [] },
            encadena: { ok: anterior ? (saldoInicial ? saldoInicial.equals(anterior.saldo_final) : null) : null, extracto_anterior_id: anterior?.id ?? null, saldo_anterior: anterior?.saldo_final ?? null },
            repetidos: { cantidad: repetidas.length, filas: repetidas.map(f => f.fila) },
        },
        errores: lectura.errores,
        filas: lectura.filas.slice(0, 10),
    }
}

function esRespuesta(valor: unknown): valor is RespuestaFixture {
    return typeof valor === 'object' && valor !== null && 'status' in valor && typeof (valor as { status: unknown }).status === 'number'
}

export const rutasArchivoExtracto: RutasFixture = {
    'POST /api/v1/bancos/extractos/vista-previa': conPermiso('bancos.importar_extracto_archivo', async (solicitud) => {
        const entrada = entradaDe(solicitud)
        if (esRespuesta(entrada)) {
            return entrada
        }
        const vista = await vistaPrevia(entrada)
        return esRespuesta(vista) ? vista : { status: 200, cuerpo: vista }
    }),

    'POST /api/v1/bancos/extractos/archivo': conPermiso('bancos.importar_extracto_archivo', conIdempotencia(async (solicitud) => {
        const entrada = entradaDe(solicitud)
        if (esRespuesta(entrada)) {
            return entrada
        }
        const vista = await vistaPrevia(entrada)
        if (esRespuesta(vista)) {
            return vista
        }
        if (vista.requiere_confirmacion) {
            return regla422('formato_no_reconocido', 'Formato no reconocido', 'Confirma las columnas en la vista previa y vuelve a enviar el mapeo.', [{ field: 'mapeo', message: 'Confirma el mapeo', rule: 'formato_no_reconocido' }])
        }
        if (vista.errores.length) {
            return regla422('extracto_con_errores', 'Filas ilegibles', `${vista.errores.length} fila(s) no se pudieron leer`, vista.errores.map(e => ({ field: `fila.${e.fila}`, message: e.mensaje, rule: 'extracto_con_errores' })))
        }
        if (!vista.saldo_inicial || !vista.saldo_final || !vista.periodo) {
            return regla422('saldos_requeridos', 'Faltan los saldos', 'El archivo no trae saldos: indica el saldo inicial y final.', [{ field: 'saldo_inicial', message: 'Obligatorio', rule: 'saldos_requeridos' }])
        }
        const cuerpo = (solicitud.cuerpo ?? {}) as Record<string, unknown>
        const repetidas = new Set(vista.revisiones.repetidos.filas)
        const lectura = interpretar(filasDe(await entrada.archivo.text()), vista.mapeo)
        const nuevas = lectura.filas.filter(f => !repetidas.has(f.fila))
        const respuesta = importar({
            ...solicitud,
            cuerpo: {
                cuenta_bancaria_id: entrada.cuentaBancariaId,
                desde: vista.periodo.desde,
                hasta: vista.periodo.hasta,
                saldo_inicial: vista.saldo_inicial,
                saldo_final: vista.saldo_final,
                archivo: entrada.archivo.name,
                sha256: vista.archivo.sha256,
                motivo_no_encadena: typeof cuerpo.motivo_no_encadena === 'string' ? cuerpo.motivo_no_encadena : null,
                lineas: (nuevas.length ? nuevas : lectura.filas).map(f => ({ fecha: f.fecha, descripcion: f.descripcion, referencia: f.referencia, monto: f.monto, saldo: f.saldo })),
            },
        })
        if (respuesta.status >= 400) {
            return respuesta
        }
        const guardar = cuerpo.guardar_mapeo !== 'false'
        if (guardar) {
            const anterior = mapeos.get(entrada.cuentaBancariaId)
            mapeos.set(entrada.cuentaBancariaId, { id: entrada.cuentaBancariaId, cuenta_bancaria_id: entrada.cuentaBancariaId, empresa_id: vista.cuenta.empresa_id, formato: vista.formato.codigo ?? 'manual', mapeo: vista.mapeo, version: (anterior?.version ?? 0) + 1, actualizado_por: usuariosPorToken[solicitud.token ?? '']?.id ?? null, updated_at: ahora() })
        }
        const extracto = respuesta.cuerpo as Schema<'Extracto'>
        const cuerpoRespuesta: Schema<'ExtractoDesdeArchivo'> = { extracto, archivo_id: extracto.id, sha256: vista.archivo.sha256, formato: vista.formato, mapeo_guardado: guardar }
        return { status: 201, cuerpo: cuerpoRespuesta }
    })),

    'GET /api/v1/bancos/cuentas-bancarias/:id/mapeo-extracto': conPermiso('bancos.ver', (solicitud) => {
        const guardado = mapeos.get(idDe(solicitud) ?? 0)
        return guardado ? { status: 200, cuerpo: guardado } : noEncontrado('el mapeo de la cuenta')
    }),

    'PUT /api/v1/bancos/cuentas-bancarias/:id/mapeo-extracto': conPermiso('bancos.guardar_mapeo_extracto', conIdempotencia((solicitud) => {
        const id = idDe(solicitud) ?? 0
        const cuenta = bd.cuentasBancarias.find(c => c.id === id)
        if (!cuenta) {
            return noEncontrado('la cuenta bancaria')
        }
        const cuerpo = (solicitud.cuerpo ?? {}) as { mapeo?: Mapeo, formato?: string | null, version?: number | null }
        if (!cuerpo.mapeo) {
            return invalido([{ field: 'mapeo', message: 'Falta el mapeo', rule: 'required' }])
        }
        const anterior = mapeos.get(id)
        if (anterior && cuerpo.version && cuerpo.version !== anterior.version) {
            return versionCambiada()
        }
        const guardado: MapeoGuardado = { id, cuenta_bancaria_id: id, empresa_id: cuenta.empresa_id ?? null, formato: cuerpo.formato ?? 'manual', mapeo: cuerpo.mapeo, version: (anterior?.version ?? 0) + 1, actualizado_por: usuariosPorToken[solicitud.token ?? '']?.id ?? null, updated_at: ahora() }
        mapeos.set(id, guardado)
        return { status: 200, cuerpo: guardado }
    })),
}

export function reiniciarMapeosExtracto(): void {
    mapeos.clear()
}
