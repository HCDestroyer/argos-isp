import db from '@adonisjs/lucid/services/db'
import Usuario from '#core/models/usuario'
import { unico } from '#tests/ayudas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { saldoCliente } from '#ledger/consultas'

/**
 * Ayudas de prueba del libro. `controlCuadre()` es el SELECT de control que corre después de cada
 * acción: ningún asiento descuadrado o con menos de 2 movimientos, y total debe = total haber.
 */

export const SQL_ASIENTOS_DESCUADRADOS = `
    SELECT a.id, coalesce(sum(m.debe), 0) AS debe, coalesce(sum(m.haber), 0) AS haber, count(m.id) AS movimientos
      FROM ledger.asientos a
      LEFT JOIN ledger.movimientos m ON m.asiento_id = a.id
     GROUP BY a.id
    HAVING coalesce(sum(m.debe), 0) <> coalesce(sum(m.haber), 0) OR count(m.id) < 2
`

export const SQL_TOTALES_LIBRO = `
    SELECT coalesce(sum(debe), 0)::text AS debe, coalesce(sum(haber), 0)::text AS haber FROM ledger.movimientos
`

export interface ControlCuadre {
    descuadrados: unknown[]
    debe: string
    haber: string
}

export async function controlCuadre(): Promise<ControlCuadre> {
    const descuadrados = await db.rawQuery(SQL_ASIENTOS_DESCUADRADOS)
    const totales = await db.rawQuery(SQL_TOTALES_LIBRO)
    const { debe, haber } = totales.rows[0] as { debe: string; haber: string }
    return { descuadrados: descuadrados.rows as unknown[], debe, haber }
}

/** Afirma Debe = Haber en todo el libro. */
export async function afirmarLibroCuadrado(assert: {
    deepEqual: (a: unknown, b: unknown, m?: string) => void
    equal: (a: unknown, b: unknown, m?: string) => void
}) {
    const control = await controlCuadre()
    assert.deepEqual(control.descuadrados, [], 'hay asientos descuadrados')
    assert.equal(control.debe, control.haber, 'total debe <> total haber')
}

export async function crearCliente(nombre = unico('Cliente')): Promise<number> {
    const [fila] = (await db
        .insertQuery()
        .table('core.clientes')
        .insert({ nombre })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

/** Cierra un mes directamente (la acción `cerrarPeriodo` es de la semana 2). */
export async function cerrarMes(periodo: string): Promise<void> {
    await db.insertQuery().table('ledger.cierres_mensuales').insert({ periodo })
}

/** Saldo CxC del cliente como string con 2 decimales. */
export async function saldoTexto(clienteId: number): Promise<string> {
    const saldo = await saldoCliente(clienteId)
    return saldo.toFixed(2)
}

/** Caja nueva con su cuenta hija de 1.1.01. */
export async function nuevaCaja(): Promise<number> {
    const padre = await db.from('ledger.cuentas').where('codigo', '1.1.01').select('id').firstOrFail()
    const [cuenta] = (await db
        .table('ledger.cuentas')
        .insert({
            codigo: `1.1.01.${await unicoBd('c', 'ledger.cuentas')}`,
            nombre: unico('Caja'),
            tipo: 'activo',
            padre_id: padre.id,
        })
        .returning('id')) as Array<{ id: number }>
    const [caja] = (await db
        .table('ledger.cajas')
        .insert({ nombre: await unicoBd('Caja', 'ledger.cajas'), cuenta_id: cuenta!.id })
        .returning('id')) as Array<{ id: number }>
    return caja!.id
}

/** Cajero cuyo rol `cajero` solo vale en `cajaId`. */
export async function cajeroDe(cajaId: number) {
    const usuario = await Usuario.create({
        nombre: unico('Cajero'),
        email: `${unico('cajero')}@prueba.local`,
        password: 'clave-de-prueba',
        activo: true,
    })
    const rol = await db.from('core.roles').where('nombre', 'cajero').select('id').firstOrFail()
    await db.table('core.usuarios_roles').insert({
        usuario_id: usuario.id,
        role_id: rol.id,
        alcance_tipo: 'caja',
        alcance_id: cajaId,
    })
    const token = await Usuario.accessTokens.create(usuario)
    return { usuario, token: token.value!.release() }
}
