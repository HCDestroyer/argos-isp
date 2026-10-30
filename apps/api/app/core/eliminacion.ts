import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'
import { Problema } from '#shared/errores'

/**
 * Eliminar solo lo que nunca se usó (decisión del PM, 29 oct; `contratos/eliminar.md`).
 *
 * Un servicio o un router con historial (facturas, pagos, asientos, DTE, sesiones, inventario,
 * lealtad, Horus, comandos a RouterOS…) no se elimina: se retira. Así se respetan el libro
 * inmutable, las facturas FEL y la auditoría. Aquí vive la lista de lo que impide eliminar un
 * servicio; la del router está en `#network/eliminacion`.
 */

export interface MotivoEliminacion {
    /** clave estable para el panel: `facturas`, `sesiones`, `servicios`… */
    codigo: string
    cantidad: number
    /** texto para mostrar: «tiene 3 facturas» */
    mensaje: string
}

export interface Eliminable {
    eliminable: boolean
    motivos: MotivoEliminacion[]
}

/** Una comprobación: cuántas filas de otro lado impiden eliminar. */
export interface Comprobacion {
    codigo: string
    /** `[singular, plural]` del sustantivo: «factura», «facturas» */
    nombre: [string, string]
    consulta: (cliente: QueryClientContract) => DatabaseQueryBuilderContract<any>
}

export async function evaluarComprobaciones(
    comprobaciones: Comprobacion[],
    cliente: QueryClientContract,
): Promise<Eliminable> {
    const motivos: MotivoEliminacion[] = []
    for (const c of comprobaciones) {
        const fila = (await c.consulta(cliente).count('* as total').first()) as {
            total: string | number
        } | null
        const cantidad = Number(fila?.total ?? 0)
        if (cantidad === 0) continue
        const nombre = cantidad === 1 ? c.nombre[0] : c.nombre[1]
        motivos.push({ codigo: c.codigo, cantidad, mensaje: `tiene ${cantidad} ${nombre}` })
    }
    return { eliminable: motivos.length === 0, motivos }
}

/** 422 con la lista de lo que impide eliminar (`errors[]`: field = código, message = motivo). */
export class ConHistorial extends Problema {
    constructor(
        codigo: 'servicio_con_historial' | 'router_con_historial',
        detalle: string,
        motivos: MotivoEliminacion[],
    ) {
        super(
            422,
            codigo,
            codigo === 'servicio_con_historial' ? 'Servicio con historial' : 'Router con historial',
            detalle,
            motivos.map((m) => ({ field: m.codigo, message: m.mensaje, rule: 'historial' })),
        )
    }
}

/** Ids de las facturas y notas de crédito del servicio (para pagos, asientos y DTE). */
function documentosDelServicio(id: number) {
    return {
        facturas: (q: DatabaseQueryBuilderContract<any>) =>
            q.from('billing.facturas').where('servicio_id', id).select('id'),
        notas: (q: DatabaseQueryBuilderContract<any>) =>
            q.from('billing.notas_credito').where('servicio_id', id).select('id'),
    }
}

function comprobacionesServicio(id: number): Comprobacion[] {
    const docs = documentosDelServicio(id)
    const porServicio = (codigo: string, tabla: string, nombre: [string, string]): Comprobacion => ({
        codigo,
        nombre,
        consulta: (c) => c.from(tabla).where('servicio_id', id),
    })
    return [
        porServicio('facturas', 'billing.facturas', ['factura', 'facturas']),
        porServicio('notas_credito', 'billing.notas_credito', ['nota de crédito', 'notas de crédito']),
        {
            codigo: 'pagos',
            nombre: ['pago aplicado', 'pagos aplicados'],
            consulta: (c) =>
                c.from('billing.pagos_aplicaciones').whereIn('factura_id', (q) => docs.facturas(q)),
        },
        porServicio('promesas', 'billing.promesas', ['promesa de pago', 'promesas de pago']),
        porServicio('bonificaciones', 'billing.bonificaciones', ['bonificación', 'bonificaciones']),
        porServicio('cargos', 'billing.conceptos_recurrentes', ['cargo recurrente', 'cargos recurrentes']),
        porServicio('comprobantes', 'billing.comprobantes', ['comprobante de pago', 'comprobantes de pago']),
        porServicio('cobros_en_linea', 'billing.pasarela_cobros', ['cobro en línea', 'cobros en línea']),
        {
            codigo: 'asientos',
            nombre: ['asiento contable', 'asientos contables'],
            consulta: (c) =>
                c
                    .from('ledger.asientos')
                    .where((w) =>
                        w
                            .where((f) =>
                                f
                                    .where('origen_tipo', 'factura')
                                    .whereIn('origen_id', (q) => docs.facturas(q)),
                            )
                            .orWhere((n) =>
                                n
                                    .where('origen_tipo', 'nota_credito')
                                    .whereIn('origen_id', (q) => docs.notas(q)),
                            ),
                    ),
        },
        {
            codigo: 'dte',
            nombre: ['DTE', 'DTE'],
            consulta: (c) =>
                c
                    .from('fiscal.dte')
                    .where((w) =>
                        w
                            .where((f) =>
                                f
                                    .where('documento_tipo', 'factura')
                                    .whereIn('documento_id', (q) => docs.facturas(q)),
                            )
                            .orWhere((n) =>
                                n
                                    .where('documento_tipo', 'nota_credito')
                                    .whereIn('documento_id', (q) => docs.notas(q)),
                            ),
                    ),
        },
        porServicio('sesiones', 'network.sesiones', ['sesión PPPoE', 'sesiones PPPoE']),
        porServicio('caidas', 'network.caidas_repetidas', ['registro de caídas', 'registros de caídas']),
        porServicio('equipos', 'inventario.unidades', [
            'equipo de inventario (comodato o entregado)',
            'equipos de inventario (comodato o entregados)',
        ]),
        porServicio('inventario', 'inventario.movimientos', [
            'movimiento de inventario',
            'movimientos de inventario',
        ]),
        porServicio('lealtad', 'lealtad.movimientos', ['movimiento de puntos', 'movimientos de puntos']),
        porServicio('canjes', 'lealtad.canjes', ['canje de puntos', 'canjes de puntos']),
        porServicio('sorteos', 'lealtad.sorteos_participantes', [
            'participación en sorteos',
            'participaciones en sorteos',
        ]),
        porServicio('horus', 'integraciones.horus_datos', ['dato de Horus', 'datos de Horus']),
        porServicio('horus_recibidos', 'integraciones.horus_recibidos', [
            'webhook de Horus',
            'webhooks de Horus',
        ]),
        {
            codigo: 'importacion',
            nombre: ['fila importada', 'filas importadas'],
            consulta: (c) =>
                c.from('importacion.filas_origen').where('entidad_tipo', 'servicio').where('entidad_id', id),
        },
    ]
}

/** ¿Se puede eliminar el servicio? Si no, qué lo impide. */
export function servicioEliminable(id: number, cliente: QueryClientContract = db.connection()) {
    return evaluarComprobaciones(comprobacionesServicio(id), cliente)
}
