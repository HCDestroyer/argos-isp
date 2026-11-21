import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { verificarVersion } from '#shared/version'
import { usuarioDelActor } from '#shared/contexto'
import type { TipoDocumentoFiscal } from '#core/nit_cui'
import { claveTelefono } from '#core/consultas/clientes'
import { telefonoParaGuardar } from '#core/telefonos'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { claveLimite, contarEnVentana, LimiteExcedido } from '#core/limite_ventana'
import CrearCliente from '#core/actions/crear_cliente'
import RegistrarIdentidadCliente from '#core/actions/registrar_identidad_cliente'
import {
    TitularNoCoincide,
    huella,
    normalizarNombre,
    validarDocumentoIdentidad,
    type DocumentoIdentidad,
    type FotoIdentidad,
    type MetodoIdentidad,
} from '#core/identidad'
import { ServicioNoPendiente, bloquearServicio, exigirServicioDeIris } from '#core/instalacion_iris'

export const MOTIVOS_CAMBIO_TITULAR = ['menor_de_edad', 'otro'] as const

export interface DatosTitular {
    nombre: string
    documento_tipo: DocumentoIdentidad
    documento_numero: string
    mayor_de_edad: boolean
    telefono: string
    whatsapp?: boolean
    email?: string | null
    tipo_documento_fiscal?: TipoDocumentoFiscal
    nit_cui?: string | null
    relacion?: 'titular' | 'familiar' | 'otro' | null
}

export interface EntradaCambiarTitular {
    id: number
    cliente: DatosTitular
    identidad: { coincide: boolean; verificado_en: Date; metodo: MetodoIdentidad }
    motivo_codigo: (typeof MOTIVOS_CAMBIO_TITULAR)[number]
    /** solo en la auditoría de Argos (B1) */
    motivo: string
    version?: number
    origen_tipo: string
    origen_id: string
    frente: FotoIdentidad
    reverso?: FotoIdentidad | null
    desdeIris?: boolean
}

export interface TitularCambiado {
    servicio_id: number
    titular: { cliente_id: number; existente: boolean }
    posible_duplicado: boolean
    identidad_id: number
    de_cliente_id: number
    de_cliente_eliminado: boolean
}

/** Límites de §3.4.4 (ajustes l y ab). */
export const LIMITES_TITULAR = {
    porServicio: 2,
    porEmpresaYActor: 10,
    noCoincidePorDocumento: 5,
    ventanaS: 24 * 60 * 60,
} as const

/** 422 `evidencia_requerida` (§3.4.7): sin `frente` o sin `coincide: true`. */
export class EvidenciaRequerida extends ReglaNegocio {
    constructor() {
        super(
            'El cambio de titular exige la foto del documento (frente) y «Coincide con el titular»',
            'evidencia_requerida',
        )
    }
}

function demasiados(reintentarEnS: number): LimiteExcedido {
    return new LimiteExcedido(
        'demasiados_cambios_titular',
        'Demasiados cambios de titular',
        'Se alcanzó el límite de cambios de titular; intenta de nuevo después de Retry-After',
        reintentarEnS,
    )
}

/**
 * `servicios.cambiar_titular` (`POST /servicios/:id/cambiar-titular`, contrato Iris 0.10.0 §3.4.4,
 * A39; decisión 9 del PM): el servicio pendiente pasa a otro titular. **Quién es lo decide Argos**
 * (Iris nunca manda `cliente_id`), comparando en la empresa del servicio:
 *
 * - mismo documento y mismo nombre normalizado → ese cliente, al momento (`existente: true`), con la
 *   identidad como versión nueva; notify le manda un aviso informativo (`servicio.titular_cambiado`);
 * - mismo documento y otro nombre → 422 `titular_no_coincide`, sin datos del otro cliente; suma al
 *   contador del documento (5 en 24 h: después, 429 hacia ese documento);
 * - ningún cliente con ese documento → uno nuevo (`posible_duplicado` si coinciden el nombre o el
 *   teléfono de otro cliente con otro documento).
 *
 * Solo en `pendiente_instalacion` (422 `servicio_no_pendiente`); sin `frente` o sin `coincide`, 422
 * `evidencia_requerida`; 2 cambios por servicio y 10 por empresa y actor al día (429
 * `demasiados_cambios_titular` con `Retry-After`). Mueve el servicio (con sus credenciales PPP); las
 * facturas ya emitidas no se mueven. El cliente anterior sin servicios ni movimientos se elimina.
 * Emite `servicio.titular_cambiado` y `cliente.identidad_registrada`. El `motivo` (texto) y el
 * documento quedan solo en la auditoría (el número como `***`).
 */
export default class CambiarTitularServicio extends DomainAction<EntradaCambiarTitular, TitularCambiado> {
    readonly nombre = 'servicios.cambiar_titular'
    protected readonly camposEntradaOcultos = ['cliente']

    protected async handle(input: EntradaCambiarTitular, t: Transaccion): Promise<TitularCambiado> {
        t.fijarEntidad('servicio', input.id)
        const servicio = await bloquearServicio(t.trx, input.id)
        if (!servicio) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        t.fijarEmpresa(servicio.empresa_id)
        if (servicio.estado !== 'pendiente_instalacion') throw new ServicioNoPendiente(servicio.estado)
        const origen = { origen_tipo: input.origen_tipo, origen_id: input.origen_id }
        if (input.desdeIris) await exigirServicioDeIris(t, input.id, origen)
        if (input.version !== undefined) {
            verificarVersion('servicio', input.id, servicio.version, input.version)
        }
        if (input.identidad.coincide !== true) throw new EvidenciaRequerida()

        const numero = validarDocumentoIdentidad(
            input.cliente.documento_tipo,
            input.cliente.documento_numero,
            'cliente.documento_numero',
        )
        const huellaDocumento = huella(numero)
        // teléfono de Guatemala o internacional (§3.2); 422 sin repetir el valor
        telefonoParaGuardar('cliente.telefono', input.cliente.telefono, null, t.ctx)

        // límites: 2 por servicio y 10 por empresa y actor al día; tope de `titular_no_coincide`
        const actor = t.ctx.iris?.actor ?? `usuario:${usuarioDelActor(t.ctx.actor) ?? 'sistema'}`
        const claves = {
            servicio: claveLimite('titular', 'servicio', input.id),
            actor: claveLimite('titular', 'actor', servicio.empresa_id, actor),
            noCoincide: claveLimite('titular', 'no_coincide', servicio.empresa_id, huellaDocumento),
        }
        const [porServicio, porActor, noCoincide] = await Promise.all([
            contarEnVentana(claves.servicio, LIMITES_TITULAR.ventanaS, 0),
            contarEnVentana(claves.actor, LIMITES_TITULAR.ventanaS, 0),
            contarEnVentana(claves.noCoincide, LIMITES_TITULAR.ventanaS, 0),
        ])
        if (porServicio.cuenta >= LIMITES_TITULAR.porServicio) throw demasiados(porServicio.reiniciaEnS)
        if (porActor.cuenta >= LIMITES_TITULAR.porEmpresaYActor) throw demasiados(porActor.reiniciaEnS)
        if (noCoincide.cuenta >= LIMITES_TITULAR.noCoincidePorDocumento) {
            throw demasiados(noCoincide.reiniciaEnS)
        }

        const deClienteId = await clienteDelServicio(t, input.id)
        const candidato = await buscarPorDocumento(
            t,
            servicio.empresa_id,
            input.cliente.documento_tipo,
            numero,
        )
        let titularId: number
        let existente = false
        let posibleDuplicado = false
        if (candidato) {
            if (!(await mismoNombre(t, candidato, input.cliente.nombre))) {
                // contador aparte del documento (ajuste ab): no toca la verificación de §7.5
                await contarEnVentana(claves.noCoincide, LIMITES_TITULAR.ventanaS)
                throw new TitularNoCoincide()
            }
            titularId = candidato
            existente = true
        } else {
            posibleDuplicado = await hayPosibleDuplicado(t, servicio.empresa_id, input.cliente, deClienteId)
            const nuevo = await new CrearCliente().execute(
                {
                    nombre: input.cliente.nombre.trim(),
                    telefono: input.cliente.telefono,
                    email: input.cliente.email ?? null,
                    ...(input.cliente.tipo_documento_fiscal
                        ? { tipo_documento_fiscal: input.cliente.tipo_documento_fiscal }
                        : {}),
                    nit_cui: input.cliente.nit_cui ?? null,
                    ...(input.cliente.whatsapp ? { canal_preferido: 'whatsapp' as const } : {}),
                    desdeIris: input.desdeIris,
                },
                t.ctx,
                { trx: t.trx },
            )
            titularId = Number(nuevo.id)
            // los datos que vinieron de Iris no cuentan como registrados hasta confirmarlos (§3.4.6)
            if (input.desdeIris) {
                await t.trx
                    .from('core.clientes')
                    .where('id', titularId)
                    .update({
                        campos_sin_confirmar: t.trx.knexRawQuery(
                            'array(SELECT DISTINCT x FROM unnest(campos_sin_confirmar || CAST(? AS text[])) x ORDER BY x)',
                            [`{${['telefono', ...(input.cliente.email ? ['email'] : [])].join(',')}}`],
                        ),
                    })
            }
        }

        if (titularId !== deClienteId) {
            await t.trx
                .from('core.servicios')
                .where('id', input.id)
                .update({
                    cliente_id: titularId,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            await t.registrarCambios(
                { tipo: 'servicio', id: input.id },
                { cliente_id: deClienteId },
                { cliente_id: titularId },
            )
        }

        const identidad = await new RegistrarIdentidadCliente().execute(
            {
                cliente_id: titularId,
                documento_tipo: input.cliente.documento_tipo,
                documento_numero: numero,
                nombre: input.cliente.nombre,
                mayor_de_edad: input.cliente.mayor_de_edad,
                coincide: input.identidad.coincide,
                verificado_en: input.identidad.verificado_en,
                metodo: input.identidad.metodo,
                origen_tipo: input.origen_tipo,
                origen_id: input.origen_id,
                frente: input.frente,
                reverso: input.reverso ?? null,
                servicio_id: input.id,
                desdeIris: input.desdeIris,
                // ya se comparó documento y nombre (existente) o el cliente es nuevo
                sinRevisarHistorial: true,
            },
            t.ctx,
            { trx: t.trx },
        )

        const eliminado = titularId !== deClienteId ? await eliminarSiNoTieneHistorial(t, deClienteId) : false
        await t.emit('servicio.titular_cambiado', {
            servicio_id: input.id,
            empresa_id: servicio.empresa_id,
            de_cliente_id: deClienteId,
            a_cliente_id: titularId,
            existente,
            posible_duplicado: posibleDuplicado,
            de_cliente_eliminado: eliminado,
            motivo_codigo: input.motivo_codigo,
            origen_tipo: input.origen_tipo,
            origen_id: input.origen_id,
        })
        t.alConfirmar(async () => {
            await contarEnVentana(claves.servicio, LIMITES_TITULAR.ventanaS)
            await contarEnVentana(claves.actor, LIMITES_TITULAR.ventanaS)
        })
        refrescarAaaAlConfirmar(t, { servicioId: input.id })
        return {
            servicio_id: input.id,
            titular: { cliente_id: titularId, existente },
            posible_duplicado: posibleDuplicado,
            identidad_id: identidad.identidad_id,
            de_cliente_id: deClienteId,
            de_cliente_eliminado: eliminado,
        }
    }
}

async function clienteDelServicio(t: Transaccion, servicioId: number): Promise<number> {
    const fila = (await t.trx
        .from('core.servicios')
        .where('id', servicioId)
        .select('cliente_id')
        .first()) as {
        cliente_id: number
    }
    return Number(fila.cliente_id)
}

/** Clientes visibles para la empresa: con algún servicio en ella o sin servicios todavía. */
const SQL_EN_EMPRESA = `(EXISTS (SELECT 1 FROM core.servicios s WHERE s.cliente_id = c.id AND s.empresa_id = ?)
    OR NOT EXISTS (SELECT 1 FROM core.servicios s WHERE s.cliente_id = c.id))`

/**
 * Cliente de la empresa con ese documento: por su identidad vigente (huella) o, para un DPI, por el
 * `nit_cui` de tipo `cui`. El más antiguo si hay varios.
 */
async function buscarPorDocumento(
    t: Transaccion,
    empresaId: number,
    tipo: DocumentoIdentidad,
    numero: string,
): Promise<number | null> {
    const fila = (await t.trx
        .from('core.clientes as c')
        .whereRaw(SQL_EN_EMPRESA, [empresaId])
        .where((q) => {
            q.whereExists((i) =>
                i
                    .from('core.clientes_identidades as i')
                    .whereRaw('i.cliente_id = c.id')
                    .where('i.vigente', true)
                    .where('i.documento_tipo', tipo)
                    .where('i.documento_huella', huella(numero)),
            )
            if (tipo === 'dpi') {
                q.orWhere((w) =>
                    w
                        .where('c.tipo_documento_fiscal', 'cui')
                        .whereRaw(
                            `upper(regexp_replace(coalesce(c.nit_cui, ''), '[[:space:]-]', '', 'g')) = ?`,
                            [numero],
                        ),
                )
            }
        })
        .orderBy('c.id')
        .select('c.id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

/** Nombre normalizado igual al del cliente o al de su identidad vigente. */
async function mismoNombre(t: Transaccion, clienteId: number, nombre: string): Promise<boolean> {
    const normal = normalizarNombre(nombre)
    const cliente = (await t.trx.from('core.clientes').where('id', clienteId).select('nombre').first()) as {
        nombre: string
    }
    if (normalizarNombre(cliente.nombre) === normal) return true
    const identidad = await t.trx
        .from('core.clientes_identidades')
        .where({ cliente_id: clienteId, vigente: true, nombre_huella: huella(normal) })
        .select('id')
        .first()
    return Boolean(identidad)
}

/** Otro cliente de la empresa con el mismo nombre normalizado o el mismo teléfono (B4). */
async function hayPosibleDuplicado(
    t: Transaccion,
    empresaId: number,
    datos: DatosTitular,
    excluir: number,
): Promise<boolean> {
    const clave = claveTelefono(datos.telefono)
    const filas = (await t.trx
        .from('core.clientes as c')
        .whereRaw(SQL_EN_EMPRESA, [empresaId])
        .whereNot('c.id', excluir)
        .where((q) =>
            q
                .whereRaw(`regexp_replace(coalesce(c.telefono, ''), '\\D', '', 'g') IN (?, ?)`, [
                    clave,
                    clave.slice(3),
                ])
                .orWhereRaw(`regexp_replace(coalesce(c.movil, ''), '\\D', '', 'g') IN (?, ?)`, [
                    clave,
                    clave.slice(3),
                ])
                .orWhereRaw('lower(c.nombre) = lower(?)', [datos.nombre.trim()]),
        )
        .select('c.id', 'c.nombre')
        .limit(50)) as Array<{ id: number; nombre: string }>
    if (filas.length > 0) return true
    // nombre normalizado (sin tildes ni signos): se compara en la app
    const normal = normalizarNombre(datos.nombre)
    const primeros = normal.split(' ')[0] ?? ''
    const parecidos = (await t.trx
        .from('core.clientes as c')
        .whereRaw(SQL_EN_EMPRESA, [empresaId])
        .whereNot('c.id', excluir)
        .whereILike('c.nombre', `%${primeros.replace(/[\\%_]/g, (x) => `\\${x}`)}%`)
        .select('c.nombre')
        .limit(500)) as Array<{ nombre: string }>
    return parecidos.some((p) => normalizarNombre(p.nombre) === normal)
}

/**
 * El cliente anterior se elimina si se quedó sin servicios ni movimientos (§3.4.4). Si algo lo
 * referencia todavía (facturas, pagos, lealtad, portal…), se queda como está.
 */
async function eliminarSiNoTieneHistorial(t: Transaccion, clienteId: number): Promise<boolean> {
    const otros = await t.trx.from('core.servicios').where('cliente_id', clienteId).select('id').first()
    if (otros) return false
    try {
        await t.trx.transaction(async (sp) => {
            await sp.from('core.codigos_referido').where('cliente_id', clienteId).delete()
            await sp
                .from('core.ids_externos')
                .where({ entidad_tipo: 'cliente', entidad_id: clienteId })
                .delete()
            await sp.from('core.clientes').where('id', clienteId).delete()
        })
    } catch {
        return false
    }
    await t.registrarCambios({ tipo: 'cliente', id: clienteId }, { eliminado: false }, { eliminado: true })
    return true
}
