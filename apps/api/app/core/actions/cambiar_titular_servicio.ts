import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { verificarVersion } from '#shared/version'
import { usuarioDelActor, type ContextoAccion } from '#shared/contexto'
import { nitValido, type TipoDocumentoFiscal } from '#core/nit_cui'
import { claveTelefono } from '#core/consultas/clientes'
import { telefonoParaGuardar } from '#core/telefonos'
import { refrescarAaaAlConfirmar } from '#core/aaa'
import { claveLimite, contarEnVentana, LimiteExcedido } from '#core/limite_ventana'
import CrearCliente from '#core/actions/crear_cliente'
import RegistrarIdentidadCliente from '#core/actions/registrar_identidad_cliente'
import {
    TitularEmpresaEnRevision,
    TitularNoCoincide,
    cifrarBytes,
    cifrarTexto,
    huella,
    normalizarNit,
    normalizarNombre,
    representanteRegistrado,
    sqlNitNormalizado,
    validarDocumentoIdentidad,
    type DocumentoIdentidad,
    type FotoIdentidad,
    type MetodoIdentidad,
    type SolicitudRevisionEmpresa,
} from '#core/identidad'
import { ServicioNoPendiente, bloquearServicio, exigirServicioDeIris } from '#core/instalacion_iris'

export const MOTIVOS_CAMBIO_TITULAR = ['menor_de_edad', 'otro'] as const
export const TIPOS_TITULAR = ['persona', 'empresa'] as const
export type TipoTitular = (typeof TIPOS_TITULAR)[number]

export interface DatosTitular {
    /** `persona` (por defecto) o `empresa` (contrato Iris 0.14.1) */
    tipo?: TipoTitular
    /** persona: como aparece en el documento; empresa: la razón social */
    nombre: string
    /** solo persona: con empresa, 422 `validacion` */
    documento_tipo?: DocumentoIdentidad
    documento_numero?: string
    mayor_de_edad?: boolean
    telefono: string
    whatsapp?: boolean
    email?: string | null
    tipo_documento_fiscal?: TipoDocumentoFiscal
    nit_cui?: string | null
    relacion?: 'titular' | 'familiar' | 'otro' | null
}

/** Representante de un titular empresa (0.14.1): su documento es el de la identidad y las fotos. */
export interface RepresentanteTitular {
    nombre: string
    documento_tipo: DocumentoIdentidad
    documento_numero: string
    mayor_de_edad: boolean
}

export interface EntradaCambiarTitular {
    id: number
    cliente: DatosTitular
    /** obligatorio con `cliente.tipo: empresa`; prohibido con persona */
    representante?: RepresentanteTitular | null
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

/** Límites de §3.4.4 (ajustes l y ab; contador por NIT en empresas, 0.14.1 ajuste c). */
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

/** 422 `representante_requerido` (0.14.1): titular empresa sin `representante`. */
export class RepresentanteRequerido extends ReglaNegocio {
    constructor() {
        super('Un titular empresa necesita un representante con DPI o pasaporte', 'representante_requerido')
    }
}

/** 422 `representante_no_permitido` (0.14.1): titular persona con `representante`. */
export class RepresentanteNoPermitido extends ReglaNegocio {
    constructor() {
        super('Un titular persona no lleva representante', 'representante_no_permitido')
    }
}

/** 422 `nit_requerido` (0.14.1): titular empresa sin `nit_cui`. */
export class NitRequerido extends ReglaNegocio {
    constructor() {
        super('Un titular empresa necesita su NIT en nit_cui', 'nit_requerido')
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

/** Documento de la identidad que se registra (el del titular persona o el del representante). */
interface DocumentoTitular {
    tipo: DocumentoIdentidad
    numero: string
    nombre: string
    mayor_de_edad: boolean
}

/**
 * Forma del titular (0.14.1): persona con su documento y sin representante; empresa con NIT, sin
 * documento de persona y con representante. Devuelve el documento de la identidad ya validado y,
 * en empresa, el NIT normalizado. 422 sin repetir valores.
 */
function validarForma(input: EntradaCambiarTitular): { documento: DocumentoTitular; nit: string | null } {
    const tipo = input.cliente.tipo ?? 'persona'
    if (tipo === 'persona') {
        if (input.representante !== undefined && input.representante !== null) {
            throw new RepresentanteNoPermitido()
        }
        const faltan: ErrorCampo[] = []
        for (const campo of ['documento_tipo', 'documento_numero', 'mayor_de_edad'] as const) {
            if (input.cliente[campo] === undefined) {
                faltan.push({ field: `cliente.${campo}`, rule: 'required', message: 'Campo obligatorio' })
            }
        }
        if (faltan.length > 0) throw new ValidacionFallida(faltan)
        return {
            documento: {
                tipo: input.cliente.documento_tipo!,
                numero: input.cliente.documento_numero!,
                nombre: input.cliente.nombre,
                mayor_de_edad: input.cliente.mayor_de_edad!,
            },
            nit: null,
        }
    }
    const prohibidos: ErrorCampo[] = []
    for (const campo of ['documento_tipo', 'documento_numero', 'mayor_de_edad'] as const) {
        if (input.cliente[campo] !== undefined) {
            prohibidos.push({
                field: `cliente.${campo}`,
                rule: 'prohibido',
                message: 'Un titular empresa no lleva documento de persona: va en representante',
            })
        }
    }
    if (input.cliente.tipo_documento_fiscal !== undefined && input.cliente.tipo_documento_fiscal !== 'nit') {
        prohibidos.push({
            field: 'cliente.tipo_documento_fiscal',
            rule: 'nit',
            message: 'Un titular empresa factura con NIT',
        })
    }
    if (prohibidos.length > 0) throw new ValidacionFallida(prohibidos)
    const nitCrudo = input.cliente.nit_cui?.trim() ?? ''
    if (nitCrudo === '') throw new NitRequerido()
    const nit = normalizarNit(nitCrudo)
    if (!nitValido(nit)) {
        throw new ValidacionFallida([
            { field: 'cliente.nit_cui', rule: 'nit', message: 'NIT inválido: revisa el dígito verificador' },
        ])
    }
    const rep = input.representante
    if (!rep) throw new RepresentanteRequerido()
    if (rep.mayor_de_edad !== true) {
        throw new ValidacionFallida([
            {
                field: 'representante.mayor_de_edad',
                rule: 'aceptado',
                message: 'El representante debe ser mayor de edad',
            },
        ])
    }
    return {
        documento: {
            tipo: rep.documento_tipo,
            numero: rep.documento_numero,
            nombre: rep.nombre,
            mayor_de_edad: rep.mayor_de_edad,
        },
        nit,
    }
}

/**
 * `servicios.cambiar_titular` (`POST /servicios/:id/cambiar-titular`, contrato Iris 0.10.0 §3.4.4,
 * A39; decisión 9 del PM; titular empresa desde 0.14.1): el servicio pendiente pasa a otro titular.
 * **Quién es lo decide Argos** (Iris nunca manda `cliente_id`), comparando en la empresa del servicio.
 *
 * Persona (por documento, solo entre clientes `persona`):
 * - mismo documento y mismo nombre normalizado → ese cliente, al momento (`existente: true`), con la
 *   identidad como versión nueva; notify le manda un aviso informativo (`servicio.titular_cambiado`);
 * - mismo documento y otro nombre → 422 `titular_no_coincide`, sin datos del otro cliente; suma al
 *   contador del documento (5 en 24 h: después, 429 hacia ese documento);
 * - ningún cliente con ese documento → uno nuevo (`posible_duplicado` si coinciden el nombre o el
 *   teléfono de otro cliente con otro documento).
 *
 * Empresa (por NIT normalizado, solo entre clientes `tipo = empresa` con NIT verificado en el panel,
 * `clientes.verificar_nit`):
 * - un candidato con la misma razón social → se asigna al momento solo si el representante
 *   (documento y nombre) coincide con una identidad A41, vigente o anterior, de esa empresa; si no,
 *   422 `titular_empresa_en_revision` y queda una solicitud que decide una persona con
 *   `clientes.ver_identidad` (`servicios.aprobar_titular_empresa` / `servicios.rechazar_titular_empresa`);
 * - un candidato con otra razón social → 422 `titular_no_coincide`;
 * - más de un candidato → 422 `titular_empresa_en_revision`;
 * - ninguno → cliente empresa nuevo (NIT sin verificar). `posible_duplicado` también si otro cliente
 *   tiene ese NIT sin verificar.
 * Los `titular_no_coincide` y `titular_empresa_en_revision` suman al contador del NIT (5 en 24 h, con
 * cualquier representante). La identidad del representante nunca escribe `nit_cui` ni vale para
 * §7.5 o §12.4 del cliente empresa.
 *
 * Solo en `pendiente_instalacion` (422 `servicio_no_pendiente`); sin `frente` o sin `coincide`, 422
 * `evidencia_requerida`; 2 cambios por servicio y 10 por empresa y actor al día (429
 * `demasiados_cambios_titular` con `Retry-After`). Mueve el servicio (con sus credenciales PPP); las
 * facturas ya emitidas no se mueven. El cliente anterior sin servicios ni movimientos se elimina.
 * Emite `servicio.titular_cambiado` (con `tipo_titular`) y `cliente.identidad_registrada`. El
 * `motivo` (texto) queda solo en la auditoría; `cliente` y `representante.*` (salvo
 * `documento_tipo`) como `***`.
 */
export default class CambiarTitularServicio extends DomainAction<EntradaCambiarTitular, TitularCambiado> {
    readonly nombre = 'servicios.cambiar_titular'
    protected readonly camposEntradaOcultos = ['cliente']

    protected ajustarEntradaAuditada(entrada: unknown): unknown {
        if (typeof entrada !== 'object' || entrada === null) return entrada
        const rep = (entrada as Record<string, unknown>).representante
        if (typeof rep !== 'object' || rep === null) return entrada
        const oculto: Record<string, unknown> = {}
        for (const [clave, valor] of Object.entries(rep)) {
            oculto[clave] = clave === 'documento_tipo' ? valor : '***'
        }
        return { ...(entrada as Record<string, unknown>), representante: oculto }
    }

    /**
     * Si el cambio a una empresa queda en revisión, la solicitud se guarda **después** del rollback,
     * en su propia transacción: el 422 no cambia nada del servicio ni del cliente, pero una persona
     * de Argos tiene qué decidir. Solo como acción de nivel superior.
     */
    async execute(
        input: EntradaCambiarTitular,
        ctx: ContextoAccion,
        opciones: { trx?: TransactionClientContract } = {},
    ): Promise<TitularCambiado> {
        try {
            return await super.execute(input, ctx, opciones)
        } catch (error) {
            if (error instanceof TitularEmpresaEnRevision && error.solicitud && !opciones.trx) {
                try {
                    await guardarSolicitudRevision(error.solicitud, ctx)
                } catch (errorRevision) {
                    logger.error(
                        { err: errorRevision, requestId: ctx.requestId },
                        'No se pudo guardar la revisión del titular empresa',
                    )
                }
            }
            throw error
        }
    }

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
        const tipoTitular: TipoTitular = input.cliente.tipo ?? 'persona'
        const { documento, nit } = validarForma(input)
        if (input.identidad.coincide !== true) throw new EvidenciaRequerida()

        const numero = validarDocumentoIdentidad(
            documento.tipo,
            documento.numero,
            tipoTitular === 'empresa' ? 'representante.documento_numero' : 'cliente.documento_numero',
        )
        // teléfono de Guatemala o internacional (§3.2); 422 sin repetir el valor
        telefonoParaGuardar('cliente.telefono', input.cliente.telefono, null, t.ctx)

        // límites: 2 por servicio y 10 por empresa y actor al día; tope de `titular_no_coincide`
        // (por documento en personas, por NIT en empresas)
        const actor = t.ctx.iris?.actor ?? `usuario:${usuarioDelActor(t.ctx.actor) ?? 'sistema'}`
        const claves = {
            servicio: claveLimite('titular', 'servicio', input.id),
            actor: claveLimite('titular', 'actor', servicio.empresa_id, actor),
            noCoincide:
                nit !== null
                    ? claveLimite('titular', 'no_coincide_nit', servicio.empresa_id, huella(nit))
                    : claveLimite('titular', 'no_coincide', servicio.empresa_id, huella(numero)),
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
        const sumarNoCoincide = () => contarEnVentana(claves.noCoincide, LIMITES_TITULAR.ventanaS)

        const deClienteId = await clienteDelServicio(t, input.id)
        let titularId: number | null = null
        let existente = false
        let posibleDuplicado = false
        if (nit === null) {
            const candidato = await buscarPorDocumento(t, servicio.empresa_id, documento.tipo, numero)
            if (candidato) {
                if (!(await mismoNombre(t, candidato, input.cliente.nombre))) {
                    // contador aparte del documento (ajuste ab): no toca la verificación de §7.5
                    await sumarNoCoincide()
                    throw new TitularNoCoincide()
                }
                titularId = candidato
                existente = true
            }
        } else {
            const candidatos = await candidatosPorNit(t, servicio.empresa_id, nit)
            const solicitud = (
                motivo: SolicitudRevisionEmpresa['motivo_revision'],
                ids: number[],
            ): SolicitudRevisionEmpresa => ({
                empresa_id: servicio.empresa_id,
                servicio_id: input.id,
                de_cliente_id: deClienteId,
                candidatos: ids,
                motivo_revision: motivo,
                razon_social: input.cliente.nombre.trim(),
                nit,
                telefono: input.cliente.telefono,
                whatsapp: input.cliente.whatsapp === true,
                email: input.cliente.email ?? null,
                relacion: input.cliente.relacion ?? null,
                representante: {
                    documento_tipo: documento.tipo,
                    documento_numero: numero,
                    nombre: documento.nombre,
                },
                frente: input.frente,
                reverso: input.reverso ?? null,
                verificado_en: input.identidad.verificado_en,
                metodo: input.identidad.metodo,
                motivo_codigo: input.motivo_codigo,
                motivo: input.motivo,
                origen_tipo: input.origen_tipo ?? null,
                origen_id: input.origen_id ?? null,
            })
            if (candidatos.length > 1) {
                await sumarNoCoincide()
                throw new TitularEmpresaEnRevision(solicitud('varios_candidatos', candidatos))
            }
            const candidato = candidatos[0]
            if (candidato !== undefined) {
                if (!(await mismaRazonSocial(t, candidato, input.cliente.nombre))) {
                    await sumarNoCoincide()
                    throw new TitularNoCoincide()
                }
                const registrado = await representanteRegistrado(
                    t.trx,
                    candidato,
                    documento.tipo,
                    numero,
                    documento.nombre,
                )
                if (registrado === null) {
                    // un representante nuevo nunca reemplaza la identidad vigente (ajuste a)
                    await sumarNoCoincide()
                    throw new TitularEmpresaEnRevision(solicitud('representante_nuevo', [candidato]))
                }
                titularId = candidato
                existente = true
            } else {
                posibleDuplicado = await nitSinVerificadoEnOtro(t, servicio.empresa_id, nit, deClienteId)
            }
        }

        if (titularId === null) {
            posibleDuplicado =
                posibleDuplicado ||
                (await hayPosibleDuplicado(t, servicio.empresa_id, input.cliente, deClienteId))
            const nuevo = await new CrearCliente().execute(
                {
                    nombre: input.cliente.nombre.trim(),
                    telefono: input.cliente.telefono,
                    email: input.cliente.email ?? null,
                    ...(tipoTitular === 'empresa'
                        ? { tipo: 'empresa' as const, tipo_documento_fiscal: 'nit' as const, nit_cui: nit }
                        : {
                              ...(input.cliente.tipo_documento_fiscal
                                  ? { tipo_documento_fiscal: input.cliente.tipo_documento_fiscal }
                                  : {}),
                              nit_cui: input.cliente.nit_cui ?? null,
                          }),
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

        const aplicado = await aplicarCambioTitular(t, {
            servicioId: input.id,
            empresaId: servicio.empresa_id,
            deClienteId,
            titularId,
            existente,
            posibleDuplicado,
            tipoTitular,
            identidad: {
                documento_tipo: documento.tipo,
                documento_numero: numero,
                nombre: documento.nombre,
                mayor_de_edad: documento.mayor_de_edad,
                verificado_en: input.identidad.verificado_en,
                metodo: input.identidad.metodo,
                frente: input.frente,
                reverso: input.reverso ?? null,
            },
            motivo_codigo: input.motivo_codigo,
            origen_tipo: input.origen_tipo,
            origen_id: input.origen_id,
            desdeIris: input.desdeIris,
        })
        t.alConfirmar(async () => {
            await contarEnVentana(claves.servicio, LIMITES_TITULAR.ventanaS)
            await contarEnVentana(claves.actor, LIMITES_TITULAR.ventanaS)
        })
        return {
            servicio_id: input.id,
            titular: { cliente_id: titularId, existente },
            posible_duplicado: posibleDuplicado,
            identidad_id: aplicado.identidad_id,
            de_cliente_id: deClienteId,
            de_cliente_eliminado: aplicado.de_cliente_eliminado,
        }
    }
}

export interface CambioTitularAplicable {
    servicioId: number
    empresaId: number
    deClienteId: number
    titularId: number
    existente: boolean
    posibleDuplicado: boolean
    tipoTitular: TipoTitular
    identidad: {
        documento_tipo: DocumentoIdentidad
        documento_numero: string
        nombre: string
        mayor_de_edad: boolean
        verificado_en: Date
        metodo: MetodoIdentidad
        frente: FotoIdentidad
        reverso: FotoIdentidad | null
    }
    motivo_codigo: string
    origen_tipo: string | null
    origen_id: string | null
    desdeIris?: boolean
}

/**
 * Lo que hace el cambio una vez decidido el titular (A39 al momento, o la aprobación de una revisión
 * de titular empresa): mueve el servicio, registra la identidad (A41) en el titular, elimina al
 * anterior sin historial y emite `servicio.titular_cambiado`.
 */
export async function aplicarCambioTitular(
    t: Transaccion,
    c: CambioTitularAplicable,
): Promise<{ identidad_id: number; de_cliente_eliminado: boolean }> {
    if (c.titularId !== c.deClienteId) {
        await t.trx
            .from('core.servicios')
            .where('id', c.servicioId)
            .update({
                cliente_id: c.titularId,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        await t.registrarCambios(
            { tipo: 'servicio', id: c.servicioId },
            { cliente_id: c.deClienteId },
            { cliente_id: c.titularId },
        )
    }

    const identidad = await new RegistrarIdentidadCliente().execute(
        {
            cliente_id: c.titularId,
            documento_tipo: c.identidad.documento_tipo,
            documento_numero: c.identidad.documento_numero,
            nombre: c.identidad.nombre,
            mayor_de_edad: c.identidad.mayor_de_edad,
            coincide: true,
            verificado_en: c.identidad.verificado_en,
            metodo: c.identidad.metodo,
            origen_tipo: c.origen_tipo,
            origen_id: c.origen_id,
            frente: c.identidad.frente,
            reverso: c.identidad.reverso,
            servicio_id: c.servicioId,
            desdeIris: c.desdeIris,
            // ya se comparó documento y nombre (existente), se aprobó o el cliente es nuevo
            sinRevisarHistorial: true,
        },
        t.ctx,
        { trx: t.trx },
    )

    const eliminado =
        c.titularId !== c.deClienteId ? await eliminarSiNoTieneHistorial(t, c.deClienteId) : false
    await t.emit('servicio.titular_cambiado', {
        servicio_id: c.servicioId,
        empresa_id: c.empresaId,
        de_cliente_id: c.deClienteId,
        a_cliente_id: c.titularId,
        existente: c.existente,
        posible_duplicado: c.posibleDuplicado,
        de_cliente_eliminado: eliminado,
        motivo_codigo: c.motivo_codigo === 'menor_de_edad' ? 'menor_de_edad' : 'otro',
        origen_tipo: c.origen_tipo,
        origen_id: c.origen_id,
        tipo_titular: c.tipoTitular,
    })
    refrescarAaaAlConfirmar(t, { servicioId: c.servicioId })
    return { identidad_id: identidad.identidad_id, de_cliente_eliminado: eliminado }
}

/**
 * Guarda la solicitud de revisión de un titular empresa (`core.titulares_empresa_revision`) en su
 * propia transacción. Documento, nombre del representante y fotos van cifrados; una solicitud
 * pendiente anterior del mismo servicio queda `reemplazada`.
 */
async function guardarSolicitudRevision(s: SolicitudRevisionEmpresa, ctx: ContextoAccion): Promise<void> {
    await db.transaction(async (trx) => {
        const t = new Transaccion(trx, ctx)
        const anteriores = (await trx
            .from('core.titulares_empresa_revision')
            .where({ servicio_id: s.servicio_id, estado: 'pendiente' })
            .forUpdate()
            .select('id')) as Array<{ id: number }>
        for (const anterior of anteriores) {
            await trx
                .from('core.titulares_empresa_revision')
                .where('id', anterior.id)
                .update({
                    estado: 'reemplazada',
                    frente: null,
                    frente_tipo: null,
                    reverso: null,
                    reverso_tipo: null,
                    representante_documento_cifrado: null,
                    representante_nombre_cifrado: null,
                    version: trx.knexRawQuery('version + 1'),
                    updated_at: trx.knexRawQuery('now()'),
                })
            await t.registrarCambios(
                { tipo: 'titular_empresa_revision', id: Number(anterior.id) },
                { estado: 'pendiente' },
                { estado: 'reemplazada' },
            )
        }
        const [fila] = (await trx
            .insertQuery()
            .table('core.titulares_empresa_revision')
            .insert({
                empresa_id: s.empresa_id,
                servicio_id: s.servicio_id,
                de_cliente_id: s.de_cliente_id,
                candidatos: s.candidatos,
                motivo_revision: s.motivo_revision,
                razon_social: s.razon_social,
                nit: s.nit,
                telefono: s.telefono,
                whatsapp: s.whatsapp,
                email: s.email,
                relacion: s.relacion,
                representante_documento_tipo: s.representante.documento_tipo,
                representante_documento_cifrado: cifrarTexto(s.representante.documento_numero),
                representante_documento_huella: huella(s.representante.documento_numero),
                representante_nombre_cifrado: cifrarTexto(s.representante.nombre.trim()),
                representante_nombre_huella: huella(normalizarNombre(s.representante.nombre)),
                frente: cifrarBytes(s.frente.contenido),
                frente_tipo: s.frente.tipo,
                reverso: s.reverso ? cifrarBytes(s.reverso.contenido) : null,
                reverso_tipo: s.reverso?.tipo ?? null,
                verificado_en: s.verificado_en,
                metodo: s.metodo,
                motivo_codigo: s.motivo_codigo,
                motivo: s.motivo,
                origen_tipo: s.origen_tipo,
                origen_id: s.origen_id,
                iris_actor: ctx.iris?.actor ?? null,
                solicitada_por: usuarioDelActor(ctx.actor),
                request_id: ctx.requestId,
            })
            .returning('id')) as Array<{ id: number }>
        await t.registrarCambios({ tipo: 'titular_empresa_revision', id: Number(fila!.id) }, null, {
            servicio_id: s.servicio_id,
            empresa_id: s.empresa_id,
            motivo_revision: s.motivo_revision,
            candidatos: s.candidatos.join(','),
            estado: 'pendiente',
            representante_documento_tipo: s.representante.documento_tipo,
            representante_documento_numero: '***',
            representante_nombre: '***',
        })
    })
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
 * Cliente persona de la empresa con ese documento: por su identidad vigente (huella) o, para un DPI,
 * por el `nit_cui` de tipo `cui`. El más antiguo si hay varios. Nunca un cliente `empresa`: la
 * identidad de su representante no es su documento (0.14.1).
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
        .whereNot('c.tipo', 'empresa')
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

/**
 * Candidatos por NIT (0.14.1, ajuste b): clientes `tipo = empresa` de la empresa con ese NIT
 * normalizado **verificado en el panel** (`nit_verificado_en`). Nunca un cliente persona ni un NIT
 * llenado por A43 o por el token de Iris (no tienen la marca).
 */
async function candidatosPorNit(t: Transaccion, empresaId: number, nit: string): Promise<number[]> {
    const filas = (await t.trx
        .from('core.clientes as c')
        .whereRaw(SQL_EN_EMPRESA, [empresaId])
        .where('c.tipo', 'empresa')
        .whereNotNull('c.nit_verificado_en')
        .whereRaw(`${sqlNitNormalizado('c.nit_cui')} = ?`, [nit])
        .orderBy('c.id')
        .select('c.id')) as Array<{ id: number }>
    return filas.map((f) => Number(f.id))
}

/** Otro cliente de la empresa con ese NIT pero sin verificar (o persona): posible duplicado (B4). */
async function nitSinVerificadoEnOtro(
    t: Transaccion,
    empresaId: number,
    nit: string,
    excluir: number,
): Promise<boolean> {
    const fila = await t.trx
        .from('core.clientes as c')
        .whereRaw(SQL_EN_EMPRESA, [empresaId])
        .whereNot('c.id', excluir)
        .whereRaw(`${sqlNitNormalizado('c.nit_cui')} = ?`, [nit])
        .select('c.id')
        .first()
    return Boolean(fila)
}

/** Razón social normalizada igual al `nombre` o al `nombre_fiscal` del cliente empresa. */
async function mismaRazonSocial(t: Transaccion, clienteId: number, nombre: string): Promise<boolean> {
    const normal = normalizarNombre(nombre)
    const cliente = (await t.trx
        .from('core.clientes')
        .where('id', clienteId)
        .select('nombre', 'nombre_fiscal')
        .first()) as { nombre: string; nombre_fiscal: string | null }
    return (
        normalizarNombre(cliente.nombre) === normal ||
        (cliente.nombre_fiscal !== null && normalizarNombre(cliente.nombre_fiscal) === normal)
    )
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
