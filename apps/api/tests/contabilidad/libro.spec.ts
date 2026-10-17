import { test } from '@japa/runner'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { CUENTAS } from '#ledger/plan_cuentas'
import { errorDe, prepararEmpresas, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import {
    afirmarLibro,
    compararFotoLibro,
    fotoLibro,
    marcasAuditoria,
    verificarLibro,
} from '#tests/contabilidad/verificar_libro'

/**
 * Auditor contable · invariantes 1 (cuadre), 2 (inmutabilidad) y 10 (montos) sobre la base real.
 */

/** Tablas que guardan hechos contables o de auditoría: la base rechaza UPDATE, DELETE y TRUNCATE. */
const INMUTABLES = [
    'ledger.asientos',
    'ledger.movimientos',
    'ledger.cierres_mensuales',
    'ledger.reaperturas_mensuales',
    'ledger.egresos',
    'ledger.egresos_anulaciones',
    'audit.acciones',
    'audit.cambios',
    'audit.red',
    'audit.outbox',
] as const

/** Documentos de billing que la regla 4 también declara inmutables (trigger y REVOKE). */
const DOCUMENTOS_INMUTABLES = ['billing.notas_credito', 'billing.cobros'] as const

/**
 * Tablas de `ledger` que la aplicación sí actualiza, con el motivo. Son datos maestros o de estado
 * (con `version` y `audit.cambios`), no hechos contables: el dinero está en `ledger.movimientos`.
 * Una tabla nueva en `ledger` o `audit` que no esté en ninguna lista hace fallar la prueba: hay
 * que decidir si es inmutable.
 */
const MUTABLES: Record<string, string> = {
    'ledger.cuentas': 'plan de cuentas: renombrar o desactivar (nunca con movimientos se borra: FK)',
    'ledger.cajas': 'catálogo de cajas (nombre, cajero, activa)',
    'ledger.bancos': 'catálogo de bancos del libro',
    'ledger.egresos_categorias': 'catálogo de categorías de egreso',
    'ledger.cajas_turnos':
        'el turno se abre con INSERT y se cierra con UPDATE (hallazgo H3: el turno cerrado sigue editable)',
}

/** Primera fila de una tabla (por id) o null. */
async function primerId(tabla: string): Promise<number | null> {
    const fila = await db.from(tabla).min('id as id').first()
    return fila?.id === null || fila?.id === undefined ? null : Number(fila.id)
}

/**
 * Ejecuta `sql` como el usuario de las pruebas (dueño de las tablas: los triggers lo frenan igual)
 * en una transacción que siempre se deshace; devuelve el error o null. Los permisos del rol
 * `argosisp_app` se revisan con `has_table_privilege` (el usuario de pruebas no puede `SET ROLE`).
 */
async function intentar(sql: string): Promise<string | null> {
    const trx = await db.transaction()
    try {
        await trx.rawQuery(sql)
        return null
    } catch (error) {
        return (error as Error).message
    } finally {
        await trx.rollback()
    }
}

async function archivos(dir: string): Promise<string[]> {
    const entradas = await readdir(dir, { withFileTypes: true })
    const lista: string[] = []
    for (const e of entradas) {
        const ruta = join(dir, e.name)
        if (e.isDirectory()) lista.push(...(await archivos(ruta)))
        else if (e.name.endsWith('.ts')) lista.push(ruta)
    }
    return lista
}

test.group('Auditor contable · libro (1, 2, 10)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('1. cada asiento cuadra, no mezcla empresas y cada empresa y mes cuadran', async ({ assert }) => {
        const e = await prepararEmpresas()
        const b = await servicioFacturado(e.B, '2026-10-01', { precio: '199.99', instalacion: '2026-07-13' })
        const c = await servicioFacturado(e.C, '2026-10-01', { precio: '99.01', instalacion: '2026-08-29' })
        await new RegistrarPago().execute(
            { cliente_id: b.clienteId, metodo: 'caja', monto: '123.45', empresa_id: e.B },
            e.ctx,
        )
        await new EmitirNotaCredito().execute(
            { factura_id: c.facturas[0]!.id, monto: '1.01', motivo: 'auditoría' },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])

        // la acción rechaza un asiento descuadrado (422) y uno con una subcuenta de otra empresa
        const descuadrado = await errorDe(
            new RegistrarAsiento().execute(
                {
                    empresa_id: e.B,
                    descripcion: 'auditoría: descuadre',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: CUENTAS.GASTO_OTROS, debe: '10.00' },
                        { cuenta: CUENTAS.BANCO_PRINCIPAL, haber: '9.99' },
                    ],
                },
                e.ctx,
            ),
        )
        assert.equal(descuadrado.status, 422)
        const cajaC = await db.from('ledger.cajas').where('id', e.cajas.get(e.C)!).firstOrFail()
        const mezcla = await errorDe(
            new RegistrarAsiento().execute(
                {
                    empresa_id: e.B,
                    descripcion: 'auditoría: caja de otra empresa',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: CUENTAS.GASTO_OTROS, debe: '10.00' },
                        { cuenta: Number(cajaC.cuenta_id), haber: '10.00' },
                    ],
                },
                e.ctx,
            ),
        )
        assert.equal(mezcla.status, 422)
        assert.include(mezcla.reglas, 'cuenta_de_otra_empresa')

        // la base también: un INSERT directo descuadrado no llega al COMMIT
        const directo = await intentar(`
            WITH a AS (INSERT INTO ledger.asientos (empresa_id, fecha, descripcion, origen_tipo)
                       VALUES (${e.B}, current_date, 'directo', 'ajuste') RETURNING id)
            INSERT INTO ledger.movimientos (asiento_id, cuenta_id, debe, haber)
            SELECT a.id, (SELECT id FROM ledger.cuentas WHERE codigo = '${CUENTAS.GASTO_OTROS}'), 5, 0 FROM a;
            SET CONSTRAINTS ALL IMMEDIATE;`)
        assert.isNotNull(directo, 'la base aceptó un asiento de un solo movimiento')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('2. la base rechaza UPDATE, DELETE y TRUNCATE en ledger y audit (trigger y permisos de la app)', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B)
        const pago = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '50.00', empresa_id: e.B },
            e.ctx,
        )
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'auditoría' }, e.ctx)

        const rolApp = await db.rawQuery(`SELECT 1 FROM pg_roles WHERE rolname = 'argosisp_app'`)
        const hayRol = rolApp.rows.length > 0
        const aceptadas: string[] = []
        for (const tabla of [...INMUTABLES, ...DOCUMENTOS_INMUTABLES]) {
            const [esquema, nombre] = tabla.split('.') as [string, string]
            // trigger BEFORE UPDATE y DELETE por fila (frena también al dueño de las tablas)
            const triggers = await db.rawQuery(
                `SELECT string_agg(DISTINCT event_manipulation, ',') AS eventos FROM information_schema.triggers
                  WHERE event_object_schema = ? AND event_object_table = ? AND action_timing = 'BEFORE'
                    AND event_manipulation IN ('UPDATE', 'DELETE')`,
                [esquema, nombre],
            )
            const eventos = String(triggers.rows[0]?.eventos ?? '')
            if (!eventos.includes('UPDATE') || !eventos.includes('DELETE')) {
                aceptadas.push(`${tabla}: sin trigger BEFORE UPDATE/DELETE`)
            }
            const id = await primerId(tabla)
            if (id !== null) {
                const columna = tabla === 'audit.outbox' ? 'payload' : 'id'
                const valor = tabla === 'audit.outbox' ? `'{}'::jsonb` : 'id'
                for (const sql of [
                    `UPDATE ${tabla} SET ${columna} = ${valor} WHERE id = ${id}`,
                    `DELETE FROM ${tabla} WHERE id = ${id}`,
                ]) {
                    if ((await intentar(sql)) === null) aceptadas.push(sql)
                }
            }
            if (hayRol) {
                const permisos = await db.rawQuery(
                    `SELECT has_table_privilege('argosisp_app', ?, 'UPDATE') AS u, has_table_privilege('argosisp_app', ?, 'DELETE') AS d,
                            has_table_privilege('argosisp_app', ?, 'TRUNCATE') AS t`,
                    [tabla, tabla, tabla],
                )
                const { u, d, t } = permisos.rows[0]
                if (u || d || t) {
                    aceptadas.push(`${tabla}: argosisp_app tiene UPDATE=${u} DELETE=${d} TRUNCATE=${t}`)
                }
            }
        }
        assert.deepEqual(aceptadas, [], 'la base aceptó modificar filas inmutables')

        // toda tabla de ledger y audit está clasificada
        const tablas = await db.rawQuery(`
            SELECT n.nspname || '.' || c.relname AS tabla
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ('ledger', 'audit') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
             ORDER BY 1`)
        const sinClasificar = (tablas.rows as Array<{ tabla: string }>)
            .map((f) => f.tabla)
            .filter((t) => !(INMUTABLES as readonly string[]).includes(t) && !(t in MUTABLES))
        assert.deepEqual(sinClasificar, [], 'tablas de ledger/audit sin decidir si son inmutables')
    })

    test('2. los reversos son asientos nuevos: anular no toca los asientos originales', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B, '2026-10-01', { instalacion: '2026-08-01' })
        const marcas = await marcasAuditoria()
        const pago = await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '500.00', empresa_id: e.B },
            e.ctx,
        )
        const antes = await fotoLibro([e.B], marcas.acciones, marcas.outbox)
        const original = await db
            .from('ledger.asientos')
            .where('origen_tipo', 'pago')
            .where('origen_id', pago.id)
            .orderBy('id')
        await new AnularPago().execute({ pago_id: pago.id, motivo: 'auditoría' }, e.ctx)
        const despues = await fotoLibro([e.B], marcas.acciones, marcas.outbox)
        assert.deepEqual(compararFotoLibro(antes, despues), [])
        assert.isAbove(despues.asientos.size, antes.asientos.size)
        for (const asiento of original) {
            const reverso = await db.from('ledger.asientos').where('reversa_de', asiento.id).first()
            assert.isNotNull(reverso, `el asiento ${asiento.id} del pago no tiene reverso`)
        }
        // un reverso no se revierte ni se revierte dos veces
        const reverso = await db.from('ledger.asientos').where('reversa_de', original[0].id).firstOrFail()
        const error = await errorDe(
            new RevertirAsiento().execute({ asiento_id: reverso.id, motivo: 'x x x' }, e.ctx),
        )
        assert.equal(error.status, 422)
        await afirmarLibro(assert, e.B)
    })

    test('2. el código de la aplicación no hace UPDATE ni DELETE sobre ledger ni audit (salvo lo clasificado)', async ({
        assert,
    }) => {
        const raiz = app.makePath('app')
        const permitidos = new Set([...Object.keys(MUTABLES), 'audit.outbox'])
        const hallados: string[] = []
        for (const archivo of await archivos(raiz)) {
            const texto = await readFile(archivo, 'utf8')
            // SQL crudo
            for (const m of texto.matchAll(
                /\b(UPDATE|DELETE\s+FROM|TRUNCATE)\s+((ledger|audit)\.[a-z_]+)/gi,
            )) {
                if (!permitidos.has(m[2]!.toLowerCase())) hallados.push(`${relative(raiz, archivo)}: ${m[0]}`)
            }
            // knex: from('ledger.x') … .update( / .delete( / .del( dentro de la misma cadena
            for (const m of texto.matchAll(
                /(?:from|table)\(\s*'((?:ledger|audit)\.[a-z_]+)(?:\s+as\s+\w+)?'\s*\)([^;]*?)\.(update|delete|del)\(/g,
            )) {
                if (!permitidos.has(m[1]!) && !m[2]!.includes('await ')) {
                    hallados.push(`${relative(raiz, archivo)}: ${m[1]} .${m[3]}()`)
                }
            }
        }
        assert.deepEqual(hallados, [], 'UPDATE/DELETE de la aplicación sobre tablas inmutables')
    })

    test('10. toda columna de dinero es numeric(14,2) y no hay float ni money', async ({ assert }) => {
        const columnas = await db.rawQuery(`
            SELECT c.table_schema || '.' || c.table_name || '.' || c.column_name AS columna,
                   c.data_type, c.numeric_precision, c.numeric_scale
              FROM information_schema.columns c
              JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
              JOIN pg_class pc ON pc.relname = c.table_name
              JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
             WHERE t.table_type = 'BASE TABLE' AND NOT pc.relispartition
               AND c.table_schema IN ('core', 'network', 'billing', 'ledger', 'notify', 'audit', 'importacion')`)
        type Col = {
            columna: string
            data_type: string
            numeric_precision: number | null
            numeric_scale: number | null
        }
        const filas = columnas.rows as Col[]
        /** numéricos que no son dinero */
        const noDinero = new Set([
            'billing.facturas_lineas.cantidad',
            'network.planes.garantizado_pct',
            'network.planes_routers.garantizado_pct',
        ])
        const dinero =
            /^(monto|total|saldo|precio|pagado|iva|subtotal|debe|haber|comision|fondo_inicial|contado|esperado|diferencia|importe|costo_override|monto_pagado)$/
        const malas = filas.filter((c) => {
            const nombre = c.columna.split('.').at(-1)!
            if (['real', 'double precision', 'money'].includes(c.data_type)) return true
            if (c.data_type === 'numeric' && !noDinero.has(c.columna)) {
                return Number(c.numeric_precision) !== 14 || Number(c.numeric_scale) !== 2
            }
            // un monto guardado como entero o texto
            return dinero.test(nombre) && c.data_type !== 'numeric'
        })
        assert.deepEqual(malas, [], 'columnas de dinero que no son numeric(14,2)')
        assert.isAbove(filas.filter((c) => c.data_type === 'numeric').length, 30)
    })

    test('10. revisión estática: ningún cálculo de dinero con number en billing, ledger e importacion', async ({
        assert,
    }) => {
        /**
         * Patrones peligrosos: parseFloat, Number()/toNumber() de un monto, aritmética de JS sobre
         * montos. Los porcentajes (indicadores, no dinero) quedan en la lista blanca con su motivo.
         */
        const permitidos: Record<string, string> = {
            'billing/reportes/definicion.ts|toNumber': 'porcentaje() de los reportes: indicador, no dinero',
            'billing/reportes/resumenes.ts|toNumber': 'cobranza_pct del dashboard: indicador, no dinero',
            'billing/comprobantes.ts|monto: number':
                'ResumenComprobantes.total es la cantidad de comprobantes (el dinero va en monto: string)',
        }
        const dinero =
            '(monto|total|saldo|pagado|precio|iva|subtotal|debe|haber|comision|importe|cobrado|facturado|pendiente|balance|costo)'
        const patrones: Array<[string, RegExp]> = [
            ['parseFloat', /parseFloat\(/],
            ['toNumber', /\.toNumber\(\)/],
            ['Number(monto)', new RegExp(`Number\\([^)]*\\b\\w*${dinero}\\w*\\b[^)]*\\)`, 'i')],
            ['Math sobre monto', new RegExp(`Math\\.(round|floor|ceil)\\([^)]*${dinero}`, 'i')],
            ['monto: number', new RegExp(`\\b${dinero}\\??\\s*:\\s*number\\b`)],
        ]
        const hallados: string[] = []
        for (const modulo of ['billing', 'ledger', 'importacion']) {
            const raiz = app.makePath('app', modulo)
            for (const archivo of await archivos(raiz)) {
                const contenido = await readFile(archivo, 'utf8')
                const lineasArchivo = contenido.split('\n')
                lineasArchivo.forEach((linea, i) => {
                    if (/^\s*(\/\/|\*)/.test(linea)) return
                    for (const [nombre, patron] of patrones) {
                        if (!patron.test(linea)) continue
                        const clave = `${modulo}/${relative(raiz, archivo)}|${nombre}`
                        if (clave in permitidos) continue
                        hallados.push(
                            `${modulo}/${relative(raiz, archivo)}:${i + 1} [${nombre}] ${linea.trim()}`,
                        )
                    }
                })
            }
        }
        assert.deepEqual(hallados, [], 'dinero con number de JS')
    })

    test('verificarLibro detecta un documento alterado (prueba del auditor)', async ({ assert }) => {
        // billing sí admite UPDATE: si alguien "corrige" lo pagado de una factura a mano, el auditor lo ve
        const e = await prepararEmpresas()
        const s = await servicioFacturado(e.B)
        assert.deepEqual(await verificarLibro(e.B), [])
        await db
            .from('billing.facturas')
            .where('id', s.facturas[0]!.id)
            .update({ pagado: '1.00', estado: 'parcial' })
        const violaciones = await verificarLibro(e.B)
        const invariantes = violaciones.map((v) => v.invariante.split(' ')[0])
        assert.includeMembers(invariantes, [
            '3.cxc_distinta_de_facturas_pendientes',
            '5.factura_pagado_inconsistente',
        ])
        await db
            .from('billing.facturas')
            .where('id', s.facturas[0]!.id)
            .update({ pagado: '0.00', estado: 'emitida' })
        assert.deepEqual(await verificarLibro(e.B), [])
    })
})
