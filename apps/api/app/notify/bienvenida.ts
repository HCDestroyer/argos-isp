import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import type { PayloadEvento } from '#shared/eventos'
import { EVENTO_BIENVENIDA } from '#notify/instalacion'

/**
 * Bienvenida con seguimiento (contrato Iris 0.9.0 §12.5, A37).
 *
 * - **Cuándo**: al activarse la instalación (`servicio.estado_cambiado` de `pendiente_instalacion` a
 *   `activo`, por `activar-instalacion` o, cuando exista, por `aprovisionar`) y al reenviarla
 *   (`ReenviarBienvenida`). Cada vez es una fila de `notify.bienvenidas` con el `origen` de sus envíos
 *   (`outbox:<id>` o `bienvenida:<servicio>:<uuid>`); los envíos por canal viven en `notify.envios`.
 * - **`origen`**: `origen_tipo`/`origen_id` del evento de activación cuando es `iris_orden`; el
 *   reenvío guarda los que manda Iris. En WhatsApp sale como `origen` del aviso (§6.2).
 * - **Seguimiento**: `seguirBienvenida` recalcula el estado de los tres canales y, si cambió desde el
 *   último aviso, emite `servicio.bienvenida_cambiada` (uno por cambio). Lo llaman quien programa,
 *   quien envía (`EnviarNotificacion`) y el acuse de WhatsApp de Iris (`aplicarAcuseIris`).
 * - **Estados**: `encolado` → `pendiente`, `enviado` → `enviada`, `fallido` → `fallida`, `omitido`
 *   → `omitida`. Un canal sin envío (sin destino, sin plantilla o fuera de los `canales` pedidos) es
 *   `omitida` con `motivo: sin_canal`. Si un canal tiene varios envíos (el respaldo por correo), vale
 *   el último. `motivo` es un código: el de Iris (`sin_permiso`, `baja`, `numero_invalido`…),
 *   `sin_destino`, `apagado` (canal o aviso apagado en la configuración), `conector_no_disponible`,
 *   `faltan_datos` o `error_canal`. Nunca el texto ni las cuentas.
 */

export const CANALES_BIENVENIDA = ['whatsapp', 'correo', 'telegram'] as const
export type CanalBienvenida = (typeof CANALES_BIENVENIDA)[number]

/** Reenvíos: no antes de 10 min del último envío y hasta 3 por servicio en el día (Guatemala). */
export const ESPERA_REENVIO_S = 10 * 60
export const REENVIOS_POR_DIA = 3

type EstadoCanal = PayloadEvento<'servicio.bienvenida_cambiada'>['canales'][number]

export interface BienvenidaNueva {
    origen: string
    servicioId: number
    empresaId: number | null
    clienteId: number
    origenTipo: 'iris_orden' | null
    origenId: string | null
    reenvio: boolean
    canales: CanalBienvenida[] | null
    requestId: string
}

/** Registra la bienvenida (idempotente por `origen`); devuelve su id. */
export async function registrarBienvenida(
    trx: TransactionClientContract,
    b: BienvenidaNueva,
): Promise<number> {
    await trx.rawQuery(
        `INSERT INTO notify.bienvenidas
            (origen, servicio_id, empresa_id, cliente_id, origen_tipo, origen_id, reenvio, canales, request_id)
         VALUES (:origen, :servicio_id, :empresa_id, :cliente_id, :origen_tipo, :origen_id, :reenvio, :canales, :request_id)
         ON CONFLICT (origen) DO NOTHING`,
        {
            origen: b.origen,
            servicio_id: b.servicioId,
            empresa_id: b.empresaId,
            cliente_id: b.clienteId,
            origen_tipo: b.origenTipo,
            origen_id: b.origenTipo ? b.origenId : null,
            reenvio: b.reenvio,
            canales: b.canales,
            request_id: b.requestId,
        } as Record<string, unknown> as never,
    )
    const fila = (await trx.from('notify.bienvenidas').where('origen', b.origen).select('id').first()) as {
        id: number
    }
    return Number(fila.id)
}

/** Origen de Iris del evento de activación: solo `iris_orden` con id (§12.5). */
export function origenIrisDe(payload: Record<string, unknown>): { tipo: 'iris_orden'; id: string } | null {
    const id = typeof payload.origen_id === 'string' ? payload.origen_id.trim() : ''
    return payload.origen_tipo === 'iris_orden' && id !== '' ? { tipo: 'iris_orden', id } : null
}

/** Canales pedidos de una bienvenida (null = todos). */
export async function canalesPedidos(
    trx: TransactionClientContract,
    origen: string,
): Promise<CanalBienvenida[] | null> {
    const fila = (await trx.from('notify.bienvenidas').where('origen', origen).select('canales').first()) as {
        canales: CanalBienvenida[] | null
    } | null
    return fila?.canales ?? null
}

function codigoIris(texto: string | null): string | null {
    const m = /^Iris: ([a-z_]+)/.exec(texto ?? '')
    return m ? m[1]! : null
}

interface FilaEnvio {
    canal: string
    estado: string
    destino: string
    motivo: string | null
    error: string | null
    proveedor_id: string | null
}

function estadoDe(canal: CanalBienvenida, e: FilaEnvio | undefined): EstadoCanal {
    if (!e) return { canal, estado: 'omitida', motivo: 'sin_canal', aviso_id: null }
    const avisoId = canal === 'whatsapp' ? (e.proveedor_id ?? null) : null
    switch (e.estado) {
        case 'encolado':
            return { canal, estado: 'pendiente', motivo: null, aviso_id: avisoId }
        case 'enviado':
            return { canal, estado: 'enviada', motivo: null, aviso_id: avisoId }
        case 'omitido': {
            const motivo =
                codigoIris(e.motivo) ??
                (/conector Iris|contrato anterior/.test(e.motivo ?? '')
                    ? 'conector_no_disponible'
                    : /faltan datos|no es un código/.test(e.motivo ?? '')
                      ? 'faltan_datos'
                      : 'apagado')
            return { canal, estado: 'omitida', motivo, aviso_id: avisoId }
        }
        default: {
            const motivo = e.destino === '-' ? 'sin_destino' : (codigoIris(e.error) ?? 'error_canal')
            return { canal, estado: 'fallida', motivo, aviso_id: avisoId }
        }
    }
}

/**
 * Recalcula los canales de la bienvenida de `origen` y emite `servicio.bienvenida_cambiada` si
 * cambiaron desde el último aviso. No hace nada si `origen` no es de una bienvenida. Bloquea la fila:
 * dos workers no emiten el mismo cambio.
 */
export async function seguirBienvenida(t: Transaccion, origen: string): Promise<void> {
    const b = (await t.trx
        .from('notify.bienvenidas')
        .where('origen', origen)
        .forUpdate()
        .select(
            'id',
            'servicio_id',
            'empresa_id',
            'cliente_id',
            'origen_tipo',
            'origen_id',
            'reenvio',
            'ultimo_estado',
        )
        .first()) as {
        id: number
        servicio_id: number
        empresa_id: number | null
        cliente_id: number
        origen_tipo: 'iris_orden' | null
        origen_id: string | null
        reenvio: boolean
        ultimo_estado: EstadoCanal[] | null
    } | null
    if (!b) return
    const envios = (await t.trx
        .from('notify.envios')
        .where('origen', origen)
        .where('cliente_id', b.cliente_id)
        .where('evento', EVENTO_BIENVENIDA)
        .orderBy('id')
        .select('canal', 'estado', 'destino', 'motivo', 'error', 'proveedor_id')) as FilaEnvio[]
    const canales = CANALES_BIENVENIDA.map((canal) =>
        estadoDe(canal, envios.filter((e) => e.canal === canal).at(-1)),
    )
    if (JSON.stringify(canales) === JSON.stringify(b.ultimo_estado)) return
    await t.trx
        .from('notify.bienvenidas')
        .where('id', b.id)
        .update({ ultimo_estado: JSON.stringify(canales), updated_at: t.trx.knexRawQuery('now()') })
    await t.emit('servicio.bienvenida_cambiada', {
        bienvenida_id: Number(b.id),
        servicio_id: Number(b.servicio_id),
        empresa_id: b.empresa_id === null ? null : Number(b.empresa_id),
        cliente_id: Number(b.cliente_id),
        origen_tipo: b.origen_tipo,
        origen_id: b.origen_id,
        canales,
        reenvio: b.reenvio,
    })
}
