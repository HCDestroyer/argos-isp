import type { Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import {
    TABLA_CONECTOR,
    invalidarConfigHorus,
    publicarInvalidacionHorus,
    type FilaConector,
} from '#integraciones/horus/configuracion'

/**
 * Escritura de la fila del conector desde una acción (configurar, canjear o conectar con enlace).
 * Serializa con un candado, controla `version` si se pide, registra el diff en `audit.cambios`
 * (secretos como `***`), emite `horus.config_cambiada` y, al confirmar, invalida la caché de este
 * proceso y avisa a los demás.
 */
export async function bloquearConector(t: Transaccion): Promise<FilaConector | null> {
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', ['integraciones:horus:conector'])
    return (
        ((await t.trx.from(TABLA_CONECTOR).where('id', 1).forUpdate().first()) as FilaConector | null) ?? null
    )
}

export async function guardarConector(
    t: Transaccion,
    antes: FilaConector | null,
    cambios: Record<string, unknown>,
    opciones: { version?: number } = {},
): Promise<FilaConector> {
    if (opciones.version !== undefined && (antes?.version ?? 0) !== opciones.version) {
        throw new ConflictoVersion(TABLA_CONECTOR, 1)
    }
    let despues: FilaConector
    if (antes) {
        const [fila] = (await t.trx
            .from(TABLA_CONECTOR)
            .where('id', 1)
            .update(
                {
                    ...cambios,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                },
                ['*'],
            )) as FilaConector[]
        despues = fila!
    } else {
        const [fila] = (await t.trx
            .table(TABLA_CONECTOR)
            .insert({ id: 1, ...cambios })
            .returning('*')) as FilaConector[]
        despues = fila!
    }
    t.fijarEntidad('conector_horus', 1)
    // Auditoría: la configuración es de la instalación, no de una empresa.
    t.fijarEmpresa(null)
    const campos = await t.registrarCambios(
        { tipo: 'conector_horus', id: 1 },
        antes ? sinPruebas(antes) : null,
        sinPruebas(despues),
    )
    await t.emit('horus.config_cambiada', { activo: despues.activo, campos })
    t.alConfirmar(async () => {
        invalidarConfigHorus()
        await publicarInvalidacionHorus()
    })
    return despues
}

/** La última prueba de conexión no es configuración: no entra en el diff. */
function sinPruebas(fila: FilaConector): Record<string, unknown> {
    const resto: Record<string, unknown> = { ...fila }
    delete resto.ultima_prueba_en
    delete resto.ultima_prueba_ok
    delete resto.ultima_prueba_error
    return resto
}
