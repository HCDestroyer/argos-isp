import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado } from '#shared/errores'
import {
    ConceptoDeSistema,
    exigirCuentaIngreso,
    verConceptoCargo,
    type ConceptoCargoVista,
    type TipoConceptoCargo,
} from '#billing/cargos_unicos'

/**
 * `conceptos_cargo.editar` (`PUT /conceptos-cargo/:id`, con `version`, permiso
 * `facturas.configurar_conceptos`): cambia nombre, tipo, cuenta, IVA o `activo` (uno inactivo no se
 * usa en cargos nuevos; nunca se borra). Solo afecta a los cargos que se emitan después: cada línea
 * guarda su cuenta y su IVA al emitirse. Cada campo queda en `audit.cambios`.
 *
 * `codigo_sistema` es de solo lectura (contrato Iris 0.14.3): un valor distinto del actual (ponerlo,
 * cambiarlo o quitarlo) responde `422 concepto_de_sistema`, igual que desactivar un concepto de sistema
 * (Iris cobra la instalación con él y `cobro_equipo` lo exige activo). Nombre, tipo, cuenta e IVA sí
 * se editan. No hay borrado (y un trigger impide borrar o recodificar la fila).
 */

export interface EntradaEditarConceptoCargo {
    id: number
    version: number
    nombre?: string
    tipo?: TipoConceptoCargo
    cuenta_codigo?: string
    gravable?: boolean
    activo?: boolean
    /** Solo lectura: distinto del actual → `422 concepto_de_sistema`. */
    codigo_sistema?: string | null
}

type FilaConcepto = Pick<
    ConceptoCargoVista,
    'id' | 'nombre' | 'tipo' | 'cuenta_codigo' | 'gravable' | 'activo' | 'codigo_sistema' | 'version'
> & { empresa_id: number }

export default class EditarConceptoCargo extends DomainAction<
    EntradaEditarConceptoCargo,
    ConceptoCargoVista
> {
    readonly nombre = 'conceptos_cargo.editar'

    protected async handle(input: EntradaEditarConceptoCargo, t: Transaccion): Promise<ConceptoCargoVista> {
        t.fijarEntidad('concepto_cargo', input.id)
        const previo = (await t.trx
            .from('billing.conceptos_cargo')
            .where('id', input.id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'nombre',
                'tipo',
                'cuenta_codigo',
                'gravable',
                'activo',
                'codigo_sistema',
                'version',
            )
            .first()) as FilaConcepto | null
        if (!previo) throw new NoEncontrado(`El concepto de cargo ${input.id} no existe`)
        const empresaId = Number(previo.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (previo.version !== input.version) throw new ConflictoVersion('El concepto de cargo', input.id)

        if (input.codigo_sistema !== undefined && input.codigo_sistema !== previo.codigo_sistema) {
            throw new ConceptoDeSistema(
                previo.codigo_sistema
                    ? `El concepto ${previo.id} es el de sistema «${previo.codigo_sistema}»: su código no se cambia ni se quita`
                    : 'codigo_sistema lo fija el sistema: no se asigna a otro concepto',
                'codigo_sistema',
            )
        }
        if (previo.codigo_sistema && input.activo === false) {
            throw new ConceptoDeSistema(
                `El concepto ${previo.id} es el de sistema «${previo.codigo_sistema}»: no se desactiva`,
                'activo',
            )
        }
        const despues = {
            nombre: input.nombre?.trim() ?? previo.nombre,
            tipo: input.tipo ?? previo.tipo,
            cuenta_codigo: input.cuenta_codigo ?? previo.cuenta_codigo,
            gravable: input.gravable ?? previo.gravable,
            activo: input.activo ?? previo.activo,
        }
        if (despues.cuenta_codigo !== previo.cuenta_codigo) {
            await exigirCuentaIngreso(t.trx, despues.cuenta_codigo, empresaId)
        }
        const repetido = await t.trx
            .from('billing.conceptos_cargo')
            .where('empresa_id', empresaId)
            .where('nombre', despues.nombre)
            .whereNot('id', previo.id)
            .select('id')
            .first()
        if (repetido) {
            throw new Conflicto(
                `El concepto «${despues.nombre}» ya existe (${repetido.id})`,
                'concepto_cargo_duplicado',
                'Concepto duplicado',
            )
        }
        await t.trx
            .from('billing.conceptos_cargo')
            .where('id', previo.id)
            .update({
                ...despues,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'concepto_cargo', id: previo.id },
            {
                nombre: previo.nombre,
                tipo: previo.tipo,
                cuenta_codigo: previo.cuenta_codigo,
                gravable: previo.gravable,
                activo: previo.activo,
            },
            despues,
        )
        return verConceptoCargo(previo.id, t.trx)
    }
}
