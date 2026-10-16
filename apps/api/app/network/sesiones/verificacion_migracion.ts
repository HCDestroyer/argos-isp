import db from '@adonisjs/lucid/services/db'
import type { Redis } from 'ioredis'
import { prefijoAaa } from '#core/aaa'
import { descifrar } from '#shared/cifrado'
import { redis as redisCompartido } from '#shared/redis'

/**
 * Lista previa a "migrar 20 a 50 clientes al nuevo RADIUS" (semana 3): dado un router, verifica que
 * puede apuntar su `/radius` al nuevo `aaa` sin dejar a nadie fuera. Solo lee (Postgres y Redis);
 * no cambia nada ni audita. Lo usa `node ace aaa:verificar-router <router_id>`.
 *
 * Comprobaciones (cada una `ok`, `aviso` o `falla`; una sola falla = no listo):
 *  1. Router: existe, activo y en modo `radius`.
 *  2. Secreto RADIUS: `radius_secret` configurado, descifra con `AAA_PPP_KEY` y lo acepta
 *     `pnpm aaa:clients` (8+ caracteres, sin caracteres de control).
 *  3. Redis: cada servicio PPPoE no retirado del router tiene `aaa:user:<user_ppp>` válido, del mismo
 *     servicio, sin lápida, con `version` ≥ la de Postgres y la misma `pass_ppp`, estado y plan.
 *     Sin esto, la primera autorización depende de la API y el modo degradado no los conoce.
 *  4. Credenciales: `pass_ppp` descifra con `AAA_PPP_KEY` (si no, `aaa` responde 500 → Reject).
 *  5. Planes con perfil: cada plan en uso tiene fila en `planes_routers` para el router con
 *     `profile_ppp`, o usa el perfil `plan-<id>` que crea el dispatcher (reuso > 1 en `simple`).
 *     Avisos: plan sin velocidad limitada, pools faltantes para servicios en modo pool.
 *  6. `user_ppp` duplicados: iguales sin distinguir mayúsculas ni espacios en toda la base (el NAS y
 *     las claves de Redis no deben confundirlos) y nombres que `filter_username` de FreeRADIUS
 *     rechazaría (espacios, caracteres de control).
 */

export type Resultado = 'ok' | 'aviso' | 'falla'

export interface Comprobacion {
    clave: 'router' | 'secreto' | 'redis' | 'credenciales' | 'planes' | 'user_ppp'
    titulo: string
    resultado: Resultado
    resumen: string
    detalles: string[]
}

export interface InformeMigracion {
    routerId: number
    router: { nombre: string; nasIp: string; modoSeguridad: string; activo: boolean } | null
    generadoEn: Date
    listo: boolean
    servicios: { total: number; porEstado: Record<string, number> }
    sesionesActivas: number
    comprobaciones: Comprobacion[]
}

interface FilaRouter {
    nombre: string
    nas_ip: string
    modo_seguridad: string
    activo: boolean
    radius_secret: string | null
    control_velocidad: string
}

interface FilaServicio {
    id: number
    user_ppp: string
    pass_ppp: string
    estado: string
    version: number
    plan_id: number
}

interface FilaPlan {
    plan_id: number
    nombre: string
    servicios: number
    subida_limitada_kbps: number
    bajada_limitada_kbps: number
    reuso_plan: number
    tiene_fila: boolean
    profile_ppp: string | null
    reuso_router: number | null
    pool_ipv4: string | null
    pool_ipv6_enlace: string | null
    pool_ipv6_delegacion: string | null
    sin_ipv4_fija: number
    en_radius_pool: number
}

/** Máximo de elementos por lista en el informe (el total siempre se dice). */
const MAX_DETALLES = 50

function lista(elementos: string[]): string[] {
    if (elementos.length <= MAX_DETALLES) return elementos
    return [...elementos.slice(0, MAX_DETALLES), `… y ${elementos.length - MAX_DETALLES} más`]
}

function peor(a: Resultado, b: Resultado): Resultado {
    const orden: Resultado[] = ['ok', 'aviso', 'falla']
    return orden[Math.max(orden.indexOf(a), orden.indexOf(b))]!
}

/** filter_username de FreeRADIUS rechaza espacios y caracteres de control. */
// eslint-disable-next-line no-control-regex -- justamente se buscan caracteres de control
const USER_PPP_INVALIDO = /[\s\x00-\x1f\x7f]/

export interface OpcionesVerificacion {
    redis?: Redis
    prefijo?: string
    /** clave de `AAA_PPP_KEY` (por defecto la del entorno) */
    clave?: Buffer
}

export async function verificarMigracionRouter(
    routerId: number,
    opciones: OpcionesVerificacion = {},
): Promise<InformeMigracion> {
    const redis = opciones.redis ?? redisCompartido()
    const prefijo = opciones.prefijo ?? prefijoAaa()
    const comprobaciones: Comprobacion[] = []

    const router = (await db
        .from('network.routers')
        .where('id', routerId)
        .select(
            'nombre',
            db.raw('host(nas_ip) as nas_ip'),
            'modo_seguridad',
            'activo',
            'radius_secret',
            'control_velocidad',
        )
        .first()) as FilaRouter | null

    const informe: InformeMigracion = {
        routerId,
        router: router
            ? {
                  nombre: router.nombre,
                  nasIp: router.nas_ip,
                  modoSeguridad: router.modo_seguridad,
                  activo: router.activo,
              }
            : null,
        generadoEn: new Date(),
        listo: false,
        servicios: { total: 0, porEstado: {} },
        sesionesActivas: 0,
        comprobaciones,
    }

    // 1. Router
    if (!router) {
        comprobaciones.push({
            clave: 'router',
            titulo: 'Router',
            resultado: 'falla',
            resumen: `no existe el router ${routerId}`,
            detalles: [],
        })
        return informe
    }
    const problemasRouter: string[] = []
    if (!router.activo) problemasRouter.push('el router está inactivo (`activo = false`)')
    if (router.modo_seguridad !== 'radius') {
        problemasRouter.push(`modo_seguridad = ${router.modo_seguridad} (debe ser radius)`)
    }
    comprobaciones.push({
        clave: 'router',
        titulo: 'Router',
        resultado: problemasRouter.length ? 'falla' : 'ok',
        resumen: problemasRouter.length
            ? problemasRouter.join('; ')
            : `activo, modo radius, NAS ${router.nas_ip}, control ${router.control_velocidad}`,
        detalles: [],
    })

    // 2. Secreto RADIUS
    let secreto: Comprobacion
    if (!router.radius_secret) {
        secreto = {
            clave: 'secreto',
            titulo: 'Secreto RADIUS',
            resultado: 'falla',
            resumen: 'sin radius_secret: `pnpm aaa:clients` no genera su cliente y FreeRADIUS lo ignora',
            detalles: [],
        }
    } else {
        try {
            const claro = descifrar(router.radius_secret, opciones.clave)
            // eslint-disable-next-line no-control-regex -- se buscan caracteres de control
            const control = /[\x00-\x1f\x7f]/.test(claro)
            const problema =
                claro.length < 8
                    ? 'demasiado corto (mínimo 8 caracteres)'
                    : control
                      ? 'con caracteres de control'
                      : null
            secreto = {
                clave: 'secreto',
                titulo: 'Secreto RADIUS',
                resultado: problema ? 'falla' : 'ok',
                resumen: problema
                    ? `radius_secret ${problema}`
                    : `configurado y descifra (${claro.length} caracteres); falta que el router tenga el mismo en /radius`,
                detalles: [],
            }
        } catch {
            secreto = {
                clave: 'secreto',
                titulo: 'Secreto RADIUS',
                resultado: 'falla',
                resumen: 'radius_secret no descifra con AAA_PPP_KEY (clave distinta o dato alterado)',
                detalles: [],
            }
        }
    }
    comprobaciones.push(secreto)

    // Servicios PPPoE del router (los retirados no se migran: se rechazan igual en ambos RADIUS).
    const servicios = (await db
        .from('core.servicios as s')
        .where('s.router_id', routerId)
        .where('s.tipo_conexion', 'pppoe')
        .whereNot('s.estado', 'retirado')
        .select('s.id', 's.user_ppp', 's.pass_ppp', 's.estado', 's.version', 's.plan_id')
        .orderBy('s.id')) as FilaServicio[]
    informe.servicios.total = servicios.length
    for (const s of servicios) {
        informe.servicios.porEstado[s.estado] = (informe.servicios.porEstado[s.estado] ?? 0) + 1
    }
    const sesiones = await db
        .from('network.sesiones')
        .where('router_id', routerId)
        .whereNull('fin')
        .count('* as n')
        .first()
    informe.sesionesActivas = Number(sesiones?.n ?? 0)

    // 3. Redis
    comprobaciones.push(await comprobarRedis(redis, prefijo, servicios))

    // 4. Credenciales
    const noDescifran: string[] = []
    for (const s of servicios) {
        try {
            descifrar(s.pass_ppp, opciones.clave)
        } catch {
            noDescifran.push(`servicio ${s.id} (\`${s.user_ppp}\`)`)
        }
    }
    comprobaciones.push({
        clave: 'credenciales',
        titulo: 'Contraseñas PPPoE',
        resultado: noDescifran.length ? 'falla' : 'ok',
        resumen: noDescifran.length
            ? `${noDescifran.length} de ${servicios.length} no descifran con AAA_PPP_KEY (aaa respondería 500 → Reject)`
            : `${servicios.length} descifran con AAA_PPP_KEY`,
        detalles: lista(noDescifran),
    })

    // 5. Planes con perfil
    comprobaciones.push(await comprobarPlanes(routerId, router.control_velocidad))

    // 6. user_ppp
    comprobaciones.push(await comprobarUserPpp(routerId, servicios))

    informe.listo = comprobaciones.every((c) => c.resultado !== 'falla')
    return informe
}

async function comprobarRedis(
    redis: Redis,
    prefijo: string,
    servicios: FilaServicio[],
): Promise<Comprobacion> {
    const faltan: string[] = []
    const lapidas: string[] = []
    const invalidos: string[] = []
    const viejos: string[] = []
    const distintos: string[] = []
    try {
        for (let i = 0; i < servicios.length; i += 500) {
            const lote = servicios.slice(i, i + 500)
            const valores = await redis.mget(...lote.map((s) => `${prefijo}${s.user_ppp}`))
            lote.forEach((s, j) => {
                const nombre = `servicio ${s.id} (\`${s.user_ppp}\`)`
                const crudo = valores[j]
                if (crudo === null || crudo === undefined) return void faltan.push(nombre)
                let r: Record<string, unknown>
                try {
                    r = JSON.parse(crudo) as Record<string, unknown>
                } catch {
                    return void invalidos.push(`${nombre}: no es JSON`)
                }
                if (r.eliminado === true) return void lapidas.push(nombre)
                if (r.servicio_id !== Number(s.id)) {
                    return void distintos.push(`${nombre}: la clave es del servicio ${String(r.servicio_id)}`)
                }
                if (typeof r.version !== 'number' || r.version < s.version) {
                    return void viejos.push(
                        `${nombre}: version ${String(r.version)} en Redis, ${s.version} en Postgres`,
                    )
                }
                const diferencias: string[] = []
                if (r.pass_ppp !== s.pass_ppp) diferencias.push('pass_ppp')
                if (r.estado !== s.estado) diferencias.push(`estado ${String(r.estado)} ≠ ${s.estado}`)
                const plan = r.plan as { id?: unknown } | undefined
                if (plan?.id !== Number(s.plan_id)) {
                    diferencias.push(`plan ${String(plan?.id)} ≠ ${s.plan_id}`)
                }
                if (diferencias.length) distintos.push(`${nombre}: ${diferencias.join(', ')}`)
            })
        }
    } catch (e) {
        return {
            clave: 'redis',
            titulo: 'Registros `aaa:user:*` en Redis',
            resultado: 'falla',
            resumen: `Redis no respondió: ${(e as Error).message}`,
            detalles: [],
        }
    }
    const problemas = faltan.length + lapidas.length + invalidos.length + viejos.length + distintos.length
    const detalles = [
        ...faltan.map((n) => `sin clave: ${n}`),
        ...lapidas.map((n) => `lápida (aaa rechazaría): ${n}`),
        ...invalidos.map((n) => `inválido: ${n}`),
        ...viejos.map((n) => `desactualizado: ${n}`),
        ...distintos.map((n) => `distinto de Postgres: ${n}`),
    ]
    return {
        clave: 'redis',
        titulo: 'Registros `aaa:user:*` en Redis',
        resultado: problemas ? 'falla' : 'ok',
        resumen: problemas
            ? `${problemas} de ${servicios.length} sin registro correcto (${faltan.length} sin clave, ${lapidas.length} lápidas, ${invalidos.length} inválidos, ${viejos.length} desactualizados, ${distintos.length} distintos). Corregir con \`node ace aaa:repoblar\` (A1) y volver a verificar`
            : `${servicios.length} servicios con registro vigente (prefijo \`${prefijo}\`)`,
        detalles: lista(detalles),
    }
}

async function comprobarPlanes(routerId: number, control: string): Promise<Comprobacion> {
    const filas = (await db
        .from('core.servicios as s')
        .join('network.planes as p', 'p.id', 's.plan_id')
        .leftJoin('network.planes_routers as pr', (j) =>
            j.on('pr.plan_id', '=', 's.plan_id').andOn('pr.router_id', '=', 's.router_id'),
        )
        .where('s.router_id', routerId)
        .where('s.tipo_conexion', 'pppoe')
        .whereNot('s.estado', 'retirado')
        .groupBy(
            'p.id',
            'p.nombre',
            'p.subida_limitada_kbps',
            'p.bajada_limitada_kbps',
            'p.reuso',
            'pr.id',
            'pr.profile_ppp',
            'pr.reuso',
            'pr.pool_ipv4',
            'pr.pool_ipv6_enlace',
            'pr.pool_ipv6_delegacion',
        )
        .select(
            'p.id as plan_id',
            'p.nombre',
            'p.subida_limitada_kbps',
            'p.bajada_limitada_kbps',
            'p.reuso as reuso_plan',
            db.raw('pr.id IS NOT NULL AS tiene_fila'),
            'pr.profile_ppp',
            'pr.reuso as reuso_router',
            'pr.pool_ipv4',
            'pr.pool_ipv6_enlace',
            'pr.pool_ipv6_delegacion',
            db.raw('count(*)::int AS servicios'),
            db.raw(
                `count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM network.ipv4_asignaciones a WHERE a.servicio_id = s.id AND a.fin IS NULL))::int AS sin_ipv4_fija`,
            ),
            db.raw(`count(*) FILTER (WHERE s.ipv6_modo = 'radius_pool')::int AS en_radius_pool`),
        )
        .orderBy('p.id')) as FilaPlan[]

    let resultado: Resultado = 'ok'
    const detalles: string[] = []
    for (const f of filas) {
        const nombre = `plan ${f.plan_id} «${f.nombre}» (${f.servicios} servicios)`
        const reuso = f.reuso_router ?? f.reuso_plan
        if (control === 'simple' && reuso > 1) {
            detalles.push(
                `ok: ${nombre} usa el perfil \`plan-${f.plan_id}\` (reuso 1:${reuso}, lo crea el dispatcher de RouterOS)`,
            )
        } else if (!f.tiene_fila) {
            resultado = peor(resultado, 'falla')
            detalles.push(`falla: ${nombre} sin fila en planes_routers para este router`)
        } else if (!f.profile_ppp) {
            resultado = peor(resultado, 'falla')
            detalles.push(`falla: ${nombre} sin profile_ppp en planes_routers (no se manda Mikrotik-Group)`)
        } else {
            detalles.push(`ok: ${nombre} con perfil \`${f.profile_ppp}\``)
        }
        if (f.subida_limitada_kbps <= 0 || f.bajada_limitada_kbps <= 0) {
            resultado = peor(resultado, 'aviso')
            detalles.push(
                `aviso: ${nombre} sin velocidad limitada (un limitado navega a la velocidad del plan)`,
            )
        }
        if (f.sin_ipv4_fija > 0 && !f.pool_ipv4) {
            resultado = peor(resultado, 'aviso')
            detalles.push(
                `aviso: ${nombre}: ${f.sin_ipv4_fija} sin IPv4 fija y sin pool_ipv4 (la IPv4 la decide el perfil del router)`,
            )
        }
        if (f.en_radius_pool > 0 && (!f.pool_ipv6_enlace || !f.pool_ipv6_delegacion)) {
            resultado = peor(resultado, 'falla')
            detalles.push(
                `falla: ${nombre}: ${f.en_radius_pool} en IPv6 radius_pool sin pool_ipv6_enlace o pool_ipv6_delegacion`,
            )
        }
    }
    const fallas = detalles.filter((d) => d.startsWith('falla')).length
    return {
        clave: 'planes',
        titulo: 'Planes con perfil',
        resultado,
        resumen: filas.length
            ? `${filas.length} planes en uso${fallas ? `, ${fallas} problemas que impiden migrar` : ''}`
            : 'sin servicios PPPoE en este router',
        detalles: lista(detalles),
    }
}

async function comprobarUserPpp(routerId: number, servicios: FilaServicio[]): Promise<Comprobacion> {
    // Duplicados en toda la base: el user_ppp es global (clave de Redis y usuario del NAS).
    const duplicados = (await db.rawQuery(
        `SELECT lower(btrim(user_ppp)) AS normalizado,
                array_agg(id ORDER BY id) AS ids,
                array_agg(user_ppp ORDER BY id) AS nombres
           FROM core.servicios
          WHERE tipo_conexion = 'pppoe' AND estado <> 'retirado'
          GROUP BY 1
         HAVING count(*) > 1
            AND bool_or(router_id = ?)`,
        [routerId],
    )) as { rows: { normalizado: string; ids: number[]; nombres: string[] }[] }
    const invalidos = servicios.filter((s) => USER_PPP_INVALIDO.test(s.user_ppp))
    const detalles = [
        ...duplicados.rows.map(
            (d) => `duplicado: ${d.nombres.map((n, i) => `\`${n}\` (servicio ${d.ids[i]})`).join(', ')}`,
        ),
        ...invalidos.map((s) => `inválido para FreeRADIUS: servicio ${s.id} (${JSON.stringify(s.user_ppp)})`),
    ]
    return {
        clave: 'user_ppp',
        titulo: '`user_ppp` únicos',
        resultado: detalles.length ? 'falla' : 'ok',
        resumen: detalles.length
            ? `${duplicados.rows.length} duplicados (sin distinguir mayúsculas ni espacios) y ${invalidos.length} con espacios o caracteres de control`
            : `${servicios.length} únicos en toda la base`,
        detalles: lista(detalles),
    }
}

const MARCA: Record<Resultado, string> = { ok: 'OK', aviso: 'AVISO', falla: 'FALLA' }

/** Informe en Markdown (para pegar en el ticket de la migración o guardarlo con `--salida`). */
export function informeMarkdown(i: InformeMigracion): string {
    const l: string[] = []
    const nombre = i.router ? `${i.router.nombre} (id ${i.routerId})` : `id ${i.routerId}`
    l.push(`# Migración a RADIUS ArgosIsp: router ${nombre}`)
    l.push('')
    l.push(`Generado: ${i.generadoEn.toISOString()}`)
    l.push('')
    l.push(
        i.listo
            ? '**Resultado: LISTO.** El router puede apuntar `/radius` al nuevo `aaa`.'
            : '**Resultado: NO LISTO.** Corregir las fallas y volver a correr la verificación.',
    )
    l.push('')
    if (i.router) {
        const estados = Object.entries(i.servicios.porEstado)
            .map(([e, n]) => `${e} ${n}`)
            .join(', ')
        l.push(`- NAS: \`${i.router.nasIp}\``)
        l.push(`- Servicios PPPoE (sin retirados): ${i.servicios.total}${estados ? ` (${estados})` : ''}`)
        l.push(`- Sesiones activas en \`network.sesiones\`: ${i.sesionesActivas}`)
        l.push('')
    }
    l.push('| Comprobación | Resultado | Resumen |')
    l.push('| --- | --- | --- |')
    for (const c of i.comprobaciones) {
        l.push(`| ${c.titulo} | ${MARCA[c.resultado]} | ${c.resumen.replaceAll('|', '\\|')} |`)
    }
    for (const c of i.comprobaciones) {
        if (c.detalles.length === 0) continue
        l.push('')
        l.push(`## ${c.titulo}`)
        l.push('')
        for (const d of c.detalles) l.push(`- ${d}`)
    }
    l.push('')
    return l.join('\n')
}
