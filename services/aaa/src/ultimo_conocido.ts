import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Redis } from 'ioredis'
import { esLapida, parsearRegistro, type RegistroAaa, type ServicioAaa } from './servicio.ts'

/**
 * Último perfil conocido de cada `user_ppp`: lo que `aaa` usa en **modo degradado**, cuando ni Redis
 * ni la API pueden dar el servicio (ver `README.md`, "Modo degradado", y `RUNBOOK.md`).
 *
 * De dónde sale:
 *   - cada autorización normal (Redis o API) guarda lo que obtuvo;
 *   - un espejo periódico de `aaa:user:*` (SCAN + MGET, `AAA_DEGRADADO_ESPEJO_S`), para tener también a
 *     los clientes que llevan semanas conectados y no han vuelto a autorizar en este nodo: son los que
 *     reconectan todos a la vez si el router se reinicia durante la caída;
 *   - al arrancar, el archivo `AAA_DEGRADADO_RUTA` (si está), que se reescribe tras cada espejo.
 *
 * No es una caché de consistencia (CLAUDE.md, regla 5): en modo normal nunca se lee. El espejo solo
 * agrega o reemplaza, nunca borra: si Redis se vació (reinicio sin datos) no se pierde la copia.
 * Las bajas llegan como lápida (A1) o como 404 de la API, y se guardan como tales.
 * `pass_ppp` se guarda como viene (cifrada, formato v1): el archivo no tiene contraseñas en claro.
 */

export interface Conocido {
    registro: RegistroAaa
    /** epoch ms en que este nodo vio el registro por última vez en Redis o en la API */
    vistoEn: number
}

interface ArchivoUltimoConocido {
    version: 1
    generado_en: string
    registros: { visto_en: number; registro: unknown }[]
}

export interface ResultadoEspejo {
    leidos: number
    invalidos: number
}

export class UltimoConocido {
    readonly #registros = new Map<string, Conocido>()
    readonly #max: number
    readonly #ruta: string | undefined
    #ultimoEspejo: number | null = null

    constructor(opciones: { max?: number; ruta?: string } = {}) {
        this.#max = opciones.max ?? 200_000
        this.#ruta = opciones.ruta || undefined
    }

    get tamano(): number {
        return this.#registros.size
    }

    /** epoch ms del último espejo completo de Redis, o null si no hubo ninguno en este proceso. */
    get ultimoEspejo(): number | null {
        return this.#ultimoEspejo
    }

    guardar(registro: RegistroAaa, vistoEn = Date.now()): void {
        // Reinsertar mueve la clave al final: al pasar de `max` sale la que lleva más tiempo sin verse.
        this.#registros.delete(registro.user_ppp)
        this.#registros.set(registro.user_ppp, { registro, vistoEn })
        if (this.#registros.size > this.#max) {
            const masViejo = this.#registros.keys().next().value
            if (masViejo !== undefined) this.#registros.delete(masViejo)
        }
    }

    /** La API dijo que el usuario no existe (404): no se acepta en modo degradado. */
    olvidar(userPpp: string): void {
        this.#registros.delete(userPpp)
    }

    /**
     * Baja definitiva (`servicio.eliminado`, `router.eliminado`; `bajas.ts`): olvida los registros
     * (no lápidas) que cumplen `predicado`. Devuelve cuántos olvidó.
     */
    olvidarDonde(predicado: (registro: ServicioAaa) => boolean): number {
        let n = 0
        for (const [userPpp, { registro }] of this.#registros) {
            if (esLapida(registro) || !predicado(registro)) continue
            this.#registros.delete(userPpp)
            n++
        }
        return n
    }

    obtener(userPpp: string): Conocido | null {
        return this.#registros.get(userPpp) ?? null
    }

    /**
     * Recorre `<prefijo>*` y guarda cada registro válido. Los inválidos se cuentan y se saltan (los
     * corrige A1 con su próximo evento). Lanza si Redis falla: el espejo anterior queda intacto.
     */
    async espejar(redis: Redis, prefijo: string, lote = 500): Promise<ResultadoEspejo> {
        const resultado: ResultadoEspejo = { leidos: 0, invalidos: 0 }
        let cursor = '0'
        do {
            const [siguiente, claves] = await redis.scan(cursor, 'MATCH', `${prefijo}*`, 'COUNT', lote)
            cursor = siguiente
            if (claves.length === 0) continue
            const valores = await redis.mget(...claves)
            const ahora = Date.now()
            for (const crudo of valores) {
                if (crudo === null) continue
                try {
                    this.guardar(parsearRegistro(JSON.parse(crudo)), ahora)
                    resultado.leidos++
                } catch {
                    resultado.invalidos++
                }
            }
        } while (cursor !== '0')
        this.#ultimoEspejo = Date.now()
        return resultado
    }

    /** Carga el archivo si existe. Devuelve cuántos registros válidos leyó (0 si no hay archivo). */
    async cargar(): Promise<number> {
        if (!this.#ruta) return 0
        let datos: ArchivoUltimoConocido
        try {
            datos = JSON.parse(await readFile(this.#ruta, 'utf8')) as ArchivoUltimoConocido
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0
            throw e
        }
        let n = 0
        for (const { visto_en, registro } of Array.isArray(datos.registros) ? datos.registros : []) {
            try {
                const r = parsearRegistro(registro)
                const actual = this.#registros.get(r.user_ppp)
                // Lo visto en este proceso es más nuevo que el archivo.
                if (actual && actual.vistoEn >= visto_en) continue
                this.guardar(r, typeof visto_en === 'number' ? visto_en : 0)
                n++
            } catch {
                // registro viejo con otro contrato: se ignora
            }
        }
        return n
    }

    /** Escribe el archivo de forma atómica (temporal + rename), legible solo por el proceso. */
    async volcar(): Promise<void> {
        if (!this.#ruta) return
        const datos: ArchivoUltimoConocido = {
            version: 1,
            generado_en: new Date().toISOString(),
            registros: [...this.#registros.values()].map((c) => ({ visto_en: c.vistoEn, registro: c.registro })),
        }
        await mkdir(dirname(this.#ruta), { recursive: true })
        const temporal = `${this.#ruta}.${process.pid}.tmp`
        await writeFile(temporal, JSON.stringify(datos), { mode: 0o600 })
        await rename(temporal, this.#ruta)
    }
}
