import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import {
    verProveedor,
    type ProveedorVista,
    type RegimenProveedor,
    type TipoDocumentoProveedor,
    type TipoProveedor,
} from '#ledger/proveedores'
import { exigirDocumentoLibre, validarDatosProveedor } from '#ledger/actions/crear_proveedor'

/**
 * `proveedores.editar` (`PUT /proveedores/:id`): nombre, tipo, régimen, agente de retención,
 * contacto, días de crédito y `activo`, con `version` (409 si cambió) y `audit.cambios`.
 *
 * El documento (`nit`, `tipo_documento`) y el país no se editan (422 `campo_solo_lectura`): las
 * compras ya registradas lo llevan en el libro de compras; un documento equivocado es otro
 * proveedor (se desactiva el primero). Reactivar uno cuyo documento ya usa otro activo: 409
 * `proveedor_duplicado`.
 */

export interface EntradaEditarProveedor {
    id: number
    version: number
    nombre?: string | null
    tipo?: TipoProveedor | null
    regimen_isr?: RegimenProveedor | null
    agente_retencion_iva?: boolean | null
    direccion?: string | null
    correo?: string | null
    telefono?: string | null
    dias_credito?: number | null
    activo?: boolean | null
    nit?: string | null
    tipo_documento?: TipoDocumentoProveedor | null
    pais?: string | null
}

const EDITABLES = [
    'nombre',
    'tipo',
    'regimen_isr',
    'agente_retencion_iva',
    'direccion',
    'correo',
    'telefono',
    'dias_credito',
    'activo',
] as const

const OPCIONALES = new Set<string>(['direccion', 'correo', 'telefono', 'regimen_isr'])

export default class EditarProveedor extends DomainAction<EntradaEditarProveedor, ProveedorVista> {
    readonly nombre = 'proveedores.editar'

    protected async handle(input: EntradaEditarProveedor, t: Transaccion): Promise<ProveedorVista> {
        t.fijarEntidad('proveedor', input.id)
        const actual = (await t.trx
            .from('ledger.proveedores')
            .where('id', input.id)
            .forUpdate()
            .select('*')
            .first()) as Record<string, unknown> | null
        if (!actual) throw new NoEncontrado(`El proveedor ${input.id} no existe`)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        for (const campo of ['nit', 'tipo_documento', 'pais'] as const) {
            const valor = input[campo]
            if (
                valor !== undefined &&
                valor !== null &&
                String(valor).trim().toUpperCase() !== String(actual[campo]).trim().toUpperCase()
            ) {
                throw new ValidacionFallida([
                    {
                        field: campo,
                        message: 'El documento del proveedor no se edita: desactívalo y crea otro',
                        rule: 'campo_solo_lectura',
                    },
                ])
            }
        }
        if (Number(actual.version) !== input.version) throw new ConflictoVersion('proveedor', input.id)

        const antes: Record<string, unknown> = Object.fromEntries(
            EDITABLES.map((c) => [c, actual[c] ?? null]),
        )
        const nuevo: Record<string, unknown> = { ...antes }
        for (const campo of EDITABLES) {
            const valor = input[campo]
            if (valor === undefined) continue
            if (valor === null) {
                // null limpia los opcionales; en los obligatorios no cambia nada
                if (OPCIONALES.has(campo)) nuevo[campo] = null
                continue
            }
            nuevo[campo] = typeof valor === 'string' ? valor.trim() || null : valor
        }
        if (input.tipo && input.tipo !== actual.tipo && input.regimen_isr === undefined) {
            nuevo.regimen_isr = input.tipo === 'pequeno_contribuyente' ? 'pequeno_contribuyente' : null
        }
        const errores = validarDatosProveedor({
            tipo: nuevo.tipo as TipoProveedor,
            tipo_documento: actual.tipo_documento as TipoDocumentoProveedor,
            regimen_isr: (nuevo.regimen_isr as RegimenProveedor | null) ?? null,
        })
        if (!nuevo.nombre || String(nuevo.nombre).length < 2) {
            errores.push({ field: 'nombre', message: 'El nombre es obligatorio', rule: 'required' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        if (nuevo.activo && !actual.activo) {
            await exigirDocumentoLibre(t, empresaId, String(actual.nit), input.id)
        }

        await t.trx
            .from('ledger.proveedores')
            .where('id', input.id)
            .update({
                ...nuevo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios({ tipo: 'proveedor', id: input.id }, antes, nuevo)
        return verProveedor(input.id, t.trx)
    }
}
