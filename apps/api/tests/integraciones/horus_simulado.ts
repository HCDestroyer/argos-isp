import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { invalidarConfigHorus } from '#integraciones/horus/configuracion'
import { fijarFetchEnvios } from '#integraciones/horus/envios'
import { fijarEmisorTokenHorus } from '#integraciones/horus/token_argos'

/**
 * Horus simulado: un servidor HTTP local que registra cada petición y responde según la ruta con
 * el manejador que la prueba fije. Sin manejador para una ruta, 404.
 */

export interface PeticionRecibida {
    metodo: string
    ruta: string
    cabeceras: Record<string, string | string[] | undefined>
    cuerpo: string
    json: any
}

export type Manejador = (
    p: PeticionRecibida,
) => { status: number; cuerpo?: unknown } | Promise<{ status: number; cuerpo?: unknown }>

export class HorusSimulado {
    readonly peticiones: PeticionRecibida[] = []
    readonly rutas = new Map<string, Manejador>()
    #servidor: Server | null = null
    url = ''

    async iniciar(): Promise<this> {
        this.#servidor = createServer((req, res) => void this.#atender(req, res))
        await new Promise<void>((r) => this.#servidor!.listen(0, '127.0.0.1', r))
        const { port } = this.#servidor.address() as AddressInfo
        this.url = `http://127.0.0.1:${port}`
        return this
    }

    responder(ruta: string, manejador: Manejador): this {
        this.rutas.set(ruta, manejador)
        return this
    }

    de(ruta: string): PeticionRecibida[] {
        return this.peticiones.filter((p) => p.ruta === ruta)
    }

    async detener() {
        await new Promise<void>((r) => (this.#servidor ? this.#servidor.close(() => r()) : r()))
        this.#servidor = null
    }

    async #atender(req: IncomingMessage, res: ServerResponse) {
        const partes: Buffer[] = []
        for await (const parte of req) partes.push(parte as Buffer)
        const cuerpo = Buffer.concat(partes).toString('utf8')
        let json: unknown = null
        try {
            json = cuerpo ? JSON.parse(cuerpo) : null
        } catch {
            json = null
        }
        const ruta = (req.url ?? '/').split('?')[0]!
        const peticion: PeticionRecibida = {
            metodo: req.method ?? 'GET',
            ruta,
            cabeceras: req.headers,
            cuerpo,
            json,
        }
        this.peticiones.push(peticion)
        const manejador = this.rutas.get(ruta)
        const respuesta = manejador
            ? await manejador(peticion)
            : { status: 404, cuerpo: { error: 'not_found' } }
        res.writeHead(respuesta.status, { 'content-type': 'application/json' })
        res.end(respuesta.cuerpo === undefined ? '' : JSON.stringify(respuesta.cuerpo))
    }
}

export const TOKEN_HORUS = `hf_pat_${'a1B2c3D4'.repeat(5)}`
export const SECRETO_ENTRADA = 'whsec_secreto-de-pruebas-del-receptor-argos'
export const SECRETO_SALIDA = 'secreto-del-receptor-de-horus-0123456789'

/** Conector guardado directo en la base (para preparar escenarios) y caché invalidada. */
export async function fijarConector(datos: {
    activo?: boolean
    url_base?: string | null
    token?: string | null
    webhook_salida_url?: string | null
    webhook_salida_secreto?: string | null
    webhook_entrada_secreto?: string | null
}) {
    await limpiarHorus()
    await db.table('integraciones.horus_conector').insert({
        id: 1,
        activo: datos.activo ?? true,
        url_base: datos.url_base ?? null,
        token_cifrado: datos.token === null ? null : cifrar(datos.token ?? TOKEN_HORUS),
        webhook_salida_url: datos.webhook_salida_url ?? null,
        webhook_salida_secreto_cifrado: datos.webhook_salida_secreto
            ? cifrar(datos.webhook_salida_secreto)
            : null,
        webhook_entrada_secreto_cifrado: cifrar(datos.webhook_entrada_secreto ?? SECRETO_ENTRADA),
    })
    invalidarConfigHorus()
}

/** Vacía las tablas del conector (no son inmutables) y deja la salud limpia. */
export async function limpiarHorus() {
    await db.from('integraciones.horus_envios').delete()
    await db.from('integraciones.horus_recibidos').delete()
    await db.from('integraciones.horus_datos').delete()
    await db.from('integraciones.horus_enlaces').delete()
    await db.from('integraciones.horus_conector').delete()
    await db.from('integraciones.horus_salud').where('id', 1).update({
        fallos_seguidos: 0,
        pausa_hasta: null,
        ultimo_error: null,
        ultimo_error_en: null,
        ultimo_exito_en: null,
    })
    fijarFetchEnvios()
    fijarEmisorTokenHorus()
    invalidarConfigHorus()
}

/** Un puerto local donde no escucha nadie (Horus caído). */
export async function urlSinServidor(): Promise<string> {
    const servidor = createServer()
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
    const { port } = servidor.address() as AddressInfo
    await new Promise<void>((r) => servidor.close(() => r()))
    return `http://127.0.0.1:${port}`
}

/** Filas de una tabla (para comparar antes y después). */
export async function contar(tabla: string, filtro?: (q: any) => void): Promise<number> {
    const consulta = db.from(tabla)
    if (filtro) filtro(consulta)
    const fila = (await consulta.count('* as n').first()) as { n: string | number }
    return Number(fila.n)
}

/** Cuerpo de una respuesta esperada con su status. */
export async function cuerpoDe(
    peticion: PromiseLike<{ assertStatus(s: number): void; body(): any }>,
    status: number,
) {
    const respuesta = await peticion
    respuesta.assertStatus(status)
    return respuesta.body()
}
