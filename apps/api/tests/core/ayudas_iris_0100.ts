import { randomInt } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, unico } from '#tests/ayudas'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { usuarioIris } from '#core/integraciones_iris'

/** Ayudas de las pruebas del contrato Iris 0.10.0 (§3.4, §3.5, §3.7, §3.8). */

export const SECRETO_RECEPTOR = 'secreto-del-receptor-de-iris-0123456789'

/** Token `atk_` del usuario técnico Iris (alcance global o solo esas empresas). */
export async function tokenIris(empresas: number[] | null = null): Promise<string> {
    const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
    const id = (await usuarioIris())!
    await db
        .from('core.usuarios')
        .where('id', id)
        .update({ activo: true, alcance_global: empresas === null })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    for (const empresaId of empresas ?? []) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: id, empresa_id: empresaId })
    }
    return token
}

/** Conector Iris activo con receptor y el contrato informado. */
export async function conectorIris(contrato: string | null) {
    await db.from('integraciones.iris_envios').delete()
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: 'http://127.0.0.1:9',
        token_cifrado: cifrar(`iris_pat_${'Zx9Yw8Vu'.repeat(5)}`),
        webhook_salida_url: 'http://127.0.0.1:9/api/v1/integraciones/argosisp/webhook/c-1',
        webhook_salida_secreto_cifrado: cifrar(SECRETO_RECEPTOR),
        contrato,
    })
}

/** Móvil de Guatemala único en E.164 (`+5025xxxxxxx`). */
export function movilUnico(): string {
    return `+5025${String(randomInt(0, 9_999_999)).padStart(7, '0')}`
}

/** El mismo número como lo guarda `core.clientes` (`+502 5512-3344`). */
export function comoCliente(e164: string): string {
    const local = e164.slice(4)
    return `+502 ${local.slice(0, 4)}-${local.slice(4)}`
}

/** Cabeceras de Iris (actor por defecto, un operador). */
export function conActor(peticion: any, actor = 'usuario:op-1', extra: Record<string, string> = {}) {
    peticion.header('X-Iris-Actor', actor)
    for (const [nombre, valor] of Object.entries(extra)) peticion.header(nombre, valor)
    return peticion
}

/** DPI válido único: 9 dígitos al azar, departamento 01 y municipio 01. */
export function dpiUnico(): string {
    return `${String(randomInt(100_000_000, 999_999_999))}0101`
}

/** JPEG mínimo (firma FF D8 FF) con relleno para que cada foto sea distinta. */
export function jpeg(relleno = 'a'): Buffer {
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(relleno.repeat(64))])
}

/** Campos de texto de una identidad (multipart). */
export function camposIdentidad(extra: Record<string, string> = {}): Record<string, string> {
    return {
        documento_tipo: 'dpi',
        documento_numero: dpiUnico(),
        nombre: 'Ana Pérez',
        mayor_de_edad: 'true',
        coincide: 'true',
        verificado_en: new Date(Date.now() - 60_000).toISOString(),
        metodo: 'foto_documento',
        origen_tipo: 'iris_orden',
        origen_id: '9123',
        ...extra,
    }
}

/** Petición multipart con campos y fotos. */
export function multipart(peticion: any, campos: Record<string, string>, fotos: Record<string, Buffer>) {
    for (const [nombre, valor] of Object.entries(campos)) peticion.field(nombre, valor)
    for (const [nombre, contenido] of Object.entries(fotos)) {
        peticion.file(nombre, contenido, { filename: `${nombre}.jpg` })
    }
    return peticion
}
