import { randomUUID } from 'node:crypto'
import { D, type Dec } from '#ledger/dinero'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import { verificarRestriccionesDiferidas } from '#shared/domain_action'
import { Problema, ValidacionFallida } from '#shared/errores'
import { normalizarNitCui } from '#core/nit_cui'
import { plantillaPorDefecto } from '#core/plantilla_por_defecto'
import CrearServicio, { type EntradaCrearServicio } from '#core/actions/crear_servicio'
import { saldoAnticipos } from '#billing/cobros'
import { saldoCliente, saldoClientePorEmpresa } from '#ledger/consultas'
import { hoyGuatemala } from '#ledger/fechas'
import type { MetodoPago } from '#shared/eventos'
import CrearCliente from '#core/actions/crear_cliente'
import CrearZona from '#core/actions/crear_zona'
import CrearPlan from '#network/actions/crear_plan'
import CrearRedIpv4 from '#network/actions/crear_red_ipv4'
import CrearRouter from '#network/actions/crear_router'
import ImplementarPlan from '#network/actions/implementar_plan'
import type {
    ClienteOrigen,
    Entidad,
    FacturaOrigen,
    FuenteCanonica,
    PlanOrigen,
    ServicioOrigen,
    TipoConexionOrigen,
} from '#importacion/canonico'
import { normalizarTelefono } from '#core/telefonos'
import { conteoVacio, type ReporteImportacion } from '#importacion/reporte'
import { idsExternosDe, type EntidadExterna, type IdsExternos } from '#importacion/ids_externos'
import { cargaFinancieraA3, type CargaFinanciera } from '#importacion/carga_financiera'
import { archivarYCuadrar, claveResultado, type ResultadoEntidad } from '#importacion/archivo'

/**
 * Núcleo del importador, igual para todos los orígenes (Mikrowisp, SmartISP, CSV): recibe la
 * fuente ya en formato canónico (`canonico.ts`, la traducen los adaptadores de `origenes/`) y el
 * nombre del sistema de origen (`sistema`), que forma la clave de idempotencia de todo lo que
 * crea. Crea routers, redes IPv4, planes (con su implementación en cada router), zonas, clientes
 * y servicios **por las acciones de dominio de A1** (auditoría y outbox incluidos), nunca con
 * INSERT directo. Las lecturas para decidir (¿ya existe?, ¿la IP está libre?) sí van directo a la
 * base, dentro de la misma transacción.
 *
 * - Todo corre en UNA transacción. En seco (`dryRun`) se revierte al final: el reporte dice lo
 *   que pasaría y la base queda igual. Real: se confirma al final.
 * - Cada acción corre en un savepoint: si falla, se revierte solo esa entidad, se anota en
 *   `errores` y se sigue. La auditoría del error (`audit.acciones`, resultado `error`) la escribe
 *   `DomainAction` en una transacción aparte, así que queda aun en seco.
 * - Idempotente: primero por `core.ids_externos` (si A1 ya la agregó, `ids_externos.ts`); si no,
 *   clientes por `campos_personalizados.<sistema>_id`; routers por `nas_ip` si la trae (o `nombre`); planes
 *   por `nombre` (o `equivale_a`); redes por `cidr` en el mismo router; implementaciones por
 *   (plan, router); servicios PPPoE por `user_ppp`, sin PPPoE por IP (o MAC) del mismo cliente;
 *   facturas y saldos por su `clave_externa` (`<sistema>:factura:<id>`, `<sistema>:saldo:<id>`).
 *   Correrlo dos veces no duplica nada: la segunda corrida reporta todo como `existentes`.
 * - Facturas pendientes y saldos por las acciones de A3 (`ImportarFacturaPendiente`,
 *   `RegistrarSaldoInicial`): el saldo inicial de cada cliente es su saldo en el origen menos lo
 *   que entra como factura, así que la suma en ArgosIsp debe ser la del origen; el reporte lo
 *   compara cliente por cliente.
 */

export interface OpcionesImportacion {
    /**
     * Nombre del sistema de origen (`mikrowisp`, `smartisp`, `csv` o el `--sistema` de un CSV):
     * `core.ids_externos.sistema`, prefijo de las claves externas y del request_id. Mismo origen y
     * mismo id = misma entidad; otro origen = otra entidad.
     */
    sistema: string
    dryRun: boolean
    /** `ninguno` (por defecto): los servicios entran solo con IPv4. `plan`: modo IPv6 por defecto del plan */
    ipv6?: 'ninguno' | 'plan'
    /** no crear planes: los que no existan en ArgosIsp (por nombre o `equivale_a`) quedan sin equivalente */
    soloPlanesExistentes?: boolean
    /** archivo o directorio de origen, solo para el reporte */
    fuente?: string | null
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
    /**
     * Empresa (`core.empresas`) a la que se asigna todo lo importado (`--empresa=<id|nit>`):
     * servicios (y con ellos sus facturas, pagos y promesas), la empresa sugerida de las zonas y
     * routers nuevos, la auditoría y el archivo del origen. Sin ella: la única empresa activa; con
     * varias, la corrida falla antes de tocar nada (`EmpresaImportacionRequerida`).
     */
    empresa?: number | string | null
    /**
     * Tablas del origen que no se guardan en el archivo (`--excluir-tablas=radacct,logs`): no se
     * archivan ni se cuentan en el cuadre por tabla, y el reporte las lista. Solo tablas que no
     * llevan nada a ArgosIsp (las que el adaptador vincula a clientes, servicios, facturas… no se
     * pueden excluir). El volcado original queda como respaldo.
     */
    excluirTablas?: string[]
}

export const PENDIENTE = [
    'Estado de los servicios suspendidos en el origen: se aplica con las facturas importadas en la siguiente evaluación (evaluarEstadoServicio de A3).',
]

/** Servicios sin PPPoE: necesitan `core.servicios.tipo_conexion` (modelo de A1, semana 2). */
async function admiteTipoConexion(trx: TransactionClientContract): Promise<boolean> {
    const r = (await trx.rawQuery(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'core' AND table_name = 'servicios' AND column_name = 'tipo_conexion'`,
    )) as { rows: Array<{ n: number }> }
    return r.rows[0]?.n === 1
}

export async function importar(
    fuente: FuenteCanonica,
    opciones: OpcionesImportacion,
): Promise<ReporteImportacion> {
    if (!SISTEMA_VALIDO.test(opciones.sistema)) {
        throw new Error(
            `Sistema de origen "${opciones.sistema}" inválido: minúsculas, dígitos y _ (hasta 40)`,
        )
    }
    const requestId = `importacion-${opciones.sistema}-${randomUUID()}`
    const inicio = new Date().toISOString()
    const excluidas = tablasExcluidas(fuente, opciones.excluirTablas ?? [])

    // Con transacción externa (pruebas) se trabaja en un savepoint de ella.
    const trx = opciones.trx ? await opciones.trx.transaction() : await db.transaction()
    let reporte: ReporteImportacion
    try {
        const empresa = await resolverEmpresaImportacion(trx, opciones.empresa)
        // La empresa de la corrida es la "empresa activa": la auditoría la registra y las acciones
        // que no dependen de un servicio (A3) la toman de aquí.
        const ctx: ContextoAccion = {
            actor: { tipo: 'sistema', id: null },
            canal: 'consola',
            requestId,
            empresaId: empresa.id,
        }
        const ids = opciones.idsExternos ?? (await idsExternosDe(trx, opciones.sistema))
        const importador = new Importador(
            fuente,
            opciones,
            ctx,
            trx,
            ids,
            await admiteTipoConexion(trx),
            empresa,
            excluidas,
        )
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

export interface EmpresaImportacion {
    id: number
    nombre: string
    nit: string | null
}

/** La corrida no sabe a qué empresa asignar lo importado (o la indicada no sirve). */
export class EmpresaImportacionRequerida extends Error {}

/**
 * Empresa de la corrida: `--empresa=<id|nit>` (primero por id; si no, por NIT normalizado) o, sin
 * ella, la única empresa activa. Con varias activas y sin `--empresa`, falla con la lista.
 */
export async function resolverEmpresaImportacion(
    trx: TransactionClientContract,
    valor: number | string | null | undefined,
): Promise<EmpresaImportacion> {
    type Fila = { id: number; nombre_comercial: string; nit: string | null; activa: boolean }
    const columnas = ['id', 'nombre_comercial', 'nit', 'activa']
    const aEmpresa = (f: Fila): EmpresaImportacion => ({
        id: Number(f.id),
        nombre: f.nombre_comercial,
        nit: f.nit,
    })
    const texto = valor === null || valor === undefined ? '' : String(valor).trim()
    if (!texto) {
        const activas = (await trx
            .from('core.empresas')
            .where('activa', true)
            .orderBy('id')
            .select(columnas)) as Fila[]
        if (activas.length === 1) return aEmpresa(activas[0]!)
        if (activas.length === 0) {
            throw new EmpresaImportacionRequerida('No hay ninguna empresa activa en core.empresas')
        }
        const lista = activas
            .map((e) => `${e.id} (${e.nombre_comercial}${e.nit ? `, NIT ${e.nit}` : ''})`)
            .join(', ')
        throw new EmpresaImportacionRequerida(
            `Hay ${activas.length} empresas activas: ${lista}. Indica a cuál se asigna lo importado con --empresa=<id|nit>.`,
        )
    }
    let fila: Fila | null = null
    if (/^\d+$/.test(texto) && Number(texto) <= 2_147_483_647) {
        fila = (await trx
            .from('core.empresas')
            .where('id', Number(texto))
            .select(columnas)
            .first()) as Fila | null
    }
    if (!fila) {
        const nit = texto.replace(/[\s-]/g, '').toUpperCase()
        fila = (await trx
            .from('core.empresas')
            .whereRaw(`upper(replace(replace(coalesce(nit, ''), '-', ''), ' ', '')) = ?`, [nit])
            .orderBy([
                { column: 'activa', order: 'desc' },
                { column: 'id', order: 'asc' },
            ])
            .select(columnas)
            .first()) as Fila | null
    }
    if (!fila) {
        throw new EmpresaImportacionRequerida(`--empresa=${texto}: no hay ninguna empresa con ese id o NIT`)
    }
    if (!fila.activa) {
        throw new EmpresaImportacionRequerida(
            `--empresa=${texto}: la empresa ${fila.id} (${fila.nombre_comercial}) está desactivada`,
        )
    }
    return aEmpresa(fila)
}

export interface TablaExcluida {
    tabla: string
    filas: number
}

/**
 * Valida `--excluir-tablas` contra el archivo del origen: cada tabla debe estar en el volcado y no
 * llevar nada a ArgosIsp (sin filas vinculadas a una entidad). Lanza con el motivo.
 */
export function tablasExcluidas(fuente: FuenteCanonica, nombres: string[]): TablaExcluida[] {
    const pedidas = [...new Set(nombres.map((n) => n.trim().toLowerCase()).filter(Boolean))]
    if (pedidas.length === 0) return []
    if (!fuente.archivo) {
        throw new Error('--excluir-tablas solo aplica a los volcados SQL (el origen csv no tiene archivo)')
    }
    const vinculadas = new Set([...fuente.archivo.vinculos.keys()].map((clave) => clave.split('#')[0]!))
    const salida: TablaExcluida[] = []
    for (const nombre of pedidas) {
        const tabla = fuente.archivo.tablas.find((t) => t.tabla === nombre)
        if (!tabla) throw new Error(`--excluir-tablas: la tabla ${nombre} no está en el volcado`)
        if (vinculadas.has(nombre)) {
            throw new Error(
                `--excluir-tablas: ${nombre} no se puede excluir; sus filas se importan a ArgosIsp (solo se excluyen tablas que quedan solo en el archivo, como radacct o los logs)`,
            )
        }
        salida.push({ tabla: nombre, filas: tabla.filas.length })
    }
    return salida
}

/** Igual que la restricción de `core.ids_externos.sistema`. */
const SISTEMA_VALIDO = /^[a-z0-9_]{1,40}$/

class Importador {
    readonly reporte: ReporteImportacion
    /** sistema de origen: prefijo de las claves externas */
    readonly sistema: string
    readonly #routers = new Map<string, number>()
    readonly #planes = new Map<string, number>()
    readonly #clientes = new Map<string, number>()
    readonly #zonas = new Map<string, number>()
    /** servicio_origen → servicio de ArgosIsp (creado o ya importado) */
    readonly #servicios = new Map<string, number>()
    /** servicio de ArgosIsp → su empresa (la de la corrida, o otra si ya estaba importado allí) */
    readonly #empresaServicio = new Map<number, number>()
    /** plantilla de los servicios nuevos (resuelta una vez) */
    #plantilla: number | null = null
    /** planes del origen que no se pueden usar: plan_origen → motivo */
    readonly #planesSinEquivalente = new Map<string, { nombre: string | null; motivo: string }>()
    readonly #carga: CargaFinanciera
    /** índices del origen (evitan recorrer las listas en cada fila) */
    readonly #servicioOrigen: Map<string, ServicioOrigen>
    readonly #serviciosPorCliente: Map<string, ServicioOrigen[]>
    /**
     * Clientes del origen en modo B (`contratos/importacion.md`): pagaron algo o tienen facturas
     * pagadas por un pago del origen. Sus facturas entran por su total, los pagos como pagos
     * históricos y el saldo inicial cubre solo la diferencia que quede. Vacío si no se importan
     * pagos (todos en modo A: facturas por lo pendiente y saldo inicial).
     */
    readonly #modoB = new Set<string>()
    /** facturas del origen que cubre algún pago (en modo B entran aunque estén pagadas) */
    readonly #facturasCubiertas = new Set<string>()
    /** factura del origen → factura de ArgosIsp (creada o ya importada) */
    readonly #facturas = new Map<string, number>()
    /**
     * factura del origen → empresa con la que se importó (o con la que ya estaba). Es la de la
     * corrida salvo las facturas de un servicio ya importado en otra empresa: van con su servicio
     * (A3 rechaza otra con `empresa_servicio`). Los pagos y promesas de esa factura la siguen.
     */
    readonly #empresaFactura = new Map<string, number>()
    /**
     * lo que toca esta corrida → empresa esperada (verificación por empresa del reporte). null =
     * ya importado por una corrida anterior: queda donde está (no se mueve) y solo se cuenta.
     */
    readonly #esperado = {
        facturas: new Map<number, { id_origen: string; empresa_id: number | null }>(),
        pagos: new Map<number, { id_origen: string; empresa_id: number | null }>(),
        promesas: new Map<number, { id_origen: string; empresa_id: number | null }>(),
        /** clave externa del saldo inicial → cliente del origen (los nuevos, en la empresa de la corrida) */
        saldos: new Map<string, { id_origen: string; existente: boolean }>(),
    }
    /** dueño de cada factura del origen (incluidas pagadas o anuladas si el origen lo sabe) */
    readonly #duenos: Map<string, string>
    /** resultado de cada entidad canónica (`<entidad>:<id>`), para el archivo y el cuadre por tabla */
    readonly #resultados = new Map<string, ResultadoEntidad>()
    /** modo A: lo pendiente que entró como factura, por cliente del origen */
    readonly #cargadoModoA = new Map<string, Dec>()
    /** `servicio:periodo` ya facturados en esta corrida (la segunda entra como cargo único) */
    readonly #periodosUsados = new Set<string>()
    /** factura del origen → lo que la cubren los pagos del origen */
    readonly #cubierto = new Map<string, Dec>()

    constructor(
        private readonly fuente: FuenteCanonica,
        private readonly opciones: OpcionesImportacion,
        private readonly ctx: ContextoAccion,
        private readonly trx: TransactionClientContract,
        private readonly ids: IdsExternos,
        private readonly tipoConexion: boolean,
        private readonly empresa: EmpresaImportacion,
        private readonly excluidas: TablaExcluida[],
    ) {
        this.sistema = opciones.sistema
        this.#carga = opciones.carga ?? cargaFinancieraA3
        this.#servicioOrigen = new Map(fuente.servicios.map((s) => [s.id, s]))
        this.#serviciosPorCliente = agrupar(fuente.servicios, (s) => s.cliente_id)
        this.#duenos = fuente.duenosFacturas ?? new Map(fuente.facturas.map((f) => [f.id, f.cliente_id]))
        if (this.#carga.registrarPagoHistorico) {
            // Modo B por defecto (decisión del PM: traer todo): todas las facturas, todos los pagos.
            for (const c of fuente.clientes) this.#modoB.add(c.id)
            for (const f of fuente.facturas) this.#modoB.add(f.cliente_id)
            for (const p of fuente.pagos) {
                this.#modoB.add(p.cliente_id)
                if (!p.factura_id) continue
                this.#facturasCubiertas.add(p.factura_id)
                const dueno = this.#duenos.get(p.factura_id)
                if (dueno) this.#modoB.add(dueno)
            }
        }
        for (const p of fuente.pagos) {
            if (!p.factura_id) continue
            this.#cubierto.set(p.factura_id, (this.#cubierto.get(p.factura_id) ?? new D(0)).plus(p.monto))
        }
        const zonas = new Set(fuente.clientes.map((c) => c.zona).filter(Boolean))
        this.reporte = {
            modo: opciones.dryRun ? 'en_seco' : 'real',
            request_id: ctx.requestId,
            inicio: '',
            fin: '',
            origen: opciones.sistema,
            fuente: opciones.fuente ?? null,
            empresa: { id: empresa.id, nombre: empresa.nombre, nit: empresa.nit },
            tablas_excluidas: excluidas,
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
                promesas: conteoVacio(fuente.promesas.length),
            },
            notas_origen: fuente.notas ?? [],
            dinero: {
                origen: { facturado: '0.00', cobrado: '0.00', pendiente: '0.00', pagos: '0.00' },
                argosisp: {
                    facturado: '0.00',
                    cobrado: '0.00',
                    pendiente: '0.00',
                    pagos: '0.00',
                    saldos_iniciales: '0.00',
                },
                diferencia: { facturado: '0.00', cobrado: '0.00', pendiente: '0.00', pagos: '0.00' },
                explicacion: [],
            },
            tablas: [],
            ids_externos: ids.modo,
            saldos: {
                clientes: 0,
                suma_origen: '0.00',
                suma_importada: '0.00',
                diferencia: '0.00',
                cuadra: true,
            },
            empresas: {
                corrida: empresa.id,
                por_empresa: [],
                fuera_de_empresa: [],
                suma: '0.00',
                cuadra: true,
            },
            diferencias: {
                routers_sin_credenciales: [],
                clientes_nit_duplicado: [],
                servicios_sin_plan: [],
                pagos_cruzados: [],
                pagos_sin_factura: [],
                pagos_no_importados: [],
                ips_duplicadas: [],
                ips_fuera_de_red: [],
                ips_en_uso: [],
                ips_nuevas: [],
                planes_sin_equivalente: [],
                clientes_sin_nit: [],
                nit_invalidos: [],
                telefonos_invalidos: [],
                user_ppp_duplicados: [],
                servicios_suspendidos_origen: [],
                servicios_retirados_origen: [],
                referencias_faltantes: [],
                tipos_conexion_pendientes: [],
                facturas_a_saldo: [],
                facturas_cargo_unico: [],
                facturas_sin_cargo: [],
                facturas_saldadas_en_origen: [],
                promesas_no_importadas: [],
                saldos_distintos: [],
                servicios_otra_empresa: [],
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
        // Orden del contrato: facturas → pagos → saldo inicial (el del modo B depende de los
        // pagos) → promesas (su avance ignora los pagos anteriores a su creación).
        await this.facturas()
        await this.pagos()
        await this.saldos()
        await this.promesas()
        await this.compararSaldos()
        await this.verificarEmpresas()
        await this.cuadrarDinero()
        await this.archivar()
    }

    /** Anota el resultado de una entidad canónica (para el archivo del origen y el cuadre por tabla). */
    #marcar(entidad: Entidad, id: string, resultado: ResultadoEntidad) {
        this.#resultados.set(claveResultado(entidad, id), resultado)
    }

    /**
     * Archivo del origen: guarda cada fila del origen en `importacion.filas_origen` con su mapeo y
     * cuenta cada tabla (leídas = creadas + existentes + al saldo + solo archivo + omitidas). Si
     * alguna fila no quedó contada, lanza y la corrida no guarda nada.
     */
    async archivar() {
        if (!this.fuente.archivo) return
        const excluir = new Set(this.excluidas.map((t) => t.tabla))
        this.reporte.tablas = await archivarYCuadrar({
            sistema: this.sistema,
            archivo: {
                ...this.fuente.archivo,
                tablas: this.fuente.archivo.tablas.filter((t) => !excluir.has(t.tabla)),
            },
            empresaId: this.empresa.id,
            resultados: this.#resultados,
            problemas: this.fuente.problemas,
            ctx: this.ctx,
            trx: this.trx,
        })
    }

    /**
     * Agrega `externo: { sistema, id }` a la entrada de la acción de alta (A1 guarda
     * el vínculo en `core.ids_externos` en la misma transacción) cuando la tabla existe.
     */
    #conExterno<T extends object>(entidad: EntidadExterna, idOrigen: string, entrada: T): T {
        const externo = this.ids.externo(entidad, idOrigen)
        return externo ? ({ ...entrada, externo } as T) : entrada
    }

    /** Busca primero en ids externos; si no, `natural`. */
    async #existente(
        entidad: EntidadExterna,
        idOrigen: string,
        natural: () => Promise<number | null>,
    ): Promise<number | null> {
        return (await this.ids.buscar(entidad, idOrigen)) ?? (await natural())
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
                id_origen: '-',
                accion: 'servicios.crear',
                mensaje:
                    'Hay varias plantillas de facturación: los servicios nuevos entran sin plantilla y sus facturas no se importan. Indica --plantilla=<id>',
            })
        }
    }

    /** Corre una acción en savepoint; si falla, anota el error y devuelve null. */
    async #accion<T>(
        entidad: string,
        idOrigen: string,
        nombre: string,
        fn: () => Promise<T>,
    ): Promise<T | null> {
        try {
            return await fn()
        } catch (error) {
            this.reporte.errores.push({
                entidad,
                id_origen: idOrigen,
                accion: nombre,
                mensaje: mensajeDe(error),
            })
            return null
        }
    }

    async routers() {
        const conteo = this.reporte.resumen.routers
        for (const r of this.fuente.routers) {
            // Sin RADIUS (`api`) el secreto RADIUS no hace falta; usuario y clave de la API sí (secrets)
            const credenciales =
                r.modo_seguridad === 'api'
                    ? (['api_usuario', 'api_password'] as const)
                    : (['api_usuario', 'api_password', 'radius_secret'] as const)
            const faltan = credenciales.filter((c) => !r[c])
            if (faltan.length > 0) {
                this.reporte.diferencias.routers_sin_credenciales.push({
                    router_origen: r.id,
                    nombre: r.nombre,
                    faltan: [...faltan],
                })
            }
            const existente = await this.#existente('router', r.id, async () => {
                const fila = (await this.trx
                    .from('network.routers')
                    .where((q) => {
                        q.where('nombre', r.nombre)
                        if (r.nas_ip) q.orWhereRaw('nas_ip = ?::inet', [r.nas_ip])
                    })
                    .select('id')
                    .first()) as { id: number } | null
                return fila ? Number(fila.id) : null
            })
            if (existente) {
                this.#routers.set(r.id, existente)
                conteo.existentes++
                this.#marcar('routers', r.id, {
                    estado: 'existente',
                    entidad_tipo: 'router',
                    entidad_id: existente,
                })
                continue
            }
            const creado = await this.#accion('router', r.id, 'routers.crear', () =>
                new CrearRouter().execute(
                    this.#conExterno('router', r.id, {
                        nombre: r.nombre,
                        host: r.host,
                        nas_ip: r.nas_ip,
                        modo_seguridad: r.modo_seguridad,
                        api_usuario: r.api_usuario,
                        api_password: r.api_password,
                        radius_secret: r.radius_secret,
                        empresa_sugerida_id: this.empresa.id,
                    }),
                    this.ctx,
                    { trx: this.trx },
                ),
            )
            if (creado) {
                this.#routers.set(r.id, creado.id)
                await this.ids.registrar('router', r.id, creado.id)
                conteo.creados++
                this.#marcar('routers', r.id, {
                    estado: 'creado',
                    entidad_tipo: 'router',
                    entidad_id: creado.id,
                })
            } else {
                conteo.omitidos++
                this.#marcar('routers', r.id, {
                    estado: 'omitido',
                    motivo: 'la acción lo rechazó (ver errores)',
                })
            }
        }
    }

    async redes() {
        const conteo = this.reporte.resumen.redes
        for (const red of this.fuente.redes) {
            const idOrigen = `${red.router_id}:${red.cidr}`
            const linea = `L${red.linea}`
            const routerId = this.#routers.get(red.router_id)
            if (!routerId) {
                this.#faltante('red', idOrigen, 'router', red.router_id)
                conteo.omitidos++
                this.#marcar('redes', linea, {
                    estado: 'omitido',
                    motivo: `falta el router ${red.router_id}`,
                })
                continue
            }
            const existente = (await this.trx
                .from('network.redes_ipv4')
                .where('router_id', routerId)
                .whereRaw('cidr = network(?::inet)', [red.cidr])
                .select('id')
                .first()) as { id: number } | null
            if (existente) {
                conteo.existentes++
                this.#marcar('redes', linea, {
                    estado: 'existente',
                    entidad_tipo: 'red_ipv4',
                    entidad_id: Number(existente.id),
                })
                continue
            }
            const creada = await this.#accion('red', idOrigen, 'redes.crear', () =>
                new CrearRedIpv4().execute(
                    { router_id: routerId, cidr: red.cidr, gateway: red.gateway, tipo: red.tipo },
                    this.ctx,
                    { trx: this.trx },
                ),
            )
            if (creada) {
                conteo.creados++
                this.#marcar('redes', linea, {
                    estado: 'creado',
                    entidad_tipo: 'red_ipv4',
                    entidad_id: Number(creada.id),
                })
            } else {
                conteo.omitidos++
                this.#marcar('redes', linea, {
                    estado: 'omitido',
                    motivo: 'la acción la rechazó (ver errores)',
                })
            }
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
                this.#marcar('planes', p.id, {
                    estado: 'existente',
                    entidad_tipo: 'plan',
                    entidad_id: existente,
                })
                continue
            }
            if (p.equivale_a || this.opciones.soloPlanesExistentes) {
                const motivo = p.equivale_a
                    ? `equivale_a "${p.equivale_a}" no existe en ArgosIsp`
                    : 'no existe en ArgosIsp un plan con ese nombre'
                this.#planesSinEquivalente.set(p.id, { nombre: p.nombre, motivo })
                conteo.omitidos++
                this.#marcar('planes', p.id, { estado: 'omitido', motivo })
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
                this.#marcar('planes', p.id, {
                    estado: 'creado',
                    entidad_tipo: 'plan',
                    entidad_id: creado.id,
                })
            } else {
                this.#marcar('planes', p.id, {
                    estado: 'omitido',
                    motivo: 'la acción lo rechazó (ver errores)',
                })
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
        for (const [planOrigen, { nombre, motivo }] of this.#planesSinEquivalente) {
            this.reporte.diferencias.planes_sin_equivalente.push({
                plan_origen: planOrigen,
                nombre,
                motivo,
                servicios: this.fuente.servicios.filter(
                    (s) => s.plan_id === planOrigen && s.estado !== 'retirado',
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
                new CrearZona().execute({ nombre, empresa_sugerida_id: this.empresa.id }, this.ctx, {
                    trx: this.trx,
                }),
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
            d.clientes_nit_duplicado.push({ nit, clientes_origen: grupo.map((x) => x.c.id) })
        }
        for (const c of this.fuente.clientes) {
            const existente = await this.#existente('cliente', c.id, async () => {
                const fila = (await this.trx
                    .from('core.clientes')
                    .whereRaw(`campos_personalizados->>? = ?`, [`${this.sistema}_id`, c.id])
                    .select('id')
                    .first()) as { id: number } | null
                return fila ? Number(fila.id) : null
            })

            const { nit, motivo } = revisarNit(c)
            if (!c.nit) d.clientes_sin_nit.push({ cliente_origen: c.id, nombre: c.nombre })
            if (motivo) d.nit_invalidos.push({ cliente_origen: c.id, nombre: c.nombre, nit: c.nit!, motivo })
            // Teléfonos (pedido A14 de Iris): `CrearCliente` normaliza los válidos y, en canal
            // `consola`, guarda tal cual los que no cumplen; aquí solo se reportan.
            for (const campo of ['telefono', 'movil'] as const) {
                const valor = c[campo]?.trim()
                if (valor && normalizarTelefono(valor) === null) {
                    d.telefonos_invalidos.push({
                        cliente_origen: c.id,
                        nombre: c.nombre,
                        campo,
                        telefono: valor,
                    })
                }
            }

            if (existente) {
                this.#clientes.set(c.id, existente)
                conteo.existentes++
                this.#marcar('clientes', c.id, {
                    estado: 'existente',
                    entidad_tipo: 'cliente',
                    entidad_id: existente,
                })
                continue
            }
            const campos: Record<string, unknown> = { [`${this.sistema}_id`]: c.id }
            if (motivo) campos[`${this.sistema}_nit`] = c.nit
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
                this.#marcar('clientes', c.id, {
                    estado: 'creado',
                    entidad_tipo: 'cliente',
                    entidad_id: creado.id,
                })
            } else {
                conteo.omitidos++
                this.#marcar('clientes', c.id, {
                    estado: 'omitido',
                    motivo: 'la acción lo rechazó (ver errores)',
                })
            }
        }
    }

    async servicios() {
        const conteo = this.reporte.resumen.servicios
        const d = this.reporte.diferencias
        const vigentes = this.fuente.servicios.filter((s) => s.estado !== 'retirado')
        for (const s of this.fuente.servicios) {
            if (s.estado === 'retirado') {
                d.servicios_retirados_origen.push({ servicio_origen: s.id, user_ppp: etiqueta(s) })
            }
            if (s.estado === 'suspendido') {
                d.servicios_suspendidos_origen.push({ servicio_origen: s.id, user_ppp: etiqueta(s) })
            }
        }

        // Duplicados dentro del origen: gana el primero del archivo.
        const omitir = new Set<string>()
        for (const [ip, grupo] of agrupar(
            vigentes.filter((s) => s.ip),
            (s) => s.ip!,
        )) {
            if (grupo.length < 2) continue
            d.ips_duplicadas.push({ ip, servicios_origen: grupo.map((s) => s.id), importado_origen: null })
        }
        const conPpp = vigentes.filter((s) => s.user_ppp)
        for (const [userPpp, grupo] of agrupar(conPpp, (s) => s.user_ppp!.toLowerCase())) {
            if (grupo.length < 2) continue
            d.user_ppp_duplicados.push({
                user_ppp: userPpp,
                servicios_origen: grupo.map((s) => s.id),
                motivo: `repetido en el origen; se importa ${grupo[0]!.id}`,
            })
            for (const s of grupo.slice(1)) omitir.add(s.id)
        }
        const ipTomada = new Map<string, string>()

        const implementadas = new Set<string>()
        for (const s of this.fuente.servicios) {
            const omitido = (motivo: string) => {
                conteo.omitidos++
                this.#marcar('servicios', s.id, { estado: 'omitido', motivo })
            }
            if (s.estado === 'retirado') {
                omitido('retirado en el origen')
                continue
            }
            if (omitir.has(s.id)) {
                omitido(`user_ppp ${s.user_ppp} repetido en el origen: entra el primero`)
                continue
            }
            if (s.plan_id === null) {
                d.servicios_sin_plan.push({
                    servicio_origen: s.id,
                    cliente_origen: s.cliente_id,
                    etiqueta: etiqueta(s),
                })
                omitido('sin plan en el origen')
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
                const faltan = [
                    !clienteId ? `cliente ${s.cliente_id}` : null,
                    !routerId ? `router ${s.router_id}` : null,
                    !planId ? `plan ${s.plan_id} (sin equivalente)` : null,
                ].filter(Boolean)
                omitido(`falta ${faltan.join(', ')}`)
                continue
            }
            if (s.tipo_conexion !== 'pppoe' && !this.tipoConexion) {
                const motivo = 'ArgosIsp aún no tiene tipo_conexion (modelo de A1); se importa cuando llegue'
                d.tipos_conexion_pendientes.push({
                    servicio_origen: s.id,
                    tipo_conexion: s.tipo_conexion,
                    motivo,
                })
                omitido(motivo)
                continue
            }

            const porId = await this.ids.buscar('servicio', s.id)
            const existente = porId
                ? ((await this.trx
                      .from('core.servicios')
                      .where('id', porId)
                      .select('id', 'cliente_id', 'empresa_id')
                      .first()) as { id: number; cliente_id: number; empresa_id: number } | null)
                : await this.#servicioExistente(s, clienteId)
            if (existente) {
                if (Number(existente.cliente_id) === clienteId) {
                    if (Number(existente.empresa_id) !== this.empresa.id) {
                        // Ya importado en otra empresa: no se mueve (servicios.cambiar_empresa es
                        // una acción explícita del panel); el reporte lo avisa.
                        d.servicios_otra_empresa.push({
                            servicio_origen: s.id,
                            servicio_id: Number(existente.id),
                            empresa_id: Number(existente.empresa_id),
                        })
                    }
                    conteo.existentes++
                    this.#servicios.set(s.id, Number(existente.id))
                    this.#empresaServicio.set(Number(existente.id), Number(existente.empresa_id))
                    if (s.ip) ipTomada.set(s.ip, s.id)
                    this.#marcar('servicios', s.id, {
                        estado: 'existente',
                        entidad_tipo: 'servicio',
                        entidad_id: Number(existente.id),
                    })
                } else {
                    const motivo = `ya existe en ArgosIsp (servicio ${existente.id}) con otro cliente`
                    d.user_ppp_duplicados.push({
                        user_ppp: etiqueta(s),
                        servicios_origen: [s.id],
                        motivo,
                    })
                    omitido(motivo)
                }
                continue
            }

            if (s.ip) {
                if (!(await this.#ipDisponible(s, routerId, ipTomada))) {
                    omitido(`la IP ${s.ip} está repetida, en uso o fuera de las redes del router`)
                    continue
                }
            }

            if (!(await this.#implementar(s, planId, routerId, implementadas))) {
                omitido('no se pudo implementar el plan en el router (ver errores)')
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
                empresa_id: this.empresa.id,
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
                omitido('la acción lo rechazó (ver errores)')
                continue
            }
            conteo.creados++
            this.#marcar('servicios', s.id, {
                estado: 'creado',
                entidad_tipo: 'servicio',
                entidad_id: creado.id,
            })
            this.#servicios.set(s.id, creado.id)
            this.#empresaServicio.set(creado.id, this.empresa.id)
            await this.ids.registrar('servicio', s.id, creado.id)
            if (s.ip) ipTomada.set(s.ip, s.id)
            else d.ips_nuevas.push({ servicio_origen: s.id, ip: creado.ipv4 })
        }

        for (const dup of d.ips_duplicadas) {
            dup.importado_origen = dup.servicios_origen.find((id) => ipTomada.get(dup.ip) === id) ?? null
        }
    }

    /** PPPoE por `user_ppp`; sin PPPoE por su IP vigente o, en dhcp_fija sin IP, por la MAC del cliente. */
    async #servicioExistente(
        s: ServicioOrigen,
        clienteId: number,
    ): Promise<{ id: number; cliente_id: number; empresa_id: number } | null> {
        if (s.tipo_conexion === 'pppoe') {
            return (await this.trx
                .from('core.servicios')
                .whereRaw('lower(user_ppp) = lower(?)', [s.user_ppp ?? ''])
                .select('id', 'cliente_id', 'empresa_id')
                .first()) as { id: number; cliente_id: number; empresa_id: number } | null
        }
        if (s.ip) {
            // Solo si es del mismo cliente; si es de otro, #ipDisponible lo reporta como IP en uso.
            return (await this.trx
                .from('network.ipv4_asignaciones as a')
                .join('core.servicios as sv', 'sv.id', 'a.servicio_id')
                .whereRaw('a.ip = ?::inet', [s.ip])
                .whereNull('a.fin')
                .where('sv.cliente_id', clienteId)
                .select('sv.id', 'sv.cliente_id', 'sv.empresa_id')
                .first()) as { id: number; cliente_id: number; empresa_id: number } | null
        }
        return (await this.trx
            .from('core.servicios')
            .whereRaw('mac = ?::macaddr', [s.mac ?? ''])
            .where('cliente_id', clienteId)
            .whereNot('estado', 'retirado')
            .select('id', 'cliente_id', 'empresa_id')
            .first()) as { id: number; cliente_id: number; empresa_id: number } | null
    }

    /**
     * Facturas. El servicio es el de la factura o, si no trae, el único servicio importado del
     * cliente. Ya importada = existe una factura con su `clave_externa`.
     *
     * - Modo B (por defecto, `#modoB`: todos los clientes cuando hay pago histórico): **todas**
     *   las facturas por su total, también las pagadas; los pagos históricos las saldan después.
     * - Modo A (sin acción de pago histórico): solo las pendientes, por lo pendiente.
     * - Todas por `ImportarFacturaPendiente` (contrato, «Importación completa: casos especiales»):
     *   con servicio y periodo es una factura de periodo; sin periodo (cargo único del origen),
     *   sin servicio (cliente retirado, servicio que no entró) o la segunda del mismo servicio y
     *   periodo (`cargo_unico`) es un cargo único con `emitida_en`; total 0 = sin cargo.
     * - Pagada en el origen sin ningún pago que la cubra: `saldada_en_origen` (pagada, sin
     *   asiento ni pago).
     */
    async facturas() {
        const conteo = this.reporte.resumen.facturas
        const d = this.reporte.diferencias
        const hoy = hoyGuatemala()
        for (const f of this.fuente.facturas) {
            const modoB = this.#modoB.has(f.cliente_id)
            const pendiente = new D(f.pendiente).gt(0)
            const omitir = (motivo: string, estado: ResultadoEntidad['estado'] = 'omitido') => {
                conteo.omitidos++
                this.#marcar('facturas', f.id, { estado, motivo })
            }
            if (!modoB && !pendiente) {
                omitir('pagada en el origen: sin pagos históricos solo entra lo pendiente', 'solo_archivo')
                continue
            }
            const clienteId = this.#clientes.get(f.cliente_id)
            if (!clienteId) {
                this.#faltante('factura', f.id, 'cliente', f.cliente_id)
                omitir(`falta el cliente ${f.cliente_id}`)
                continue
            }
            const total = modoB ? f.total : f.pendiente
            const clave = this.#claveFactura(f.id)
            const ya = (await this.trx
                .from('billing.facturas')
                .where({ origen: this.sistema, clave_externa: clave })
                .select('id', 'empresa_id')
                .first()) as { id: number; empresa_id: number } | null

            // Servicio y periodo: sin servicio (cliente retirado, servicio que no entró) o sin
            // periodo es un cargo único del cliente; una segunda factura del mismo servicio y
            // periodo también (`cargo_unico`, con nota).
            const servicio = this.#resolverServicio(f)
            let periodo = servicio.id === null ? null : f.periodo
            let nota = f.nota
            let cargoUnico = false
            if (servicio.id !== null && periodo) {
                const usado = `${servicio.id}:${periodo}`
                if (this.#periodosUsados.has(usado)) {
                    cargoUnico = true
                    nota = `segunda factura del servicio en el periodo ${periodo.slice(0, 7)}: entra como cargo único`
                } else this.#periodosUsados.add(usado)
            }
            if (servicio.id === null && f.periodo && !nota) {
                nota = `sin servicio en ArgosIsp (${servicio.motivo}): entra como cargo único del cliente`
            }
            if (periodo === null || cargoUnico) {
                d.facturas_cargo_unico.push({
                    factura_origen: f.id,
                    cliente_origen: f.cliente_id,
                    total,
                    nota,
                })
            }
            const sinCargo = new D(total).isZero()
            if (sinCargo) {
                d.facturas_sin_cargo.push({
                    factura_origen: f.id,
                    cliente_origen: f.cliente_id,
                    motivo: f.nota ?? 'total 0 en el origen: entra pagada, sin asiento',
                })
            }
            // Pagada en el origen sin ningún pago que la cubra: saldada en el origen (sin asiento).
            const saldada =
                modoB && !pendiente && !sinCargo && (this.#cubierto.get(f.id) ?? new D(0)).isZero()
            if (saldada) {
                d.facturas_saldadas_en_origen.push({
                    factura_origen: f.id,
                    cliente_origen: f.cliente_id,
                    total,
                })
            }
            // Empresa de la factura: la de la corrida (`--empresa`); la de su servicio si ese ya
            // estaba importado en otra (servicios_otra_empresa: la factura sigue a su servicio).
            const empresaId =
                servicio.id === null
                    ? this.empresa.id
                    : (this.#empresaServicio.get(servicio.id) ?? this.empresa.id)
            if (ya) {
                this.#facturas.set(f.id, Number(ya.id))
                this.#empresaFactura.set(f.id, Number(ya.empresa_id))
                this.#esperado.facturas.set(Number(ya.id), { id_origen: f.id, empresa_id: null })
                if (!modoB) this.#sumarModoA(f)
                conteo.existentes++
                this.#marcar('facturas', f.id, {
                    estado: 'existente',
                    entidad_tipo: 'factura',
                    entidad_id: Number(ya.id),
                })
                continue
            }

            let emitida = f.emitida ?? f.vence ?? hoy
            if (emitida > hoy) emitida = hoy
            const hecha = await this.#accion('factura', f.id, 'facturas.importar_pendiente', () =>
                this.#carga.importarFactura(
                    {
                        origen: this.sistema,
                        id_externo: clave,
                        empresa_id: empresaId,
                        servicio_id: servicio.id,
                        cliente_id: clienteId,
                        periodo,
                        cargo_unico: cargoUnico || undefined,
                        emitida_en: emitida,
                        total,
                        saldada_en_origen: saldada || undefined,
                        vence_en: f.vence ?? undefined,
                        concepto: [f.concepto, nota].filter(Boolean).join(' · ') || null,
                    },
                    this.ctx,
                    this.trx,
                ),
            )
            this.#facturaHecha(f, hecha?.factura_id ?? null, modoB, empresaId)
        }
    }

    /** Anota el resultado de una factura creada (o fallida: ya quedó en errores). */
    #facturaHecha(f: FacturaOrigen, facturaId: number | null, modoB: boolean, empresaId: number) {
        const conteo = this.reporte.resumen.facturas
        if (facturaId === null) {
            conteo.omitidos++
            this.#marcar('facturas', f.id, {
                estado: 'omitido',
                motivo: 'la acción la rechazó (ver errores)',
            })
            return
        }
        this.#facturas.set(f.id, facturaId)
        this.#empresaFactura.set(f.id, empresaId)
        this.#esperado.facturas.set(facturaId, { id_origen: f.id, empresa_id: empresaId })
        if (!modoB) this.#sumarModoA(f)
        conteo.creados++
        this.#marcar('facturas', f.id, { estado: 'creado', entidad_tipo: 'factura', entidad_id: facturaId })
    }

    /** Modo A: lo pendiente que ya entró como factura (el saldo inicial cubre el resto). */
    #sumarModoA(f: FacturaOrigen) {
        this.#cargadoModoA.set(
            f.cliente_id,
            (this.#cargadoModoA.get(f.cliente_id) ?? new D(0)).plus(f.pendiente),
        )
    }

    /** Servicio de ArgosIsp de la factura, o null con el motivo (sin anotar nada). */
    #resolverServicio(f: FacturaOrigen): { id: number | null; motivo: string | null } {
        if (f.servicio_id) {
            const servicio = this.#servicioOrigen.get(f.servicio_id)
            if (!servicio || servicio.cliente_id !== f.cliente_id) {
                return { id: null, motivo: `el servicio ${f.servicio_id} no es del cliente en el origen` }
            }
            const id = this.#servicios.get(f.servicio_id)
            return id
                ? { id, motivo: null }
                : { id: null, motivo: `el servicio ${f.servicio_id} no se importó` }
        }
        const delCliente = (this.#serviciosPorCliente.get(f.cliente_id) ?? [])
            .filter((s) => this.#servicios.has(s.id))
            .map((s) => this.#servicios.get(s.id)!)
        const unicos = [...new Set(delCliente)]
        if (unicos.length === 1) return { id: unicos[0]!, motivo: null }
        return {
            id: null,
            motivo:
                unicos.length === 0
                    ? 'el cliente no tiene servicios importados'
                    : `sin servicio_id y el cliente tiene ${unicos.length} servicios`,
        }
    }

    /**
     * Pagos del origen por `RegistrarPagoHistorico` (A3, modo B): con su fecha original y
     * `facturas: [id]` de la factura que cubrió en ArgosIsp (puede ser de otro cliente). El pago
     * mueve el libro (`2.9.01 / CxC + Anticipos`), no la caja. Si su factura no entró, el dinero
     * queda a favor del pagador (`pagos_sin_factura`) y el saldo inicial lo compensa. Ya
     * importado = existe un pago con su `clave_externa`. Sin la acción (`registrarPagoHistorico`
     * null), los pagos no se importan y todos los clientes van en modo A.
     *
     * Después, cada factura pagada en el origen cuyo pago no está registrado ahí (o lo está por
     * menos) entra con un pago por la diferencia, marcado "sin registro de pago en el origen".
     */
    async pagos() {
        const conteo = this.reporte.resumen.pagos
        const d = this.reporte.diferencias
        for (const p of this.fuente.pagos) {
            const dueno = p.factura_id ? this.#duenos.get(p.factura_id) : undefined
            if (p.factura_id && dueno && dueno !== p.cliente_id) {
                d.pagos_cruzados.push({
                    pago_origen: p.id,
                    pagador_origen: p.cliente_id,
                    factura_origen: p.factura_id,
                    dueno_origen: dueno,
                    monto: p.monto,
                })
            }
        }
        const registrar = this.#carga.registrarPagoHistorico
        if (!registrar) {
            conteo.omitidos = this.fuente.pagos.length
            for (const p of this.fuente.pagos) {
                this.#marcar('pagos', p.id, {
                    estado: 'solo_archivo',
                    motivo: 'sin acción de pago histórico: lo pendiente de cada factura ya lo descuenta',
                })
            }
            if (this.fuente.pagos.length > 0) {
                this.reporte.pendiente.push(
                    `Pagos históricos: ${this.fuente.pagos.length} pagos del origen no se importan (sin acción de pago histórico). No cambia saldos: lo pendiente de cada factura ya los descuenta.`,
                )
            }
            return
        }
        for (const p of this.fuente.pagos) {
            const omitir = (motivo: string) => {
                conteo.omitidos++
                this.#marcar('pagos', p.id, { estado: 'omitido', motivo })
            }
            const clienteId = this.#clientes.get(p.cliente_id)
            if (!clienteId) {
                this.#faltante('pago', p.id, 'cliente', p.cliente_id)
                omitir(`falta el cliente ${p.cliente_id}`)
                continue
            }
            if (!p.fecha) {
                const motivo = 'sin fecha en el origen (el pago histórico la exige)'
                d.pagos_no_importados.push({
                    pago_origen: p.id,
                    cliente_origen: p.cliente_id,
                    monto: p.monto,
                    motivo,
                })
                omitir(`${motivo}; el saldo inicial lo compensa`)
                continue
            }
            const clave = `${this.sistema}:pago:${p.id}`
            const ya = await this.#pagoExistente(clave)
            const facturaId = p.factura_id ? this.#facturas.get(p.factura_id) : undefined
            // Un pago es de una sola empresa: la de su factura (la de la corrida salvo una factura
            // de un servicio en otra empresa); sin factura, la de la corrida.
            const empresaId =
                facturaId === undefined
                    ? this.empresa.id
                    : (this.#empresaFactura.get(p.factura_id!) ?? this.empresa.id)
            if (ya !== null) {
                this.#esperado.pagos.set(ya, { id_origen: p.id, empresa_id: null })
                conteo.existentes++
                this.#marcar('pagos', p.id, { estado: 'existente', entidad_tipo: 'pago', entidad_id: ya })
                continue
            }
            if (p.factura_id && facturaId === undefined) {
                d.pagos_sin_factura.push({
                    pago_origen: p.id,
                    factura_origen: p.factura_id,
                    monto: p.monto,
                    motivo: 'la factura no se importó: el pago queda a favor del cliente y el saldo inicial lo compensa',
                })
            }
            const metodo = metodoPago(p.metodo)
            const hecho = await this.#accion('pago', p.id, 'pagos.registrar_historico', () =>
                registrar(
                    {
                        historico: true,
                        origen: this.sistema,
                        id_externo: clave,
                        empresa_id: empresaId,
                        cliente_id: clienteId,
                        metodo,
                        monto: p.monto,
                        fecha: p.fecha!,
                        nota: `Pago histórico importado de ${this.sistema} (${p.id})${
                            p.metodo ? ` · forma de pago en el origen: ${p.metodo}` : ''
                        }`,
                        facturas: facturaId === undefined ? [] : [facturaId],
                    },
                    this.ctx,
                    this.trx,
                ),
            )
            if (hecho) {
                conteo.creados++
                this.#esperado.pagos.set(Number(hecho.id), { id_origen: p.id, empresa_id: empresaId })
                this.#marcar('pagos', p.id, {
                    estado: 'creado',
                    entidad_tipo: 'pago',
                    entidad_id: Number(hecho.id),
                })
            } else omitir('la acción lo rechazó (ver errores)')
        }
    }

    /** Id del pago ya importado con esa clave, o null. */
    async #pagoExistente(clave: string): Promise<number | null> {
        if (
            this.#carga.existePagoHistorico &&
            !(await this.#carga.existePagoHistorico(this.sistema, clave, this.trx))
        ) {
            return null
        }
        const fila = (await this.trx
            .from('billing.pagos')
            .where({ origen: this.sistema, clave_externa: clave })
            .select('id')
            .first()) as { id: number } | null
        return fila ? Number(fila.id) : null
    }

    /**
     * Promesas vigentes del origen (`ImportarPromesa` de A3) sobre facturas ya importadas, después
     * de pagos y saldo inicial (contrato). Las que A3 rechaza por no estar vigentes (`promesa_vencida`,
     * `sin_deuda`) o porque el servicio ya tiene una (`promesa_abierta`) quedan omitidas con el
     * motivo, no como error. Sin la acción, quedan solo en el archivo.
     */
    async promesas() {
        const conteo = this.reporte.resumen.promesas
        const d = this.reporte.diferencias
        const hoy = hoyGuatemala()
        for (const p of this.fuente.promesas) {
            const omitir = (motivo: string, estado: ResultadoEntidad['estado'] = 'omitido') => {
                conteo.omitidos++
                d.promesas_no_importadas.push({ promesa_origen: p.id, cliente_origen: p.cliente_id, motivo })
                this.#marcar('promesas', p.id, { estado, motivo })
            }
            if (!this.#clientes.get(p.cliente_id)) {
                this.#faltante('promesa', p.id, 'cliente', p.cliente_id)
                omitir(`falta el cliente ${p.cliente_id}`)
                continue
            }
            const facturaId = p.factura_id ? this.#facturas.get(p.factura_id) : undefined
            if (facturaId === undefined) {
                omitir(p.factura_id ? `la factura ${p.factura_id} no entró` : 'sin factura en el origen')
                continue
            }
            const importarPromesa = this.#carga.importarPromesa
            if (!importarPromesa) {
                omitir('sin acción para importar promesas: queda en el archivo', 'solo_archivo')
                continue
            }
            const clave = `${this.sistema}:promesa:${p.id}`
            const ya = (await this.trx
                .from('billing.promesas')
                .where({ origen: this.sistema, clave_externa: clave })
                .select('id')
                .first()) as { id: number } | null
            // La promesa es de la empresa del servicio de su factura (A3: `empresa_servicio`).
            const empresaId = this.#empresaFactura.get(p.factura_id!) ?? this.empresa.id
            if (ya) {
                this.#esperado.promesas.set(Number(ya.id), { id_origen: p.id, empresa_id: null })
                conteo.existentes++
                this.#marcar('promesas', p.id, {
                    estado: 'existente',
                    entidad_tipo: 'promesa',
                    entidad_id: Number(ya.id),
                })
                continue
            }
            let creada = p.fecha ?? hoy
            if (creada > hoy) creada = hoy
            try {
                const hecha = await importarPromesa(
                    {
                        origen: this.sistema,
                        id_externo: clave,
                        empresa_id: empresaId,
                        factura_id: facturaId,
                        vence: p.vence,
                        monto: p.monto,
                        creada_en: creada,
                    },
                    this.ctx,
                    this.trx,
                )
                conteo.creados++
                this.#esperado.promesas.set(hecha.id, { id_origen: p.id, empresa_id: empresaId })
                this.#marcar('promesas', p.id, {
                    estado: 'creado',
                    entidad_tipo: 'promesa',
                    entidad_id: hecha.id,
                })
            } catch (error) {
                const codigo = error instanceof Problema ? error.tipo.split(':').at(-1) : null
                if (codigo && ['promesa_vencida', 'sin_deuda', 'promesa_abierta'].includes(codigo)) {
                    omitir(`${codigo}: ${mensajeDe(error)}`)
                    continue
                }
                this.reporte.errores.push({
                    entidad: 'promesa',
                    id_origen: p.id,
                    accion: 'promesas.importar',
                    mensaje: mensajeDe(error),
                })
                omitir('la acción la rechazó (ver errores)')
            }
        }
    }

    /**
     * Saldo inicial por cliente (`RegistrarSaldoInicial` de A3), para que el saldo en ArgosIsp
     * sea el del origen:
     *
     * - Modo A: saldo del origen − lo que entró como factura pendiente. Sin fila en `saldos`, el
     *   saldo del origen es la suma de sus facturas pendientes (las sin servicio entran aquí).
     * - Modo B: saldo del origen − el saldo que ya tiene en ArgosIsp (CxC − anticipos) después de
     *   cargar sus facturas por su total y sus pagos históricos. Cubre lo que el historial no
     *   explica (abonos sin pago en el origen, una factura que no entró).
     */
    async saldos() {
        const conteo = this.reporte.resumen.saldos
        const conocidos = new Set(this.fuente.clientes.map((c) => c.id))
        for (const fila of this.fuente.saldos) {
            if (!conocidos.has(fila.cliente_id)) {
                this.#faltante('saldo', fila.cliente_id, 'cliente', fila.cliente_id)
                this.#marcar('saldos', fila.cliente_id, {
                    estado: 'omitido',
                    motivo: `el cliente ${fila.cliente_id} no está en el origen`,
                })
            }
        }
        for (const [clienteOrigen, origen] of this.#saldosOrigen()) {
            const clienteId = this.#clientes.get(clienteOrigen)
            if (!clienteId) {
                this.#marcar('saldos', clienteOrigen, {
                    estado: 'omitido',
                    motivo: `el cliente ${clienteOrigen} no se importó`,
                })
                continue // ya está en referencias faltantes o no se pudo importar el cliente
            }
            // El saldo del cliente queda en su cuenta de ArgosIsp (con o sin saldo inicial).
            this.#marcar('saldos', clienteOrigen, {
                estado: 'a_saldo',
                entidad_tipo: 'cliente',
                entidad_id: clienteId,
            })
            const clave = `${this.sistema}:saldo:${clienteOrigen}`
            const ya = await this.trx
                .from('billing.saldos_iniciales')
                .where({ origen: this.sistema, clave_externa: clave })
                .select('id')
                .first()
            if (ya) {
                this.#esperado.saldos.set(clave, { id_origen: clienteOrigen, existente: true })
                conteo.origen++
                conteo.existentes++
                continue
            }
            const cargado = this.#modoB.has(clienteOrigen)
                ? await this.#saldoArgos(clienteId)
                : (this.#cargadoModoA.get(clienteOrigen) ?? new D(0))
            const monto = origen.minus(cargado)
            if (monto.isZero()) continue
            conteo.origen++
            const hecho = await this.#accion('saldo', clienteOrigen, 'facturas.registrar_saldo_inicial', () =>
                this.#carga.registrarSaldoInicial(
                    {
                        origen: this.sistema,
                        id_externo: clave,
                        empresa_id: this.empresa.id,
                        cliente_id: clienteId,
                        monto: monto.toFixed(2),
                        descripcion: `Saldo inicial importado de ${this.sistema}`,
                    },
                    this.ctx,
                    this.trx,
                ),
            )
            if (hecho) {
                this.#esperado.saldos.set(clave, { id_origen: clienteOrigen, existente: false })
                conteo.creados++
            } else conteo.omitidos++
        }
    }

    /** Saldo del cliente en ArgosIsp dentro de la corrida: CxC − anticipos. */
    async #saldoArgos(clienteId: number): Promise<Dec> {
        const cxc = await saldoCliente(clienteId, this.trx)
        return cxc.minus(await saldoAnticipos(this.trx, clienteId))
    }

    /**
     * cliente_origen → saldo en el origen (`saldos` o suma de facturas pendientes). Los clientes
     * en modo B entran aunque no deban nada (0): sus pagos mueven el libro y hay que comprobarlo.
     */
    #saldosOrigen(): Map<string, Dec> {
        const saldos = new Map<string, Dec>()
        for (const c of this.#modoB) {
            if (this.#clientes.has(c)) saldos.set(c, new D(0))
        }
        for (const f of this.fuente.facturas) {
            if (new D(f.pendiente).lte(0)) continue
            saldos.set(f.cliente_id, (saldos.get(f.cliente_id) ?? new D(0)).plus(f.pendiente))
        }
        for (const fila of this.fuente.saldos) saldos.set(fila.cliente_id, new D(fila.saldo))
        return saldos
    }

    /**
     * Cuadre de dinero: facturado, cobrado y pendiente de las facturas del origen contra las
     * facturas de esta importación en ArgosIsp (por su clave externa), y la suma de pagos. Los
     * saldos iniciales explican lo que no entró como factura o pago.
     */
    async cuadrarDinero() {
        const origen = {
            facturado: new D(0),
            cobrado: new D(0),
            pendiente: new D(0),
            pagos: new D(0),
        }
        for (const f of this.fuente.facturas) {
            origen.facturado = origen.facturado.plus(f.total)
            origen.pendiente = origen.pendiente.plus(f.pendiente)
            origen.cobrado = origen.cobrado.plus(new D(f.total).minus(f.pendiente))
        }
        for (const p of this.fuente.pagos) origen.pagos = origen.pagos.plus(p.monto)

        const claves = this.fuente.facturas.map((f) => this.#claveFactura(f.id))
        let facturas = { total: '0', pagado: '0' }
        for (let i = 0; i < claves.length; i += 5000) {
            const parte = (await this.trx
                .from('billing.facturas')
                .where('origen', this.sistema)
                .whereIn('clave_externa', claves.slice(i, i + 5000))
                .whereNot('estado', 'anulada')
                .select(
                    this.trx.raw('coalesce(sum(total), 0)::text AS total'),
                    this.trx.raw('coalesce(sum(pagado), 0)::text AS pagado'),
                )
                .first()) as { total: string; pagado: string }
            facturas = {
                total: new D(facturas.total).plus(parte.total).toString(),
                pagado: new D(facturas.pagado).plus(parte.pagado).toString(),
            }
        }
        const pagos = (await this.trx
            .from('billing.pagos')
            .where('origen', this.sistema)
            .whereLike('clave_externa', `${this.sistema}:pago:%`)
            .whereNot('estado', 'anulado')
            .select(this.trx.raw('coalesce(sum(monto), 0)::text AS monto'))
            .first()) as { monto: string }
        const saldos = (await this.trx
            .from('billing.saldos_iniciales')
            .where('origen', this.sistema)
            .whereNull('anulado_en')
            .select(this.trx.raw('coalesce(sum(monto), 0)::text AS monto'))
            .first()) as { monto: string }

        const argos = {
            facturado: new D(facturas.total),
            cobrado: new D(facturas.pagado),
            pendiente: new D(facturas.total).minus(facturas.pagado),
            pagos: new D(pagos.monto),
        }
        const texto = (m: Record<'facturado' | 'cobrado' | 'pendiente' | 'pagos', Dec>) => ({
            facturado: m.facturado.toFixed(2),
            cobrado: m.cobrado.toFixed(2),
            pendiente: m.pendiente.toFixed(2),
            pagos: m.pagos.toFixed(2),
        })
        const d = this.reporte.diferencias
        const aSaldo = d.facturas_a_saldo.reduce((s, x) => {
            const f = this.fuente.facturas.find((y) => y.id === x.factura_origen)
            return s.plus(f ? (this.#modoB.has(f.cliente_id) ? f.total : f.pendiente) : 0)
        }, new D(0))
        const explicacion: string[] = []
        if (!aSaldo.isZero()) {
            explicacion.push(
                `Q ${aSaldo.toFixed(2)} de ${d.facturas_a_saldo.length} facturas no entraron como factura: van en el saldo inicial`,
            )
        }
        const saldadas = d.facturas_saldadas_en_origen.reduce((x, y) => x.plus(y.total), new D(0))
        if (!saldadas.isZero()) {
            explicacion.push(
                `Q ${saldadas.toFixed(2)} de ${d.facturas_saldadas_en_origen.length} facturas saldadas en el origen sin pago: cuentan como cobradas, no están en pagos`,
            )
        }
        const noImportados = d.pagos_no_importados.reduce((s, x) => s.plus(x.monto), new D(0))
        if (!noImportados.isZero()) {
            explicacion.push(
                `Q ${noImportados.toFixed(2)} en pagos del origen que no se importaron (ver pagos)`,
            )
        }
        explicacion.push(
            `Saldos iniciales: Q ${new D(saldos.monto).toFixed(2)} (cubren la diferencia por cliente)`,
        )
        this.reporte.dinero = {
            origen: texto(origen),
            argosisp: { ...texto(argos), saldos_iniciales: new D(saldos.monto).toFixed(2) },
            diferencia: texto({
                facturado: argos.facturado.minus(origen.facturado),
                cobrado: argos.cobrado.minus(origen.cobrado),
                pendiente: argos.pendiente.minus(origen.pendiente),
                pagos: argos.pagos.minus(origen.pagos),
            }),
            explicacion,
        }
    }

    /** Compara, cliente por cliente, el saldo del origen con CxC − anticipos en ArgosIsp. */
    async compararSaldos() {
        let sumaOrigen = new D(0)
        let sumaImportada = new D(0)
        const saldos = this.#saldosOrigen()
        for (const [clienteOrigen, origen] of saldos) {
            const clienteId = this.#clientes.get(clienteOrigen)
            let importado = new D(0)
            if (clienteId) {
                const cxc = await saldoCliente(clienteId, this.trx)
                importado = cxc.minus(await saldoAnticipos(this.trx, clienteId))
            }
            sumaOrigen = sumaOrigen.plus(origen)
            sumaImportada = sumaImportada.plus(importado)
            if (!importado.equals(origen)) {
                this.reporte.diferencias.saldos_distintos.push({
                    cliente_origen: clienteOrigen,
                    nombre: this.fuente.clientes.find((c) => c.id === clienteOrigen)?.nombre ?? null,
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

    /**
     * Multiempresa: comprueba en la base (dentro de la corrida) que cada factura, pago, promesa y
     * saldo inicial creado por esta corrida quedó en la empresa esperada (la de `--empresa`, o la
     * del servicio ya importado en otra; lo ya importado antes solo se cuenta donde está), y reparte la suma de saldos importada por empresa (CxC −
     * anticipos de cada cliente en cada empresa). Cuadra si nada quedó fuera de su empresa y la
     * suma por empresa es la suma consolidada de `compararSaldos`.
     */
    async verificarEmpresas() {
        const r = this.reporte.empresas
        const filas = new Map<number, ReporteImportacion['empresas']['por_empresa'][number]>()
        const fila = (empresaId: number) => {
            let f = filas.get(empresaId)
            if (!f) {
                f = {
                    empresa_id: empresaId,
                    facturas: 0,
                    pagos: 0,
                    promesas: 0,
                    saldos_iniciales: 0,
                    saldo: '0.00',
                }
                filas.set(empresaId, f)
            }
            return f
        }
        fila(this.empresa.id)
        const tablas = [
            ['factura', 'facturas', 'billing.facturas'],
            ['pago', 'pagos', 'billing.pagos'],
            ['promesa', 'promesas', 'billing.promesas'],
        ] as const
        for (const [entidad, campo, tabla] of tablas) {
            const esperado = this.#esperado[campo]
            const ids = [...esperado.keys()]
            for (let i = 0; i < ids.length; i += 1000) {
                const reales = (await this.trx
                    .from(tabla)
                    .whereIn('id', ids.slice(i, i + 1000))
                    .select('id', 'empresa_id')) as Array<{ id: number; empresa_id: number }>
                for (const real of reales) {
                    const e = esperado.get(Number(real.id))!
                    const empresaId = Number(real.empresa_id)
                    fila(empresaId)[campo]++
                    if (e.empresa_id !== null && empresaId !== e.empresa_id) {
                        r.fuera_de_empresa.push({
                            entidad,
                            id_origen: e.id_origen,
                            id: Number(real.id),
                            empresa_id: empresaId,
                            esperada: e.empresa_id,
                        })
                    }
                }
            }
        }
        const claves = [...this.#esperado.saldos.keys()]
        for (let i = 0; i < claves.length; i += 1000) {
            const reales = (await this.trx
                .from('billing.saldos_iniciales')
                .where('origen', this.sistema)
                .whereIn('clave_externa', claves.slice(i, i + 1000))
                .select('id', 'clave_externa', 'empresa_id')) as Array<{
                id: number
                clave_externa: string
                empresa_id: number
            }>
            for (const real of reales) {
                const empresaId = Number(real.empresa_id)
                const e = this.#esperado.saldos.get(real.clave_externa)!
                fila(empresaId).saldos_iniciales++
                if (!e.existente && empresaId !== this.empresa.id) {
                    r.fuera_de_empresa.push({
                        entidad: 'saldo_inicial',
                        id_origen: e.id_origen,
                        id: Number(real.id),
                        empresa_id: empresaId,
                        esperada: this.empresa.id,
                    })
                }
            }
        }

        // Suma de saldos por empresa: los mismos clientes que compararSaldos.
        const saldos = new Map<number, Dec>()
        for (const clienteOrigen of this.#saldosOrigen().keys()) {
            const clienteId = this.#clientes.get(clienteOrigen)
            if (!clienteId) continue
            const cxc = await saldoClientePorEmpresa(clienteId, this.trx)
            const empresas = new Set<number>([...filas.keys(), ...cxc.keys()])
            for (const empresaId of empresas) {
                const saldo = (cxc.get(empresaId) ?? new D(0)).minus(
                    await saldoAnticipos(this.trx, clienteId, empresaId),
                )
                if (saldo.isZero()) continue
                saldos.set(empresaId, (saldos.get(empresaId) ?? new D(0)).plus(saldo))
            }
        }
        let suma = new D(0)
        for (const [empresaId, saldo] of saldos) {
            fila(empresaId).saldo = saldo.toFixed(2)
            suma = suma.plus(saldo)
        }
        r.por_empresa = [...filas.values()].sort((a, b) => a.empresa_id - b.empresa_id)
        r.suma = suma.toFixed(2)
        r.cuadra = r.fuera_de_empresa.length === 0 && suma.equals(this.reporte.saldos.suma_importada)
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
                servicio_origen: s.id,
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
            this.reporte.diferencias.ips_fuera_de_red.push({
                servicio_origen: s.id,
                ip,
                router_origen: s.router_id,
            })
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

    /** `<sistema>:factura:<id>`: clave externa de la factura (idempotencia de A3). */
    #claveFactura(idOrigen: string): string {
        return `${this.sistema}:factura:${idOrigen}`
    }

    #faltante(entidad: string, idOrigen: string, falta: string, idFalta: string) {
        this.reporte.diferencias.referencias_faltantes.push({
            entidad,
            id_origen: idOrigen,
            falta,
            id_falta_origen: idFalta,
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
        // Los orígenes no traen IPv6: el plan queda dual stack para activarlo después.
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

/**
 * Forma de pago del origen (texto libre) → `METODOS_PAGO` de ArgosIsp. Lo que no se reconoce
 * queda como `caja` (efectivo); el texto original va en la nota del pago.
 */
export function metodoPago(valor: string | null): MetodoPago {
    const v = (valor ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const reglas: Array<[RegExp, MetodoPago]> = [
        [/transfer|banca|bi en linea/, 'transferencia'],
        [/deposit|boleta|ventanilla/, 'deposito'],
        [/\bach\b/, 'ach'],
        [/remesa/, 'remesa'],
        [/agente|kiosco|punto de pago/, 'agente'],
        [/tarjeta|debito|credito|card|pos\b/, 'debito'],
        [/pasarela|en linea|online|web|paypal|stripe/, 'pasarela'],
    ]
    return reglas.find(([re]) => re.test(v))?.[1] ?? 'caja'
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
