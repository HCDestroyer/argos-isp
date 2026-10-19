import type { Schema } from '@argosisp/contracts'
import { IMAGENES_SEMILLA } from './imagenes'

/**
 * Sorteos de los fixtures (A3, `contratos/lealtad.md` §7 y §15.3), uno por paso, de ArgosNet salvo
 * el último (Fibra del Sur). Los hashes (`bases_hash`, `compromiso`, `lista_hash`) y el resultado
 * del ejecutado no se escriben a mano: `prepararSorteos` (rutas) los calcula con `argos-sorteo-v1`
 * la primera vez que se piden, igual que lo haría la API al publicar, cerrar y ejecutar.
 */

type Sorteo = Schema<'SorteoDetalle'>
type Premio = Sorteo['premios'][number]
type Requisito = Schema<'RequisitoSorteo'>

export interface ParticipanteSorteo {
    id: number
    cliente_id: number
    servicio_id: number | null
    /** Seudónimo público (`codigo_publico`). */
    codigo: string
    boletos: number
}

/** Lo que la API guarda y no devuelve en el detalle: semilla (cifrada), lista del corte y asistentes. */
export interface SorteoPrivado {
    sorteo_id: number
    /** Semilla en hexadecimal (32 bytes); null hasta publicar las bases. */
    semilla: string | null
    participantes: ParticipanteSorteo[]
    asistentes: { nombre: string, rol: string | null }[]
    /** Solo semilla de los fixtures: el sorteo ya ejecutado se ejecuta al prepararse con este valor. */
    ejecutarCon: { valor_publico: string, valor_publico_evidencia: string, ejecutado_en: string } | null
}

const CLAVES: Requisito['clave'][] = ['bases_diaco', 'autorizacion_gobernacion', 'fianza', 'isr_premios', 'timbre_fiscal', 'delegado_o_notario', 'publicacion_resultados', 'lista_a_gobernacion']

/** Checklist vigente con las claves dadas marcadas (las demás pendientes), como `requisitosVigentes`. */
function checklist(marcados: Partial<Record<Requisito['clave'], Pick<Requisito, 'estado' | 'valor' | 'evidencia'>>>, marcadoEn: string): Requisito[] {
    return CLAVES.map((clave) => {
        const marca = marcados[clave]
        return marca
            ? { clave, ...marca, nota: null, marcado_en: marcadoEn }
            : { clave, estado: 'pendiente', valor: null, evidencia: null, nota: null, marcado_en: null }
    })
}

const REQUISITOS_EJECUCION: Partial<Record<Requisito['clave'], Pick<Requisito, 'estado' | 'valor' | 'evidencia'>>> = {
    bases_diaco: { estado: 'cumplido', valor: 'Prensa Libre, 1 de septiembre de 2026', evidencia: 'Edición impresa, página 14' },
    autorizacion_gobernacion: { estado: 'cumplido', valor: 'Resolución 412-2026 del 5 de septiembre', evidencia: 'Expediente GD-ESC-412-2026' },
    fianza: { estado: 'cumplido', valor: 'Fianza 88-1234 por Q 450.00', evidencia: 'Póliza de Afianzadora G&T' },
    isr_premios: { estado: 'cumplido', valor: 'Formulario SAT-1331 Q 375.00', evidencia: 'Boleta 7781234' },
    timbre_fiscal: { estado: 'cumplido', valor: 'Recibo 63 Q 112.50', evidencia: 'Recibo de la Gobernación' },
    delegado_o_notario: { estado: 'cumplido', valor: 'Lic. Marta Sosa, colegiado 9921', evidencia: 'Nombramiento del notario' },
}

function premio(id: number, posicion: number, datos: Pick<Premio, 'nombre' | 'valor' | 'tipo'> & Partial<Premio>): Premio {
    return { id, posicion, cantidad: 1, imagen_url: null, premio_id: null, retiene_isr: true, isr_pct: '10.00', ...datos }
}

const BASES_COMPLETAS = {
    mecanica: 'Sorteo electrónico con el algoritmo argos-sorteo-v1 ante notario: la semilla se compromete al publicar las bases y el resultado se calcula con el valor público leído en el acto.',
    regla_participacion: 'Un boleto por cada servicio activo y sin facturas vencidas al corte; más los boletos canjeados con puntos.',
    plazo_reclamo_dias: 30,
    no_reclamados: 'Pasado el plazo, el premio pasa al primer suplente.',
    publicacion_resultados: 'En el portal de clientes y en la página de Facebook de ArgosNet, el mismo día.',
    fuente_valor_publico: 'Primer premio de la Lotería Santa Lucía del día del sorteo, como lo publica la Lotería Nacional',
    resolucion_gobernacion: null,
}

/** Archivo sembrado de cada imagen de premio (`imagen_archivo_id`): su id → la imagen de `imagenes.ts`. */
export const IMAGEN_DE_ARCHIVO: Record<number, keyof typeof IMAGENES_SEMILLA> = {}
const ARCHIVO_IMAGEN_INICIAL = 9100

/**
 * Las imágenes se suben (`POST .../premios/:posicion/imagen`, `a3/sorteos-2`): en la semilla se marca la
 * imagen con su nombre (`/sorteos/bicicleta.svg`) y aquí queda como la deja la API, con su archivo y la
 * ruta del panel en `imagen_url`.
 */
function conImagenSubida(sorteoId: number, premios: Premio[]): Premio[] {
    return premios.map((p) => {
        const nombre = /^\/sorteos\/([a-z-]+)\.svg$/.exec(p.imagen_url ?? '')?.[1]
        if (!nombre || !Object.hasOwn(IMAGENES_SEMILLA, nombre)) {
            return { ...p, imagen_url: null, imagen_archivo_id: null }
        }
        const archivo = ARCHIVO_IMAGEN_INICIAL + p.id
        IMAGEN_DE_ARCHIVO[archivo] = nombre as keyof typeof IMAGENES_SEMILLA
        return { ...p, imagen_url: `/api/v1/lealtad/sorteos/${sorteoId}/premios/${p.posicion}/imagen`, imagen_archivo_id: archivo }
    })
}

function sorteo(id: number, datos: Partial<Sorteo> & Pick<Sorteo, 'nombre' | 'estado' | 'premios'>): Sorteo {
    const creado = '2026-09-01T15:00:00.000Z'
    const { premios, ...resto } = datos
    return {
        id,
        empresa_id: 1,
        programa_id: 1,
        descripcion: null,
        bases: { ...BASES_COMPLETAS },
        criterios: { boletos_por_servicio: 1, admite_canje: false },
        bases_hash: null,
        inscripcion_desde: '2026-09-01',
        corte_en: '2026-10-16T05:59:00.000Z',
        fecha_sorteo: '2026-10-17T16:00:00.000Z',
        lugar: 'Oficina central, 4a. calle 3-21 zona 1, Escuintla',
        suplentes: 2,
        algoritmo: 'argos-sorteo-v1',
        compromiso: null,
        semilla: null,
        valor_publico: null,
        lista_hash: null,
        resultado: null,
        motivo_cancelacion: null,
        publicado_en: null,
        corte_cerrado_en: null,
        ejecutado_en: null,
        cancelado_en: null,
        aviso_portal: false,
        acta_hash: null,
        acta_archivo_id: null,
        acta_constancia: null,
        acta_cerrada_en: null,
        version: 1,
        created_at: creado,
        updated_at: creado,
        requisitos: checklist({}, creado),
        participantes: 0,
        boletos: 0,
        ganadores: [],
        archivos: [],
        ...resto,
        premios: conImagenSubida(id, premios),
    }
}

/** Participantes del corte, en orden de `codigo_publico` (servicios activos sin vencidas). */
function participantes(base: number, filas: [cliente: number, servicio: number, codigo: string, boletos: number][]): ParticipanteSorteo[] {
    return filas
        .map(([cliente_id, servicio_id, codigo, boletos], i) => ({ id: base + i, cliente_id, servicio_id, codigo, boletos }))
        .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
}

export const SORTEO_BORRADOR_ID = 1
export const SORTEO_PUBLICADO_ID = 2
export const SORTEO_ABIERTO_ID = 3
export const SORTEO_CORTE_ID = 4
export const SORTEO_EJECUTADO_ID = 5
export const SORTEO_CANCELADO_ID = 6
export const SORTEO_SUR_ID = 7

/** Catálogo de lealtad (fase 2): los premios de servicio del sorteo salen de aquí. */
export const premiosLealtad: Schema<'PremioLealtad'>[] = [
    { id: 1, empresa_id: 1, programa_id: 1, tipo: 'descuento_factura', nombre: 'Descuento de Q 50.00', costo_puntos: 500, descuento_tipo: 'monto', descuento_valor: '50.00', tope: null, plan_destino_id: null, dias: null, costo_unitario: null, existencias: null, sorteo_id: null, boletos: null, en_portal: true, activo: true, version: 1, created_at: '2026-09-01T15:00:00.000Z', updated_at: '2026-09-01T15:00:00.000Z' },
    { id: 2, empresa_id: 1, programa_id: 1, tipo: 'mes_gratis', nombre: 'Un mes gratis de internet', costo_puntos: 2500, descuento_tipo: null, descuento_valor: null, tope: null, plan_destino_id: null, dias: null, costo_unitario: null, existencias: null, sorteo_id: null, boletos: null, en_portal: true, activo: true, version: 1, created_at: '2026-09-01T15:00:00.000Z', updated_at: '2026-09-01T15:00:00.000Z' },
    { id: 3, empresa_id: 1, programa_id: 1, tipo: 'boletos', nombre: '5 boletos extra', costo_puntos: 300, descuento_tipo: null, descuento_valor: null, tope: null, plan_destino_id: null, dias: null, costo_unitario: null, existencias: null, sorteo_id: SORTEO_ABIERTO_ID, boletos: 5, en_portal: true, activo: true, version: 1, created_at: '2026-09-01T15:00:00.000Z', updated_at: '2026-09-01T15:00:00.000Z' },
]

export const sorteos: Sorteo[] = [
    sorteo(SORTEO_BORRADOR_ID, {
        nombre: 'Gran sorteo de Navidad 2026',
        descripcion: 'Para los clientes al día en diciembre.',
        estado: 'borrador',
        // Falta la publicación de resultados: publicar responde 422 `bases_incompletas`.
        bases: { ...BASES_COMPLETAS, publicacion_resultados: undefined },
        inscripcion_desde: '2026-11-01',
        corte_en: '2026-12-20T05:59:00.000Z',
        fecha_sorteo: '2026-12-22T22:00:00.000Z',
        premios: [
            premio(1, 1, { nombre: 'Q 1,000.00 en efectivo', valor: '1000.00', tipo: 'efectivo' }),
            premio(2, 2, { nombre: 'Televisor inteligente de 55"', valor: '4200.00', tipo: 'bien', imagen_url: '/sorteos/televisor.svg' }),
        ],
    }),
    sorteo(SORTEO_PUBLICADO_ID, {
        nombre: 'Sorteo del aniversario',
        estado: 'bases_publicadas',
        corte_en: '2026-11-30T05:59:00.000Z',
        fecha_sorteo: '2026-12-01T22:00:00.000Z',
        publicado_en: '2026-10-10T15:00:00.000Z',
        premios: [
            premio(3, 1, { nombre: 'Bicicleta de montaña', valor: '2500.00', tipo: 'bien', imagen_url: '/sorteos/bicicleta.svg' }),
        ],
    }),
    sorteo(SORTEO_ABIERTO_ID, {
        nombre: 'Clientes al día · octubre',
        estado: 'participacion_abierta',
        aviso_portal: true,
        criterios: { boletos_por_servicio: 1, admite_canje: true },
        publicado_en: '2026-09-02T15:00:00.000Z',
        requisitos: checklist({ bases_diaco: REQUISITOS_EJECUCION.bases_diaco }, '2026-09-02T16:00:00.000Z'),
        premios: [
            premio(4, 1, { nombre: 'Q 500.00 en efectivo', valor: '500.00', tipo: 'efectivo', cantidad: 2 }),
        ],
    }),
    sorteo(SORTEO_CORTE_ID, {
        nombre: 'Sorteo de fiestas patrias',
        estado: 'corte_cerrado',
        corte_en: '2026-09-14T05:59:00.000Z',
        fecha_sorteo: '2026-10-20T16:00:00.000Z',
        publicado_en: '2026-08-20T15:00:00.000Z',
        corte_cerrado_en: '2026-09-14T06:10:00.000Z',
        // Falta el timbre fiscal: ejecutar responde 422 `requisito_pendiente`.
        requisitos: checklist({ ...REQUISITOS_EJECUCION, timbre_fiscal: undefined }, '2026-09-20T16:00:00.000Z'),
        premios: [
            premio(5, 1, { nombre: 'Q 750.00 en efectivo', valor: '750.00', tipo: 'efectivo' }),
            premio(6, 2, { nombre: 'Un mes gratis de internet', valor: '250.00', tipo: 'servicio', premio_id: 2, retiene_isr: false, imagen_url: '/sorteos/mes-gratis.svg' }),
        ],
    }),
    sorteo(SORTEO_EJECUTADO_ID, {
        nombre: 'Día del cliente',
        estado: 'ejecutado',
        corte_en: '2026-08-31T05:59:00.000Z',
        fecha_sorteo: '2026-09-05T16:00:00.000Z',
        publicado_en: '2026-08-01T15:00:00.000Z',
        corte_cerrado_en: '2026-08-31T06:10:00.000Z',
        requisitos: checklist(REQUISITOS_EJECUCION, '2026-09-04T16:00:00.000Z'),
        premios: [
            premio(7, 1, { nombre: 'Q 1,000.00 en efectivo', valor: '1000.00', tipo: 'efectivo', imagen_url: '/sorteos/efectivo.svg' }),
            premio(8, 2, { nombre: 'Bicicleta de montaña', valor: '2500.00', tipo: 'bien', imagen_url: '/sorteos/bicicleta.svg' }),
            premio(9, 3, { nombre: 'Un mes gratis de internet', valor: '250.00', tipo: 'servicio', premio_id: 2, retiene_isr: false, imagen_url: '/sorteos/mes-gratis.svg' }),
        ],
    }),
    sorteo(SORTEO_CANCELADO_ID, {
        nombre: 'Sorteo de verano',
        estado: 'cancelado',
        corte_en: '2026-04-30T05:59:00.000Z',
        fecha_sorteo: '2026-05-02T16:00:00.000Z',
        motivo_cancelacion: 'La Gobernación no autorizó el sorteo a tiempo',
        cancelado_en: '2026-04-20T15:00:00.000Z',
        premios: [premio(10, 1, { nombre: 'Q 300.00 en efectivo', valor: '300.00', tipo: 'efectivo' })],
    }),
    sorteo(SORTEO_SUR_ID, {
        empresa_id: 2,
        programa_id: null,
        nombre: 'Sorteo Fibra del Sur',
        estado: 'borrador',
        lugar: 'Oficina de Santa Lucía Cotzumalguapa',
        premios: [premio(11, 1, { nombre: 'Q 400.00 en efectivo', valor: '400.00', tipo: 'efectivo' })],
    }),
]

export const sorteosPrivados: SorteoPrivado[] = [
    { sorteo_id: SORTEO_PUBLICADO_ID, semilla: null, participantes: [], asistentes: [], ejecutarCon: null },
    { sorteo_id: SORTEO_ABIERTO_ID, semilla: null, participantes: [], asistentes: [], ejecutarCon: null },
    {
        sorteo_id: SORTEO_CORTE_ID,
        semilla: null,
        participantes: participantes(400, [[1, 1, 'S3F9A21C07B', 1], [3, 3, 'S08D4E7B1A2', 1], [4, 5, 'SC1E07F3D98', 1], [6, 7, 'S6B2D90E4F1', 1], [7, 8, 'S9E4A1B7C03', 1], [10, 11, 'S5D7C3E0A96', 2]]),
        asistentes: [],
        ejecutarCon: null,
    },
    {
        sorteo_id: SORTEO_EJECUTADO_ID,
        semilla: null,
        participantes: participantes(500, [[1, 1, 'SA7C2E9F014', 1], [4, 5, 'S2B8D61E3F0', 1], [6, 7, 'SE04F7A9B21', 1], [8, 9, 'S71C3D8E5A6', 1], [11, 12, 'S4E9B0A2C7D', 1], [15, 16, 'SD3A6F1B8E2', 1], [18, 19, 'S0F5E2C9A4B', 1], [19, 20, 'S86B1D4F7E3', 1]]),
        asistentes: [{ nombre: 'Lic. Marta Sosa', rol: 'Notaria' }],
        ejecutarCon: { valor_publico: 'Lotería Santa Lucía, sorteo 2387 del 5/9/2026: 48213', valor_publico_evidencia: 'Leído por la notaria en loteria.gob.gt a las 16:15 y mostrado en pantalla', ejecutado_en: '2026-09-05T16:20:00.000Z' },
    },
    { sorteo_id: SORTEO_CANCELADO_ID, semilla: null, participantes: [], asistentes: [], ejecutarCon: null },
]
