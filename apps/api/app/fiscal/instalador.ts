import { createHash } from 'node:crypto'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { PaisNoSoportado } from '#fiscal/errores'
import { DESDE_PAQUETE } from '#fiscal/l10n/gt/parametros'
import {
    PAQUETE_GT_2026_1,
    PAQUETE_GT_2026_2,
    PAQUETE_GT_2026_3,
    PAQUETE_GT_2026_4,
} from '#fiscal/l10n/gt/index'
import type {
    DatosEmpresaInstalacion,
    OpcionesInstalacion,
    PaqueteLocalizacion,
    ResumenInstalacion,
} from '#fiscal/localizacion'

/**
 * Instalador de paquetes de localización (contrato §4 y §11.2).
 *
 * `instalarPaquete` **solo inserta lo que falta**; nunca borra ni cambia una cuenta, un valor o
 * una frase. Instalar la misma versión dos veces no agrega nada (ni siquiera una fila en
 * `fiscal.instalaciones`). Pasos:
 *
 *  1. `fiscal.localizaciones`: el catálogo de la versión con su checksum. Si la versión ya estaba
 *     publicada con otro contenido, falla: una versión publicada no se edita.
 *  2. `ledger.cuentas` (catálogo común, `pais`): plan base + cuentas del paquete que falten.
 *  3. `fiscal.parametros`: catálogo de parámetros del país.
 *  4. `fiscal.parametros_valores`: valores del paquete (`empresa_id` null, `origen = paquete`), y
 *     `fiscal.impuestos` / `fiscal.impuestos_versiones`: los impuestos con sus tasas por vigencia.
 *  5. Solo si la empresa no tenía esta versión: `inicio_libros`, el régimen que ya tenía
 *     (`core.empresas.regimen_isr`), el establecimiento (`codigo_establecimiento`) y la fila de
 *     `fiscal.instalaciones`. Las frases del régimen no se guardan: se derivan al leer.
 */

/** Versiones publicadas, por código. */
export const PAQUETES: Readonly<Record<string, PaqueteLocalizacion>> = {
    [PAQUETE_GT_2026_1.codigo]: PAQUETE_GT_2026_1,
    [PAQUETE_GT_2026_2.codigo]: PAQUETE_GT_2026_2,
    [PAQUETE_GT_2026_3.codigo]: PAQUETE_GT_2026_3,
    [PAQUETE_GT_2026_4.codigo]: PAQUETE_GT_2026_4,
}

/** Versión más reciente del paquete de cada país (la que instala el núcleo al crear la empresa). */
export const ULTIMO_PAQUETE: Readonly<Record<string, PaqueteLocalizacion>> = {
    GT: PAQUETE_GT_2026_4,
}

/** Países con paquete, en el orden del selector. */
export function paisesConPaquete(): string[] {
    return Object.keys(ULTIMO_PAQUETE)
}

/** Paquete más reciente del país; 422 `pais_no_soportado` si no hay. */
export function paqueteDePais(pais: string): PaqueteLocalizacion {
    const paquete = ULTIMO_PAQUETE[pais.toUpperCase()]
    if (!paquete) throw new PaisNoSoportado(pais)
    return paquete
}

/** sha256 del contenido del paquete (cuentas, parámetros, frases y tipos de DTE). */
export function checksumPaquete(paquete: PaqueteLocalizacion): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                codigo: paquete.codigo,
                pais: paquete.pais,
                version: paquete.version,
                cuentas: paquete.cuentas,
                parametros: paquete.parametros,
                impuestos: paquete.impuestos,
                cuadriculas: paquete.cuadriculas,
                regimenes: paquete.regimenes,
                frases: paquete.frases_por_regimen,
                tipos_dte: paquete.tipos_dte,
            }),
        )
        .digest('hex')
}

export interface FilaInstalacion {
    id: number
    empresa_id: number
    localizacion_codigo: string
    de_codigo: string | null
    pais: string
    instalada_en: Date
    instalada_por: number | null
    resumen: Record<string, unknown>
}

/** Última instalación de la empresa (la vigente) o null. */
export async function instalacionVigente(
    cliente: QueryClientContract,
    empresaId: number,
): Promise<FilaInstalacion | null> {
    const fila = (await cliente
        .from('fiscal.instalaciones as i')
        .join('fiscal.localizaciones as l', 'l.codigo', 'i.localizacion_codigo')
        .where('i.empresa_id', empresaId)
        .orderBy('i.id', 'desc')
        .select('i.*', 'l.pais')
        .first()) as FilaInstalacion | null
    return fila ? { ...fila, id: Number(fila.id), empresa_id: Number(fila.empresa_id) } : null
}

async function publicarVersion(trx: QueryClientContract, paquete: PaqueteLocalizacion) {
    const checksum = checksumPaquete(paquete)
    await trx
        .knexQuery()
        .table('fiscal.localizaciones')
        .insert({
            codigo: paquete.codigo,
            pais: paquete.pais,
            version: paquete.version,
            publicada_en: paquete.publicada_en,
            checksum,
        })
        .onConflict('codigo')
        .ignore()
    const fila = (await trx
        .from('fiscal.localizaciones')
        .where('codigo', paquete.codigo)
        .select('checksum')
        .firstOrFail()) as { checksum: string }
    if (fila.checksum !== checksum) {
        throw new Error(
            `El paquete ${paquete.codigo} cambió después de publicarse (checksum distinto): publique una versión nueva`,
        )
    }
}

async function agregarCuentas(trx: QueryClientContract, paquete: PaqueteLocalizacion): Promise<string[]> {
    const ids = new Map<string, number>()
    const filas = (await trx
        .from('ledger.cuentas')
        .where('pais', paquete.pais)
        .select('id', 'codigo')) as Array<{ id: number; codigo: string }>
    for (const fila of filas) ids.set(fila.codigo, Number(fila.id))

    const agregadas: string[] = []
    for (const cuenta of paquete.cuentas) {
        if (ids.has(cuenta.codigo)) continue
        const padreId = cuenta.padre ? ids.get(cuenta.padre) : null
        if (padreId === undefined) {
            throw new Error(
                `Paquete ${paquete.codigo}: la cuenta ${cuenta.codigo} no tiene a su padre ${cuenta.padre}`,
            )
        }
        const [fila] = (await trx
            .insertQuery()
            .table('ledger.cuentas')
            .insert({
                pais: paquete.pais,
                codigo: cuenta.codigo,
                nombre: cuenta.nombre,
                tipo: cuenta.tipo,
                padre_id: padreId,
                imputable: cuenta.imputable,
                auxiliar_cliente: cuenta.auxiliar_cliente ?? false,
                contracuenta: cuenta.contracuenta ?? false,
                auxiliar_proveedor: cuenta.auxiliar_proveedor ?? false,
                categoria_fiscal: cuenta.categoria_fiscal ?? null,
                libro_inventario: cuenta.libro_inventario ?? false,
                categoria_flujo: cuenta.categoria_flujo ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        ids.set(cuenta.codigo, Number(fila!.id))
        agregadas.push(cuenta.codigo)
    }
    return agregadas
}

async function agregarCatalogo(trx: QueryClientContract, paquete: PaqueteLocalizacion): Promise<string[]> {
    const agregados: string[] = []
    for (const p of paquete.parametros) {
        const filas = (await trx
            .knexQuery()
            .table('fiscal.parametros')
            .insert({
                pais: paquete.pais,
                clave: p.clave,
                tipo: p.tipo,
                alcance: p.alcance,
                descripcion: p.descripcion,
                fuente: p.fuente,
                confianza: p.confianza,
                confirmar_contador: p.confirmar_contador,
                opciones: p.opciones ? JSON.stringify(p.opciones) : null,
                minimo: p.minimo ?? null,
                maximo: p.maximo ?? null,
                accion: p.accion ?? null,
                derivado: p.derivado ?? false,
                tope_por_clave: p.tope_por_clave ?? false,
                localizacion_codigo: paquete.codigo,
            })
            .onConflict(['pais', 'clave'])
            .ignore()
            .returning('clave')) as Array<{ clave: string }>
        if (filas.length > 0) agregados.push(p.clave)
    }
    return agregados
}

async function agregarValoresPaquete(
    trx: QueryClientContract,
    paquete: PaqueteLocalizacion,
): Promise<ResumenInstalacion['valores']> {
    const agregados: ResumenInstalacion['valores'] = []
    for (const p of paquete.parametros) {
        for (const valor of p.valores) {
            const filas = (await trx.rawQuery(
                `INSERT INTO fiscal.parametros_valores
                    (pais, empresa_id, clave, valor, vigente_desde, origen, localizacion_codigo)
                 VALUES (?, NULL, ?, ?::jsonb, ?, 'paquete', ?)
                 ON CONFLICT (pais, empresa_id, clave, vigente_desde, origen) DO NOTHING
                 RETURNING id`,
                [paquete.pais, p.clave, JSON.stringify(valor.valor), valor.vigente_desde, paquete.codigo],
            )) as { rows: Array<{ id: number }> }
            if (filas.rows.length > 0) {
                agregados.push({ clave: p.clave, vigente_desde: valor.vigente_desde, empresa_id: null })
            }
        }
    }
    return agregados
}

async function agregarImpuestos(trx: QueryClientContract, paquete: PaqueteLocalizacion): Promise<string[]> {
    const agregados: string[] = []
    for (const imp of paquete.impuestos) {
        await trx
            .knexQuery()
            .table('fiscal.impuestos')
            .insert({
                pais: paquete.pais,
                codigo: imp.codigo,
                grupo: imp.grupo,
                uso: imp.uso,
                localizacion_codigo: paquete.codigo,
            })
            .onConflict(['pais', 'codigo'])
            .ignore()
        for (const version of imp.versiones) {
            const filas = (await trx.rawQuery(
                `INSERT INTO fiscal.impuestos_versiones
                    (pais, codigo, empresa_id, vigente_desde, origen, nombre, calculo, base_impuesto, tasa, signo,
                     incluido, exigibilidad, cuenta_cuota, cuenta_transicion, cuadricula_base, cuadricula_cuota,
                     descripcion, fuente, confianza, confirmar_contador, activo, localizacion_codigo)
                 VALUES (?, ?, NULL, ?, 'paquete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?)
                 ON CONFLICT (pais, codigo, empresa_id, vigente_desde, origen) DO NOTHING
                 RETURNING id`,
                [
                    paquete.pais,
                    imp.codigo,
                    version.vigente_desde,
                    imp.nombre,
                    imp.calculo,
                    imp.base_impuesto as string,
                    version.tasa,
                    imp.signo,
                    imp.incluido,
                    imp.exigibilidad,
                    imp.cuenta_cuota,
                    imp.cuenta_transicion as string,
                    imp.cuadricula_base as string,
                    imp.cuadricula_cuota,
                    imp.descripcion,
                    imp.fuente,
                    imp.confianza,
                    imp.confirmar_contador,
                    paquete.codigo,
                ],
            )) as { rows: Array<{ id: number }> }
            if (filas.rows.length > 0) agregados.push(`${imp.codigo}@${version.vigente_desde}`)
        }
    }
    return agregados
}

async function datosEmpresa(trx: QueryClientContract, empresaId: number): Promise<DatosEmpresaInstalacion> {
    const fila = (await trx
        .from('core.empresas')
        .where('id', empresaId)
        .select(
            'regimen_isr',
            'codigo_establecimiento',
            'nombre_comercial',
            'direccion_fiscal',
            'municipio',
            'departamento',
        )
        .first()) as DatosEmpresaInstalacion | null
    if (!fila) throw new NoEncontrado(`La empresa ${empresaId} no existe`)
    return {
        ...fila,
        codigo_establecimiento:
            fila.codigo_establecimiento === null ? null : Number(fila.codigo_establecimiento),
    }
}

async function tieneValorDeEmpresa(trx: QueryClientContract, pais: string, empresaId: number, clave: string) {
    return Boolean(
        await trx
            .from('fiscal.parametros_valores')
            .where({ pais, empresa_id: empresaId, clave })
            .select('id')
            .first(),
    )
}

async function insertarValorInstalacion(
    trx: QueryClientContract,
    paquete: PaqueteLocalizacion,
    empresaId: number,
    clave: string,
    valor: unknown,
    vigenteDesde: string,
    motivo: string,
    creadoPor: number | null,
) {
    await trx
        .insertQuery()
        .table('fiscal.parametros_valores')
        .insert({
            pais: paquete.pais,
            empresa_id: empresaId,
            clave,
            valor: JSON.stringify(valor),
            vigente_desde: vigenteDesde,
            origen: 'instalacion',
            localizacion_codigo: paquete.codigo,
            motivo,
            creado_por: creadoPor,
        })
}

/**
 * Aplica `paquete` a la empresa (ver el encabezado). Corre dentro de la transacción de quien lo
 * llama (la acción `fiscal.actualizar_localizacion`, `empresas.cambiar_pais` de A1 o la migración).
 */
export async function instalarPaquete(
    trx: TransactionClientContract | QueryClientContract,
    paquete: PaqueteLocalizacion,
    empresaId: number,
    opciones: OpcionesInstalacion,
): Promise<ResumenInstalacion> {
    // una instalación a la vez por base (el catálogo es común a las empresas)
    await trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [3011])
    const datos = await datosEmpresa(trx, empresaId)

    await publicarVersion(trx, paquete)
    const cuentas = await agregarCuentas(trx, paquete)
    const parametros = await agregarCatalogo(trx, paquete)
    const valores = await agregarValoresPaquete(trx, paquete)
    const impuestos = await agregarImpuestos(trx, paquete)

    const vigente = await instalacionVigente(trx, empresaId)
    const resumen: ResumenInstalacion = {
        empresa_id: empresaId,
        codigo: paquete.codigo,
        de_codigo: vigente?.localizacion_codigo ?? null,
        ya_instalada: vigente?.localizacion_codigo === paquete.codigo,
        cuentas,
        parametros,
        valores,
        impuestos,
        establecimientos: [],
        instalacion_id: null,
    }
    if (resumen.ya_instalada) {
        resumen.de_codigo = vigente!.de_codigo
        return resumen
    }

    // inicio_libros: desde la instalación ArgosIsp es el libro oficial (contrato §11.5)
    if (!(await tieneValorDeEmpresa(trx, paquete.pais, empresaId, 'inicio_libros'))) {
        await insertarValorInstalacion(
            trx,
            paquete,
            empresaId,
            'inicio_libros',
            opciones.hoy,
            DESDE_PAQUETE,
            `Instalación de ${paquete.codigo}: fecha de inicio de los libros en ArgosIsp`,
            opciones.instaladaPor,
        )
        valores.push({ clave: 'inicio_libros', vigente_desde: DESDE_PAQUETE, empresa_id: empresaId })
    }

    // régimen que ya tenía la empresa (core.empresas.regimen_isr), con fecha de la instalación; sin él
    // rige el del paquete (la SAT inscribe en utilidades). Las frases del régimen se derivan al leer.
    const inicial = paquete.regimenInicial(datos)
    if (inicial && !(await tieneValorDeEmpresa(trx, paquete.pais, empresaId, 'regimen'))) {
        await insertarValorInstalacion(
            trx,
            paquete,
            empresaId,
            'regimen',
            inicial,
            opciones.hoy,
            `Instalación de ${paquete.codigo}: régimen de core.empresas.regimen_isr (${datos.regimen_isr})`,
            opciones.instaladaPor,
        )
        valores.push({ clave: 'regimen', vigente_desde: opciones.hoy, empresa_id: empresaId })
    }

    // establecimiento 1 desde core.empresas.codigo_establecimiento (un establecimiento por empresa)
    const conEstablecimiento = await trx
        .from('fiscal.establecimientos')
        .where('empresa_id', empresaId)
        .select('id')
        .first()
    if (!conEstablecimiento && datos.codigo_establecimiento !== null) {
        const [fila] = (await trx
            .insertQuery()
            .table('fiscal.establecimientos')
            .insert({
                empresa_id: empresaId,
                codigo: datos.codigo_establecimiento,
                nombre: datos.nombre_comercial,
                direccion: datos.direccion_fiscal,
                municipio: datos.municipio,
                departamento: datos.departamento,
                activo: true,
                por_defecto: true,
            })
            .returning('id')) as Array<{ id: number }>
        resumen.establecimientos.push(Number(fila!.id))
    }

    const { instalacion_id: sinId, ...guardado } = resumen
    void sinId
    const [fila] = (await trx
        .insertQuery()
        .table('fiscal.instalaciones')
        .insert({
            empresa_id: empresaId,
            localizacion_codigo: paquete.codigo,
            de_codigo: resumen.de_codigo,
            instalada_por: opciones.instaladaPor,
            resumen: JSON.stringify(guardado),
        })
        .returning('id')) as Array<{ id: number }>
    resumen.instalacion_id = Number(fila!.id)
    return resumen
}
