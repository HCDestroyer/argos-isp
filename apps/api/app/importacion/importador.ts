import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import { verificarRestriccionesDiferidas } from '#shared/domain_action'
import { Problema, ValidacionFallida } from '#shared/errores'
import { normalizarNitCui } from '#core/nit_cui'
import { plantillaPorDefecto } from '#core/plantilla_por_defecto'
import CrearServicio, { type EntradaCrearServicio } from '#core/actions/crear_servicio'
import { saldoAnticipos } from '#billing/cobros'
import { saldoCliente } from '#ledger/consultas'
import CrearCliente from '#core/actions/crear_cliente'
import CrearZona from '#core/actions/crear_zona'
import CrearPlan from '#network/actions/crear_plan'
import CrearRedIpv4 from '#network/actions/crear_red_ipv4'
import CrearRouter from '#network/actions/crear_router'
import ImplementarPlan from '#network/actions/implementar_plan'
import type {
    ClienteOrigen,
    FacturaOrigen,
    FuenteMikrowisp,
    PlanOrigen,
    ServicioOrigen,
    TipoConexionOrigen,
} from '#importacion/fuente'
import { conteoVacio, type ReporteImportacion } from '#importacion/reporte'
import { idsExternosDe, type EntidadExterna, type IdsExternos } from '#importacion/ids_externos'
import { cargaFinancieraA3, type CargaFinanciera } from '#importacion/carga_financiera'

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
 * - Idempotente: primero por `core.ids_externos` (si A1 ya la agregó, `ids_externos.ts`); si no,
 *   clientes por `campos_personalizados.mikrowisp_id`; routers por `nas_ip` (o `nombre`); planes
 *   por `nombre` (o `equivale_a`); redes por `cidr` en el mismo router; implementaciones por
 *   (plan, router); servicios PPPoE por `user_ppp`, sin PPPoE por IP (o MAC) del mismo cliente;
 *   facturas y saldos por su `clave_externa` (`mikrowisp:factura:<id>`, `mikrowisp:saldo:<id>`).
 *   Correrlo dos veces no duplica nada: la segunda corrida reporta todo como `existentes`.
 * - Facturas pendientes y saldos por las acciones de A3 (`ImportarFacturaPendiente`,
 *   `RegistrarSaldoInicial`): el saldo inicial de cada cliente es su saldo en Mikrowisp menos lo
 *   que entra como factura, así que la suma en ArgosIsp debe ser la del origen; el reporte lo
 *   compara cliente por cliente.
 */

export interface OpcionesImportacion {
    dryRun: boolean
    /** `ninguno` (por defecto): los servicios entran solo con IPv4. `plan`: modo IPv6 por defecto del plan */
    ipv6?: 'ninguno' | 'plan'
    /** no crear planes: los que no existan en ArgosIsp (por nombre o `equivale_a`) quedan sin equivalente */
    soloPlanesExistentes?: boolean
    /** directorio de origen, solo para el reporte */
    directorio?: string | null
    /**
     * Plantilla de facturación de los servicios nuevos. Sin ella, la plantilla por defecto
     * (`plantillaPorDefecto` de A1: la única que haya); si hay varias, los servicios entran sin
     * plantilla y sus facturas pendientes no se pueden importar (queda en errores).
     */
    plantillaId?: number | null
    /** acciones de carga histórica de A3 (pruebas o el adaptador nuevo); por defecto `cargaFinancieraA3` */
    carga?: CargaFinanciera
    /** ids externos (pruebas); por defecto `core.ids_externos` si existe */
    idsExternos?: IdsExternos
    /** transacción externa (pruebas): no se confirma ni se revierte aquí */
    trx?: TransactionClientContract
}

export const PENDIENTE = [
    'Estado de los servicios suspendidos en Mikrowisp: se aplica con las facturas importadas en la siguiente evaluación (evaluarEstadoServicio de A3).',
]

/** Servicios sin PPPoE: necesitan `core.servicios.tipo_conexion` (modelo de A1, semana 2). */
async function admiteTipoConexion(trx: TransactionClientContract): Promise<boolean> {
    const r = (await trx.rawQuery(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'core' AND table_name = 'servicios' AND column_name = 'tipo_conexion'`,
    )) as { rows: Array<{ n: number }> }
    return r.rows[0]?.n === 1
}

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
        const ids = opciones.idsExternos ?? (await idsExternosDe(trx))
        const importador = new Importador(fuente, opciones, ctx, trx, ids, await admiteTipoConexion(trx))
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
    /** servicio_mw → servicio de ArgosIsp (creado o ya importado) */
    readonly #servicios = new Map<string, number>()
    /** plantilla de los servicios nuevos (resuelta una vez) */
    #plantilla: number | null = null
    /** planes del origen que no se pueden usar: plan_mw → motivo */
    readonly #planesSinEquivalente = new Map<string, { nombre: string | null; motivo: string }>()
    readonly #carga: CargaFinanciera
    /** índices del origen (evitan recorrer las listas en cada fila) */
    readonly #servicioMw: Map<string, ServicioOrigen>
    readonly #facturasPorCliente: Map<string, FacturaOrigen[]>
    readonly #serviciosPorCliente: Map<string, ServicioOrigen[]>

    constructor(
        private readonly fuente: FuenteMikrowisp,
        private readonly opciones: OpcionesImportacion,
        private readonly ctx: ContextoAccion,
        private readonly trx: TransactionClientContract,
        private readonly ids: IdsExternos,
        private readonly tipoConexion: boolean,
    ) {
        this.#carga = opciones.carga ?? cargaFinancieraA3
        this.#servicioMw = new Map(fuente.servicios.map((s) => [s.id, s]))
        this.#facturasPorCliente = agrupar(fuente.facturas, (f) => f.cliente_id)
        this.#serviciosPorCliente = agrupar(fuente.servicios, (s) => s.cliente_id)
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
                facturas: conteoVacio(fuente.facturas.length),
                saldos: conteoVacio(),
                pagos: conteoVacio(fuente.pagos.length),
            },
            ids_externos: ids.modo,
            saldos: {
                clientes: 0,
                suma_origen: '0.00',
                suma_importada: '0.00',
                diferencia: '0.00',
                cuadra: true,
            },
            diferencias: {
                routers_sin_credenciales: [],
                clientes_nit_duplicado: [],
                servicios_sin_plan: [],
                pagos_cruzados: [],
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
                tipos_conexion_pendientes: [],
                facturas_a_saldo: [],
                saldos_distintos: [],
            },
            formato: fuente.problemas,
            errores: [],
            pendiente: [...PENDIENTE],
        }
        if (ids.modo === 'ninguno') {
            this.reporte.pendiente.push(
                'Ids externos: no existe core.ids_externos (A1); lo ya importado se reconoce por claves naturales.',
            )
        }
        if (!tipoConexion && fuente.servicios.some((x) => x.tipo_conexion !== 'pppoe')) {
            this.reporte.pendiente.push(
                'Servicios sin PPPoE (ip_estatica, dhcp_fija): ArgosIsp aún no tiene tipo_conexion (modelo de A1); se importan cuando llegue.',
            )
        }
    }

    async ejecutar() {
        await this.routers()
        await this.redes()
        await this.planes()
        await this.zonas()
        await this.clientes()
        await this.#resolverPlantilla()
        await this.servicios()
        await this.facturas()
        await this.saldos()
        await this.pagos()
        await this.compararSaldos()
    }

    /**
     * Agrega `externo: { sistema: 'mikrowisp', id }` a la entrada de la acción de alta (A1 guarda
     * el vínculo en `core.ids_externos` en la misma transacción) cuando la tabla existe.
     */
    #conExterno<T extends object>(entidad: EntidadExterna, idMw: string, entrada: T): T {
        const externo = this.ids.externo(entidad, idMw)
        return externo ? ({ ...entrada, externo } as T) : entrada
    }

    /** Busca primero en ids externos; si no, `natural`. */
    async #existente(
        entidad: EntidadExterna,
        idMw: string,
        natural: () => Promise<number | null>,
    ): Promise<number | null> {
        return (await this.ids.buscar(entidad, idMw)) ?? (await natural())
    }

    async #resolverPlantilla() {
        if (this.opciones.plantillaId !== undefined) {
            this.#plantilla = this.opciones.plantillaId
            return
        }
        try {
            this.#plantilla = await plantillaPorDefecto(this.trx)
            if (this.#plantilla === null && this.fuente.facturas.length > 0) {
                this.reporte.pendiente.push(
                    'No hay plantilla de facturación: los servicios nuevos entran sin plantilla y sus facturas no se importan. Crea una o indica --plantilla=<id>.',
                )
            }
        } catch (error) {
            if (!(error instanceof ValidacionFallida)) throw error
            this.#plantilla = null
            this.reporte.errores.push({
                entidad: 'plantilla',
                id_mw: '-',
                accion: 'servicios.crear',
                mensaje:
                    'Hay varias plantillas de facturación: los servicios nuevos entran sin plantilla y sus facturas no se importan. Indica --plantilla=<id>',
            })
        }
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
            const faltan = (['api_usuario', 'api_password', 'radius_secret'] as const).filter((c) => !r[c])
            if (faltan.length > 0) {
                this.reporte.diferencias.routers_sin_credenciales.push({
                    router_mw: r.id,
                    nombre: r.nombre,
                    faltan: [...faltan],
                })
            }
            const existente = await this.#existente('router', r.id, async () => {
                const fila = (await this.trx
                    .from('network.routers')
                    .whereRaw('nas_ip = ?::inet', [r.nas_ip])
                    .orWhere('nombre', r.nombre)
                    .select('id')
                    .first()) as { id: number } | null
                return fila ? Number(fila.id) : null
            })
            if (existente) {
                this.#routers.set(r.id, existente)
                conteo.existentes++
                continue
            }
            const creado = await this.#accion('router', r.id, 'routers.crear', () =>
                new CrearRouter().execute(
                    this.#conExterno('router', r.id, {
                        nombre: r.nombre,
                        host: r.host,
                        nas_ip: r.nas_ip,
                        api_usuario: r.api_usuario,
                        api_password: r.api_password,
                        radius_secret: r.radius_secret,
                    }),
                    this.ctx,
                    { trx: this.trx },
                ),
            )
            if (creado) {
                this.#routers.set(r.id, creado.id)
                await this.ids.registrar('router', r.id, creado.id)
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
            const existente = await this.#existente('plan', p.id, async () => {
                const fila = (await this.trx
                    .from('network.planes')
                    .where('nombre', nombre)
                    .select('id')
                    .first()) as { id: number } | null
                return fila ? Number(fila.id) : null
            })
            if (existente) {
                this.#planes.set(p.id, existente)
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
                new CrearPlan().execute(this.#conExterno('plan', p.id, entradaPlan(p)), this.ctx, {
                    trx: this.trx,
                }),
            )
            if (creado) {
                this.#planes.set(p.id, creado.id)
                await this.ids.registrar('plan', p.id, creado.id)
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
            if (s.plan_id === null) continue // servicios_sin_plan
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
        // Mismo NIT en varios clientes: se importan todos (son cuentas distintas en el origen).
        const conNit = this.fuente.clientes
            .map((c) => ({ c, nit: revisarNit(c).nit }))
            .filter((x): x is { c: ClienteOrigen; nit: string } => !!x.nit && x.nit !== 'CF')
        for (const [nit, grupo] of agrupar(conNit, (x) => x.nit)) {
            if (grupo.length < 2) continue
            d.clientes_nit_duplicado.push({ nit, clientes_mw: grupo.map((x) => x.c.id) })
        }
        for (const c of this.fuente.clientes) {
            const existente = await this.#existente('cliente', c.id, async () => {
                const fila = (await this.trx
                    .from('core.clientes')
                    .whereRaw(`campos_personalizados->>'mikrowisp_id' = ?`, [c.id])
                    .select('id')
                    .first()) as { id: number } | null
                return fila ? Number(fila.id) : null
            })

            const { nit, motivo } = revisarNit(c)
            if (!c.nit) d.clientes_sin_nit.push({ cliente_mw: c.id, nombre: c.nombre })
            if (motivo) d.nit_invalidos.push({ cliente_mw: c.id, nombre: c.nombre, nit: c.nit!, motivo })

            if (existente) {
                this.#clientes.set(c.id, existente)
                conteo.existentes++
                continue
            }
            const campos: Record<string, unknown> = { mikrowisp_id: c.id }
            if (motivo) campos.mikrowisp_nit = c.nit
            const creado = await this.#accion('cliente', c.id, 'clientes.crear', () =>
                new CrearCliente().execute(
                    this.#conExterno('cliente', c.id, {
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
                    }),
                    this.ctx,
                    { trx: this.trx },
                ),
            )
            if (creado) {
                this.#clientes.set(c.id, creado.id)
                await this.ids.registrar('cliente', c.id, creado.id)
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
                d.servicios_retirados_origen.push({ servicio_mw: s.id, user_ppp: etiqueta(s) })
            }
            if (s.estado === 'suspendido') {
                d.servicios_suspendidos_origen.push({ servicio_mw: s.id, user_ppp: etiqueta(s) })
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
        const conPpp = vigentes.filter((s) => s.user_ppp)
        for (const [userPpp, grupo] of agrupar(conPpp, (s) => s.user_ppp!.toLowerCase())) {
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
            if (s.plan_id === null) {
                d.servicios_sin_plan.push({
                    servicio_mw: s.id,
                    cliente_mw: s.cliente_id,
                    etiqueta: etiqueta(s),
                })
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
            if (s.tipo_conexion !== 'pppoe' && !this.tipoConexion) {
                d.tipos_conexion_pendientes.push({
                    servicio_mw: s.id,
                    tipo_conexion: s.tipo_conexion,
                    motivo: 'ArgosIsp aún no tiene tipo_conexion (modelo de A1); se importa cuando llegue',
                })
                conteo.omitidos++
                continue
            }

            const porId = await this.ids.buscar('servicio', s.id)
            const existente = porId
                ? ((await this.trx
                      .from('core.servicios')
                      .where('id', porId)
                      .select('id', 'cliente_id')
                      .first()) as { id: number; cliente_id: number } | null)
                : await this.#servicioExistente(s, clienteId)
            if (existente) {
                if (Number(existente.cliente_id) === clienteId) {
                    conteo.existentes++
                    this.#servicios.set(s.id, Number(existente.id))
                    if (s.ip) ipTomada.set(s.ip, s.id)
                } else {
                    d.user_ppp_duplicados.push({
                        user_ppp: etiqueta(s),
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

            const entrada: EntradaServicioImportado = {
                cliente_id: clienteId,
                router_id: routerId,
                plan_id: planId,
                plantilla_facturacion_id: this.#plantilla,
                mac: s.mac,
                direccion: s.direccion,
                coordenadas: s.coordenadas,
                fecha_instalacion: s.fecha_instalacion,
                ipv4: s.ip ?? undefined,
                ipv6_modo: this.opciones.ipv6 === 'plan' ? undefined : 'ninguno',
            }
            if (s.tipo_conexion === 'pppoe') {
                entrada.user_ppp = s.user_ppp!
                entrada.pass_ppp = s.pass_ppp ?? undefined
            } else {
                // contratos/routeros.md: sin credenciales PPP; el dispatcher de A2 crea cola, lease y amarre.
                entrada.tipo_conexion = s.tipo_conexion
                entrada.amarre_ip_mac = s.amarre_ip_mac
            }
            const creado = await this.#accion('servicio', s.id, 'servicios.crear', () =>
                new CrearServicio().execute(this.#conExterno('servicio', s.id, entrada), this.ctx, {
                    trx: this.trx,
                }),
            )
            if (!creado) {
                conteo.omitidos++
                continue
            }
            conteo.creados++
            this.#servicios.set(s.id, creado.id)
            await this.ids.registrar('servicio', s.id, creado.id)
            if (s.ip) ipTomada.set(s.ip, s.id)
            else d.ips_nuevas.push({ servicio_mw: s.id, ip: creado.ipv4 })
        }

        for (const dup of d.ips_duplicadas) {
            dup.importado_mw = dup.servicios_mw.find((id) => ipTomada.get(dup.ip) === id) ?? null
        }
    }

    /** PPPoE por `user_ppp`; sin PPPoE por su IP vigente o, en dhcp_fija sin IP, por la MAC del cliente. */
    async #servicioExistente(
        s: ServicioOrigen,
        clienteId: number,
    ): Promise<{ id: number; cliente_id: number } | null> {
        if (s.tipo_conexion === 'pppoe') {
            return (await this.trx
                .from('core.servicios')
                .whereRaw('lower(user_ppp) = lower(?)', [s.user_ppp ?? ''])
                .select('id', 'cliente_id')
                .first()) as { id: number; cliente_id: number } | null
        }
        if (s.ip) {
            // Solo si es del mismo cliente; si es de otro, #ipDisponible lo reporta como IP en uso.
            return (await this.trx
                .from('network.ipv4_asignaciones as a')
                .join('core.servicios as sv', 'sv.id', 'a.servicio_id')
                .whereRaw('a.ip = ?::inet', [s.ip])
                .whereNull('a.fin')
                .where('sv.cliente_id', clienteId)
                .select('sv.id', 'sv.cliente_id')
                .first()) as { id: number; cliente_id: number } | null
        }
        return (await this.trx
            .from('core.servicios')
            .whereRaw('mac = ?::macaddr', [s.mac ?? ''])
            .where('cliente_id', clienteId)
            .whereNot('estado', 'retirado')
            .select('id', 'cliente_id')
            .first()) as { id: number; cliente_id: number } | null
    }

    /**
     * Facturas pendientes por `ImportarFacturaPendiente` (A3). El servicio es el de la factura o,
     * si no trae, el único servicio importado del cliente. Sin servicio, su monto va al saldo
     * inicial (`facturas_a_saldo`). Ya importada = existe una factura con su `clave_externa`.
     */
    async facturas() {
        const conteo = this.reporte.resumen.facturas
        for (const f of this.fuente.facturas) {
            if (new Decimal(f.pendiente).lte(0)) {
                conteo.omitidos++ // pagada en el origen: no hay nada que importar
                continue
            }
            const servicioId = this.#servicioDeFactura(f)
            if (servicioId === null) {
                conteo.omitidos++
                continue
            }
            const clave = claveFactura(f)
            const ya = await this.trx
                .from('billing.facturas')
                .where('clave_externa', clave)
                .select('id')
                .first()
            if (ya) {
                conteo.existentes++
                continue
            }
            const hecha = await this.#accion('factura', f.id, 'facturas.importar_pendiente', () =>
                this.#carga.importarFactura(
                    {
                        clave_externa: clave,
                        servicio_id: servicioId,
                        periodo: f.periodo,
                        total: f.pendiente,
                        vence_en: f.vence ?? undefined,
                        concepto: f.concepto,
                    },
                    this.ctx,
                    this.trx,
                ),
            )
            if (hecha) conteo.creados++
            else conteo.omitidos++
        }
    }

    /** Servicio de ArgosIsp de la factura, o null (anota en `facturas_a_saldo` o referencias). */
    #servicioDeFactura(f: FacturaOrigen): number | null {
        const aSaldo = (motivo: string) => {
            this.reporte.diferencias.facturas_a_saldo.push({
                factura_mw: f.id,
                cliente_mw: f.cliente_id,
                pendiente: f.pendiente,
                motivo,
            })
            return null
        }
        if (!this.#clientes.has(f.cliente_id)) {
            this.#faltante('factura', f.id, 'cliente', f.cliente_id)
            return null
        }
        if (f.servicio_id) {
            const servicio = this.#servicioMw.get(f.servicio_id)
            if (!servicio || servicio.cliente_id !== f.cliente_id) {
                return aSaldo(`el servicio ${f.servicio_id} no es del cliente en el origen`)
            }
            return this.#servicios.get(f.servicio_id) ?? aSaldo(`el servicio ${f.servicio_id} no se importó`)
        }
        const delCliente = (this.#serviciosPorCliente.get(f.cliente_id) ?? [])
            .filter((s) => this.#servicios.has(s.id))
            .map((s) => this.#servicios.get(s.id)!)
        const unicos = [...new Set(delCliente)]
        if (unicos.length === 1) return unicos[0]!
        return aSaldo(
            unicos.length === 0
                ? 'el cliente no tiene servicios importados'
                : `sin servicio_id y el cliente tiene ${unicos.length} servicios`,
        )
    }

    /**
     * Saldo inicial por cliente (`RegistrarSaldoInicial` de A3) = saldo en el origen − lo que entra
     * como factura pendiente. Sin fila en saldos.csv, el saldo del origen es la suma de sus
     * facturas pendientes (las que quedaron sin servicio entran aquí).
     */
    async saldos() {
        const conteo = this.reporte.resumen.saldos
        const conocidos = new Set(this.fuente.clientes.map((c) => c.id))
        for (const fila of this.fuente.saldos) {
            if (!conocidos.has(fila.cliente_id)) {
                this.#faltante('saldo', fila.cliente_id, 'cliente', fila.cliente_id)
            }
        }
        for (const [clienteMw, origen] of this.#saldosOrigen()) {
            const clienteId = this.#clientes.get(clienteMw)
            if (!clienteId) continue // ya está en referencias faltantes o no se pudo importar el cliente
            const comoFactura = (this.#facturasPorCliente.get(clienteMw) ?? [])
                .filter((f) => new Decimal(f.pendiente).gt(0))
                .filter((f) => this.#servicioDeFacturaSinAnotar(f) !== null)
                .reduce((suma, f) => suma.plus(f.pendiente), new Decimal(0))
            const monto = origen.minus(comoFactura)
            if (monto.isZero()) continue
            conteo.origen++
            const clave = `mikrowisp:saldo:${clienteMw}`
            const ya = await this.trx
                .from('billing.saldos_iniciales')
                .where('clave_externa', clave)
                .select('id')
                .first()
            if (ya) {
                conteo.existentes++
                continue
            }
            const hecho = await this.#accion('saldo', clienteMw, 'facturas.registrar_saldo_inicial', () =>
                this.#carga.registrarSaldoInicial(
                    {
                        clave_externa: clave,
                        cliente_id: clienteId,
                        monto: monto.toFixed(2),
                        descripcion: 'Saldo inicial importado de Mikrowisp',
                    },
                    this.ctx,
                    this.trx,
                ),
            )
            if (hecho) conteo.creados++
            else conteo.omitidos++
        }
    }

    /**
     * Pagos del origen. Lo pendiente de cada factura ya descuenta lo pagado, así que los pagos no
     * mueven saldos aquí: se reportan los de un cliente a facturas de otro (`pagos_cruzados`) y,
     * cuando A3 publique la acción de pago histórico (`carga_financiera.ts`), se registran como
     * historial. Sin ella, quedan en `pendiente`.
     */
    async pagos() {
        const conteo = this.reporte.resumen.pagos
        const duenos =
            this.fuente.duenosFacturas ?? new Map(this.fuente.facturas.map((f) => [f.id, f.cliente_id]))
        for (const p of this.fuente.pagos) {
            const dueno = p.factura_id ? duenos.get(p.factura_id) : undefined
            if (p.factura_id && dueno && dueno !== p.cliente_id) {
                this.reporte.diferencias.pagos_cruzados.push({
                    pago_mw: p.id,
                    pagador_mw: p.cliente_id,
                    factura_mw: p.factura_id,
                    dueno_mw: dueno,
                    monto: p.monto,
                })
            }
        }
        const registrar = this.#carga.registrarPagoHistorico
        if (!registrar) {
            conteo.omitidos = this.fuente.pagos.length
            if (this.fuente.pagos.length > 0) {
                this.reporte.pendiente.push(
                    `Pagos históricos: ${this.fuente.pagos.length} pagos del origen no se importan hasta que A3 publique la acción de pago histórico (contratos/importacion.md). No cambia saldos: lo pendiente de cada factura ya los descuenta.`,
                )
            }
            return
        }
        for (const p of this.fuente.pagos) {
            const clienteId = this.#clientes.get(p.cliente_id)
            if (!clienteId) {
                this.#faltante('pago', p.id, 'cliente', p.cliente_id)
                conteo.omitidos++
                continue
            }
            const clave = `mikrowisp:pago:${p.id}`
            if (await this.#carga.existePagoHistorico?.(clave, this.trx)) {
                conteo.existentes++
                continue
            }
            const hecho = await this.#accion('pago', p.id, 'pagos.registrar_historico', async () => {
                await registrar(
                    {
                        clave_externa: clave,
                        cliente_id: clienteId,
                        monto: p.monto,
                        fecha: p.fecha,
                        metodo: p.metodo,
                        factura_clave_externa: p.factura_id ? `mikrowisp:factura:${p.factura_id}` : null,
                    },
                    this.ctx,
                    this.trx,
                )
                return true
            })
            if (hecho) conteo.creados++
            else conteo.omitidos++
        }
    }

    /** Igual que `#servicioDeFactura` pero sin anotar diferencias (ya se anotaron en `facturas`). */
    #servicioDeFacturaSinAnotar(f: FacturaOrigen): number | null {
        const d = this.reporte.diferencias
        const antes = [d.facturas_a_saldo.length, d.referencias_faltantes.length] as const
        const id = this.#servicioDeFactura(f)
        d.facturas_a_saldo.length = antes[0]
        d.referencias_faltantes.length = antes[1]
        return id
    }

    /** cliente_mw → saldo en el origen (saldos.csv o suma de facturas pendientes). */
    #saldosOrigen(): Map<string, Decimal> {
        const saldos = new Map<string, Decimal>()
        for (const f of this.fuente.facturas) {
            if (new Decimal(f.pendiente).lte(0)) continue
            saldos.set(f.cliente_id, (saldos.get(f.cliente_id) ?? new Decimal(0)).plus(f.pendiente))
        }
        for (const fila of this.fuente.saldos) saldos.set(fila.cliente_id, new Decimal(fila.saldo))
        return saldos
    }

    /** Compara, cliente por cliente, el saldo del origen con CxC − anticipos en ArgosIsp. */
    async compararSaldos() {
        let sumaOrigen = new Decimal(0)
        let sumaImportada = new Decimal(0)
        const saldos = this.#saldosOrigen()
        for (const [clienteMw, origen] of saldos) {
            const clienteId = this.#clientes.get(clienteMw)
            let importado = new Decimal(0)
            if (clienteId) {
                const cxc = await saldoCliente(clienteId, this.trx)
                importado = cxc.minus(await saldoAnticipos(this.trx, clienteId))
            }
            sumaOrigen = sumaOrigen.plus(origen)
            sumaImportada = sumaImportada.plus(importado)
            if (!importado.equals(origen)) {
                this.reporte.diferencias.saldos_distintos.push({
                    cliente_mw: clienteMw,
                    nombre: this.fuente.clientes.find((c) => c.id === clienteMw)?.nombre ?? null,
                    origen: origen.toFixed(2),
                    importado: importado.toFixed(2),
                    diferencia: importado.minus(origen).toFixed(2),
                })
            }
        }
        const diferencia = sumaImportada.minus(sumaOrigen)
        this.reporte.saldos = {
            clientes: saldos.size,
            suma_origen: sumaOrigen.toFixed(2),
            suma_importada: sumaImportada.toFixed(2),
            diferencia: diferencia.toFixed(2),
            cuadra: diferencia.isZero() && this.reporte.diferencias.saldos_distintos.length === 0,
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

/**
 * Entrada de `CrearServicio` con lo de `contratos/routeros.md` (`tipo_conexion`, `amarre_ip_mac`).
 * Mientras el modelo de A1 no esté en esta rama, esos campos solo se mandan si la columna existe
 * (`admiteTipoConexion`); si no, el servicio queda en `tipos_conexion_pendientes`.
 */
type EntradaServicioImportado = EntradaCrearServicio & {
    tipo_conexion?: TipoConexionOrigen
    amarre_ip_mac?: boolean
}

function claveFactura(f: FacturaOrigen): string {
    return `mikrowisp:factura:${f.id}`
}

/** user_ppp, o el tipo y la IP/MAC para un servicio sin PPPoE (solo para el reporte). */
function etiqueta(s: ServicioOrigen): string {
    return s.user_ppp ?? `${s.tipo_conexion} ${s.ip ?? s.mac ?? s.id}`
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
