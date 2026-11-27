import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ConflictoVersion, NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CAMPOS_CLIENTE_FISCAL } from '#shared/eventos'
import {
    perfilFiscalDe,
    vistaPerfilFiscal,
    type PerfilFiscal,
    type PerfilFiscalVista,
    type TipoImpuesto,
} from '#billing/perfil_fiscal'

/**
 * `clientes.asignar_perfil_fiscal` (`POST /clientes/:id/perfil-fiscal`): tipo de impuesto del
 * cliente (Normal, Agente retenedor de IVA o Exento) y la casilla «me retiene ISR» (lote B4 del plan
 * de contabilidad).
 *
 * - Control optimista por `version` (la de `GET /clientes/:id/perfil-fiscal`; 0 si nunca se
 *   guardó): otra versión → 409 `conflicto_version`.
 * - `exento` exige `resolucion_exencion` { numero, fecha } (la resolución de la SAT; 422). Se
 *   guarda, pero la factura sigue saliendo con IVA mientras la exención esté apagada
 *   (`exencionDisponible`).
 * - No toca facturas emitidas: cada factura guarda su instantánea al emitirse.
 * - `audit.cambios` (entidad `cliente_perfil_fiscal`, id = cliente) y `cliente.actualizado` con
 *   `campos[]` = `tipo_impuesto` y/o `retiene_isr` si cambiaron.
 */

export interface EntradaAsignarPerfilFiscal {
    cliente_id: number
    tipo_impuesto: TipoImpuesto
    retiene_isr: boolean
    resolucion_exencion?: { numero: string; fecha: string } | null
    nota?: string | null
    version: number
}

export default class AsignarPerfilFiscal extends DomainAction<EntradaAsignarPerfilFiscal, PerfilFiscalVista> {
    readonly nombre = 'clientes.asignar_perfil_fiscal'

    protected async handle(input: EntradaAsignarPerfilFiscal, t: Transaccion): Promise<PerfilFiscalVista> {
        const clienteId = input.cliente_id
        t.fijarEntidad('cliente_perfil_fiscal', clienteId)
        const cliente = await t.trx
            .from('core.clientes')
            .where('id', clienteId)
            .forUpdate()
            .select('id')
            .first()
        if (!cliente) throw new NoEncontrado(`El cliente ${clienteId} no existe`)
        const antes = await perfilFiscalDe(clienteId, t.trx)
        if (antes.version !== input.version) {
            throw new ConflictoVersion('billing.perfiles_fiscales_cliente', clienteId)
        }

        const errores: ErrorCampo[] = []
        let resolucion: { numero: string; fecha: string } | null = null
        if (input.tipo_impuesto === 'exento') {
            const numero = input.resolucion_exencion?.numero?.trim() ?? ''
            if (!numero) {
                errores.push({
                    field: 'resolucion_exencion.numero',
                    message: 'Un cliente exento necesita el número de su resolución de la SAT',
                    rule: 'required',
                })
            }
            const fecha = input.resolucion_exencion?.fecha
                ? fechaValida(input.resolucion_exencion.fecha, 'resolucion_exencion.fecha')
                : null
            if (!fecha) {
                errores.push({
                    field: 'resolucion_exencion.fecha',
                    message: 'Falta la fecha de la resolución',
                    rule: 'required',
                })
            } else if (fecha > hoyGuatemala()) {
                errores.push({
                    field: 'resolucion_exencion.fecha',
                    message: 'La resolución no puede ser futura',
                    rule: 'futuro',
                })
            }
            if (errores.length === 0) resolucion = { numero: numero.toUpperCase(), fecha: fecha! }
        } else if (input.resolucion_exencion) {
            errores.push({
                field: 'resolucion_exencion',
                message: 'La resolución de exención solo va con el tipo «exento»',
                rule: 'no_aplica',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const columnas = {
            tipo_impuesto: input.tipo_impuesto,
            retiene_isr: input.retiene_isr,
            resolucion_exencion: resolucion ? JSON.stringify(resolucion) : null,
            nota: input.nota?.trim() || null,
            actualizado_por: usuarioDelActor(t.ctx.actor),
        }
        if (antes.version === 0) {
            await t.trx
                .table('billing.perfiles_fiscales_cliente')
                .insert({ cliente_id: clienteId, ...columnas })
        } else {
            await t.trx
                .from('billing.perfiles_fiscales_cliente')
                .where({ cliente_id: clienteId, version: input.version })
                .update({
                    ...columnas,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        }
        const despues = await perfilFiscalDe(clienteId, t.trx)
        const plano = (p: PerfilFiscal) => ({
            tipo_impuesto: p.tipo_impuesto,
            retiene_isr: p.retiene_isr,
            resolucion_exencion: p.resolucion_exencion,
            nota: p.nota,
        })
        await t.registrarCambios(
            { tipo: 'cliente_perfil_fiscal', id: clienteId },
            plano(antes),
            plano(despues),
        )
        const campos = CAMPOS_CLIENTE_FISCAL.filter((c) => antes[c] !== despues[c])
        if (campos.length > 0) {
            await t.emit('cliente.actualizado', { cliente_id: clienteId, campos: [...campos] })
        }
        return vistaPerfilFiscal(clienteId, t.ctx.empresaId ?? null, t.trx)
    }
}
