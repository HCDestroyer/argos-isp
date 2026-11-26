import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { CAMPOS_CLIENTE_ACTUALIZADO, type CatalogoEventos } from '#shared/eventos'
import { verificarVersion } from '#shared/version'
import { verCliente } from '#core/consultas/clientes'
import { verServicio, type ServicioVista } from '#core/consultas/servicios'
import { telefonoParaGuardar } from '#core/telefonos'
import { validarDocumentoFiscal, type TipoDocumentoFiscal } from '#core/nit_cui'
import { clienteConHistorial, descifrarTexto, normalizarNombre } from '#core/identidad'
import { ServicioNoPendiente, bloquearServicio, exigirServicioDeIris } from '#core/instalacion_iris'

export interface EntradaCompletarDatos {
    id: number
    cliente?: {
        nombre?: string
        telefono?: string
        whatsapp?: boolean
        email?: string
        tipo_documento_fiscal?: TipoDocumentoFiscal
        nit_cui?: string | null
        /** relación con quien pidió el servicio: queda solo en la auditoría */
        relacion?: 'titular' | 'familiar' | 'otro'
    }
    servicio?: {
        direccion?: string
        referencia?: string
        coordenadas?: string
        precision_m?: number
    }
    identidad_id?: number
    version?: number
    origen_tipo: string
    origen_id: string
    desdeIris?: boolean
}

/** 422 `campo_ya_registrado` (§3.4.7): A43 solo llena campos vacíos del cliente. */
class CampoYaRegistrado extends ReglaNegocio {
    constructor(campos: string[]) {
        super(
            'El cliente ya tiene esos datos: completar-datos solo llena los vacíos',
            'campo_ya_registrado',
            campos.map((field) => ({
                field: `cliente.${field}`,
                rule: 'campo_ya_registrado',
                message: 'Ya registrado',
            })),
        )
    }
}

/** 422 `cliente_con_historial` (§3.4.7): esos datos de un cliente con historial los cambia Argos. */
class ClienteConHistorial extends ReglaNegocio {
    constructor(campos: string[]) {
        super(
            'El cliente tiene historial: sus datos de contacto, nombre y receptor fiscal los cambia Argos o el titular',
            'cliente_con_historial',
            campos.map((field) => ({
                field: `cliente.${field}`,
                rule: 'cliente_con_historial',
                message: 'No se cambia',
            })),
        )
    }
}

const PROTEGIDOS_CON_HISTORIAL = [
    'telefono',
    'movil',
    'email',
    'nombre',
    'tipo_documento_fiscal',
    'nit_cui',
] as const
type CampoDatos = CatalogoEventos['servicio.datos_cambiados']['campos'][number]

/**
 * `servicios.completar_datos` (`POST /servicios/:id/completar-datos`, contrato Iris 0.10.0 §3.4.6,
 * A43): completa, antes de activar, lo que el titular no dio al vender.
 *
 * - Solo con el servicio `pendiente_instalacion` (422 `servicio_no_pendiente`) y para el cliente de
 *   ese servicio. `version` del servicio opcional (409 si llega y no coincide).
 * - Del cliente **solo llena vacíos** (422 `campo_ya_registrado`). El `nombre` se corrige solo con
 *   `identidad_id` de una identidad vigente del cliente, y debe coincidir con el de la identidad.
 * - Cliente con historial: no acepta `telefono`, `movil`, `email`, `nombre`, `tipo_documento_fiscal` ni
 *   `nit_cui` (422 `cliente_con_historial`).
 * - «Facturar a» (`tipo_documento_fiscal` + `nit_cui`) se valida como en el alta (422 `validacion`).
 * - Teléfono y correo agregados aquí no cuentan como registrados (`campos_sin_confirmar`) hasta que el
 *   titular los confirme; `whatsapp: true` deja WhatsApp como canal preferido si el cliente no tiene
 *   correo.
 * - Del servicio sí corrige dirección, referencia, coordenadas y su precisión.
 * - Emite `cliente.actualizado` y `servicio.datos_cambiados` (con la orden), solo nombres de campo.
 */
export default class CompletarDatosServicio extends DomainAction<EntradaCompletarDatos, ServicioVista> {
    readonly nombre = 'servicios.completar_datos'

    protected async handle(input: EntradaCompletarDatos, t: Transaccion): Promise<ServicioVista> {
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

        const antesServicio = await verServicio(input.id, t.trx)
        const clienteId = antesServicio.cliente_id
        const datos = input.cliente ?? {}

        // ── cliente ──
        const pedidos = (Object.keys(datos) as Array<keyof typeof datos>).filter(
            (c) => datos[c] !== undefined,
        )
        const protegidos = PROTEGIDOS_CON_HISTORIAL.filter((c) => pedidos.includes(c as never))
        if (protegidos.length > 0 && (await clienteConHistorial(t.trx, clienteId))) {
            throw new ClienteConHistorial([...protegidos])
        }
        const antes = await verCliente(clienteId, t.trx)
        const columnas: Record<string, unknown> = {}
        const sinConfirmar: string[] = []
        const yaRegistrados: string[] = []
        const vacio = (valor: unknown) => valor === null || valor === undefined || String(valor).trim() === ''

        if (datos.nombre !== undefined) {
            // Iris 0.14.1: en una empresa la identidad es la del representante; nunca corrige la razón social
            const nombre =
                antes.tipo === 'empresa' ? null : await nombreDeIdentidad(t, clienteId, input.identidad_id)
            if (nombre === null) yaRegistrados.push('nombre')
            else if (normalizarNombre(nombre) !== normalizarNombre(datos.nombre)) {
                throw new ValidacionFallida([
                    {
                        field: 'cliente.nombre',
                        rule: 'identidad',
                        message: 'Debe ser el nombre como aparece en el documento',
                    },
                ])
            } else if (datos.nombre.trim() !== antes.nombre) columnas.nombre = datos.nombre.trim()
        }
        if (datos.telefono !== undefined) {
            if (!vacio(antes.telefono)) yaRegistrados.push('telefono')
            else {
                columnas.telefono = telefonoParaGuardar('cliente.telefono', datos.telefono, null, t.ctx)
                sinConfirmar.push('telefono')
            }
        }
        if (datos.email !== undefined) {
            if (!vacio(antes.email)) yaRegistrados.push('email')
            else {
                columnas.email = datos.email.trim()
                sinConfirmar.push('email')
            }
        }
        if (datos.tipo_documento_fiscal !== undefined || datos.nit_cui !== undefined) {
            if (!vacio(antes.nit_cui) && antes.nit_cui !== 'CF') yaRegistrados.push('nit_cui')
            else {
                const documento = validarDocumentoFiscal({
                    tipo: datos.tipo_documento_fiscal,
                    valor: datos.nit_cui,
                    pais: String(antes.pais_fiscal ?? 'GT'),
                })
                // Iris (completar datos, `contratos/iris.md`) sigue estricto: el NIT tolerante de fel-establecimientos R1 es
                // solo para el panel; desde Iris un NIT sin dígito verificador sigue siendo 422.
                if (documento.nit_cui_invalido) {
                    throw new ValidacionFallida([
                        {
                            field: 'nit_cui',
                            message: 'El NIT no es válido (dígito verificador)',
                            rule: 'nit',
                        },
                    ])
                }
                Object.assign(columnas, documento)
            }
        }
        if (yaRegistrados.length > 0) throw new CampoYaRegistrado(yaRegistrados)
        if (datos.whatsapp === true && vacio(antes.email) && columnas.email === undefined) {
            columnas.canal_preferido = 'whatsapp'
        }
        if (Object.keys(columnas).length > 0) {
            await t.trx
                .from('core.clientes')
                .where('id', clienteId)
                .update({
                    ...columnas,
                    ...(sinConfirmar.length > 0
                        ? {
                              campos_sin_confirmar: t.trx.knexRawQuery(
                                  'array(SELECT DISTINCT x FROM unnest(campos_sin_confirmar || CAST(? AS text[])) x ORDER BY x)',
                                  [`{${sinConfirmar.join(',')}}`],
                              ),
                          }
                        : {}),
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            const despues = await verCliente(clienteId, t.trx)
            await t.registrarCambios({ tipo: 'cliente', id: clienteId }, antes, despues)
            const campos = CAMPOS_CLIENTE_ACTUALIZADO.filter((c) => antes[c] !== despues[c])
            if (campos.length > 0) await t.emit('cliente.actualizado', { cliente_id: clienteId, campos })
        }

        // ── lugar del servicio ──
        const lugar = input.servicio ?? {}
        const columnasServicio: Record<string, unknown> = {}
        for (const campo of ['direccion', 'referencia', 'coordenadas', 'precision_m'] as const) {
            if (lugar[campo] === undefined) continue
            // metros enteros (la precisión del GPS no necesita decimales)
            columnasServicio[campo] = campo === 'precision_m' ? Math.round(lugar.precision_m!) : lugar[campo]
        }
        if (Object.keys(columnasServicio).length > 0) {
            await t.trx
                .from('core.servicios')
                .where('id', input.id)
                .update({
                    ...columnasServicio,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        }
        const despuesServicio = await verServicio(input.id, t.trx)
        await t.registrarCambios({ tipo: 'servicio', id: input.id }, antesServicio, despuesServicio)
        const camposServicio = (['direccion', 'referencia', 'coordenadas', 'precision_m'] as const).filter(
            (c) => antesServicio[c] !== despuesServicio[c],
        ) as CampoDatos[]
        if (camposServicio.length > 0) {
            await t.emit('servicio.datos_cambiados', {
                servicio_id: input.id,
                empresa_id: servicio.empresa_id,
                empresas: [servicio.empresa_id],
                cliente_id: clienteId,
                campos: camposServicio,
                ...origen,
            })
        }
        return despuesServicio
    }
}

/**
 * Nombre de la identidad vigente del cliente (`identidad_id`), para corregir el nombre (§3.4.6).
 * null sin `identidad_id`: el nombre ya está registrado y no se toca. 422 si no es una identidad
 * vigente de este cliente.
 */
async function nombreDeIdentidad(
    t: Transaccion,
    clienteId: number,
    identidadId: number | undefined,
): Promise<string | null> {
    if (identidadId === undefined) return null
    const fila = (await t.trx
        .from('core.clientes_identidades')
        .where({ id: identidadId, cliente_id: clienteId, vigente: true })
        .select('nombre_cifrado')
        .first()) as { nombre_cifrado: string } | null
    if (!fila) {
        throw new ValidacionFallida([
            {
                field: 'identidad_id',
                rule: 'exists',
                message: 'No es la identidad vigente del titular de este servicio',
            },
        ])
    }
    return descifrarTexto(fila.nombre_cifrado)
}
