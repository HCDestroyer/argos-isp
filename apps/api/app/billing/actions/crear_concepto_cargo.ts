import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import {
    ConceptoDeSistema,
    exigirCuentaIngreso,
    verConceptoCargo,
    type ConceptoCargoVista,
    type TipoConceptoCargo,
} from '#billing/cargos_unicos'

/**
 * `conceptos_cargo.crear` (`POST /conceptos-cargo`, permiso `facturas.configurar_conceptos`): agrega
 * un concepto al catálogo de cargos únicos de una empresa (la indicada o la activa), con su cuenta de
 * ingreso (imputable, de ingreso) y su tratamiento de IVA. 409 `concepto_cargo_duplicado` si el
 * nombre ya existe en esa empresa; 422 `concepto_de_sistema` si trae `codigo_sistema` (solo lo pone la
 * siembra). Queda en `audit.cambios`.
 */

export interface EntradaConceptoCargo {
    empresa_id?: number | null
    nombre: string
    tipo?: TipoConceptoCargo
    cuenta_codigo: string
    gravable?: boolean
    activo?: boolean
    /** Solo lectura: un valor distinto de null responde `422 concepto_de_sistema`. */
    codigo_sistema?: string | null
}

export default class CrearConceptoCargo extends DomainAction<EntradaConceptoCargo, ConceptoCargoVista> {
    readonly nombre = 'conceptos_cargo.crear'

    protected async handle(input: EntradaConceptoCargo, t: Transaccion): Promise<ConceptoCargoVista> {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (input.codigo_sistema !== undefined && input.codigo_sistema !== null) {
            throw new ConceptoDeSistema(
                'codigo_sistema lo fija el sistema: un concepto nuevo no puede llevarlo',
                'codigo_sistema',
            )
        }
        const nombre = input.nombre.trim()
        await exigirCuentaIngreso(t.trx, input.cuenta_codigo, empresaId)
        const repetido = await t.trx
            .from('billing.conceptos_cargo')
            .where('empresa_id', empresaId)
            .where('nombre', nombre)
            .select('id')
            .first()
        if (repetido) {
            throw new Conflicto(
                `El concepto «${nombre}» ya existe (${repetido.id})`,
                'concepto_cargo_duplicado',
                'Concepto duplicado',
            )
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.conceptos_cargo')
            .insert({
                empresa_id: empresaId,
                nombre,
                tipo: input.tipo ?? 'otro',
                cuenta_codigo: input.cuenta_codigo,
                gravable: input.gravable ?? true,
                activo: input.activo ?? true,
            })
            .returning('id')) as Array<{ id: number }>
        const creado = await verConceptoCargo(fila!.id, t.trx)
        t.fijarEntidad('concepto_cargo', creado.id)
        await t.registrarCambios({ tipo: 'concepto_cargo', id: creado.id }, null, {
            empresa_id: creado.empresa_id,
            nombre: creado.nombre,
            tipo: creado.tipo,
            cuenta_codigo: creado.cuenta_codigo,
            gravable: creado.gravable,
            activo: creado.activo,
        })
        return creado
    }
}
