import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import { usuarioDelActor } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Problema, ValidacionFallida } from '#shared/errores'
import { permisosDeUsuario } from '#core/acl'
import { aTexto, dec } from '#ledger/dinero'
import type { ClaveCategoriaEgreso } from '#ledger/plan_cuentas'
import type { EgresoVista } from '#ledger/egresos'
import { verEgreso } from '#ledger/egresos'
import { estadoCajaChica, leerCajaChica, AVISO_REPONER_PCT, type EstadoCajaChica } from '#ledger/caja_chica'
import {
    auditable,
    validarArchivoComprobante,
    type ArchivoAuditable,
    type ArchivoSubido,
} from '#ledger/comprobantes_egreso'
import { borrarArchivoComprobante, guardarArchivoComprobante } from '#billing/comprobantes_archivos'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'

/**
 * `caja_chica.registrar_gasto` (`POST /cajas/:id/gastos`, multipart): un gasto pagado con el efectivo
 * de la caja chica (B9 del plan de contabilidad, §5.7; decisiones del PM del 26 nov 2026).
 *
 * - **Comprobante obligatorio** (`archivo`: foto JPG, PNG o WebP, o PDF, hasta 5 MB): «sin comprobante
 *   no hay gasto». Se guarda en el almacenamiento compartido (`ledger.egresos_comprobantes`).
 * - **Sin tope por gasto** (el PM: «el tope de gastos no se puede definir»): el único límite es el
 *   efectivo de la caja (422 `efectivo_insuficiente`).
 * - Es un egreso (`ledger.egresos`, `metodo = caja`, sin turno) con su asiento `Gasto / Caja chica`.
 * - `con_factura`: el gasto trae factura a nombre de la empresa. Se registra igual y la respuesta
 *   dice `pasar_a_compras = true`: el panel sigue con `POST /compras/desde-egreso/:egreso_id` para
 *   no perder el crédito del IVA (la compra reclasifica el gasto sin tocar el efectivo).
 * - Quien no tiene `egresos.registrar_sin_limite` solo registra en la caja chica de la que es
 *   encargado (`cajero_id`; 403 `caja_ajena`).
 * - Evento `caja_chica.gasto_registrado` (con `bajo_minimo` si el efectivo queda bajo el
 *   `AVISO_REPONER_PCT` del fondo: avisa para reponer).
 */

export interface EntradaGastoCajaChica {
    caja_id: number
    categoria: ClaveCategoriaEgreso
    monto: string
    descripcion: string
    fecha?: string
    proveedor?: string | null
    comprobante?: string | null
    con_factura?: boolean
    archivo: ArchivoSubido | ArchivoAuditable | null
}

export interface GastoCajaChica {
    egreso: EgresoVista
    caja_chica: EstadoCajaChica
    /** con factura a nombre de la empresa: sigue `POST /compras/desde-egreso/:egreso_id` */
    pasar_a_compras: boolean
}

export default class RegistrarGastoCajaChica extends DomainAction<EntradaGastoCajaChica, GastoCajaChica> {
    readonly nombre = 'caja_chica.registrar_gasto'

    override execute(
        input: EntradaGastoCajaChica,
        ctx: ContextoAccion,
        opciones: { trx?: TransactionClientContract } = {},
    ): Promise<GastoCajaChica> {
        return super.execute({ ...input, archivo: auditable(input.archivo) }, ctx, opciones)
    }

    protected async handle(input: EntradaGastoCajaChica, t: Transaccion): Promise<GastoCajaChica> {
        t.fijarEntidad('caja', input.caja_id)
        const caja = await leerCajaChica(t.trx, input.caja_id, true)
        exigirAccesoEmpresa(t.ctx, caja.empresa_id)
        t.fijarEmpresa(caja.empresa_id)
        if (!input.descripcion?.trim()) {
            throw new ValidacionFallida([
                { field: 'descripcion', message: 'Escribe en qué se gastó', rule: 'required' },
            ])
        }
        const { tipo, ruta } = validarArchivoComprobante(input.archivo)

        const usuario = usuarioDelActor(t.ctx.actor)
        const permisos = usuario === null ? null : await permisosDeUsuario(usuario)
        if (
            permisos !== null &&
            !permisos.includes('egresos.registrar_sin_limite') &&
            caja.cajero_id !== usuario
        ) {
            throw new Problema(
                403,
                'caja_ajena',
                'Caja ajena',
                `La caja chica ${caja.nombre} tiene otro encargado: solo él registra sus gastos`,
            )
        }

        const egreso = await new RegistrarEgreso().execute(
            {
                categoria: input.categoria,
                monto: input.monto,
                metodo: 'caja',
                caja_id: caja.id,
                fecha: input.fecha,
                proveedor: input.proveedor ?? null,
                descripcion: input.descripcion,
                comprobante: input.comprobante ?? null,
                desde_caja_chica: true,
            },
            t.ctx,
            { trx: t.trx },
        )
        const contenido = input.archivo!.contenido
        await t.trx
            .insertQuery()
            .table('ledger.egresos_comprobantes')
            .insert({
                egreso_id: egreso.id,
                empresa_id: caja.empresa_id,
                archivo: ruta,
                tipo,
                tamano: contenido.length,
                nombre: input.archivo?.nombre ?? null,
                subido_por: usuario,
            })
        await guardarArchivoComprobante(ruta, contenido)
        try {
            const estado = await estadoCajaChica(caja.id, t.trx)
            await t.emit('caja_chica.gasto_registrado', {
                egreso_id: egreso.id,
                empresa_id: caja.empresa_id,
                caja_id: caja.id,
                categoria: input.categoria,
                monto: aTexto(dec(input.monto)),
                con_factura: Boolean(input.con_factura),
                efectivo: estado.efectivo,
                bajo_minimo: estado.porcentaje < AVISO_REPONER_PCT,
            })
            return {
                egreso: await verEgreso(egreso.id, t.trx),
                caja_chica: estado,
                pasar_a_compras: Boolean(input.con_factura),
            }
        } catch (error) {
            await borrarArchivoComprobante(ruta).catch(() => {})
            throw error
        }
    }
}
