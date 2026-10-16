import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { CERO, aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { pendienteDe } from '#billing/facturas'
import { pasarela, proveedorConfigurado, PasarelaNoConfigurada } from '#billing/pasarelas/pasarela'
import { verCobroPasarela, type CobroPasarelaVista } from '#billing/pasarelas/cobros'

/**
 * `pasarela.crear_cobro` (`POST /pasarela/cobros`; el portal de A5 la llama directo desde "Pagar
 * en línea" con canal `portal` y actor sistema).
 *
 * Crea el cobro en el proveedor configurado y devuelve `url_pago`, adonde se manda al cliente.
 * No mueve dinero: el pago se registra cuando llega el webhook firmado (`pasarela.procesar_webhook`).
 *
 * - `monto` por defecto: lo pendiente de las `facturas` pedidas (de cualquier cliente, como en
 *   el pago de terceros) o, sin ellas, todo lo pendiente del cliente. 422 `sin_deuda` si no debe
 *   nada y no se pidió monto.
 * - `facturas` se guardan y el pago se aplicará primero a ellas.
 */

export interface EntradaCrearCobroPasarela {
    cliente_id: number
    monto?: string | null
    facturas?: number[]
    servicio_id?: number | null
}

export default class CrearCobroPasarela extends DomainAction<EntradaCrearCobroPasarela, CobroPasarelaVista> {
    readonly nombre = 'pasarela.crear_cobro'

    protected async handle(input: EntradaCrearCobroPasarela, t: Transaccion): Promise<CobroPasarelaVista> {
        const proveedor = proveedorConfigurado()
        if (!proveedor) throw new PasarelaNoConfigurada()
        const adaptador = await pasarela(proveedor)

        const cliente = (await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .select('id', 'nombre', 'email')
            .first()) as { id: number; nombre: string; email: string | null } | null
        if (!cliente) {
            throw new ValidacionFallida([
                { field: 'cliente_id', message: `El cliente ${input.cliente_id} no existe`, rule: 'exists' },
            ])
        }
        if (input.servicio_id) {
            const servicio = await t.trx
                .from('core.servicios')
                .where('id', input.servicio_id)
                .where('cliente_id', cliente.id)
                .first()
            if (!servicio) {
                throw new ValidacionFallida([
                    { field: 'servicio_id', message: 'El servicio no es de este cliente', rule: 'exists' },
                ])
            }
        }

        const facturas = [...new Set(input.facturas ?? [])]
        const filas = (await t.trx
            .from('billing.facturas')
            .whereIn('estado', ['emitida', 'parcial', 'vencida'])
            .if(
                facturas.length > 0,
                (q) => q.whereIn('id', facturas),
                (q) => q.where('cliente_id', cliente.id),
            )
            .select('id', 'total', 'pagado')) as Array<{ id: number; total: string; pagado: string }>
        const faltantes = facturas
            .map((id, i) => ({ id, i }))
            .filter(({ id }) => !filas.some((f) => f.id === id))
        if (faltantes.length > 0) {
            throw new ValidacionFallida(
                faltantes.map(({ id, i }) => ({
                    field: `facturas.${i}`,
                    message: `La factura ${id} no existe o no tiene saldo pendiente`,
                    rule: 'factura_pendiente',
                })),
            )
        }
        const pendiente = filas.reduce((suma, f) => suma.plus(pendienteDe(f)), CERO)

        const monto = input.monto ? dec(input.monto) : pendiente
        if (input.monto && (monto.lte(0) || !tieneCentavosExactos(monto))) {
            throw new ValidacionFallida([
                {
                    field: 'monto',
                    message: 'El monto debe ser mayor que 0 con hasta 2 decimales',
                    rule: 'monto',
                },
            ])
        }
        if (monto.lte(0)) throw new ReglaNegocio('El cliente no tiene saldo pendiente', 'sin_deuda')

        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.pasarela_cobros')
            .insert({
                proveedor,
                cliente_id: cliente.id,
                servicio_id: input.servicio_id ?? null,
                monto: aTexto(monto),
                facturas: t.trx.raw('?::bigint[]', [`{${facturas.join(',')}}`]),
                canal: t.ctx.canal,
                creado_por: t.ctx.actor.id,
            })
            .returning('id')) as Array<{ id: number }>
        const cobroId = fila!.id
        t.fijarEntidad('cobro_pasarela', cobroId)

        const creado = await adaptador.crearCobro({
            referencia: String(cobroId),
            monto: aTexto(monto),
            descripcion: `Pago en línea de ${cliente.nombre}`,
            cliente,
        })
        await t.trx.from('billing.pasarela_cobros').where('id', cobroId).update({
            id_proveedor: creado.id_proveedor,
            url_pago: creado.url_pago,
            expira_en: creado.expira_en,
        })
        return verCobroPasarela(cobroId, t.trx)
    }
}
