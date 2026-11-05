import { createHash, timingSafeEqual } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { limpiarDocumento } from '#core/nit_cui'
import { LimiteIdentidad } from '#core/limite_identidad'

export const METODOS_VERIFICACION = ['documento', 'nombre', 'codigo_cliente'] as const
export type MetodoVerificacion = (typeof METODOS_VERIFICACION)[number]

export interface EntradaVerificarIdentidad {
    cliente_id: number
    metodo: MetodoVerificacion
    /** lo que dijo el cliente; se audita como `***` y nunca se devuelve */
    valor: string
}

export interface ResultadoVerificacion {
    coincide: boolean
}

/** Documento: sin espacios ni guiones, en mayúsculas (el NIT puede terminar en `K`). */
export function normalizarDocumento(valor: string): string {
    return limpiarDocumento(valor)
}

/** Nombre: sin mayúsculas, tildes, signos ni espacios repetidos. */
export function normalizarNombre(valor: string): string {
    return valor
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
}

/** Código de cliente (`C-000455`): sin espacios ni guiones, en mayúsculas. */
export function normalizarCodigo(valor: string): string {
    return valor.replace(/[\s-]/g, '').toUpperCase()
}

/** Compara en tiempo constante (sha-256 de los dos lados: mismo largo siempre). */
export function igualesTiempoConstante(a: string, b: string): boolean {
    const ha = createHash('sha256').update(a, 'utf8').digest()
    const hb = createHash('sha256').update(b, 'utf8').digest()
    return timingSafeEqual(ha, hb) && a.length > 0
}

/**
 * `clientes.verificar_identidad` (contrato Iris 0.6.0 §7.5, pedido A19): Iris pregunta si lo que
 * dijo el cliente coincide con lo que Argos tiene, sin recibir nunca el dato.
 *
 * - `documento`: el `nit_cui` completo (NIT o CUI, el que tenga). Sin documento (`cf` o null):
 *   `422 metodo_no_disponible`, que no cuenta como intento.
 * - `nombre` y `codigo_cliente`: pruebas débiles (Iris ya las tiene); Iris las combina con otra.
 * - Límite: `LimiteIdentidad` (5 fallidos por cliente cada 30 min; `429 demasiados_intentos`).
 * - Cada intento queda en `audit.acciones` con `valor` como `***` (también los rechazados por el
 *   límite, que se auditan como error) y el resultado (`coincide`) en `entrada.auditoria`.
 *
 * No cambia nada en la base.
 */
export default class VerificarIdentidadCliente extends DomainAction<
    EntradaVerificarIdentidad,
    ResultadoVerificacion
> {
    readonly nombre = 'clientes.verificar_identidad'
    protected readonly camposEntradaOcultos = ['valor']

    constructor(private readonly limite: LimiteIdentidad = new LimiteIdentidad()) {
        super()
    }

    protected async handle(input: EntradaVerificarIdentidad, t: Transaccion): Promise<ResultadoVerificacion> {
        t.fijarEntidad('cliente', input.cliente_id)
        const cliente = (await t.trx
            .from('core.clientes')
            .where('id', input.cliente_id)
            .select('nombre', 'codigo', 'nit_cui', 'tipo_documento_fiscal')
            .first()) as {
            nombre: string
            codigo: string | null
            nit_cui: string | null
            tipo_documento_fiscal: string | null
        } | null
        if (!cliente) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)

        await this.limite.revisar(input.cliente_id)

        let guardado: string
        let dicho: string
        switch (input.metodo) {
            case 'documento': {
                const documento = cliente.nit_cui ? normalizarDocumento(cliente.nit_cui) : ''
                if (cliente.tipo_documento_fiscal === 'cf' || documento === '' || documento === 'CF') {
                    throw new ReglaNegocio(
                        'El cliente no tiene documento registrado (consumidor final): verifica con otro método',
                        'metodo_no_disponible',
                    )
                }
                guardado = documento
                dicho = normalizarDocumento(input.valor)
                break
            }
            case 'nombre':
                guardado = normalizarNombre(cliente.nombre)
                dicho = normalizarNombre(input.valor)
                break
            case 'codigo_cliente':
                if (!cliente.codigo) {
                    throw new ReglaNegocio('El cliente no tiene código', 'metodo_no_disponible')
                }
                guardado = normalizarCodigo(cliente.codigo)
                dicho = normalizarCodigo(input.valor)
                break
        }

        const coincide = igualesTiempoConstante(guardado, dicho)
        if (!coincide) await this.limite.fallido(input.cliente_id)
        t.anotarAuditoria({ coincide })
        return { coincide }
    }
}
