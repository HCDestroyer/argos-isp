import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import {
    TitularNoCoincide,
    cifrarBytes,
    cifrarTexto,
    clienteConHistorial,
    compararConCliente,
    huella,
    normalizarNombre,
    validarDocumentoIdentidad,
    type DocumentoIdentidad,
    type FotoIdentidad,
    type MetodoIdentidad,
} from '#core/identidad'
import { ServicioNoDeIris, esServicioDeIris, registrarOrigenIris } from '#core/instalacion_iris'

export interface EntradaRegistrarIdentidad {
    cliente_id: number
    documento_tipo: DocumentoIdentidad
    /** se audita como `***`; nunca va a eventos ni logs */
    documento_numero: string
    /** como aparece en el documento; se audita como `***` */
    nombre: string
    mayor_de_edad: boolean
    coincide: boolean
    verificado_en: Date
    metodo: MetodoIdentidad
    origen_tipo?: string | null
    origen_id?: string | null
    frente: FotoIdentidad
    reverso?: FotoIdentidad | null
    /** el servicio pendiente de la instalación (A39 lo pasa; si no, el pendiente del cliente) */
    servicio_id?: number
    /** la pidió el token de Iris: solo para el cliente de un pendiente de Iris (§3.4.3) */
    desdeIris?: boolean
    /** A39: el cliente se acaba de crear o asignar en esta misma transacción; no revisa historial */
    sinRevisarHistorial?: boolean
}

export interface IdentidadRegistrada {
    identidad_id: number
    version: number
}

/** 422 `cliente_sin_instalacion` (§3.4.7): el cliente no tiene un servicio pendiente con orden de Iris. */
export class ClienteSinInstalacion extends ReglaNegocio {
    constructor() {
        super(
            'El cliente no tiene un servicio pendiente de instalación con una orden de Iris en curso',
            'cliente_sin_instalacion',
        )
    }
}

/**
 * `clientes.registrar_identidad` (`POST /clientes/:id/identidad`, contrato Iris 0.10.0 §3.4.3, A41):
 * guarda la foto del documento (frente obligatorio, reverso opcional), el tipo y número y el nombre
 * como aparecen en él, **cifrados en reposo**, como versión nueva de la identidad del cliente.
 *
 * - `mayor_de_edad` y `coincide` deben ser `true` (422 `validacion`).
 * - Desde Iris, solo para el cliente de un servicio `pendiente_instalacion` (422
 *   `cliente_sin_instalacion`) que sea de Iris (403 `servicio_no_de_iris`).
 * - Cliente con historial (otros servicios no pendientes, facturas o pagos): si Argos ya tiene su
 *   documento, deben coincidir el número y el nombre normalizado (422 `titular_no_coincide`); si no
 *   tiene documento, se guarda sin confirmar (`confirmada: false`: no vale para §7.5 ni §12.4). Nunca
 *   escribe `nit_cui`.
 * - Solo quedan la vigente y la anterior; la más vieja se borra.
 * - Emite `cliente.identidad_registrada` (sin número ni foto). Número, nombre y fotos se auditan
 *   como `***`.
 */
export default class RegistrarIdentidadCliente extends DomainAction<
    EntradaRegistrarIdentidad,
    IdentidadRegistrada
> {
    readonly nombre = 'clientes.registrar_identidad'
    protected readonly camposEntradaOcultos = ['documento_numero', 'nombre']

    protected async handle(input: EntradaRegistrarIdentidad, t: Transaccion): Promise<IdentidadRegistrada> {
        t.fijarEntidad('cliente', input.cliente_id)
        const errores = []
        if (input.mayor_de_edad !== true) {
            errores.push({
                field: 'mayor_de_edad',
                rule: 'aceptado',
                message: 'El titular debe ser mayor de edad',
            })
        }
        if (input.coincide !== true) {
            errores.push({
                field: 'coincide',
                rule: 'aceptado',
                message: 'La foto debe coincidir con el titular',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const numero = validarDocumentoIdentidad(input.documento_tipo, input.documento_numero)

        const cliente = await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .forUpdate()
            .select('id')
            .first()
        if (!cliente) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)

        const servicio = await servicioPendiente(t, input)
        t.fijarEmpresa(servicio?.empresa_id ?? null)

        let confirmada = true
        if (!input.sinRevisarHistorial && (await clienteConHistorial(t.trx, input.cliente_id))) {
            const conocido = await compararConCliente(
                t.trx,
                input.cliente_id,
                input.documento_tipo,
                numero,
                input.nombre,
            )
            if (conocido.tieneDocumento && !(conocido.coincideDocumento && conocido.coincideNombre)) {
                throw new TitularNoCoincide()
            }
            confirmada = conocido.tieneDocumento
        }

        const ultima = (await t.trx
            .from('core.clientes_identidades')
            .where('cliente_id', input.cliente_id)
            .max('version as version')
            .first()) as { version: number | null }
        const version = Number(ultima?.version ?? 0) + 1
        await t.trx
            .from('core.clientes_identidades')
            .where({ cliente_id: input.cliente_id, vigente: true })
            .update({
                vigente: false,
            })
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.clientes_identidades')
            .insert({
                cliente_id: input.cliente_id,
                version,
                vigente: true,
                documento_tipo: input.documento_tipo,
                documento_cifrado: cifrarTexto(numero),
                documento_huella: huella(numero),
                nombre_cifrado: cifrarTexto(input.nombre.trim()),
                nombre_huella: huella(normalizarNombre(input.nombre)),
                mayor_de_edad: true,
                coincide: true,
                verificado_en: input.verificado_en,
                metodo: input.metodo,
                confirmada,
                frente: cifrarBytes(input.frente.contenido),
                frente_tipo: input.frente.tipo,
                reverso: input.reverso ? cifrarBytes(input.reverso.contenido) : null,
                reverso_tipo: input.reverso?.tipo ?? null,
                origen_tipo: input.origen_tipo ?? null,
                origen_id: input.origen_id ?? null,
                registrada_por: usuarioDelActor(t.ctx.actor),
                iris_actor: t.ctx.iris?.actor ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        // solo la vigente y la anterior (§3.4.3)
        await t.trx
            .from('core.clientes_identidades')
            .where('cliente_id', input.cliente_id)
            .where('version', '<', version - 1)
            .delete()
        await t.registrarCambios({ tipo: 'cliente_identidad', id }, null, {
            cliente_id: input.cliente_id,
            version,
            documento_tipo: input.documento_tipo,
            metodo: input.metodo,
            confirmada,
            documento_numero: '***',
            nombre: '***',
        })
        await t.emit('cliente.identidad_registrada', {
            cliente_id: input.cliente_id,
            empresa_id: servicio?.empresa_id ?? null,
            identidad_id: id,
            documento_tipo: input.documento_tipo,
            metodo: input.metodo,
            origen_tipo: input.origen_tipo ?? null,
            origen_id: input.origen_id ?? null,
        })
        return { identidad_id: id, version }
    }
}

/**
 * El servicio pendiente de la instalación: el indicado o el pendiente del cliente. Desde Iris es
 * obligatorio (422 `cliente_sin_instalacion`) y debe ser de Iris (403 `servicio_no_de_iris`); la
 * orden queda registrada para el servicio.
 */
async function servicioPendiente(
    t: Transaccion,
    input: EntradaRegistrarIdentidad,
): Promise<{ id: number; empresa_id: number } | null> {
    const filas = (await t.trx
        .from('core.servicios')
        .where('cliente_id', input.cliente_id)
        .where('estado', 'pendiente_instalacion')
        .if(input.servicio_id !== undefined, (q) => q.where('id', input.servicio_id!))
        .orderBy('id')
        .select('id', 'empresa_id')) as Array<{ id: number; empresa_id: number }>
    if (!input.desdeIris) {
        const primero = filas[0]
        return primero ? { id: Number(primero.id), empresa_id: Number(primero.empresa_id) } : null
    }
    if (filas.length === 0) throw new ClienteSinInstalacion()
    for (const fila of filas) {
        if (await esServicioDeIris(t.trx, Number(fila.id))) {
            if (input.origen_tipo && input.origen_id) {
                await registrarOrigenIris(t.trx, Number(fila.id), {
                    origen_tipo: input.origen_tipo,
                    origen_id: input.origen_id,
                })
            }
            return { id: Number(fila.id), empresa_id: Number(fila.empresa_id) }
        }
    }
    throw new ServicioNoDeIris()
}
