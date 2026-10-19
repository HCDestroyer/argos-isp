import db from '@adonisjs/lucid/services/db'
import { NoEncontrado } from '#shared/errores'
import { ganadoresDe, verSorteo, type EstadoSorteo } from '#lealtad/sorteos'
import { marcaDeEmpresa, type MarcaEmpresa } from '#portal/marca'

/**
 * Sorteos en el portal (contrato `lealtad.md` §7 y §12), lecturas de `lealtad.sorteos*` de A3:
 *
 * - **Avisos** (`GET /portal/avisos-sorteo`): los sorteos que el panel ya activó para el público
 *   (bases publicadas o participación abierta) y que aún no se sortean, de las empresas del cliente.
 *   Van en el carrusel del inicio y de la página de corte. Sin imágenes: en la página de corte el
 *   cliente suspendido solo alcanza el walled garden.
 * - **Página pública** (`GET /portal/sorteos/:id/publico`): bases, premios, compromiso y, al
 *   terminar, los ganadores por seudónimo. Es lo que la ley pide publicar: sin datos de nadie.
 *
 * La lista con los boletos y el seudónimo del cliente es `GET /portal/sorteos` (A3).
 */

const ESTADOS_AVISO: readonly EstadoSorteo[] = ['bases_publicadas', 'participacion_abierta']
const ESTADOS_TERMINADOS: readonly EstadoSorteo[] = ['ejecutado', 'premios_entregados']

export interface AvisoSorteo {
    id: number
    empresa_id: number
    nombre: string
    estado: EstadoSorteo
    corte_en: string | null
    fecha_sorteo: string | null
    premio_principal: string | null
    premios: number
}

function iso(valor: Date | string | null): string | null {
    if (valor === null) return null
    return valor instanceof Date ? valor.toISOString() : new Date(valor).toISOString()
}

/** Empresas con servicios vivos del cliente (o solo `empresaId`, la del servicio de la IP). */
async function empresasDelCliente(clienteId: number, empresaId?: number): Promise<number[]> {
    if (empresaId !== undefined) return [empresaId]
    const filas = (await db
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .select(db.raw('DISTINCT coalesce(empresa_id, 1)::int AS empresa_id'))) as Array<{
        empresa_id: number
    }>
    return filas.map((f) => Number(f.empresa_id))
}

/** Sorteos próximos que el panel ya abrió al público, del más cercano al más lejano. */
export async function avisosDeSorteo(clienteId: number | null, empresaId?: number): Promise<AvisoSorteo[]> {
    if (clienteId === null) return []
    const empresas = await empresasDelCliente(clienteId, empresaId)
    if (empresas.length === 0) return []
    const filas = (await db
        .from('lealtad.sorteos')
        .whereIn('empresa_id', empresas)
        .whereIn('estado', [...ESTADOS_AVISO])
        .whereRaw('fecha_sorteo > now()')
        .orderBy('fecha_sorteo', 'asc')
        .orderBy('id', 'asc')
        .select('id')) as Array<{ id: number }>
    const salida: AvisoSorteo[] = []
    for (const { id } of filas) {
        const s = await verSorteo(Number(id))
        const principal = [...s.premios].sort((a, b) => a.posicion - b.posicion)[0]
        salida.push({
            id: s.id,
            empresa_id: s.empresa_id,
            nombre: s.nombre,
            estado: s.estado,
            corte_en: iso(s.corte_en),
            fecha_sorteo: iso(s.fecha_sorteo),
            premio_principal: principal?.nombre ?? null,
            premios: s.premios.reduce((n, p) => n + Number(p.cantidad), 0),
        })
    }
    return salida
}

export interface SorteoPublico {
    id: number
    empresa: MarcaEmpresa
    nombre: string
    descripcion: string | null
    estado: EstadoSorteo
    inscripcion_desde: string | null
    corte_en: string | null
    fecha_sorteo: string | null
    lugar: string | null
    premios: Array<{
        posicion: number
        nombre: string
        cantidad: number
        valor: string
        imagen_url: string | null
    }>
    bases: {
        mecanica: string | null
        regla_participacion: string | null
        plazo_reclamo_dias: number | null
        no_reclamados: string | null
        publicacion_resultados: string | null
        fuente_valor_publico: string | null
        resolucion_gobernacion: string | null
    }
    bases_hash: string
    compromiso: string | null
    motivo_cancelacion: string | null
    verificable: boolean
    ganadores: Array<{
        posicion: number
        tipo: 'titular' | 'suplente'
        codigo: string
        premio_posicion: number | null
    }> | null
}

function textoONulo(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() !== '' ? valor : null
}

/** Página pública de un sorteo: desde que publica sus bases (antes, 404 como uno inexistente). */
export async function sorteoPublico(id: number): Promise<SorteoPublico> {
    const s = await verSorteo(id).catch(() => null)
    if (!s || s.estado === 'borrador' || !s.bases_hash) {
        throw new NoEncontrado('El sorteo no existe o aún no publica sus bases')
    }
    const terminado = ESTADOS_TERMINADOS.includes(s.estado)
    const ganadores = terminado ? await ganadoresDe(s.id) : null
    const bases = (s.bases ?? {}) as Record<string, unknown>
    return {
        id: s.id,
        empresa: await marcaDeEmpresa(s.empresa_id),
        nombre: s.nombre,
        descripcion: s.descripcion,
        estado: s.estado,
        inscripcion_desde: s.inscripcion_desde,
        corte_en: iso(s.corte_en),
        fecha_sorteo: iso(s.fecha_sorteo),
        lugar: s.lugar,
        premios: [...s.premios]
            .sort((a, b) => a.posicion - b.posicion)
            .map((p) => ({
                posicion: p.posicion,
                nombre: p.nombre,
                cantidad: Number(p.cantidad),
                valor: String(p.valor),
                imagen_url: p.imagen_url,
            })),
        bases: {
            mecanica: textoONulo(bases.mecanica),
            regla_participacion: textoONulo(bases.regla_participacion),
            plazo_reclamo_dias:
                typeof bases.plazo_reclamo_dias === 'number' ? bases.plazo_reclamo_dias : null,
            no_reclamados: textoONulo(bases.no_reclamados),
            publicacion_resultados: textoONulo(bases.publicacion_resultados),
            fuente_valor_publico: textoONulo(bases.fuente_valor_publico),
            resolucion_gobernacion: textoONulo(bases.resolucion_gobernacion),
        },
        bases_hash: s.bases_hash,
        compromiso: s.compromiso,
        motivo_cancelacion: s.estado === 'cancelado' ? s.motivo_cancelacion : null,
        verificable: terminado,
        ganadores: ganadores
            ? ganadores.map((g) => ({
                  posicion: g.posicion,
                  tipo: g.tipo,
                  codigo: g.codigo_publico,
                  premio_posicion: g.premio_posicion,
              }))
            : null,
    }
}
