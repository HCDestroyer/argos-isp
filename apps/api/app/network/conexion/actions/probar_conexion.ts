import { createHash, timingSafeEqual } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { descifrar } from '#shared/cifrado'
import { NoEncontrado } from '#shared/errores'
import { leerRedTunel } from '#network/conexion/config'
import { filaConexion, vistaConexion } from '#network/conexion/consultas'
import { routerDispatcher } from '#network/routeros/consultas'
import { bitacoraRed, fabricaPorDefecto, type FabricaClientes } from '#network/routeros/dispatcher'
import type { ErrorRouterOS } from '#network/routeros/errores'
import { diagnosticarErrorRouterOS, type MotivoApi } from '#network/diagnostico_routeros'
import { sondearRouter } from '#network/routeros/actions/sondear_routers'
import type { ObjetoRouterOS } from '#network/routeros/cliente'
import type { ResolverIPv4 } from '#network/routeros/corte_router'
import { diagnosticoCorte, resumenCorte, type DiagnosticoCorte } from '#network/routeros/diagnostico'

export type ClaveChequeo = 'tunel' | 'api' | 'equipo' | 'radius' | 'corte'
export type { MotivoApi } from '#network/diagnostico_routeros'

export interface Chequeo {
    clave: ClaveChequeo
    /** null = no se pudo comprobar (depende de otro chequeo que falló) */
    ok: boolean | null
    detalle: string
    ms: number
    /** solo en `api` cuando falla */
    motivo?: MotivoApi | null
    /** `equipo`: version, modelo, uptime, cpu_pct; `radius`: direcciones y secreto_verificado */
    datos?: Record<string, unknown> | null
    /** Solo en `corte`: el diagnóstico completo (pasos, comandos, suspendidos fuera de la lista, límites) */
    corte?: DiagnosticoCorte | null
}

export interface ResultadoProbarConexion {
    router_id: number
    /** todos los chequeos que se pudieron hacer salieron bien */
    ok: boolean
    probado_en: string
    chequeos: Chequeo[]
}

/**
 * `routers.probar_conexion` (pedido del PM, 28 oct): prueba en vivo la conexión con el router.
 *
 * - **tunel** (solo si el router tiene conexión WireGuard): estado `conectado` y handshake en los
 *   últimos 180 s. Lee lo que informa el servicio `wireguard`; no toca el router.
 * - **api**: `GET /rest/system/resource` con las credenciales guardadas, con el mismo código que el
 *   sondeo (`sondearRouter`: queda en `audit.red` y, si responde, actualiza `en_linea` y
 *   `ultimo_contacto` con fuente `sondeo`). Si falla, `motivo` y `detalle` en lenguaje simple con los
 *   comandos de RouterOS (`diagnostico_routeros.ts`); el texto de OpenSSL solo en `datos.error_tecnico`.
 * - **equipo**: versión de RouterOS, modelo, uptime y CPU de esa misma respuesta.
 * - **radius** (routers en modo `radius`): `GET /rest/radius` (también a `audit.red`) y que haya un
 *   cliente con servicio `ppp` hacia Argos (la IP del servidor en el túnel o
 *   `ROUTERS_RADIUS_DIRECCIONES`). Si el router devuelve el secreto (usuario con política
 *   `sensitive`), se compara con el del router sin devolverlo nunca; si no lo devuelve, se dice que no
 *   se pudo verificar.
 * - **corte** (A2, si la API respondió): ¿un suspendido ve la página de corte? `diagnosticoCorte`: la
 *   address-list `suspendidos`, las reglas de filter y NAT (activas y en orden), el destino real del NAT
 *   probado con `/tool/fetch` a `http://<ip>:<puerto>/corte`, que cada suspendido tenga su IP en la
 *   lista y la excepción de FastTrack; cada paso con los comandos de RouterOS para arreglarlo.
 *
 * Es la acción de alguien: siempre se audita. Nunca lanza por un router caído; lo informa.
 */
export default class ProbarConexion extends DomainAction<{ router_id: number }, ResultadoProbarConexion> {
    readonly nombre = 'routers.probar_conexion'
    readonly #clientes: FabricaClientes
    readonly #resolver: ResolverIPv4 | undefined

    constructor(opciones: { clientes?: FabricaClientes; resolver?: ResolverIPv4 } = {}) {
        super()
        this.#clientes = opciones.clientes ?? fabricaPorDefecto
        this.#resolver = opciones.resolver
    }

    protected async handle(input: { router_id: number }, t: Transaccion): Promise<ResultadoProbarConexion> {
        const routerId = input.router_id
        t.fijarEntidad('router', routerId)
        const router = await routerDispatcher(routerId, t.trx)
        if (!router) throw new NoEncontrado(`El router ${routerId} no existe`)
        const fila = (await t.trx
            .from('network.routers')
            .where('id', routerId)
            .select('modo_seguridad', 'radius_secret', 'empresa_sugerida_id')
            .firstOrFail()) as {
            modo_seguridad: string
            radius_secret: string | null
            empresa_sugerida_id: number | null
        }
        t.fijarEmpresa(fila.empresa_sugerida_id)
        const chequeos: Chequeo[] = []

        const conexion = await filaConexion(routerId, t.trx)
        if (conexion) {
            const vista = vistaConexion(routerId, conexion)
            const ok = vista.estado === 'conectado' && vista.handshake_reciente
            chequeos.push({
                clave: 'tunel',
                ok,
                ms: 0,
                detalle: ok
                    ? `Túnel activo (${vista.ip_tunel}); último handshake ${vista.ultimo_handshake}`
                    : vista.public_key === null
                      ? 'El router todavía no registró su clave pública: ejecuta el script de conexión'
                      : vista.ultimo_handshake
                        ? `Sin handshake reciente; el último fue ${vista.ultimo_handshake}`
                        : 'El servidor todavía no vio ningún handshake del router',
            })
        }

        let recurso: Record<string, unknown> | null = null
        if (!router.con_credenciales) {
            chequeos.push({
                clave: 'api',
                ok: false,
                ms: 0,
                motivo: 'sin_credenciales',
                detalle: 'El router no tiene usuario y clave de la API REST',
            })
        } else {
            const sondeo = await sondearRouter(t, router.api, this.#clientes, 'probar_conexion')
            if (sondeo.ok) {
                recurso = sondeo.recurso
                chequeos.push({
                    clave: 'api',
                    ok: true,
                    ms: sondeo.ms,
                    motivo: null,
                    detalle: `La API REST respondió en ${sondeo.host}`,
                })
            } else {
                const { motivo, detalle, error_tecnico: errorTecnico } = sondeo.diagnostico
                chequeos.push({
                    clave: 'api',
                    ok: false,
                    ms: sondeo.ms,
                    motivo,
                    detalle,
                    datos: { error_tecnico: errorTecnico },
                })
            }
        }

        if (recurso) {
            const datos = {
                version: texto(recurso.version),
                modelo: texto(recurso['board-name']) ?? texto(recurso.platform),
                uptime: texto(recurso.uptime),
                cpu_pct: recurso['cpu-load'] === undefined ? null : Number(recurso['cpu-load']),
            }
            const v7 = datos.version?.startsWith('7.') ?? false
            chequeos.push({
                clave: 'equipo',
                ok: v7,
                ms: 0,
                datos,
                detalle:
                    `RouterOS ${datos.version ?? '?'} · ${datos.modelo ?? 'modelo desconocido'} · ` +
                    `encendido ${datos.uptime ?? '?'} · CPU ${datos.cpu_pct ?? '?'} %` +
                    (v7 ? '' : ' · se requiere RouterOS 7'),
            })
        } else {
            chequeos.push({
                clave: 'equipo',
                ok: null,
                ms: 0,
                datos: null,
                detalle: 'Sin datos del equipo: la API no respondió',
            })
        }

        if (fila.modo_seguridad === 'radius') {
            chequeos.push(
                recurso
                    ? await this.#radius(t, router.api, fila.radius_secret, conexion !== null)
                    : {
                          clave: 'radius',
                          ok: null,
                          ms: 0,
                          detalle: 'No se pudo leer /radius: la API no respondió',
                      },
            )
        }

        if (recurso) {
            const inicio = performance.now()
            // Sin contacto: el sondeo de arriba ya lo anotó en esta transacción (que tiene la fila
            // tomada); otro cliente que lo anotara en su propia conexión esperaría ese lock para siempre.
            const corte = await diagnosticoCorte(
                routerId,
                { clientes: (api) => this.#clientes(api, { sinContacto: true }), resolver: this.#resolver },
                t.ctx.requestId,
            )
            chequeos.push({
                clave: 'corte',
                ok: corte.ok,
                ms: Math.round(performance.now() - inicio),
                detalle: resumenCorte(corte),
                corte,
            })
        }

        const hechos = chequeos.filter((c) => c.ok !== null)
        return {
            router_id: routerId,
            ok: hechos.length > 0 && chequeos.every((c) => c.ok === true),
            probado_en: new Date().toISOString(),
            chequeos,
        }
    }

    async #radius(
        t: Transaccion,
        api: Parameters<FabricaClientes>[0],
        secretoCifrado: string | null,
        conTunel: boolean,
    ): Promise<Chequeo> {
        const esperadas = new Set(
            (process.env.ROUTERS_RADIUS_DIRECCIONES ?? '')
                .split(',')
                .map((d) => d.trim())
                .filter(Boolean),
        )
        if (conTunel) esperadas.add(leerRedTunel().servidor)
        const comando = {
            operacion: 'probar_conexion',
            metodo: 'GET',
            ruta: '/radius',
            request_id: t.ctx.requestId,
        }
        const inicio = performance.now()
        let cliente
        let entradas: ObjetoRouterOS[]
        try {
            cliente = this.#clientes(api, { sinContacto: true })
            entradas = await cliente.listar('/radius')
        } catch (error) {
            const e = error as ErrorRouterOS
            const ms = Math.round(performance.now() - inicio)
            await bitacoraRed.registrar({
                tipo: 'routeros',
                router_id: api.id,
                servicio_id: null,
                comando: { ...comando, host: cliente?.host ?? null },
                respuesta: {
                    status: e.status ?? null,
                    error: e.message,
                    tipo_error: e.tipo ?? 'inalcanzable',
                },
                ok: false,
            })
            const diagnostico = diagnosticarErrorRouterOS(e, cliente?.host ?? api.host)
            return {
                clave: 'radius',
                ok: false,
                ms,
                detalle: `No se pudo leer /radius. ${diagnostico.detalle}`,
                datos: { error_tecnico: diagnostico.error_tecnico },
            }
        } finally {
            cliente?.cerrar()
        }
        const ms = Math.round(performance.now() - inicio)
        // Sin el secreto: `audit.red` guarda solo cuántas entradas hubo.
        await bitacoraRed.registrar({
            tipo: 'routeros',
            router_id: api.id,
            servicio_id: null,
            comando: { ...comando, host: cliente.host },
            respuesta: { status: 200, rtt_ms: ms, entradas: entradas.length },
            ok: true,
        })

        const ppp = entradas.filter(
            (e) => e.disabled !== 'true' && (e.service ?? '').split(',').includes('ppp'),
        )
        const hacia = esperadas.size > 0 ? ppp.filter((e) => esperadas.has(e.address ?? '')) : ppp
        const direcciones = ppp.map((e) => e.address ?? '')
        if (hacia.length === 0) {
            return {
                clave: 'radius',
                ok: false,
                ms,
                datos: { direcciones, esperadas: [...esperadas], secreto_verificado: false },
                detalle:
                    ppp.length === 0
                        ? 'El router no tiene un cliente /radius con servicio ppp'
                        : `Ningún /radius apunta a Argos (${[...esperadas].join(', ')}); hay: ${direcciones.join(', ')}`,
            }
        }
        const conSecreto = hacia.filter((e) => typeof e.secret === 'string' && e.secret !== '')
        if (conSecreto.length === 0 || !secretoCifrado) {
            return {
                clave: 'radius',
                ok: true,
                ms,
                datos: { direcciones, esperadas: [...esperadas], secreto_verificado: false },
                detalle:
                    `RADIUS hacia ${hacia[0]!.address}. El secreto no se pudo verificar ` +
                    (secretoCifrado
                        ? '(el usuario de la API no puede leerlo sin la política sensitive)'
                        : '(el router no tiene secreto guardado en Argos)'),
            }
        }
        const esperado = descifrar(secretoCifrado)
        const coincide = conSecreto.some((e) => mismoTexto(e.secret!, esperado))
        return {
            clave: 'radius',
            ok: coincide,
            ms,
            datos: { direcciones, esperadas: [...esperadas], secreto_verificado: true },
            detalle: coincide
                ? `RADIUS hacia ${hacia[0]!.address} con el secreto correcto`
                : 'El secreto RADIUS del router no coincide con el de Argos: vuelve a ejecutar el script de conexión',
        }
    }
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor !== '' ? valor : null
}

/** Comparación en tiempo constante (sobre el hash: mismo largo siempre). */
function mismoTexto(a: string, b: string): boolean {
    return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}
