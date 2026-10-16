import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { ContextoAccion } from '#shared/contexto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import { bloquearCliente } from '#billing/cobros'
import { exigirReferenciaLibre, validarDatosBancarios } from '#billing/datos_bancarios'
import {
    METODOS_COMPROBANTE,
    verComprobante,
    type CanalComprobante,
    type ComprobanteVista,
    type MetodoComprobante,
} from '#billing/comprobantes'
import {
    TAMANO_MAXIMO_COMPROBANTE,
    borrarArchivoComprobante,
    detectarTipoComprobante,
    guardarArchivoComprobante,
    nuevaRutaComprobante,
} from '#billing/comprobantes_archivos'

/**
 * `comprobantes.registrar`: el cliente (portal, actor sistema) o un operador (panel) sube el
 * comprobante de un depósito, transferencia, ACH o remesa. Queda `pendiente` hasta que alguien
 * con `comprobantes.aprobar` lo apruebe (crea el pago) o lo rechace. **No mueve dinero ni cambia
 * el estado del servicio**: eso pasa al aprobarlo.
 *
 * - Datos por método igual que `POST /pagos` (`DATOS_POR_METODO`, 422 por campo): cuenta bancaria
 *   propia de destino y referencia siempre; banco de origen con transferencia y ACH.
 * - Archivo: foto JPG, PNG o WebP, o PDF, de hasta 5 MB. El tipo se verifica por el contenido
 *   (firma de los primeros bytes); con otro contenido → 422 `archivo` (`rule: tipo` o `tamano`).
 *   Se guarda en `COMPROBANTES_DIR` (`comprobantes_archivos.ts`), nunca en la base.
 * - Referencia repetida → 409 `referencia_duplicada`: si ya es un pago (mismo método y cuenta) o
 *   si hay otro comprobante pendiente con ella. Uno rechazado la deja libre.
 * - Evento `comprobante.recibido` (`comprobante_id`, `cliente_id`, `pago_id: null`, `motivo: null`).
 *
 * Uso desde el portal (A5):
 * ```ts
 * await new RegistrarComprobante().execute(
 *     { cliente_id, servicio_id, metodo: 'deposito', cuenta_bancaria_id, referencia: '123456',
 *       monto: '150.00', fecha_deposito: '2026-10-16', canal: 'portal',
 *       archivo: { contenido: await readFile(archivo.tmpPath!), nombre: archivo.clientName } },
 *     { actor: { tipo: 'sistema', id: null }, canal: 'portal', requestId },
 * )
 * ```
 */

export interface ArchivoComprobante {
    contenido: Uint8Array
    /** nombre original (solo informativo; el tipo se decide por el contenido) */
    nombre?: string | null
}

export interface EntradaRegistrarComprobante {
    cliente_id: number
    servicio_id?: number | null
    metodo: MetodoComprobante
    cuenta_bancaria_id: number
    banco_origen_id?: number | null
    referencia: string
    monto: string
    /** día del depósito (YYYY-MM-DD, Guatemala); no puede ser futuro */
    fecha_deposito: string
    archivo: ArchivoComprobante
    canal: CanalComprobante
    nota?: string | null
}

/** En la auditoría el archivo se registra solo con su nombre y tamaño, nunca su contenido. */
class ArchivoAuditable implements ArchivoComprobante {
    constructor(
        readonly contenido: Uint8Array,
        readonly nombre: string | null,
    ) {}

    toJSON() {
        return { nombre: this.nombre, bytes: this.contenido.length }
    }
}

export default class RegistrarComprobante extends DomainAction<
    EntradaRegistrarComprobante,
    ComprobanteVista
> {
    readonly nombre = 'comprobantes.registrar'

    override execute(
        input: EntradaRegistrarComprobante,
        ctx: ContextoAccion,
        opciones: { trx?: TransactionClientContract } = {},
    ): Promise<ComprobanteVista> {
        const archivo = input.archivo
            ? new ArchivoAuditable(input.archivo.contenido, input.archivo.nombre?.trim() || null)
            : input.archivo
        return super.execute({ ...input, archivo }, ctx, opciones)
    }

    protected async handle(input: EntradaRegistrarComprobante, t: Transaccion): Promise<ComprobanteVista> {
        const errores: ErrorCampo[] = []
        const referencia = input.referencia?.trim() || null

        if (!(METODOS_COMPROBANTE as readonly string[]).includes(input.metodo)) {
            errores.push({
                field: 'metodo',
                message: `Método inválido; se acepta ${METODOS_COMPROBANTE.join(', ')}`,
                rule: 'enum',
            })
        }
        const monto = /^\d{1,12}(\.\d{1,2})?$/.test(input.monto?.trim() ?? '')
            ? dec(input.monto.trim())
            : null
        if (!monto || monto.lte(0) || !tieneCentavosExactos(monto)) {
            errores.push({
                field: 'monto',
                message: 'El monto debe ser mayor que 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
        const fecha = DateTime.fromISO(input.fecha_deposito ?? '', { zone: ZONA_NEGOCIO })
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha_deposito ?? '') || !fecha.isValid) {
            errores.push({ field: 'fecha_deposito', message: 'Fecha inválida (YYYY-MM-DD)', rule: 'fecha' })
        } else if (input.fecha_deposito > hoyGuatemala()) {
            errores.push({
                field: 'fecha_deposito',
                message: 'La fecha del depósito no puede ser futura',
                rule: 'fecha_futura',
            })
        }

        const contenido = input.archivo?.contenido
        const tipo = contenido ? detectarTipoComprobante(contenido) : null
        if (!contenido || contenido.length === 0) {
            errores.push({ field: 'archivo', message: 'Falta el archivo del comprobante', rule: 'required' })
        } else if (contenido.length > TAMANO_MAXIMO_COMPROBANTE) {
            errores.push({
                field: 'archivo',
                message: `El archivo pesa ${(contenido.length / 1024 / 1024).toFixed(1)} MB; el máximo es 5 MB`,
                rule: 'tamano',
            })
        } else if (!tipo) {
            errores.push({
                field: 'archivo',
                message: 'El archivo no es una foto (JPG, PNG o WebP) ni un PDF',
                rule: 'tipo',
            })
        }

        const cliente = await t.trx.from('core.clientes').where('id', input.cliente_id).select('id').first()
        if (!cliente) {
            errores.push({
                field: 'cliente_id',
                message: `El cliente ${input.cliente_id} no existe`,
                rule: 'exists',
            })
        }
        if (input.servicio_id) {
            const servicio = await t.trx
                .from('core.servicios')
                .where('id', input.servicio_id)
                .select('cliente_id')
                .first()
            if (!servicio || servicio.cliente_id !== input.cliente_id) {
                errores.push({
                    field: 'servicio_id',
                    message: `El servicio ${input.servicio_id} no es del cliente ${input.cliente_id}`,
                    rule: 'exists',
                })
            }
        }

        let bancario: Awaited<ReturnType<typeof validarDatosBancarios>> | null = null
        try {
            bancario = await validarDatosBancarios(t.trx, {
                metodo: input.metodo,
                referencia,
                cuenta_bancaria_id: input.cuenta_bancaria_id ?? null,
                banco_origen_id: input.banco_origen_id ?? null,
            })
        } catch (error) {
            if (!(error instanceof ValidacionFallida)) throw error
            errores.push(...(error.errores ?? []))
        }
        if (errores.length > 0 || !bancario || !monto || !tipo || !contenido) {
            throw new ValidacionFallida(errores)
        }

        await bloquearCliente(t.trx, input.cliente_id)
        await exigirReferenciaLibre(t.trx, input.metodo, referencia, bancario.cuentaBancariaId)
        await this.exigirSinPendiente(t, input.metodo, referencia!, bancario.cuentaBancariaId!)

        const ruta = nuevaRutaComprobante(tipo)
        let id: number
        try {
            const [fila] = (await t.trx
                .insertQuery()
                .table('billing.comprobantes')
                .insert({
                    cliente_id: input.cliente_id,
                    servicio_id: input.servicio_id ?? null,
                    metodo: input.metodo,
                    cuenta_bancaria_id: bancario.cuentaBancariaId,
                    banco_origen_id: bancario.bancoOrigenId,
                    referencia,
                    monto: aTexto(monto),
                    fecha_deposito: input.fecha_deposito,
                    archivo: ruta,
                    archivo_tipo: tipo,
                    archivo_tamano: contenido.length,
                    archivo_nombre: input.archivo.nombre?.trim().slice(0, 255) || null,
                    canal: input.canal,
                    nota: input.nota?.trim() || null,
                    estado: 'pendiente',
                    registrado_por: t.ctx.actor.id,
                })
                .returning('id')) as Array<{ id: number }>
            id = fila!.id
        } catch (error) {
            // dos envíos simultáneos con la misma referencia: lo resuelve el índice único parcial
            if ((error as { code?: string }).code === '23505') {
                throw new Conflicto(
                    `La referencia ${referencia} ya está en otro comprobante pendiente de revisión`,
                    'referencia_duplicada',
                    'Referencia duplicada',
                )
            }
            throw error
        }
        t.fijarEntidad('comprobante', id)

        await guardarArchivoComprobante(ruta, contenido)
        try {
            await t.emit('comprobante.recibido', {
                comprobante_id: id,
                cliente_id: input.cliente_id,
                pago_id: null,
                motivo: null,
            })
            return await verComprobante(id, t.trx)
        } catch (error) {
            await borrarArchivoComprobante(ruta).catch(() => {})
            throw error
        }
    }

    private async exigirSinPendiente(
        t: Transaccion,
        metodo: MetodoComprobante,
        referencia: string,
        cuentaBancariaId: number,
    ) {
        const pendiente = await t.trx
            .from('billing.comprobantes')
            .where('metodo', metodo)
            .where('cuenta_bancaria_id', cuentaBancariaId)
            .where('referencia', referencia)
            .where('estado', 'pendiente')
            .select('id')
            .first()
        if (pendiente) {
            throw new Conflicto(
                `La referencia ${referencia} ya está en el comprobante ${pendiente.id}, pendiente de revisión`,
                'referencia_duplicada',
                'Referencia duplicada',
            )
        }
    }
}
