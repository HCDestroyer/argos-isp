import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import { cifrar, descifrar } from '#shared/cifrado'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import type { DescriptorPasarela } from '#billing/pasarelas/pasarela'
import { USOS_PASARELA, type FilaCuentaPasarela, type UsoPasarela } from '#billing/pasarelas/cuentas'

/** Reglas compartidas por las acciones que crean y editan una cuenta de pasarela. */

export function exigirProveedorDisponible(d: DescriptorPasarela): void {
    if (d.laboratorio && env.get('NODE_ENV') === 'production') {
        throw new ValidacionFallida([
            {
                field: 'proveedor',
                message: `La pasarela ${d.nombre} es solo de laboratorio y no se configura en producción`,
                rule: 'proveedor_no_disponible',
            },
        ])
    }
}

/** Cada uso pedido debe estar entre las capacidades del adaptador (`debito_no_soportado`). */
export function validarUsos(d: DescriptorPasarela, usos: readonly UsoPasarela[]): void {
    const errores: ErrorCampo[] = []
    if (usos.length === 0) {
        errores.push({ field: 'usos', message: 'Indica al menos un uso', rule: 'required' })
    }
    for (const uso of usos) {
        if (!USOS_PASARELA.includes(uso)) {
            errores.push({ field: 'usos', message: `Uso inválido: ${uso}`, rule: 'enum' })
        } else if (uso === 'pago_en_linea' && !d.capacidades.pago_en_linea) {
            errores.push({
                field: 'usos',
                message: `${d.titulo} no ofrece pago en línea`,
                rule: 'pago_en_linea_no_soportado',
            })
        } else if (uso === 'debito' && !d.capacidades.cargo_con_token) {
            errores.push({
                field: 'usos',
                message: `${d.titulo} todavía no permite cargos con tarjeta guardada`,
                rule: 'debito_no_soportado',
            })
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
}

/** Claves y valores válidos de las credenciales y opciones que declara el adaptador. */
export function validarCredencialesYOpciones(
    d: DescriptorPasarela,
    credenciales: Record<string, unknown> | null | undefined,
    opciones: Record<string, unknown> | null | undefined,
): void {
    const errores: ErrorCampo[] = []
    const declaradas = new Set(d.credenciales.map((c) => c.clave))
    for (const [clave, valor] of Object.entries(credenciales ?? {})) {
        if (!declaradas.has(clave)) {
            errores.push({
                field: `credenciales.${clave}`,
                message: `${d.titulo} no usa esa credencial`,
                rule: 'credencial_desconocida',
            })
        } else if (typeof valor !== 'string' || valor.trim() === '') {
            errores.push({
                field: `credenciales.${clave}`,
                message: 'Debe ser un texto no vacío',
                rule: 'required',
            })
        }
    }
    const tipos = new Map(d.opciones.map((o) => [o.clave, o.tipo]))
    for (const [clave, valor] of Object.entries(opciones ?? {})) {
        const tipo = tipos.get(clave)
        if (!tipo) {
            errores.push({
                field: `opciones.${clave}`,
                message: `${d.titulo} no usa esa opción`,
                rule: 'opcion_desconocida',
            })
        } else if (tipo === 'numero' && !(typeof valor === 'number' && Number.isFinite(valor) && valor > 0)) {
            errores.push({
                field: `opciones.${clave}`,
                message: 'Debe ser un número mayor que 0',
                rule: 'number',
            })
        } else if (tipo === 'texto' && typeof valor !== 'string') {
            errores.push({ field: `opciones.${clave}`, message: 'Debe ser un texto', rule: 'string' })
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
}

/** Las credenciales requeridas deben estar todas (al crear, o tras mezclar en una edición). */
export function exigirCredencialesCompletas(d: DescriptorPasarela, claves: string[]): void {
    const faltan = d.credenciales.filter((c) => c.requerida && !claves.includes(c.clave))
    if (faltan.length > 0) {
        throw new ValidacionFallida(
            faltan.map((c) => ({
                field: `credenciales.${c.clave}`,
                message: `Falta ${c.etiqueta}`,
                rule: 'required',
            })),
        )
    }
}

/** Mezcla las credenciales nuevas con las guardadas y devuelve el JSON cifrado y los nombres. */
export function mezclarCredenciales(
    actual: string | null,
    nuevas: Record<string, string> | null | undefined,
): { cifradas: string | null; claves: string[] } {
    const previas = actual ? (JSON.parse(descifrar(actual)) as Record<string, string>) : {}
    const todas: Record<string, string> = { ...previas }
    for (const [clave, valor] of Object.entries(nuevas ?? {})) todas[clave] = valor.trim()
    const claves = Object.keys(todas).sort()
    return { cifradas: claves.length > 0 ? cifrar(JSON.stringify(todas)) : null, claves }
}

/**
 * Deja una sola cuenta predeterminada por empresa y uso y siempre activa: si la marcada no está
 * activa (o no hay ninguna) pasa a la activa de menor id que tenga ese uso.
 */
export async function normalizarPredeterminadas(
    trx: TransactionClientContract,
    empresaId: number,
): Promise<void> {
    for (const uso of USOS_PASARELA) {
        const columna = uso === 'pago_en_linea' ? 'predeterminada_pago_en_linea' : 'predeterminada_debito'
        const filas = (await trx
            .from('billing.pasarela_cuentas')
            .where('empresa_id', empresaId)
            .orderBy('id')
            .select('id', 'activa', columna, 'usos')) as Array<
            Pick<FilaCuentaPasarela, 'id' | 'activa' | 'usos'> & Record<string, unknown>
        >
        const marcada = filas.find((f) => f[columna] === true)
        if (marcada?.activa && marcada.usos.includes(uso)) continue
        const candidata = filas.find((f) => f.activa && f.usos.includes(uso))
        // primero se suelta la marca (índice único) y luego se pone la nueva
        if (marcada) {
            await trx
                .from('billing.pasarela_cuentas')
                .where('id', marcada.id)
                .update({ [columna]: false })
        }
        if (candidata) {
            await trx
                .from('billing.pasarela_cuentas')
                .where('id', candidata.id)
                .update({ [columna]: true })
        }
    }
}

/** Fila lista para `registrarCambios` (campos de auditoría; los secretos salen como `***`). */
export function paraAuditoria(f: FilaCuentaPasarela | null) {
    if (!f) return null
    return {
        alias: f.alias,
        proveedor_cobro_id: f.proveedor_cobro_id,
        credenciales_cifradas: f.credenciales_cifradas,
        credenciales_claves: f.credenciales_claves,
        webhook_secreto_cifrado: f.webhook_secreto_cifrado,
        opciones: f.opciones,
        modo: f.modo,
        usos: f.usos,
        predeterminada_pago_en_linea: f.predeterminada_pago_en_linea,
        predeterminada_debito: f.predeterminada_debito,
        activa: f.activa,
        prueba_ok: f.prueba_ok,
        sembrada_desde_entorno: f.sembrada_desde_entorno,
    }
}

/** El proveedor de cobro (ledger) debe ser de la misma empresa y de pasarela o débito. */
export async function exigirProveedorCobroDeEmpresa(
    trx: TransactionClientContract,
    proveedorCobroId: number,
    empresaId: number,
): Promise<void> {
    const fila = await trx
        .from('ledger.proveedores_cobro')
        .where('id', proveedorCobroId)
        .select('empresa_id', 'metodo')
        .first()
    if (!fila || Number(fila.empresa_id) !== empresaId || !['pasarela', 'debito'].includes(fila.metodo)) {
        throw new ValidacionFallida([
            {
                field: 'proveedor_cobro_id',
                message: 'Debe ser un proveedor de cobro (pasarela o débito) de la misma empresa',
                rule: 'proveedor_cobro',
            },
        ])
    }
}
