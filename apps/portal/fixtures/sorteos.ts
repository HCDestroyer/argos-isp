import type { Schema } from '@argosisp/contracts'
import { MARCA_FIXTURE } from './empresa'

/**
 * Sorteos en fixtures (contrato `lealtad.md` §7 y §12), como los devuelve la API: uno con la
 * participación abierta y otro ya sorteado en el que el cliente ganó el segundo premio.
 */

const HASH_BASES = '3f7a9c1e5b2d4f6a8c0e1b3d5f7a9c1e5b2d4f6a8c0e1b3d5f7a9c1e5b2d4f6a'
const COMPROMISO = 'a81c0e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a91'

const PREMIOS = [
    { posicion: 1, nombre: 'Televisor de 55"', cantidad: 1, imagen_url: '/favicon.svg', valor: '3500.00' },
    { posicion: 2, nombre: 'Router Wi-Fi 6', cantidad: 2, imagen_url: null, valor: '650.00' },
    { posicion: 3, nombre: 'Un mes gratis', cantidad: 5, imagen_url: 'https://cdn.example.com/mes.png', valor: '175.00' },
]

const REGLA = '1 boleto por cada servicio al día al cierre de la lista, más los boletos que canjees con tus puntos.'

export const SORTEO_ABIERTO_FIXTURE: Schema<'PortalSorteo'> = {
    id: 31,
    empresa_id: MARCA_FIXTURE.id,
    nombre: 'Gran sorteo de aniversario',
    descripcion: 'Celebramos 10 años con nuestros clientes.',
    estado: 'participacion_abierta',
    regla_participacion: REGLA,
    inscripcion_desde: '2026-10-01',
    corte_en: '2026-11-30T23:59:00.000Z',
    fecha_sorteo: '2026-12-05T00:00:00.000Z',
    lugar: 'Oficinas centrales, Quetzaltenango',
    premios: PREMIOS,
    bases_hash: HASH_BASES,
    compromiso: COMPROMISO,
    mis_boletos: 3,
    mi_codigo: null,
    ganadores: null,
}

export const SORTEO_EJECUTADO_FIXTURE: Schema<'PortalSorteo'> = {
    ...SORTEO_ABIERTO_FIXTURE,
    id: 27,
    nombre: 'Sorteo del Día del Cliente',
    descripcion: null,
    estado: 'ejecutado',
    corte_en: '2026-09-30T23:59:00.000Z',
    fecha_sorteo: '2026-10-05T00:00:00.000Z',
    premios: PREMIOS.slice(0, 2).map(p => ({ ...p, cantidad: 1 })),
    mis_boletos: 2,
    mi_codigo: 'K7Q-24M',
    ganadores: [
        { posicion: 1, tipo: 'titular', codigo: 'B2X-91P', premio_posicion: 1 },
        { posicion: 2, tipo: 'titular', codigo: 'K7Q-24M', premio_posicion: 2 },
        { posicion: 1, tipo: 'suplente', codigo: 'Z4H-08C', premio_posicion: null },
    ],
}

export const AVISO_SORTEO_FIXTURE: Schema<'PortalAvisoSorteo'> = {
    id: SORTEO_ABIERTO_FIXTURE.id,
    empresa_id: MARCA_FIXTURE.id,
    nombre: SORTEO_ABIERTO_FIXTURE.nombre,
    estado: 'participacion_abierta',
    corte_en: SORTEO_ABIERTO_FIXTURE.corte_en,
    fecha_sorteo: SORTEO_ABIERTO_FIXTURE.fecha_sorteo,
    premio_principal: PREMIOS[0]!.nombre,
    premios: 8,
}

function publico(s: Schema<'PortalSorteo'>): Schema<'PortalSorteoPublico'> {
    return {
        id: s.id,
        empresa: MARCA_FIXTURE,
        nombre: s.nombre,
        descripcion: s.descripcion,
        estado: s.estado,
        inscripcion_desde: s.inscripcion_desde,
        corte_en: s.corte_en,
        fecha_sorteo: s.fecha_sorteo,
        lugar: s.lugar,
        premios: s.premios,
        bases: {
            mecanica: 'Sorteo electrónico con el algoritmo argos-sorteo-v1, ante notario.',
            regla_participacion: REGLA,
            plazo_reclamo_dias: 30,
            no_reclamados: 'Pasan al suplente en orden.',
            publicacion_resultados: 'En este portal y en nuestras redes el mismo día.',
            fuente_valor_publico: 'Primer premio de la Lotería Santa Lucía del día del sorteo.',
            resolucion_gobernacion: 'GD-QZ-2026-118',
        },
        bases_hash: HASH_BASES,
        compromiso: COMPROMISO,
        motivo_cancelacion: null,
        verificable: s.estado === 'ejecutado' || s.estado === 'premios_entregados',
        ganadores: s.ganadores,
    }
}

export const SORTEOS_PUBLICOS_FIXTURE: Record<number, Schema<'PortalSorteoPublico'>> = {
    [SORTEO_ABIERTO_FIXTURE.id]: publico(SORTEO_ABIERTO_FIXTURE),
    [SORTEO_EJECUTADO_FIXTURE.id]: publico(SORTEO_EJECUTADO_FIXTURE),
}
