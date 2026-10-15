import { readFile } from 'node:fs/promises'
import { isIPv4 } from 'node:net'
import { join } from 'node:path'
import { Decimal } from 'decimal.js'
import { leerCsv, type FilaCsv } from '#importacion/csv'

/**
 * Formato de entrada del importador: un directorio con un CSV por entidad, exportado de la base
 * MySQL de Mikrowisp (ver README del módulo). Los `id` y las referencias (`cliente_id`,
 * `router_id`, `plan_id`) son los ids de Mikrowisp. Este archivo lee, normaliza y valida el
 * formato; las reglas de negocio (NIT, IPs, duplicados) las aplica el importador.
 */

export type EstadoOrigen = 'activo' | 'suspendido' | 'retirado'

export interface RouterOrigen {
    id: string
    nombre: string
    host: string
    nas_ip: string
    api_usuario: string | null
    api_password: string | null
    radius_secret: string | null
}

export interface RedOrigen {
    linea: number
    router_id: string
    cidr: string
    gateway: string | null
    tipo: 'estatico' | 'pool'
}

export interface PlanOrigen {
    id: string
    nombre: string
    precio: string
    bajada_kbps: number
    subida_kbps: number
    bajada_limitada_kbps: number
    subida_limitada_kbps: number
    perfil_ppp: string | null
    pool_ipv4: string | null
    /** nombre de un plan de ArgosIsp al que se mapea en lugar de crear uno */
    equivale_a: string | null
}

export interface ClienteOrigen {
    id: string
    nombre: string
    tipo: 'persona' | 'empresa'
    nit: string | null
    nombre_fiscal: string | null
    direccion_fiscal: string | null
    email: string | null
    telefono: string | null
    movil: string | null
    direccion: string | null
    coordenadas: string | null
    zona: string | null
}

export interface ServicioOrigen {
    id: string
    cliente_id: string
    router_id: string
    plan_id: string
    user_ppp: string
    pass_ppp: string | null
    ip: string | null
    mac: string | null
    direccion: string | null
    coordenadas: string | null
    fecha_instalacion: string | null
    estado: EstadoOrigen
}

/** Problema de formato de una fila: la fila se omite o el campo se descarta (`aviso`). */
export interface ProblemaFila {
    archivo: string
    linea: number
    id: string | null
    mensaje: string
    /** true: la fila se importa sin ese campo; false: la fila se omite */
    aviso: boolean
}

export interface FuenteMikrowisp {
    routers: RouterOrigen[]
    redes: RedOrigen[]
    planes: PlanOrigen[]
    clientes: ClienteOrigen[]
    servicios: ServicioOrigen[]
    problemas: ProblemaFila[]
}

export const ARCHIVOS = {
    routers: 'routers.csv',
    redes: 'redes.csv',
    planes: 'planes.csv',
    clientes: 'clientes.csv',
    servicios: 'servicios.csv',
} as const

/** Velocidad limitada por defecto (kbps) cuando el plan no la trae: Mikrowisp no la tiene. */
export const LIMITADA_KBPS = 512

class FilaInvalida extends Error {}

/** Lee y valida el directorio exportado. `redes.csv` es opcional; los demás son obligatorios. */
export async function leerDirectorio(directorio: string): Promise<FuenteMikrowisp> {
    const problemas: ProblemaFila[] = []
    const leer = async (archivo: string, obligatorio = true): Promise<FilaCsv[]> => {
        try {
            return leerCsv(await readFile(join(directorio, archivo), 'utf8'))
        } catch (error) {
            if (!obligatorio && (error as NodeJS.ErrnoException).code === 'ENOENT') return []
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new Error(`Falta ${archivo} en ${directorio}`, { cause: error })
            }
            throw new Error(`${archivo}: ${(error as Error).message}`, { cause: error })
        }
    }

    const procesar = <T>(archivo: string, filas: FilaCsv[], convertir: (f: Campos) => T): T[] => {
        const salida: T[] = []
        for (const fila of filas) {
            const campos = new Campos(archivo, fila, problemas)
            try {
                salida.push(convertir(campos))
            } catch (error) {
                if (!(error instanceof FilaInvalida)) throw error
                problemas.push({
                    archivo,
                    linea: fila.linea,
                    id: fila.valores.id?.trim() || null,
                    mensaje: error.message,
                    aviso: false,
                })
            }
        }
        return salida
    }

    const routers = procesar(ARCHIVOS.routers, await leer(ARCHIVOS.routers), (f) => ({
        id: f.requerido('id'),
        nombre: f.requerido('nombre'),
        host: f.requerido('host'),
        nas_ip: f.ipv4('nas_ip', true)!,
        api_usuario: f.opcional('api_usuario'),
        api_password: f.opcional('api_password'),
        radius_secret: f.opcional('radius_secret'),
    }))

    const redes = procesar(ARCHIVOS.redes, await leer(ARCHIVOS.redes, false), (f) => ({
        linea: f.linea,
        router_id: f.requerido('router_id'),
        cidr: f.cidr('cidr'),
        gateway: f.ipv4('gateway', false),
        tipo: f.enumerado('tipo', ['estatico', 'pool'] as const, 'estatico'),
    }))

    const planes = procesar(ARCHIVOS.planes, await leer(ARCHIVOS.planes), (f) => {
        const bajada = f.velocidad('bajada', true)!
        const subida = f.velocidad('subida', true)!
        return {
            id: f.requerido('id'),
            nombre: f.requerido('nombre'),
            precio: f.dinero('precio'),
            bajada_kbps: bajada,
            subida_kbps: subida,
            bajada_limitada_kbps: f.velocidad('bajada_limitada', false) ?? Math.min(LIMITADA_KBPS, bajada),
            subida_limitada_kbps: f.velocidad('subida_limitada', false) ?? Math.min(LIMITADA_KBPS, subida),
            perfil_ppp: f.opcional('perfil_ppp'),
            pool_ipv4: f.opcional('pool_ipv4'),
            equivale_a: f.opcional('equivale_a'),
        }
    })

    const clientes = procesar(ARCHIVOS.clientes, await leer(ARCHIVOS.clientes), (f) => ({
        id: f.requerido('id'),
        nombre: f.requerido('nombre'),
        tipo: f.enumerado('tipo', ['persona', 'empresa'] as const, 'persona'),
        nit: f.opcional('nit'),
        nombre_fiscal: f.opcional('nombre_fiscal'),
        direccion_fiscal: f.opcional('direccion_fiscal'),
        email: f.email('email'),
        telefono: f.opcional('telefono'),
        movil: f.opcional('movil'),
        direccion: f.opcional('direccion'),
        coordenadas: f.coordenadas('coordenadas'),
        zona: f.opcional('zona'),
    }))

    const servicios = procesar(ARCHIVOS.servicios, await leer(ARCHIVOS.servicios), (f) => ({
        id: f.requerido('id'),
        cliente_id: f.requerido('cliente_id'),
        router_id: f.requerido('router_id'),
        plan_id: f.requerido('plan_id'),
        user_ppp: f.requerido('user_ppp'),
        pass_ppp: f.opcional('pass_ppp'),
        ip: f.ipv4('ip', false),
        mac: f.mac('mac'),
        direccion: f.opcional('direccion'),
        coordenadas: f.coordenadas('coordenadas'),
        fecha_instalacion: f.fecha('fecha_instalacion'),
        estado: f.estado('estado'),
    }))

    return { routers, redes, planes, clientes, servicios, problemas }
}

/** Acceso tipado a los campos de una fila, con los avisos de formato. */
class Campos {
    constructor(
        private readonly archivo: string,
        private readonly fila: FilaCsv,
        private readonly problemas: ProblemaFila[],
    ) {}

    get linea() {
        return this.fila.linea
    }

    opcional(columna: string): string | null {
        const valor = this.fila.valores[columna]?.trim()
        return valor ? valor : null
    }

    requerido(columna: string): string {
        const valor = this.opcional(columna)
        if (valor === null) throw new FilaInvalida(`Falta ${columna}`)
        return valor
    }

    /** Descarta el campo con un aviso (la fila se importa sin él). */
    private descartar(columna: string, valor: string, motivo: string): null {
        this.problemas.push({
            archivo: this.archivo,
            linea: this.fila.linea,
            id: this.opcional('id'),
            mensaje: `${columna} "${valor}" ${motivo}; se importa vacío`,
            aviso: true,
        })
        return null
    }

    ipv4(columna: string, requerida: boolean): string | null {
        const valor = requerida ? this.requerido(columna) : this.opcional(columna)
        if (valor === null) return null
        const ip = valor.replace(/\/32$/, '')
        // Una IP mal escrita omite la fila: importarla sin IP daría al cliente otra distinta.
        if (!isIPv4(ip)) throw new FilaInvalida(`${columna} "${valor}" no es una IPv4`)
        return ip
    }

    cidr(columna: string): string {
        const valor = this.requerido(columna)
        const [ip, mascara] = valor.split('/')
        const bits = Number(mascara)
        if (!ip || !isIPv4(ip) || !/^\d{1,2}$/.test(mascara ?? '') || bits < 8 || bits > 32) {
            throw new FilaInvalida(`${columna} "${valor}" no es una red IPv4 (a.b.c.d/nn)`)
        }
        return `${ip}/${bits}`
    }

    enumerado<T extends string>(columna: string, opciones: readonly T[], porDefecto: T): T {
        const valor = this.opcional(columna)?.toLowerCase()
        if (!valor) return porDefecto
        if (!(opciones as readonly string[]).includes(valor)) {
            throw new FilaInvalida(`${columna} "${valor}" debe ser ${opciones.join(' o ')}`)
        }
        return valor as T
    }

    /** `10000`, `10000k`, `10M`, `1.5M`, `1G` → kbps (sin unidad = kbps). */
    velocidad(columna: string, requerida: boolean): number | null {
        const valor = requerida ? this.requerido(columna) : this.opcional(columna)
        if (valor === null) return null
        const partes = /^(\d+(?:\.\d+)?)\s*([kmg])?(?:bps)?$/i.exec(valor)
        if (!partes) throw new FilaInvalida(`${columna} "${valor}" no es una velocidad (10M, 512k, 10000)`)
        const factor = { k: 1, m: 1000, g: 1_000_000 }[(partes[2] ?? 'k').toLowerCase() as 'k' | 'm' | 'g']
        const kbps = Math.round(Number(partes[1]) * factor)
        if (kbps < 1) throw new FilaInvalida(`${columna} "${valor}" debe ser mayor que 0`)
        return kbps
    }

    dinero(columna: string): string {
        const valor = this.requerido(columna).replace(/^Q\s*/i, '').replace(/,/g, '')
        let monto: Decimal
        try {
            monto = new Decimal(valor)
        } catch {
            throw new FilaInvalida(`${columna} "${valor}" no es un monto`)
        }
        if (monto.isNegative() || !monto.isFinite()) {
            throw new FilaInvalida(`${columna} "${valor}" no es válido`)
        }
        return monto.toFixed(2)
    }

    email(columna: string): string | null {
        const valor = this.opcional(columna)
        if (valor === null) return null
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)
            ? valor.toLowerCase()
            : this.descartar(columna, valor, 'no es un correo')
    }

    coordenadas(columna: string): string | null {
        const valor = this.opcional(columna)
        if (valor === null) return null
        const limpio = valor.replace(/\s+/g, '')
        if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(limpio)) {
            return this.descartar(columna, valor, 'no es "lat,lng"')
        }
        return limpio
    }

    mac(columna: string): string | null {
        const valor = this.opcional(columna)
        if (valor === null) return null
        const limpio = valor.toUpperCase().replace(/-/g, ':')
        return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(limpio)
            ? limpio
            : this.descartar(columna, valor, 'no es una MAC')
    }

    /** `2024-03-15`, `2024-03-15 10:00:00` o `15/03/2024` → `2024-03-15`. */
    fecha(columna: string): string | null {
        const valor = this.opcional(columna)
        if (valor === null || valor.startsWith('0000-00-00')) return null
        const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor)
        const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valor)
        const [anio, mes, dia] = iso
            ? [iso[1]!, iso[2]!, iso[3]!]
            : dmy
              ? [dmy[3]!, dmy[2]!.padStart(2, '0'), dmy[1]!.padStart(2, '0')]
              : []
        if (!anio) return this.descartar(columna, valor, 'no es una fecha')
        const fecha = new Date(`${anio}-${mes}-${dia}T00:00:00Z`)
        if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== `${anio}-${mes}-${dia}`) {
            return this.descartar(columna, valor, 'no es una fecha')
        }
        return `${anio}-${mes}-${dia}`
    }

    /** Estados de Mikrowisp: activo, suspendido/cortado/moroso, retirado/cancelado/baja. */
    estado(columna: string): EstadoOrigen {
        const valor = (this.opcional(columna) ?? 'activo').toLowerCase()
        if (['activo', 'activa', 'habilitado', 'online'].includes(valor)) return 'activo'
        if (['suspendido', 'suspendida', 'cortado', 'moroso', 'bloqueado'].includes(valor)) {
            return 'suspendido'
        }
        if (['retirado', 'retirada', 'cancelado', 'cancelada', 'baja', 'eliminado'].includes(valor)) {
            return 'retirado'
        }
        throw new FilaInvalida(
            `${columna} "${valor}" no es un estado conocido (activo, suspendido, retirado)`,
        )
    }
}
