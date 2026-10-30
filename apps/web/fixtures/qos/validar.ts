import type { Problem, Schema } from '@argosisp/contracts'
import type { ClaseQosFixture, ReglaQosFixture } from './datos'
import { QOS_MAX_HOJAS } from '../routers/estrategiasDatos'

/**
 * Reglas de un perfil de QoS, copiadas de `apps/api/app/network/qos.ts` (A2) con sus mismos `field`,
 * `rule` y mensajes: `problemasReglas`, `validarPerfil` (errores 422 y advertencias) y `costoQos`.
 * Funciones puras, sin `bd`.
 */

type Errores = NonNullable<Problem['errors']>
type Advertencia = Schema<'PerfilQos'>['advertencias'][number]
type ClaseValidacion = Pick<ClaseQosFixture, 'id' | 'nombre' | 'orden' | 'garantizado_pct' | 'tope_pct' | 'es_resto' | 'reglas' | 'bytes_minimo' | 'reclasifica_de' | 'activa'>

export const QOS_MAX_CLASES = 8
export const QOS_MAX_REGLAS = 10
const QOS_MAX_PUERTOS = 15

const esDescarga = (c: Pick<ClaseValidacion, 'bytes_minimo'>) => c.bytes_minimo !== null

function errorPuertos(valor: string): string | null {
    const partes = valor.split(',').map(p => p.trim())
    if (partes.length > QOS_MAX_PUERTOS) {
        return `máximo ${QOS_MAX_PUERTOS} puertos o rangos`
    }
    for (const p of partes) {
        const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(p)
        if (!m) {
            return `«${p}» no es un puerto ni un rango (n o n-m)`
        }
        const a = Number(m[1])
        const b = m[2] === undefined ? a : Number(m[2])
        if (a < 1 || b > 65535 || a > b) {
            return `«${p}» fuera de 1–65535 o rango invertido`
        }
    }
    return null
}

export function problemasReglas(reglas: ReglaQosFixture[], campo = 'reglas'): Errores {
    const errores: Errores = []
    if (reglas.length > QOS_MAX_REGLAS) {
        errores.push({ field: campo, rule: 'qos_reglas', message: `máximo ${QOS_MAX_REGLAS} reglas por clase` })
    }
    reglas.forEach((r, i) => {
        const f = `${campo}.${i}`
        if (!r.protocolo && !r.puertos_destino && !r.puertos_origen && r.dscp === null && !r.lista_destino) {
            errores.push({ field: f, rule: 'qos_reglas', message: 'la regla no tiene ningún criterio' })
        }
        for (const k of ['puertos_destino', 'puertos_origen'] as const) {
            const v = r[k]
            if (!v) {
                continue
            }
            if (r.protocolo !== 'tcp' && r.protocolo !== 'udp') {
                errores.push({ field: `${f}.${k}`, rule: 'qos_puertos', message: 'los puertos solo aplican a tcp o udp: elige el protocolo' })
                continue
            }
            const e = errorPuertos(v)
            if (e) {
                errores.push({ field: `${f}.${k}`, rule: 'qos_puertos', message: e })
            }
        }
    })
    return errores
}

export function validarPerfil(clases: ClaseValidacion[], campo: (id: number) => string = id => `clases.${id}`): { errores: Errores, advertencias: Advertencia[] } {
    const errores: Errores = []
    const advertencias: Advertencia[] = []
    const activas = clases.filter(c => c.activa)
    if (activas.filter(c => c.es_resto).length !== 1) {
        errores.push({ field: 'es_resto', rule: 'qos_resto', message: 'el perfil necesita exactamente una clase «resto» activa (lo que no coincide con nada)' })
    }
    if (activas.length > QOS_MAX_CLASES) {
        errores.push({ field: 'activa', rule: 'qos_max_clases', message: `máximo ${QOS_MAX_CLASES} clases activas por perfil (hay ${activas.length}); RouterOS tiene 8 prioridades` })
    }
    const suma = activas.reduce((t, c) => t + c.garantizado_pct, 0)
    if (suma > 100) {
        errores.push({ field: 'garantizado_pct', rule: 'qos_garantizado', message: `la suma del garantizado de las clases activas sería ${suma} %: no puede pasar de 100 %` })
    }
    const porId = new Map(clases.map(c => [c.id, c]))
    const origenes = new Map<number, number>()
    for (const c of activas) {
        const f = campo(c.id)
        if (c.es_resto) {
            if (c.reglas.length > 0 || esDescarga(c)) {
                errores.push({ field: `${f}.reglas`, rule: 'qos_reglas', message: '«resto» es lo que no coincide con nada: no lleva reglas ni bytes_minimo' })
            }
            continue
        }
        errores.push(...problemasReglas(c.reglas, `${f}.reglas`))
        if (!esDescarga(c)) {
            if (c.reglas.length === 0) {
                errores.push({ field: `${f}.reglas`, rule: 'qos_reglas', message: 'la clase necesita al menos una regla (protocolo, puertos, DSCP o lista de destino)' })
            }
            if (c.reclasifica_de.length > 0) {
                errores.push({ field: `${f}.reclasifica_de`, rule: 'qos_reclasifica', message: 'reclasifica_de solo aplica a una clase de descargas (con bytes_minimo)' })
            }
            continue
        }
        if (c.reclasifica_de.length === 0) {
            errores.push({ field: `${f}.reclasifica_de`, rule: 'qos_reclasifica', message: 'una clase de descargas dice de qué clases toma las conexiones (p. ej. web y resto)' })
        }
        for (const o of c.reclasifica_de) {
            const origen = porId.get(o)
            let error: string | null = null
            if (o === c.id) {
                error = 'una clase no se reclasifica a sí misma'
            }
            else if (!origen) {
                error = `la clase ${o} no es de este perfil`
            }
            else if (!origen.activa) {
                error = `la clase ${origen.nombre} está inactiva`
            }
            else if (esDescarga(origen)) {
                error = `${origen.nombre} también es de descargas`
            }
            else if (origenes.has(o) && origenes.get(o) !== c.id) {
                error = `${origen.nombre} ya la reclasifica otra clase de descargas: el resultado dependería del orden`
            }
            if (error) {
                errores.push({ field: `${f}.reclasifica_de`, rule: 'qos_reclasifica', message: error })
            }
            origenes.set(o, c.id)
        }
    }
    const porCliente = activas.reduce((t, c) => t + (c.tope_pct ?? 100), 0)
    if (porCliente > 100) {
        advertencias.push({
            regla: 'tope_por_cliente',
            mensaje: `un cliente que usa varias clases a la vez puede pasar la velocidad de su plan (hasta ${porCliente} %): cada clase tiene su propio PCQ; el nodo del plan sigue limitando el total del plan`,
        })
    }
    const ordenes = activas.filter(c => !c.es_resto && !esDescarga(c)).map(c => c.orden)
    if (new Set(ordenes).size !== ordenes.length) {
        advertencias.push({ regla: 'orden_repetido', mensaje: 'hay clases con el mismo orden: se desempata por id (la más vieja primero)' })
    }
    return { errores, advertencias }
}

/** `costoQos()` de A2: hojas, reglas de mangle (IPv4; IPv6 igual) y tipos de cola extra. */
export function costoQos(clases: ClaseValidacion[], planesQos: number): Omit<Schema<'UsoPerfilQos'>, 'router_id' | 'nombre'> {
    const activas = clases.filter(c => c.activa)
    const m = activas.length
    let clasificacion = 0
    if (planesQos > 0 && activas.some(c => c.es_resto)) {
        const posiciones = activas.filter(c => !c.es_resto && !esDescarga(c))
        const descargas = activas.filter(esDescarga)
        clasificacion = posiciones.reduce((t, c) => t + c.reglas.length + 1, 0)
            + 1
            + descargas.reduce((t, d) => t + d.reclasifica_de.length * Math.max(1, d.reglas.length), 0)
            + 1
            + (descargas.length > 0 ? 1 : 0)
    }
    return {
        planes_qos: planesQos,
        clases: m,
        hojas: 4 * planesQos * m,
        reglas_mangle: clasificacion + 4 * planesQos * (m + 1),
        tipos_cola: 4 * planesQos * activas.filter(c => c.tope_pct !== null).length,
        limite_hojas: QOS_MAX_HOJAS,
    }
}
