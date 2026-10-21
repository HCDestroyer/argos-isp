import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { descifrar } from '#shared/cifrado'
import { ALGORITMO_SORTEO, hashLista, semillaFinal, sha256Hex, sortear } from '#lealtad/sorteo_v1'
import {
    REQUISITOS_PARA_EJECUTAR,
    detalleSorteo,
    exigirEstado,
    exigirRequisitos,
    listaDelCorte,
    titularesDe,
    verSorteo,
} from '#lealtad/sorteos'

/**
 * `sorteos.ejecutar` (`POST /lealtad/sorteos/:id/ejecutar`, permiso `sorteos.ejecutar`):
 * `corte_cerrado → ejecutado` (§7.3, punto 4).
 *
 * - Exige el checklist legal de ejecución (§8: `bases_diaco`, `isr_premios`, `timbre_fiscal`,
 *   `delegado_o_notario`; decisión del PM: la Gobernación y la fianza ya no) cumplido o que no aplica; si
 *   falta uno, 422 `requisito_pendiente` con la clave.
 * - `valor_publico`: el valor de la fuente pública que declararon las bases (`fuente_valor_publico`,
 *   congelada con `bases_hash`), con su evidencia (`valor_publico_evidencia`, obligatoria). Así quien
 *   conoce la semilla no elige el valor. `asistentes[]` opcional (nombre y rol).
 * - Revela la semilla, verifica `SHA-256(s) = compromiso` y vuelve a calcular `lista_hash` de los
 *   participantes; elige con `argos-sorteo-v1` (HMAC-SHA256, sin sesgo de módulo) los titulares (Σ
 *   cantidad de los premios, en orden de premio) y luego los suplentes.
 * - Guarda semilla, `valor_publico`, `semilla_final` y los elegidos en `resultado` (lo audita la acción:
 *   cualquiera lo reproduce con `scripts/verificar-sorteo.mjs`). Evento `sorteo.ejecutado`.
 */

export interface EntradaEjecutarSorteo {
    id: number
    /** el valor de la fuente que declararon las bases (`bases.fuente_valor_publico`) */
    valor_publico: string
    /** cómo se obtuvo en el acto (acta, enlace o número de la publicación oficial); obligatoria (422) */
    valor_publico_evidencia: string
    asistentes?: Array<{ nombre: string; rol?: string | null }>
}

export default class EjecutarSorteo extends DomainAction<
    EntradaEjecutarSorteo,
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.ejecutar'

    protected async handle(input: EntradaEjecutarSorteo, t: Transaccion) {
        t.fijarEntidad('sorteo', input.id)
        const valorPublico = input.valor_publico?.trim() ?? ''
        if (!valorPublico) {
            throw new ValidacionFallida([
                {
                    field: 'valor_publico',
                    message: 'El valor público del acto es obligatorio',
                    rule: 'required',
                },
            ])
        }
        const evidencia = input.valor_publico_evidencia?.trim() ?? ''
        if (evidencia.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'valor_publico_evidencia',
                    message: 'Registra cómo se obtuvo el valor público (acta, enlace o publicación oficial)',
                    rule: 'required',
                },
            ])
        }
        const sorteo = await verSorteo(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['corte_cerrado'], 'ejecutar')
        await exigirRequisitos(t.trx, sorteo.id, REQUISITOS_PARA_EJECUTAR, 'ejecutar el sorteo')

        const fila = (await t.trx
            .from('lealtad.sorteos')
            .where('id', sorteo.id)
            .select('semilla_cifrada')
            .firstOrFail()) as { semilla_cifrada: string }
        const semilla = Buffer.from(descifrar(fila.semilla_cifrada), 'hex')
        if (sha256Hex(semilla) !== sorteo.compromiso) {
            throw new ReglaNegocio('La semilla no coincide con su compromiso publicado', 'compromiso_roto')
        }
        const lista = await listaDelCorte(t.trx, sorteo.id)
        const listaHash = hashLista(lista)
        if (listaHash !== sorteo.lista_hash) {
            throw new ReglaNegocio('La lista del corte no coincide con su hash', 'lista_alterada')
        }
        if (lista.length === 0) {
            throw new ReglaNegocio('El sorteo no tiene participantes', 'sin_participantes')
        }

        const titulares = titularesDe(sorteo)
        const elegidos = sortear(
            semilla,
            listaHash,
            sorteo.bases_hash!,
            valorPublico,
            lista.map((p) => ({ codigo: p.codigo, boletos: p.boletos })),
            titulares + sorteo.suplentes,
        )
        // cada titular recibe el premio que le toca por orden: premio 1 (×cantidad), premio 2…
        const premiosPorPuesto = sorteo.premios.flatMap((p) =>
            Array.from({ length: p.cantidad }, () => p.posicion),
        )
        const porCodigo = new Map(lista.map((p) => [p.codigo, p]))
        const ganadores: Array<{ cliente_id: number; tipo: 'titular' | 'suplente'; posicion: number }> = []
        for (const [i, codigo] of elegidos.entries()) {
            const p = porCodigo.get(codigo)!
            const tipo = i < titulares ? 'titular' : 'suplente'
            await t.trx
                .insertQuery()
                .table('lealtad.sorteos_ganadores')
                .insert({
                    sorteo_id: sorteo.id,
                    posicion: i + 1,
                    tipo,
                    participante_id: p.id,
                    premio_posicion: tipo === 'titular' ? premiosPorPuesto[i] : null,
                })
            ganadores.push({ cliente_id: p.cliente_id, tipo, posicion: i + 1 })
        }
        const resultado = {
            algoritmo: ALGORITMO_SORTEO,
            semilla: semilla.toString('hex'),
            semilla_final: semillaFinal(semilla, listaHash, sorteo.bases_hash!, valorPublico).toString('hex'),
            valor_publico: valorPublico,
            fuente_valor_publico: sorteo.bases.fuente_valor_publico ?? null,
            valor_publico_evidencia: evidencia,
            lista_hash: listaHash,
            bases_hash: sorteo.bases_hash,
            titulares,
            suplentes: sorteo.suplentes,
            elegidos,
        }
        await t.trx
            .from('lealtad.sorteos')
            .where('id', sorteo.id)
            .update({
                estado: 'ejecutado',
                semilla: semilla.toString('hex'),
                valor_publico: valorPublico,
                valor_publico_evidencia: evidencia,
                resultado: JSON.stringify(resultado),
                asistentes: JSON.stringify(input.asistentes ?? []),
                ejecutado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'sorteo', id: sorteo.id },
            { estado: sorteo.estado },
            { estado: 'ejecutado', resultado },
        )
        await t.emit('sorteo.ejecutado', { sorteo_id: sorteo.id, empresa_id: sorteo.empresa_id, ganadores })
        return detalleSorteo(sorteo.id, t.trx)
    }
}
