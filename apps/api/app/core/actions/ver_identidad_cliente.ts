import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { descifrarBytes, descifrarTexto, type TipoFoto } from '#core/identidad'

export interface EntradaVerIdentidad {
    cliente_id: number
    /** sin él, los datos de la vigente y la anterior; con él y `parte`, la foto */
    identidad_id?: number
    parte?: 'frente' | 'reverso'
}

export interface IdentidadVista {
    identidad_id: number
    version: number
    vigente: boolean
    documento_tipo: string
    documento_numero: string
    nombre: string
    metodo: string
    confirmada: boolean
    verificado_en: string
    tiene_reverso: boolean
    origen_tipo: string | null
    origen_id: string | null
    created_at: string
}

export type SalidaVerIdentidad =
    { tipo: 'datos'; identidades: IdentidadVista[] } | { tipo: 'foto'; contenido: Buffer; mime: TipoFoto }

/**
 * `clientes.ver_identidad` (contrato Iris 0.10.0 §3.4.3, A41): muestra la identidad del cliente
 * (vigente y anterior) o una de sus fotos. **Cada vista queda auditada** (qué identidad y qué parte;
 * nunca el contenido). El token de Iris nunca la lee (la ruta lo rechaza) y no sale por portal,
 * webhooks, eventos ni MCP.
 */
export default class VerIdentidadCliente extends DomainAction<EntradaVerIdentidad, SalidaVerIdentidad> {
    readonly nombre = 'clientes.ver_identidad'

    protected async handle(input: EntradaVerIdentidad, t: Transaccion): Promise<SalidaVerIdentidad> {
        t.fijarEntidad('cliente', input.cliente_id)
        if (input.identidad_id !== undefined && input.parte) {
            const fila = (await t.trx
                .from('core.clientes_identidades')
                .where({ id: input.identidad_id, cliente_id: input.cliente_id })
                .select('frente', 'frente_tipo', 'reverso', 'reverso_tipo')
                .first()) as {
                frente: Buffer
                frente_tipo: TipoFoto
                reverso: Buffer | null
                reverso_tipo: TipoFoto | null
            } | null
            const datos = input.parte === 'frente' ? fila?.frente : fila?.reverso
            const mime = input.parte === 'frente' ? fila?.frente_tipo : fila?.reverso_tipo
            if (!datos || !mime) throw new NoEncontrado('La foto no existe')
            t.anotarAuditoria({ identidad_id: input.identidad_id, parte: input.parte })
            return { tipo: 'foto', contenido: descifrarBytes(datos), mime }
        }
        const filas = (await t.trx
            .from('core.clientes_identidades')
            .where('cliente_id', input.cliente_id)
            .orderBy('version', 'desc')
            .select(
                'id',
                'version',
                'vigente',
                'documento_tipo',
                'documento_cifrado',
                'nombre_cifrado',
                'metodo',
                'confirmada',
                'verificado_en',
                'reverso_tipo',
                'origen_tipo',
                'origen_id',
                'created_at',
            )) as Array<Record<string, any>>
        t.anotarAuditoria({ identidades: filas.map((f) => Number(f.id)) })
        return {
            tipo: 'datos',
            identidades: filas.map((f) => ({
                identidad_id: Number(f.id),
                version: Number(f.version),
                vigente: f.vigente,
                documento_tipo: f.documento_tipo,
                documento_numero: descifrarTexto(f.documento_cifrado),
                nombre: descifrarTexto(f.nombre_cifrado),
                metodo: f.metodo,
                confirmada: f.confirmada,
                verificado_en: new Date(f.verificado_en).toISOString(),
                tiene_reverso: f.reverso_tipo !== null,
                origen_tipo: f.origen_tipo,
                origen_id: f.origen_id,
                created_at: new Date(f.created_at).toISOString(),
            })),
        }
    }
}
