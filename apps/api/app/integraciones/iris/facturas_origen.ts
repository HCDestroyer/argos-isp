import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { idEntidad } from '#shared/validadores'
import { Problema, ValidacionFallida } from '#shared/errores'
import { dec } from '#ledger/dinero'
import { claveLimite, exigirBajoLimite } from '#core/limite_ventana'
import { CABECERA_IRIS_ACTOR, CabeceraIrisRequerida, esTokenIris } from '#integraciones/iris/atencion'

/**
 * Lectura de una factura de origen Iris (contrato Iris 0.14.3 §3, «cobro por confirmar»):
 * `GET /facturas/origen-iris`. Iris valida con ella el número de factura que le da un supervisor antes
 * de conciliar un cargo cuyo envío quedó sin respuesta. Aquí van las piezas que no son la acción:
 * el validador de la query, las cabeceras, el límite y la consulta.
 */

/** `asistente_ia`, `sistema` (0.14.2) o `usuario:<id en Iris>`. */
const FORMATO_ACTOR = /^(asistente_ia|sistema|usuario:[A-Za-z0-9_-]{1,64})$/

/** Formato de `origen_id`: el de `billing.facturas.origen_externo_id` (1 a 100 caracteres). */
export const leerFacturaOrigenIrisValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad(),
        origen_id: vine.string().trim().minLength(1).maxLength(100),
        numero: idEntidad().optional(),
        serie: vine.string().trim().minLength(1).maxLength(100).optional(),
        numero_dte: vine.string().trim().minLength(1).maxLength(100).optional(),
    }),
)

export type BusquedaFacturaOrigenIris =
    | { empresa_id: number; origen_id: string; numero: number }
    | { empresa_id: number; origen_id: string; serie: string; numero_dte: string }

/**
 * `numero` o `serie` + `numero_dte`, nunca los dos ni ninguno: `422 validacion` con el campo que
 * sobra o falta.
 */
export function busquedaDe(q: {
    empresa_id: number
    origen_id: string
    numero?: number
    serie?: string
    numero_dte?: string
}): BusquedaFacturaOrigenIris {
    const conNumero = q.numero !== undefined
    const conSerie = q.serie !== undefined
    const conDte = q.numero_dte !== undefined
    if (conNumero && (conSerie || conDte)) {
        throw new ValidacionFallida(
            [
                {
                    field: conSerie ? 'serie' : 'numero_dte',
                    rule: 'excluyente',
                    message: '`numero` es excluyente con `serie` y `numero_dte`',
                },
            ],
            'Busca por `numero` o por `serie` + `numero_dte`, no por los dos',
        )
    }
    if (conNumero) return { empresa_id: q.empresa_id, origen_id: q.origen_id, numero: q.numero! }
    if (conSerie && conDte) {
        return {
            empresa_id: q.empresa_id,
            origen_id: q.origen_id,
            serie: q.serie!,
            numero_dte: q.numero_dte!,
        }
    }
    const falta = conSerie ? 'numero_dte' : conDte ? 'serie' : 'numero'
    throw new ValidacionFallida(
        [
            {
                field: falta,
                rule: 'required',
                message:
                    falta === 'numero'
                        ? 'Falta `numero` (o `serie` + `numero_dte`)'
                        : '`serie` y `numero_dte` van juntos',
            },
        ],
        'Busca por `numero` o por `serie` + `numero_dte`',
    )
}

export class ActorNoPermitido extends Problema {
    constructor() {
        super(
            403,
            'actor_no_permitido',
            'Este actor de Iris no puede hacer esto',
            'Esta lectura la pide una persona de Iris (`X-Iris-Actor: usuario:<id>`), nunca `asistente_ia` ni `sistema`',
        )
    }
}

/**
 * Con el token de Iris: `X-Iris-Actor: usuario:<id>` obligatoria (`400 cabecera_iris_requerida` si
 * falta o está mal formada; `403 actor_no_permitido` con `asistente_ia` o `sistema`). No usa
 * `X-Iris-Conversacion` ni `X-Iris-Contacto` (se ignoran). Deja el actor en `ctx.iris` (canal `api` y
 * `audit.acciones.iris_actor`). Otro actor (admin del panel): nada.
 */
export function exigirPersonaIris(ctx: HttpContext): void {
    if (!esTokenIris(ctx)) return
    const actor = ctx.request.header(CABECERA_IRIS_ACTOR)?.trim()
    if (!actor || !FORMATO_ACTOR.test(actor)) {
        throw new CabeceraIrisRequerida(`${CABECERA_IRIS_ACTOR} es obligatoria: \`usuario:<id en Iris>\``)
    }
    if (!actor.startsWith('usuario:')) throw new ActorNoPermitido()
    ctx.iris = { actor, conversacion: null }
}

function entero(nombre: string, defecto: number): number {
    const valor = Number(process.env[nombre])
    return Number.isInteger(valor) && valor >= 1 ? valor : defecto
}

/**
 * 60 lecturas por minuto por token (`FACTURAS_ORIGEN_IRIS_LIMITE` lo cambia en pruebas):
 * `429 demasiadas_peticiones` con `Retry-After`. Cuenta también las que terminan en 404 o 422.
 */
export async function limitarLecturaFacturaIris(ctx: HttpContext): Promise<void> {
    exigirPersonaIris(ctx)
    const usuario = ctx.auth.user!
    const tokenId = ctx.auth.authenticatedViaGuard === 'tokens' ? ctx.auth.use('tokens').token?.id : null
    await exigirBajoLimite(
        [
            {
                clave: claveLimite('facturas_origen_iris', 'token', String(tokenId ?? `u${usuario.id}`)),
                tope: entero('FACTURAS_ORIGEN_IRIS_LIMITE', 60),
                ventanaS: 60,
            },
        ],
        {
            codigo: 'demasiadas_peticiones',
            titulo: 'Demasiadas peticiones',
            detalle:
                'Se pasó el límite de lecturas de facturas de origen Iris por minuto; intenta de nuevo después de Retry-After',
        },
        ctx,
    )
}

/** Respuesta de §3: sin pagos, NIT, nombre ni dirección. */
export interface FacturaOrigenIris {
    factura_id: number
    /** número interno de Argos (el que el panel muestra como «Factura #n») */
    numero: string
    empresa_id: number
    servicio_id: number | null
    cliente_id: number
    origen_tipo: 'iris_orden'
    origen_id: string
    estado: string
    lineas: Array<{ concepto_id: number | null; precio_unitario: string; cantidad: string }>
    total: string
    moneda: 'GTQ'
    emitida_en: string
    dte: { serie: string; numero: string } | null
}

/** Estados de un DTE que tuvo serie y número del certificador. */
const ESTADOS_DTE_CERTIFICADO = ['certificado', 'anulacion_pendiente', 'anulado']

/**
 * La factura de `busqueda` si es `iris_orden` de ese `origen_id`, de esa empresa y dentro de
 * `permitidas` (null = todas); si no, null (el `404` es el mismo en todos los casos).
 */
export async function buscarFacturaOrigenIris(
    cliente: QueryClientContract,
    busqueda: BusquedaFacturaOrigenIris,
    permitidas: number[] | null,
): Promise<FacturaOrigenIris | null> {
    if (permitidas !== null && !permitidas.includes(busqueda.empresa_id)) return null
    const consulta = cliente
        .from('billing.facturas as f')
        .where('f.empresa_id', busqueda.empresa_id)
        .where('f.origen_externo_tipo', 'iris_orden')
        .where('f.origen_externo_id', busqueda.origen_id)
        .select(
            'f.id',
            'f.empresa_id',
            'f.servicio_id',
            'f.cliente_id',
            'f.origen_externo_id',
            'f.estado',
            'f.total',
            'f.emitida_en',
        )
    if ('numero' in busqueda) consulta.where('f.id', busqueda.numero)
    else {
        consulta.whereExists((q) =>
            q
                .from('fiscal.dte as d')
                .whereRaw('d.documento_id = f.id')
                .where('d.documento_tipo', 'factura')
                .where('d.empresa_id', busqueda.empresa_id)
                .where('d.serie', busqueda.serie)
                .where('d.numero', busqueda.numero_dte)
                .whereIn('d.estado', ESTADOS_DTE_CERTIFICADO),
        )
    }
    const f = (await consulta.first()) as {
        id: number
        empresa_id: number
        servicio_id: number | null
        cliente_id: number
        origen_externo_id: string
        estado: string
        total: string
        emitida_en: Date
    } | null
    if (!f) return null

    const lineas = (await cliente
        .from('billing.facturas_lineas')
        .where('factura_id', f.id)
        .whereNot('tipo', 'descuento')
        .orderBy('id')
        .select('concepto_cargo_id', 'precio_unitario', cliente.raw('cantidad::text as cantidad'))) as Array<{
        concepto_cargo_id: number | null
        precio_unitario: string
        cantidad: string
    }>
    const dte = (await cliente
        .from('fiscal.dte')
        .where({ documento_tipo: 'factura', documento_id: f.id })
        .whereIn('estado', ESTADOS_DTE_CERTIFICADO)
        .whereNotNull('serie')
        .whereNotNull('numero')
        .orderBy('id', 'desc')
        .select('serie', 'numero')
        .first()) as { serie: string; numero: string } | null

    return {
        factura_id: Number(f.id),
        numero: String(f.id),
        empresa_id: Number(f.empresa_id),
        servicio_id: f.servicio_id === null ? null : Number(f.servicio_id),
        cliente_id: Number(f.cliente_id),
        origen_tipo: 'iris_orden',
        origen_id: f.origen_externo_id,
        estado: f.estado,
        lineas: lineas.map((l) => ({
            concepto_id: l.concepto_cargo_id === null ? null : Number(l.concepto_cargo_id),
            precio_unitario: dec(l.precio_unitario).toFixed(2),
            // `numeric(12,3)` → sin ceros de más: «1», «2.5»
            cantidad: dec(l.cantidad).toString(),
        })),
        total: dec(f.total).toFixed(2),
        moneda: 'GTQ',
        emitida_en: new Date(f.emitida_en).toISOString(),
        dte: dte ? { serie: dte.serie, numero: dte.numero } : null,
    }
}
