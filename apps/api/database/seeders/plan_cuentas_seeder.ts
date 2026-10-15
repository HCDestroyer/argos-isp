import { BaseSeeder } from '@adonisjs/lucid/seeders'
import db from '@adonisjs/lucid/services/db'
import { sembrarPlanCuentas } from '#ledger/plan_cuentas'

/**
 * Plan de cuentas base (A3): cuentas, categorías de egreso, caja y banco iniciales.
 * Idempotente; el contenido vive en `app/ledger/plan_cuentas.ts`.
 */
export default class PlanCuentasSeeder extends BaseSeeder {
    async run() {
        await db.transaction((trx) => sembrarPlanCuentas(trx))
    }
}
