import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { verPrograma } from '#lealtad/programas'
import {
    camposAuditables,
    verRegla,
    type PeriodoTope,
    type ReglaVista,
    type TipoRegla,
} from '#lealtad/reglas'
import { validarCondiciones } from '#lealtad/validators'

/**
 * `lealtad.crear_regla` (`POST /lealtad/reglas`, permiso `lealtad.configurar`): regla para ganar
 * puntos de un programa (contrato §4). `condiciones` se valida con el esquema de su `tipo` y se
 * guarda completa (con los valores por defecto). Fase 1: `recompensa = puntos` (422
 * `recompensa_no_disponible` con `premio` o `boletos`). `vigente_desde` por defecto = la del
 * programa: lo anterior no otorga (no es retroactivo). `audit.cambios` y
 * `lealtad.programa_cambiado` (`campos: ['reglas']`).
 */

export interface EntradaRegla {
    programa_id: number
    tipo: TipoRegla
    condiciones?: Record<string, unknown> | null
    recompensa?: string
    puntos: number
    tope_por_cliente?: number | null
    periodo_tope?: PeriodoTope | null
    activa?: boolean
    vigente_desde?: string
    vigente_hasta?: string | null
}

export function validarTope(tope: number | null, periodo: PeriodoTope | null) {
    if ((tope === null) !== (periodo === null)) {
        throw new ValidacionFallida([
            {
                field: tope === null ? 'tope_por_cliente' : 'periodo_tope',
                message: 'tope_por_cliente y periodo_tope van juntos',
            },
        ])
    }
}

export function validarRecompensa(recompensa: string | undefined) {
    if (recompensa !== undefined && recompensa !== 'puntos') {
        throw new ReglaNegocio(
            `La recompensa ${recompensa} llega con los canjes y sorteos (fases 2 y 3); hoy solo puntos`,
            'recompensa_no_disponible',
        )
    }
}

export default class CrearRegla extends DomainAction<EntradaRegla, ReglaVista> {
    readonly nombre = 'lealtad.crear_regla'

    protected async handle(input: EntradaRegla, t: Transaccion): Promise<ReglaVista> {
        const programa = await verPrograma(input.programa_id, t.trx)
        exigirAccesoEmpresa(t.ctx, programa.empresa_id)
        t.fijarEmpresa(programa.empresa_id)
        validarRecompensa(input.recompensa)
        const condiciones = await validarCondiciones(input.tipo, input.condiciones)
        const tope = input.tope_por_cliente ?? null
        const periodo = input.periodo_tope ?? null
        validarTope(tope, periodo)
        const vigenteDesde = input.vigente_desde ?? programa.vigente_desde
        if (input.vigente_hasta && input.vigente_hasta < vigenteDesde) {
            throw new ValidacionFallida([
                { field: 'vigente_hasta', message: 'vigente_hasta no puede ser anterior a vigente_desde' },
            ])
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('lealtad.reglas')
            .insert({
                empresa_id: programa.empresa_id,
                programa_id: programa.id,
                tipo: input.tipo,
                condiciones: JSON.stringify(condiciones),
                recompensa: 'puntos',
                puntos: input.puntos,
                tope_por_cliente: tope,
                periodo_tope: periodo,
                activa: input.activa ?? true,
                vigente_desde: vigenteDesde,
                vigente_hasta: input.vigente_hasta ?? null,
            })
            .returning('id')) as Array<{ id: number }>
        const regla = await verRegla(Number(fila!.id), t.trx)
        t.fijarEntidad('regla_lealtad', regla.id)
        await t.registrarCambios({ tipo: 'regla_lealtad', id: regla.id }, null, {
            tipo: regla.tipo,
            ...camposAuditables(regla),
        })
        await t.emit('lealtad.programa_cambiado', {
            programa_id: programa.id,
            empresa_id: programa.empresa_id,
            campos: ['reglas'],
        })
        return regla
    }
}
