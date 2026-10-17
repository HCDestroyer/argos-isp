import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import ImportarFacturaPendiente, {
    type EntradaImportarFactura,
    type ResultadoImportarFactura,
} from '#billing/actions/importar_factura_pendiente'
import RegistrarSaldoInicial, { type EntradaSaldoInicial } from '#billing/actions/registrar_saldo_inicial'
import RegistrarPagoHistorico, {
    type EntradaPagoHistorico,
    type ResultadoPagoHistorico,
} from '#billing/actions/registrar_pago_historico'

export type { EntradaPagoHistorico } from '#billing/actions/registrar_pago_historico'

/**
 * Puerto del importador hacia las acciones de carga histórica de A3
 * (`.claude/integration/contratos/importacion.md`): facturas, saldo inicial y pago histórico. El
 * importador no llama esas acciones directamente: si A3 cambia una firma, solo cambia el
 * adaptador de este archivo (y las pruebas pueden poner un doble).
 *
 * El pago histórico **mueve el libro** (`2.9.01 / CxC + Anticipos`, con la fecha del pago): por
 * eso el importador, para los clientes que tienen pagos en el origen, importa las facturas que
 * esos pagos cubren por su **total** y pasa `facturas: [ids]` al pago (modo B del contrato).
 */
export interface CargaFinanciera {
    importarFactura(
        entrada: EntradaImportarFactura,
        ctx: ContextoAccion,
        trx: TransactionClientContract,
    ): Promise<ResultadoImportarFactura>
    registrarSaldoInicial(
        entrada: EntradaSaldoInicial,
        ctx: ContextoAccion,
        trx: TransactionClientContract,
    ): Promise<unknown>
    /**
     * null: no se importan pagos (todos los clientes en modo A: solo saldo; los pagos del origen
     * salen como omitidos en el reporte)
     */
    registrarPagoHistorico:
        | ((
              entrada: EntradaPagoHistorico,
              ctx: ContextoAccion,
              trx: TransactionClientContract,
          ) => Promise<Pick<ResultadoPagoHistorico, 'id' | 'creado'>>)
        | null
    /** ¿ya existe el pago histórico con ese id externo? (idempotencia sin auditar de nuevo) */
    existePagoHistorico?: (claveExterna: string, trx: TransactionClientContract) => Promise<boolean>
}

/** Las acciones de A3. */
export const cargaFinancieraA3: CargaFinanciera = {
    importarFactura: (entrada, ctx, trx) => new ImportarFacturaPendiente().execute(entrada, ctx, { trx }),
    registrarSaldoInicial: (entrada, ctx, trx) => new RegistrarSaldoInicial().execute(entrada, ctx, { trx }),
    registrarPagoHistorico: (entrada, ctx, trx) =>
        new RegistrarPagoHistorico().execute(entrada, ctx, { trx }),
    existePagoHistorico: async (clave, trx) =>
        !!(await trx.from('billing.pagos').where('clave_externa', clave).select('id').first()),
}
