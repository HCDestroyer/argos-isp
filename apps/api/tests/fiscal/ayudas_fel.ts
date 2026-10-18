import db from '@adonisjs/lucid/services/db'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import ConfigurarFel from '#fiscal/actions/configurar_fel'
import GuardarCredencialesFel from '#fiscal/actions/guardar_credenciales_fel'
import { configuracionFel, type ModoFel } from '#fiscal/fel/configuracion'
import { controlFelFalso } from '#fiscal/fel/falso'
import { procesarColaFel } from '#fiscal/fel/cola'
import { registrarInstaladorLocalizacion } from '#core/localizacion'
import { instaladorFiscal } from '#fiscal/instalador_localizacion'
import { dec } from '#ledger/dinero'
import {
    prepararEmpresas,
    saldoCuenta,
    servicioFacturado,
    type Empresas,
} from '#tests/contabilidad/ayudas_contabilidad'

/**
 * Ayudas de las pruebas de FEL: empresas nuevas con la localización instalada y la FEL configurada
 * con el certificador **falso** (nunca se llama a INFILE en pruebas).
 */

export const IVA_POR_CERTIFICAR = '2.1.11'
export const IVA_DEBITO = '2.1.02'

export async function empresasFel(modo: ModoFel = 'obligatoria'): Promise<Empresas> {
    registrarInstaladorLocalizacion(instaladorFiscal)
    controlFelFalso.reiniciar()
    const e = await prepararEmpresas()
    for (const empresaId of [e.B, e.C]) {
        await new ActualizarLocalizacion().execute({ empresa_id: empresaId }, e.ctx)
        await configurarModo(e, empresaId, modo)
        await new GuardarCredencialesFel().execute(
            {
                empresa_id: empresaId,
                ambiente: 'pruebas',
                secreto: { usuario: 'prueba', llave: 'llave-secreta-1' },
            },
            e.ctx,
        )
    }
    return e
}

export async function configurarModo(e: Empresas, empresaId: number, modo: ModoFel) {
    const actual = await configuracionFel(empresaId)
    return new ConfigurarFel().execute(
        { empresa_id: empresaId, proveedor: 'falso', ambiente: 'pruebas', modo, version: actual.version },
        e.ctx,
    )
}

/** Servicio con plantilla `certificar_al` dado y sus facturas hasta el 1-oct-2026. */
export function servicioFel(
    e: Empresas,
    certificarAl: 'emitir' | 'pagar' | 'nunca',
    precio = '150.00',
    clienteId?: number,
    empresaId = e.B,
) {
    return servicioFacturado(empresaId, '2026-10-01', {
        precio,
        instalacion: '2026-10-01',
        plantilla: { certificar_al: certificarAl },
        clienteId,
    })
}

export function cola(e: Empresas) {
    return procesarColaFel(e.ctx)
}

export async function dtesDe(documentoTipo: string, documentoId: number) {
    return (await db
        .from('fiscal.dte')
        .where({ documento_tipo: documentoTipo, documento_id: documentoId })
        .orderBy('id')
        .select('*')) as Array<Record<string, any>>
}

export async function factura(id: number) {
    return (await db.from('billing.facturas').where('id', id).firstOrFail()) as Record<string, any>
}

export async function eventosDe(evento: string, clave: string, valor: number) {
    return (await db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`(payload->>?)::bigint = ?`, [clave, valor])
        .orderBy('id')
        .select('payload')) as Array<{ payload: Record<string, unknown> }>
}

/** Vence el DTE hacia atrás (como si se hubiera certificado hace `meses` meses). */
export async function envejecerDte(dteId: number, meses: number) {
    await db.rawQuery(
        `UPDATE fiscal.dte SET certificado_en = now() - make_interval(months => ?) WHERE id = ?`,
        [meses, dteId],
    )
}

/** La factura se emitió hace `meses` meses (plazo de anulación). */
export async function envejecerFactura(facturaId: number, meses: number) {
    await db.rawQuery(
        `UPDATE billing.facturas SET emitida_en = now() - make_interval(months => ?) WHERE id = ?`,
        [meses, facturaId],
    )
}

/** Deja el DTE listo para la siguiente corrida (su espera de reintento ya pasó). */
export async function adelantarReintento(dteId: number) {
    await db.rawQuery(`UPDATE fiscal.dte SET proximo_intento = now() WHERE id = ?`, [dteId])
}

/** Cliente con NIT válido (para receptores que no son consumidor final). */
export function datosNit() {
    return { nit_cui: '12345679', nombre_fiscal: 'Cliente Con NIT, S.A.', tipo_documento_fiscal: 'nit' }
}

/** Saldo (debe − haber) de una cuenta en la empresa, con 2 decimales. */
export async function saldo(empresaId: number, codigo: string): Promise<string> {
    return dec(await saldoCuenta(empresaId, codigo)).toFixed(2)
}
