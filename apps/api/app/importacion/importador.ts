import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import { verificarRestriccionesDiferidas } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { normalizarNitCui } from '#core/nit_cui'
import CrearCliente from '#core/actions/crear_cliente'
import CrearServicio from '#core/actions/crear_servicio'
import CrearZona from '#core/actions/crear_zona'
import CrearPlan from '#network/actions/crear_plan'
import CrearRedIpv4 from '#network/actions/crear_red_ipv4'
import CrearRouter from '#network/actions/crear_router'
import ImplementarPlan from '#network/actions/implementar_plan'
import type { ClienteOrigen, FuenteMikrowisp, PlanOrigen, ServicioOrigen } from '#importacion/fuente'
import { conteoVacio, type ReporteImportacion } from '#importacion/reporte'

/**
 * Importador desde Mikrowisp. Crea routers, redes IPv4, planes (con su implementación en cada
 * router), zonas, clientes y servicios **por las acciones de dominio de A1** (auditoría y outbox
 * incluidos), nunca con INSERT directo. Las lecturas para decidir (¿ya existe?, ¿la IP está
 * libre?) sí van directo a la base, dentro de la misma transacción.
 *
 * - Todo corre en UNA transacción. En seco (`dryRun`) se revierte al final: el reporte dice lo
 *   que pasaría y la base queda igual. Real: se confirma al final.
 * - Cada acción corre en un savepoint: si falla, se revierte solo esa entidad, se anota en
 *   `errores` y se sigue. La auditoría del error (`audit.acciones`, resultado `error`) la escribe
 *   `DomainAction` en una transacción aparte, así que queda aun en seco.
 * - Idempotente: clientes por `campos_personalizados.mikrowisp_id`; routers por `nas_ip` (o
 *   `nombre`); planes por `nombre` (o `equivale_a`); redes por `cidr` en el mismo router;
 *   implementaciones por (plan, router); servicios por `user_ppp`. Correrlo dos veces no
 *   duplica nada: la segunda corrida reporta todo como `existentes`.
 */

export interface OpcionesImportacion {
    dryRun: boolean
    /** `ninguno` (por defecto): los servicios entran solo con IPv4. `plan`: modo IPv6 por defecto del plan */
    ipv6?: 'ninguno' | 'plan'
    /** no crear planes: los que no existan en ArgosIsp (por nombre o `equivale_a`) quedan sin equivalente */
    soloPlanesExistentes?: boolean
    /** directorio de origen, solo para el reporte */
    directorio?: string | null
    /** transacción externa (pruebas): no se confirma ni se revierte aquí */
    trx?: TransactionClientContract
}

export const PENDIENTE = [
    'Facturas pendientes y saldos por cliente: cuando A3 tenga sus acciones (día 4). La suma de saldos se comparará con la del origen.',
    'Estado de los servicios suspendidos en Mikrowisp: se aplica con las facturas (evaluarEstadoServicio de A3).',
]

export async function importarMikrowisp(
    fuente: FuenteMikrowisp,
    opciones: OpcionesImportacion,
): Promise<ReporteImportacion> {
    const requestId = `importacion-mikrowisp-${randomUUID()}`
    const ctx: ContextoAccion = { actor: { tipo: 'sistema', id: null }, canal: 'consola', requestId }
    const inicio = new Date().toISOString()

    // Con transacción externa (pruebas) se trabaja en un savepoint de ella.
    const trx = opciones.trx ? await opciones.trx.transaction() : await db.transaction()
    let reporte: ReporteImportacion
    try {
        const importador = new Importador(fuente, opciones, ctx, trx)
        await importador.ejecutar()
        reporte = importador.reporte
        if (opciones.dryRun) {
            await trx.rollback()
        } else {
            await verificarRestriccionesDiferidas(trx)
            await trx.commit()
        }
    } catch (error) {
        if (!trx.isCompleted) await trx.rollback()
        throw error
    }
    reporte.inicio = inicio
    reporte.fin = new Date().toISOString()
    return reporte
}

class Importador {
    readonly reporte: ReporteImportacion
    readonly #routers = new Map<string, number>()
    readonly #planes = new Map<string, number>()
    readonly #clientes = new Map<string, number>()
    readonly #zonas = new Map<string, number>()
    /** planes del origen que no se pueden usar: plan_mw → motivo */
    readonly #planesSinEquivalente = new Map<string, { nombre: string | null; motivo: string }>()

    constructor(
        private readonly fuente: FuenteMikrowisp,
        private readonly opciones: OpcionesImportacion,
        private readonly ctx: ContextoAccion,
        private readonly trx: TransactionClientContract,
    ) {
        const zonas = new Set(fuente.clientes.map((c) => c.zona).filter(Boolean))
        this.reporte = {
            modo: opciones.dryRun ? 'en_seco' : 'real',
            request_id: ctx.requestId,
            inicio: '',
            fin: '',
            directorio: opciones.directorio ?? null,
            resumen: {
                routers: conteoVacio(fuente.routers.length),
                redes: conteoVacio(fuente.redes.length),
                planes: conteoVacio(fuente.planes.length),
                zonas: conteoVacio(zonas.size),
                clientes: conteoVacio(fuente.clientes.length),
                implementaciones: conteoVacio(),
                servicios: conteoVacio(fuente.servicios.length),
            },
            diferencias: {
                ips_duplicadas: [],
                ips_fuera_de_red: [],
                ips_en_uso: [],
                ips_nuevas: [],
                planes_sin_equivalente: [],
                clientes_sin_nit: [],
                nit_invalidos: [],
                user_ppp_duplicados: [],
                servicios_suspendidos_origen: [],
                servicios_retirados_origen: [],
                referencias_faltantes: [],
            },
            formato: fuente.problemas,
            errores: [],
            pendiente: [...PENDIENTE],
        }
    }

    async ejecutar() {
        await this.routers()
        await this.redes()
        await this.planes()
        await this.zonas()
        await this.clientes()
        await this.servicios()
    }

    /** Corre una acción en savepoint; si falla, anota el error y devuelve null. */
    async #accion<T>(entidad: string, idMw: string, nombre: string, fn: () => Promise<T>): Promise<T | null> {
        try {
            return await fn()
        } catch (error) {
            this.reporte.errores.push({ entidad, id_mw: idMw, accion: nombre, mensaje: mensajeDe(error) })
            return null
        }
    }

    async routers() {
        const conteo = this.reporte.resumen.routers
        for (const r of this.fuente.routers) {
            const existente = (await this.trx
                .from('network.routers')
                .whereRaw('nas_ip = ?::inet', [r.nas_ip])
                .orWhere('nombre', r.nombre)
                .select('id')
                .first()) as { id: number } | null
            if (existente) {
                this.#routers.set(r.id, existente.id)
                conteo.existentes++
                continue
            }
            const creado = await this.#accion('router', r.id, 'routers.crear', () =>
                new CrearRouter().execute(
                    {
                        nombre: r.nombre,
                        host: r.host,
                        nas_ip: r.nas_ip,
                        api_usuario: r.api_usuario,
                        api_password: r.api_password,
                        radius_secret: r.radius_secret,
                    },
                    this.ctx,
                    { trx: this.trx },
                ),
            )
            if (creado) {
                this.#routers.set(r.id, creado.id)
                conteo.creados++
            } else conteo.omitidos++
        }
    }

    async redes() {
        const conteo = this.reporte.resumen.redes
        for (const red of this.fuente.redes) {
            const idMw = `${red.router_id}:${red.cidr}`
            const routerId = this.#routers.get(red.router_id)
            if (!routerId) {
                this.#faltante('red', idMw, 'router', red.router_id)
                conteo.omitidos++
                continue
            }
            const existente = await this.trx
                .from('network.redes_ipv4')
                .where('router_id', routerId)
                .whereRaw('cidr = network(?::inet)', [red.cidr])
                .first()
            if (existente) {
                conteo.existentes++
                continue
            }
            const creada = await this.#accion('red', idMw, 'redes.crear', () =>
                new CrearRedIpv4().execute(
                    { router_id: routerId, cidr: red.cidr, gateway: red.gateway, tipo: red.tipo },
                    this.ctx,
                    { trx: this.trx },
                ),
            )
            if (creada) conteo.creados++
            else conteo.omitidos++
        }
    }

    async planes() {
        const conteo = this.reporte.resumen.planes
        for (const p of this.fuente.planes) {
            const nombre = p.equivale_a ?? p.nombre
            const existente = (await this.trx
                .from('network.planes')
                .where('nombre', nombre)
                .select('id')
                .first()) as {
                id: number
            } | null
            if (existente) {
                this.#planes.set(p.id, existente.id)
                conteo.existentes++
                continue
            }
            if (p.equivale_a || this.opciones.soloPlanesExistentes) {
                const motivo = p.equivale_a
                    ? `equivale_a "${p.equivale_a}" no existe en ArgosIsp`
                    : 'no existe en ArgosIsp un plan con ese nombre'
                this.#planesSinEquivalente.set(p.id, { nombre: p.nombre, motivo })
                conteo.omitidos++
                continue
            }
            const creado = await this.#accion('plan', p.id, 'planes.crear', () =>
                new CrearPlan().execute(entradaPlan(p), this.ctx, { trx: this.trx }),
            )
            if (creado) {
                this.#planes.set(p.id, creado.id)
                conteo.creados++
            } else {
                this.#planesSinEquivalente.set(p.id, {
                    nombre: p.nombre,
                    motivo: 'no se pudo crear (ver errores)',
                })
                conteo.omitidos++
            }
        }
        // Planes que usan los servicios y no vienen en planes.csv
        const conocidos = new Set(this.fuente.planes.map((p) => p.id))
        for (const s of this.fuente.servicios) {
            if (!conocidos.has(s.plan_id) && !this.#planesSinEquivalente.has(s.plan_id)) {
                this.#planesSinEquivalente.set(s.plan_id, { nombre: null, motivo: 'no está en planes.csv' })
            }
        }
        for (const [planMw, { nombre, motivo }] of this.#planesSinEquivalente) {
            this.reporte.diferencias.planes_sin_equivalente.push({
                plan_mw: planMw,
                nombre,
                motivo,
                servicios: this.fuente.servicios.filter(
                    (s) => s.plan_id === planMw && s.estado !== 'retirado',
                ).length,
            })
        }
    }

    async zonas() {
        const conteo = this.reporte.resumen.zonas
        const nombres = [...new Set(this.fuente.clientes.map((c) => c.zona).filter((z): z is string => !!z))]
        for (const nombre of nombres) {
            const existente = (await this.trx
                .from('core.zonas')
                .where('nombre', nombre)
                .select('id')
                .first()) as {
                id: number
            } | null
            if (existente) {
                this.#zonas.set(nombre, existente.id)
                conteo.existentes++
                continue
            }
            const creada = await this.#accion('zona', nombre, 'zonas.crear', () =>
                new CrearZona().execute({ nombre }, this.ctx, { trx: this.trx }),
            )
            if (creada) {
                this.#zonas.set(nombre, creada.id)
                conteo.creados++
            } else conteo.omitidos++
        }
    }

    async clientes() {
        const conteo = this.reporte.resumen.clientes
        const d = this.reporte.diferencias
        for (const c of this.fuente.clientes) {
            const existente = (await this.trx
                .from('core.clientes')
                .whereRaw(`campos_personalizados->>'mikrowisp_id' = ?`, [c.id])
                .select('id')
                .first()) as { id: number } | null

            const { nit, motivo } = revisarNit(c)
            if (!c.nit) d.clientes_sin_nit.push({ cliente_mw: c.id, nombre: c.nombre })
            if (motivo) d.nit_invalidos.push({ cliente_mw: c.id, nombre: c.nombre, nit: c.nit!, motivo })

            if (existente) {
                this.#clientes.set(c.id, existente.id)
                conteo.existentes++
                continue
            }
            const campos: Record<string, unknown> = { mikrowisp_id: c.id }
            if (motivo) campos.mikrowisp_nit = c.nit
            const creado = await this.#accion('cliente', c.id, 'clientes.crear', () =>
                new CrearCliente().execute(
                    {
                        nombre: c.nombre,
                        tipo: c.tipo,
                        nit_cui: nit,
                        nombre_fiscal: c.nombre_fiscal,
                        direccion_fiscal: c.direccion_fiscal,
                        email: c.email,
                        telefono: c.telefono,
                        movil: c.movil,
                        direccion: c.direccion,
                        coordenadas: c.coordenadas,
                        zona_id: c.zona ? (this.#zonas.get(c.zona) ?? null) : null,
                        campos_personalizados: campos,
                    },
                    this.ctx,
                    { trx: this.trx },
                ),
            )
            if (creado) {
                this.#clientes.set(c.id, creado.id)
                conteo.creados++
            } else conteo.omitidos++
        }
    }

    async servicios() {
        const conteo = this.reporte.resumen.servicios
        const d = this.reporte.diferencias
        const vigentes = this.fuente.servicios.filter((s) => s.estado !== 'retirado')
        for (const s of this.fuente.servicios) {
            if (s.estado === 'retirado') {
                d.servicios_retirados_origen.push({ servicio_mw: s.id, user_ppp: s.user_ppp })
            }
            if (s.estado === 'suspendido') {
                d.servicios_suspendidos_origen.push({ servicio_mw: s.id, user_ppp: s.user_ppp })
            }
        }

        // Duplicados dentro del origen: gana el primero del archivo.
        const omitir = new Set<string>()
        for (const [ip, grupo] of agrupar(
            vigentes.filter((s) => s.ip),
            (s) => s.ip!,
        )) {
            if (grupo.length < 2) continue
            d.ips_duplicadas.push({ ip, servicios_mw: grupo.map((s) => s.id), importado_mw: null })
        }
        for (const [userPpp, grupo] of agrupar(vigentes, (s) => s.user_ppp.toLowerCase())) {
            if (grupo.length < 2) continue
            d.user_ppp_duplicados.push({
                user_ppp: userPpp,
                servicios_mw: grupo.map((s) => s.id),
                motivo: `repetido en el origen; se importa ${grupo[0]!.id}`,
            })
            for (const s of grupo.slice(1)) omitir.add(s.id)
        }
        const ipTomada = new Map<string, string>()

        const implementadas = new Set<string>()
        for (const s of this.fuente.servicios) {
            if (s.estado === 'retirado' || omitir.has(s.id)) {
                conteo.omitidos++
                continue
            }
            const clienteId = this.#clientes.get(s.cliente_id)
            const routerId = this.#routers.get(s.router_id)
            const planId = this.#planes.get(s.plan_id)
            if (!clienteId) this.#faltante('servicio', s.id, 'cliente', s.cliente_id)
            if (!routerId) this.#faltante('servicio', s.id, 'router', s.router_id)
            if (!planId && !this.#planesSinEquivalente.has(s.plan_id)) {
                this.#faltante('servicio', s.id, 'plan', s.plan_id)
            }
            if (!clienteId || !routerId || !planId) {
                conteo.omitidos++
                continue
            }

            const existente = (await this.trx
                .from('core.servicios')
                .whereRaw('lower(user_ppp) = lower(?)', [s.user_ppp])
                .select('id', 'cliente_id')
                .first()) as { id: number; cliente_id: number } | null
            if (existente) {
                if (Number(existente.cliente_id) === clienteId) {
                    conteo.existentes++
                    if (s.ip) ipTomada.set(s.ip, s.id)
                } else {
                    d.user_ppp_duplicados.push({
                        user_ppp: s.user_ppp,
                        servicios_mw: [s.id],
                        motivo: `ya existe en ArgosIsp (servicio ${existente.id}) con otro cliente`,
                    })
                    conteo.omitidos++
                }
                continue
            }

            if (s.ip) {
                if (!(await this.#ipDisponible(s, routerId, ipTomada))) {
                    conteo.omitidos++
                    continue
                }
            }

            if (!(await this.#implementar(s, planId, routerId, implementadas))) {
                conteo.omitidos++
                continue
            }

            const creado = await this.#accion('servicio', s.id, 'servicios.crear', () =>
                new CrearServicio().execute(
                    {
                        cliente_id: clienteId,
                        router_id: routerId,
                        plan_id: planId,
                        user_ppp: s.user_ppp,
                        pass_ppp: s.pass_ppp ?? undefined,
                        mac: s.mac,
                        direccion: s.direccion,
                        coordenadas: s.coordenadas,
                        fecha_instalacion: s.fecha_instalacion,
                        ipv4: s.ip ?? undefined,
                        ipv6_modo: this.opciones.ipv6 === 'plan' ? undefined : 'ninguno',
                    },
                    this.ctx,
                    { trx: this.trx },
                ),
            )
            if (!creado) {
                conteo.omitidos++
                continue
            }
            conteo.creados++
            if (s.ip) ipTomada.set(s.ip, s.id)
            else d.ips_nuevas.push({ servicio_mw: s.id, ip: creado.ipv4 })
        }

        for (const dup of d.ips_duplicadas) {
            dup.importado_mw = dup.servicios_mw.find((id) => ipTomada.get(dup.ip) === id) ?? null
        }
    }

    /** IP libre (en el origen y en ArgosIsp) y dentro de una red del router. Anota la diferencia si no. */
    async #ipDisponible(
        s: ServicioOrigen,
        routerId: number,
        ipTomada: Map<string, string>,
    ): Promise<boolean> {
        const ip = s.ip!
        if (ipTomada.has(ip)) return false // duplicada en el origen: ya reportada en ips_duplicadas

        const enUso = (await this.trx
            .from('network.ipv4_asignaciones')
            .whereRaw('ip = ?::inet', [ip])
            .whereNull('fin')
            .select('servicio_id')
            .first()) as { servicio_id: number } | null
        if (enUso) {
            this.reporte.diferencias.ips_en_uso.push({
                servicio_mw: s.id,
                ip,
                servicio_id: Number(enUso.servicio_id),
            })
            return false
        }
        const red = await this.trx
            .from('network.redes_ipv4')
            .where('router_id', routerId)
            .whereRaw('cidr >>= ?::inet', [ip])
            .first()
        if (!red) {
            this.reporte.diferencias.ips_fuera_de_red.push({ servicio_mw: s.id, ip, router_mw: s.router_id })
            return false
        }
        return true
    }

    /** Asegura la implementación del plan en el router (ImplementarPlan) una vez por par. */
    async #implementar(
        s: ServicioOrigen,
        planId: number,
        routerId: number,
        hechas: Set<string>,
    ): Promise<boolean> {
        const clave = `${planId}:${routerId}`
        if (hechas.has(clave)) return true
        const conteo = this.reporte.resumen.implementaciones
        conteo.origen++
        const existente = await this.trx
            .from('network.planes_routers')
            .where({ plan_id: planId, router_id: routerId })
            .first()
        if (existente) {
            conteo.existentes++
            hechas.add(clave)
            return true
        }
        const plan = this.fuente.planes.find((p) => p.id === s.plan_id)
        const hecha = await this.#accion(
            'implementacion',
            `${s.plan_id}:${s.router_id}`,
            'planes.editar',
            () =>
                new ImplementarPlan().execute(
                    {
                        plan_id: planId,
                        router_id: routerId,
                        profile_ppp: plan?.perfil_ppp ?? null,
                        pool_ipv4: plan?.pool_ipv4 ?? null,
                    },
                    this.ctx,
                    { trx: this.trx },
                ),
        )
        if (!hecha) {
            conteo.omitidos++
            return false
        }
        conteo.creados++
        hechas.add(clave)
        return true
    }

    #faltante(entidad: string, idMw: string, falta: string, idFalta: string) {
        this.reporte.diferencias.referencias_faltantes.push({
            entidad,
            id_mw: idMw,
            falta,
            id_falta_mw: idFalta,
        })
    }
}

function entradaPlan(p: PlanOrigen) {
    return {
        nombre: p.nombre,
        precio: p.precio,
        bajada_kbps: p.bajada_kbps,
        subida_kbps: p.subida_kbps,
        bajada_limitada_kbps: p.bajada_limitada_kbps,
        subida_limitada_kbps: p.subida_limitada_kbps,
        // Mikrowisp no maneja IPv6: el plan queda dual stack para activarlo después.
        dual_stack: 'ambos' as const,
        // Disponible solo en los routers donde se implementa (los de sus servicios).
        global: false,
    }
}

/** NIT normalizado o null; `motivo` si el del origen no es válido. */
function revisarNit(c: ClienteOrigen): { nit: string | null; motivo: string | null } {
    if (!c.nit) return { nit: null, motivo: null }
    try {
        return { nit: normalizarNitCui(c.nit), motivo: null }
    } catch (error) {
        return { nit: null, motivo: mensajeDe(error) }
    }
}

function agrupar<T>(lista: T[], clave: (x: T) => string): Map<string, T[]> {
    const grupos = new Map<string, T[]>()
    for (const x of lista) {
        const k = clave(x)
        grupos.set(k, [...(grupos.get(k) ?? []), x])
    }
    return grupos
}

function mensajeDe(error: unknown): string {
    if (error instanceof Problema) {
        const campos = (error.errores ?? []).map((e) => `${e.field}: ${e.message}`)
        if (campos.length > 0) return campos.join('; ')
        return error.detalle ?? error.titulo
    }
    return error instanceof Error ? error.message : String(error)
}
