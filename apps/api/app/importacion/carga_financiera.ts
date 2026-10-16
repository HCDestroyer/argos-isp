import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import ImportarFacturaPendiente, {
    type EntradaImportarFactura,
} from '#billing/actions/importar_factura_pendiente'
import RegistrarSaldoInicial, { type EntradaSaldoInicial } from '#billing/actions/registrar_saldo_inicial'

/**
 * Puerto del importador hacia las acciones de carga histórica de A3 (facturas pendientes, saldo
 * inicial y pago histórico). El importador no llama esas acciones directamente: así, cuando A3
 * publique `contratos/importacion.md` (acción de pago histórico, cambios en saldo inicial), solo
 * cambia el adaptador de este archivo.
 *
 * Supuesto mientras llega el contrato (anotado en `.claude/integration/a6.md`): el pago histórico
 * es **solo historial** (estado de cuenta), no mueve el saldo, porque lo pendiente de cada factura
 * ya descuenta lo pagado en Mikrowisp. Si A3 lo define con efecto en el libro, el importador debe
 * importar la factura por su total en lugar de lo pendiente.
 */
export interface EntradaPagoHistorico {
    /** `mikrowisp:pago:<id>`: idempotencia */
    clave_externa: string
    /** cliente de ArgosIsp que pagó */
    cliente_id: number
    monto: string
    fecha: string | null
    metodo: string | null
    /** factura de origen que pagó (`mikrowisp:factura:<id>`), puede ser de otro cliente */
    factura_clave_externa: string | null
}

export interface CargaFinanciera {
    importarFactura(
        entrada: EntradaImportarFactura,
        ctx: ContextoAccion,
        trx: TransactionClientContract,
    ): Promise<unknown>
    registrarSaldoInicial(
        entrada: EntradaSaldoInicial,
        ctx: ContextoAccion,
        trx: TransactionClientContract,
    ): Promise<unknown>
    /** null mientras A3 no publique la acción: los pagos del origen no se importan (queda en `pendiente`) */
    registrarPagoHistorico:
        | ((
              entrada: EntradaPagoHistorico,
              ctx: ContextoAccion,
              trx: TransactionClientContract,
          ) => Promise<unknown>)
        | null
    /** ¿ya existe el pago histórico con esa clave? (idempotencia) */
    existePagoHistorico?: (clave: string, trx: TransactionClientContract) => Promise<boolean>
}

/** Las acciones de A3 que ya están en `main`. */
export const cargaFinancieraA3: CargaFinanciera = {
    importarFactura: (entrada, ctx, trx) => new ImportarFacturaPendiente().execute(entrada, ctx, { trx }),
    registrarSaldoInicial: (entrada, ctx, trx) => new RegistrarSaldoInicial().execute(entrada, ctx, { trx }),
    registrarPagoHistorico: null,
}
