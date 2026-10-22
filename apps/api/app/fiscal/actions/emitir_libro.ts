import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { periodoCerrado } from '#ledger/cierres'
import { bloqueoVigente } from '#ledger/bloqueos'
import { verificarCadena } from '#ledger/sellos'
import {
    construirLibro,
    esLibroEmitible,
    mesesEntre,
    rangoMeses,
    type LibroEmitible,
} from '#fiscal/libros_legales'
import {
    LOCK_LIBROS,
    borrarArchivo,
    emisionQueCubre,
    empresaDelLibroLegal,
    foliosDe,
    generarArchivoLibro,
    guardarArchivo,
    sha256,
    verEmision,
    type EmisionVista,
    type FormatoEmision,
} from '#fiscal/libros_emisiones'

/**
 * `libros.emitir` (`POST /libros/:libro/emitir`): emisión oficial con folio de un libro legal
 * (contrato de localización fiscal §7). Diario, Mayor, Compras y Ventas.
 *
 * - Meses completos: `desde` va al primer día de su mes y `hasta` al último del suyo.
 * - Cada mes del rango cerrado **y** el rango bajo el bloqueo `global` o `duro` (el mayor de los
 *   dos llega al último día de `hasta`): si no, 422 `periodo_sin_bloqueo` con un `errors[]` por
 *   mes abierto (`rule` `mes_abierto`) y uno por el bloqueo (`rule` `sin_bloqueo`).
 * - La cadena de hash del rango verificada (409 `integridad_rota`); la emisión guarda el último
 *   sello y hash que guardó el cierre del último mes (§10.10).
 * - Folios: el siguiente del libro (el primero habilitado o el que sigue a la última emisión) y
 *   tantos como páginas tenga el PDF; sin habilitación o sin folios suficientes, 422
 *   `folios_agotados` (`errors[]` con necesarios y disponibles). El trigger de
 *   `fiscal.libros_emisiones` lo repite.
 * - Un rango que se cruza con una emisión anterior del mismo libro es una **reimpresión**: folios
 *   nuevos, `reimpresion_de` = esa emisión y la marca en el encabezado.
 * - Guarda el archivo (PDF, o XLSX con el folio de cada fila) con su SHA-256 y emite
 *   `libro.emitido`.
 */

export interface EntradaEmitirLibro {
    empresa_id?: number | null
    libro: LibroEmitible
    desde: string
    hasta?: string | null
    formato?: FormatoEmision
    /** instante de la emisión (pruebas); por defecto ahora */
    ahora?: Date
}

export default class EmitirLibro extends DomainAction<EntradaEmitirLibro, EmisionVista> {
    readonly nombre = 'libros.emitir'

    protected async handle(input: EntradaEmitirLibro, t: Transaccion): Promise<EmisionVista> {
        if (!esLibroEmitible(input.libro)) {
            throw new ValidacionFallida([
                { field: 'libro', message: 'Uno de: diario, mayor, compras, ventas', rule: 'enum' },
            ])
        }
        const formato: FormatoEmision = input.formato ?? 'pdf'
        const { desde, hasta } = rangoMeses({ desde: input.desde, hasta: input.hasta ?? input.desde })
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_LIBROS, empresaId])

        // meses cerrados y bloqueo global o duro hasta el fin del rango
        const errores: ErrorCampo[] = []
        for (const mes of mesesEntre(desde, hasta)) {
            if (!(await periodoCerrado(t.trx, mes, empresaId))) {
                errores.push({
                    field: 'hasta',
                    message: `El mes ${mes.slice(0, 7)} está abierto`,
                    rule: 'mes_abierto',
                })
            }
        }
        const global = await bloqueoVigente(t.trx, empresaId, 'global')
        const duro = await bloqueoVigente(t.trx, empresaId, 'duro')
        const bloqueo =
            [global, duro]
                .filter((f): f is string => f !== null)
                .sort()
                .at(-1) ?? null
        if (bloqueo === null || bloqueo < hasta) {
            errores.push({
                field: 'hasta',
                message: bloqueo
                    ? `El libro está bloqueado hasta ${bloqueo}; falta hasta ${hasta}`
                    : 'El libro no tiene bloqueo global ni duro',
                rule: 'sin_bloqueo',
            })
        }
        if (errores.length > 0) {
            throw new Problema(
                422,
                'periodo_sin_bloqueo',
                'Periodo sin bloqueo',
                `El libro oficial se emite solo de meses cerrados y bajo el bloqueo global o duro (${desde} a ${hasta})`,
                errores,
            )
        }

        // la cadena del rango verifica; el último hash es el que guardó el cierre del último mes
        const integridad = await verificarCadena(empresaId, { desde, hasta }, t.trx)
        if (integridad.ruptura || integridad.sin_sellar > 0) {
            const r = integridad.ruptura
            throw new Conflicto(
                r
                    ? `La cadena de hash del libro está rota en el sello ${r.sello} (${r.motivo}): no se puede emitir`
                    : `Hay ${integridad.sin_sellar} asientos sin sellar en el rango: no se puede emitir`,
                'integridad_rota',
                'Integridad del libro',
            )
        }
        const cierre = (await t.trx
            .from('ledger.cierres_mensuales as c')
            .where('c.empresa_id', empresaId)
            .where('c.periodo', hasta.slice(0, 8) + '01')
            .whereNotExists((q) => q.from('ledger.reaperturas_mensuales as r').whereRaw('r.cierre_id = c.id'))
            .orderBy('c.id', 'desc')
            .select('c.ultimo_sello', 'c.ultimo_hash')
            .first()) as { ultimo_sello: number | null; ultimo_hash: string | null } | null
        const ultimoSello = cierre?.ultimo_sello ?? integridad.ultimo_sello
        const ultimoHash = cierre?.ultimo_hash ?? integridad.ultimo_hash

        const folios = await foliosDe(t.trx, empresaId, input.libro)
        if (folios.siguiente === null) {
            throw new Problema(
                422,
                'folios_agotados',
                'Folios agotados',
                `El libro ${input.libro} no tiene folios habilitados: registre la habilitación (POST /libros/habilitaciones)`,
                [{ field: 'libro', message: 'Sin rango habilitado', rule: 'folios_agotados' }],
            )
        }
        const reimpresion = await emisionQueCubre(t.trx, empresaId, input.libro, desde, hasta)

        const generadoEn = input.ahora ?? new Date()
        const libro = await construirLibro(input.libro, empresaId, { desde, hasta }, t.trx)
        const empresa = await empresaDelLibroLegal(t.trx, empresaId)
        const oficial = {
            folio_inicial: folios.siguiente,
            reimpresion,
            ultimo_sello: ultimoSello === null ? null : Number(ultimoSello),
            ultimo_hash: ultimoHash,
        }
        const archivo = await generarArchivoLibro(libro, empresa, formato, generadoEn, oficial)
        if (archivo.paginas > folios.disponibles) {
            throw new Problema(
                422,
                'folios_agotados',
                'Folios agotados',
                `El libro necesita ${archivo.paginas} folios y quedan ${folios.disponibles} habilitados (del ${folios.siguiente} al ${folios.ultimo_habilitado})`,
                [
                    {
                        field: 'libro',
                        message: `Necesita ${archivo.paginas} folios; disponibles ${folios.disponibles}`,
                        rule: 'folios_agotados',
                    },
                ],
            )
        }

        const huella = sha256(archivo.contenido)
        const ruta = await guardarArchivo(empresaId, input.libro, formato, archivo.contenido)
        let id: number
        try {
            const [fila] = (await t.trx
                .insertQuery()
                .table('fiscal.libros_emisiones')
                .insert({
                    empresa_id: empresaId,
                    libro: input.libro,
                    desde,
                    hasta,
                    folio_inicial: folios.siguiente,
                    folio_final: folios.siguiente + archivo.paginas - 1,
                    paginas: archivo.paginas,
                    formato,
                    archivo: ruta,
                    tamano: archivo.contenido.length,
                    sha256: huella,
                    filas: libro.reporte.filas.length,
                    totales: JSON.stringify(libro.reporte.totales),
                    ultimo_sello: oficial.ultimo_sello,
                    ultimo_hash: oficial.ultimo_hash,
                    reimpresion_de: reimpresion?.id ?? null,
                    generado_por: usuarioDelActor(t.ctx.actor),
                    generado_en: generadoEn,
                })
                .returning('id')) as Array<{ id: number }>
            id = Number(fila!.id)
        } catch (error) {
            await borrarArchivo(ruta)
            throw error
        }
        t.fijarEntidad('libro_emision', id)
        const emision = await verEmision(id, t.trx)
        await t.emit('libro.emitido', {
            emision_id: id,
            empresa_id: empresaId,
            libro: input.libro,
            desde,
            hasta,
            folio_inicial: emision.folio_inicial,
            folio_final: emision.folio_final,
            formato,
            sha256: huella,
            reimpresion_de: emision.reimpresion_de,
        })
        return emision
    }
}
