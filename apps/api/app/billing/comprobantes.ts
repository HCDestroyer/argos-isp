import db from '@adonisjs/lucid/services/db'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, type Alcance, type FiltrosDimension } from '#core/acl'
import { dimensionesDeCliente } from '#core/consultas/clientes'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import type { TipoComprobante } from '#billing/comprobantes_archivos'
import type { CausaRechazoComprobante, EstadoServicioConPendiente, PayloadComprobante } from '#shared/eventos'
import { aTexto } from '#ledger/dinero'

/**
 * Comprobantes de depósito: lectura (cola del panel, detalle). Las acciones están en
 * `actions/registrar_comprobante.ts`, `aprobar_comprobante.ts` y `rechazar_comprobante.ts`.
 */

export const METODOS_COMPROBANTE = ['deposito', 'transferencia', 'ach', 'remesa'] as const
export type MetodoComprobante = (typeof METODOS_COMPROBANTE)[number]

export const ESTADOS_COMPROBANTE = ['pendiente', 'aprobado', 'rechazado'] as const
export type EstadoComprobante = (typeof ESTADOS_COMPROBANTE)[number]

/** `iris`: boleta que llegó por chat o llamada (contrato Iris 0.6.0 §7.2) */
export const CANALES_COMPROBANTE = ['portal', 'panel', 'iris'] as const
export type CanalComprobante = (typeof CANALES_COMPROBANTE)[number]

/** Quién leyó los datos de la foto (solo Iris). */
export const LECTORES_COMPROBANTE = ['ia', 'persona', 'cliente_dictado'] as const
export type LectorComprobante = (typeof LECTORES_COMPROBANTE)[number]

/** Por dónde llegó la boleta a Iris. */
export const CANALES_CONTACTO = ['whatsapp', 'telegram', 'correo', 'llamada'] as const
export type CanalContacto = (typeof CANALES_CONTACTO)[number]

export interface ComprobanteVista {
    id: number
    /** la empresa de la cuenta bancaria de destino */
    empresa_id: number
    cliente_id: number
    cliente_nombre: string
    servicio_id: number | null
    metodo: MetodoComprobante
    cuenta_bancaria_id: number
    cuenta_bancaria_nombre: string
    banco_origen_id: number | null
    banco_origen_nombre: string | null
    referencia: string
    monto: string
    /** YYYY-MM-DD */
    fecha_deposito: string
    archivo_tipo: TipoComprobante
    archivo_tamano: number
    archivo_nombre: string | null
    canal: CanalComprobante
    /** solo Iris: quién leyó la foto, qué tan seguro (0–1, texto) y por dónde llegó */
    leido_por: LectorComprobante | null
    confianza: string | null
    canal_contacto: CanalContacto | null
    /** solo Iris: cabeceras X-Iris-Actor y X-Iris-Conversacion */
    iris_actor: string | null
    iris_conversacion: string | null
    nota: string | null
    estado: EstadoComprobante
    motivo_rechazo: string | null
    causa_rechazo: CausaRechazoComprobante | null
    pago_id: number | null
    registrado_por: number | null
    verificado_por: number | null
    verificado_por_nombre: string | null
    verificado_en: Date | null
    version: number
    created_at: Date
    updated_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('billing.comprobantes as k')
        .join('core.clientes as c', 'c.id', 'k.cliente_id')
        .join('billing.cuentas_bancarias as cb', 'cb.id', 'k.cuenta_bancaria_id')
        .join('billing.bancos as bd', 'bd.id', 'cb.banco_id')
        .leftJoin('billing.bancos as bo', 'bo.id', 'k.banco_origen_id')
        .leftJoin('core.usuarios as uv', 'uv.id', 'k.verificado_por')
        .select(
            'k.id',
            'k.empresa_id',
            'k.cliente_id',
            'c.nombre as cliente_nombre',
            'k.servicio_id',
            'k.metodo',
            'k.cuenta_bancaria_id',
            cliente.raw(`bd.nombre || ' · ' || cb.alias as cuenta_bancaria_nombre`),
            'k.banco_origen_id',
            'bo.nombre as banco_origen_nombre',
            'k.referencia',
            'k.monto',
            cliente.raw(`to_char(k.fecha_deposito, 'YYYY-MM-DD') as fecha_deposito`),
            'k.archivo_tipo',
            'k.archivo_tamano',
            'k.archivo_nombre',
            'k.canal',
            'k.leido_por',
            'k.confianza',
            'k.canal_contacto',
            'k.iris_actor',
            'k.iris_conversacion',
            'k.nota',
            'k.estado',
            'k.motivo_rechazo',
            'k.causa_rechazo',
            'k.pago_id',
            'k.registrado_por',
            'k.verificado_por',
            'uv.nombre as verificado_por_nombre',
            'k.verificado_en',
            'k.version',
            'k.created_at',
            'k.updated_at',
        )
}

export async function verComprobante(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ComprobanteVista> {
    const fila = (await consulta(cliente).where('k.id', id).first()) as ComprobanteVista | null
    if (!fila) throw new NoEncontrado(`El comprobante ${id} no existe`)
    return fila
}

export interface FiltrosComprobantes extends OpcionesPaginacion {
    estado?: EstadoComprobante
    cliente_id?: number
    metodo?: MetodoComprobante
    cuenta_bancaria_id?: number
    /** `iris`: la cola de boletas que llegaron por Iris */
    canal?: CanalComprobante
    /** Fecha de depósito desde (YYYY-MM-DD, inclusive) */
    desde?: string
    /** Fecha de depósito hasta (YYYY-MM-DD, inclusive) */
    hasta?: string
}

/** Alcance: zona del cliente o router de alguno de sus servicios (igual que el cliente). */
const dimensionesComprobante: FiltrosDimension = {
    zona: (q, ids) => q.whereIn('c.zona_id', ids),
    router: (q, ids) =>
        q.whereExists((s) =>
            s
                .from('core.servicios as s')
                .whereColumn('s.cliente_id', 'k.cliente_id')
                .whereIn('s.router_id', ids),
        ),
}

type ConsultaComprobantes = ReturnType<typeof consulta>

/** Filtros comunes a la lista y al resumen, menos `estado` (el resumen cuenta pendientes aparte). */
function aplicarFiltros<Q extends ConsultaComprobantes>(
    q: Q,
    filtros: Omit<FiltrosComprobantes, 'estado'>,
    alcance?: Alcance,
    empresas: number[] | null = null,
): Q {
    q.if(filtros.cliente_id, (w) => w.where('k.cliente_id', filtros.cliente_id!))
        .if(filtros.metodo, (w) => w.where('k.metodo', filtros.metodo!))
        .if(filtros.cuenta_bancaria_id, (w) => w.where('k.cuenta_bancaria_id', filtros.cuenta_bancaria_id!))
        .if(filtros.canal, (w) => w.where('k.canal', filtros.canal!))
        .if(filtros.desde, (w) => w.where('k.fecha_deposito', '>=', filtros.desde!))
        .if(filtros.hasta, (w) => w.where('k.fecha_deposito', '<=', filtros.hasta!))
    filtrarPorAlcance(q, alcance, dimensionesComprobante)
    filtrarPorEmpresa(q, empresas, (w, ids) => w.whereIn('k.empresa_id', ids))
    return q
}

export async function listarComprobantes(
    filtros: FiltrosComprobantes,
    alcance?: Alcance,
    empresas: number[] | null = null,
) {
    const lista = aplicarFiltros(consulta(db.connection()), filtros, alcance, empresas).if(
        filtros.estado,
        (q) => q.where('k.estado', filtros.estado!),
    )
    return paginar<ComprobanteVista>(lista, filtros, { columna: 'k.id' })
}

export interface ResumenComprobantes {
    /** Comprobantes que cumplen todos los filtros (todas las páginas) */
    total: number
    /** Suma de sus montos */
    monto: string
    /** Pendientes que cumplen los demás filtros, sin importar `estado` (contador del menú) */
    pendientes: number
    /** Suma de los montos pendientes */
    monto_pendiente: string
}

/**
 * Totales de la cola con los mismos filtros y alcance que la lista. `pendientes` ignora el
 * filtro `estado`, para que el contador del menú salga de cualquier página de la cola.
 */
export async function resumenComprobantes(
    filtros: FiltrosComprobantes,
    alcance?: Alcance,
    empresas: number[] | null = null,
): Promise<ResumenComprobantes> {
    const base = aplicarFiltros(consulta(db.connection()), filtros, alcance, empresas)
    const fila = (await db
        .from(base.as('k'))
        .select(
            db.raw(`count(*) FILTER (WHERE ?::text IS NULL OR k.estado = ?::text)::int AS total`, [
                filtros.estado ?? null,
                filtros.estado ?? null,
            ]),
            db.raw(
                `coalesce(sum(k.monto) FILTER (WHERE ?::text IS NULL OR k.estado = ?::text), 0)::numeric(14, 2)::text AS monto`,
                [filtros.estado ?? null, filtros.estado ?? null],
            ),
            db.raw(`count(*) FILTER (WHERE k.estado = 'pendiente')::int AS pendientes`),
            db.raw(
                `coalesce(sum(k.monto) FILTER (WHERE k.estado = 'pendiente'), 0)::numeric(14, 2)::text AS monto_pendiente`,
            ),
        )
        .first()) as ResumenComprobantes
    return fila
}

/** Dimensiones de alcance de un comprobante: las de su cliente. */
export async function dimensionesDeComprobante(id: number) {
    const fila = await db
        .from('billing.comprobantes')
        .where('id', id)
        .select('cliente_id', 'empresa_id')
        .first()
    if (!fila) throw new NoEncontrado(`El comprobante ${id} no existe`)
    return { ...(await dimensionesDeCliente(fila.cliente_id as number)), empresa_id: Number(fila.empresa_id) }
}

/** Ruta y tipo del archivo de un comprobante (para `GET /comprobantes/:id/archivo`). */
export async function archivoDeComprobante(id: number) {
    const fila = (await db
        .from('billing.comprobantes')
        .where('id', id)
        .select('archivo', 'archivo_tipo', 'archivo_nombre')
        .first()) as { archivo: string; archivo_tipo: TipoComprobante; archivo_nombre: string | null } | null
    if (!fila) throw new NoEncontrado(`El comprobante ${id} no existe`)
    return fila
}

/**
 * Payload de `comprobante.*` (contrato Iris 0.6.0 §7.2), leído dentro de la transacción después
 * del cambio: `servicio_estado` es el estado del servicio del comprobante en ese momento (después
 * de aplicar el pago o la re-evaluación), o null sin servicio.
 */
export async function payloadComprobante(
    cliente: QueryClientContract,
    id: number,
): Promise<PayloadComprobante> {
    const fila = (await cliente
        .from('billing.comprobantes as k')
        .leftJoin('core.servicios as s', 's.id', 'k.servicio_id')
        .where('k.id', id)
        .select(
            'k.id',
            'k.empresa_id',
            'k.cliente_id',
            'k.servicio_id',
            'k.canal',
            cliente.raw('k.monto::text as monto'),
            'k.pago_id',
            'k.motivo_rechazo',
            'k.causa_rechazo',
            's.estado as servicio_estado',
        )
        .first()) as {
        id: number
        empresa_id: number
        cliente_id: number
        servicio_id: number | null
        canal: CanalComprobante
        monto: string
        pago_id: number | null
        motivo_rechazo: string | null
        causa_rechazo: CausaRechazoComprobante | null
        servicio_estado: EstadoServicioConPendiente | null
    } | null
    if (!fila) throw new NoEncontrado(`El comprobante ${id} no existe`)
    return {
        comprobante_id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        cliente_id: Number(fila.cliente_id),
        servicio_id: fila.servicio_id === null ? null : Number(fila.servicio_id),
        canal: fila.canal,
        monto: aTexto(fila.monto),
        pago_id: fila.pago_id === null ? null : Number(fila.pago_id),
        motivo: fila.motivo_rechazo,
        causa: fila.causa_rechazo,
        servicio_estado: fila.servicio_id === null ? null : fila.servicio_estado,
        origen: fila.canal === 'iris' ? 'iris' : null,
    }
}
