import hash from '@adonisjs/core/services/hash'
import type { ContextoAccion } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import {
    claveCliente,
    coincideAlguno,
    contrasenaPropia,
    empresasDelCliente,
    hashesPorDefecto,
    marcarIntentoExitoso,
    normalizarDocumento,
    registrarIntento,
} from '#portal/acceso/contrasenas'

export interface EntradaCambiarContrasena {
    clienteId: number
    sesionId: number
    ip: string
    contrasena_actual: string
    contrasena_nueva: string
}

export interface ContrasenaCambiada {
    actualizada_en: string
    /** otras sesiones del portal del cliente que se cerraron */
    sesiones_cerradas: number
}

/**
 * El cliente cambia su contraseña del portal (`POST /portal/contrasena`, con la sesión).
 *
 * - Pide la **actual**: la propia o, si no tiene, la por defecto de sus empresas. Los fallos cuentan
 *   en el mismo límite que la entrada (`cliente:<id>` y la IP): 429 al pasarse.
 * - La nueva no puede ser la por defecto ni el propio documento (422 en `contrasena_nueva`).
 * - Guarda solo el hash. Quita `debe_cambiar_contrasena` de la sesión actual y cierra las demás
 *   sesiones del portal del cliente.
 * - Diff en `audit.cambios` (`cliente`, `portal_contrasena`, `***`); la entrada queda `***`.
 */
export default class CambiarContrasenaPortal extends DomainAction<
    EntradaCambiarContrasena,
    ContrasenaCambiada
> {
    readonly nombre = 'portal.cambiar_contrasena'

    #actualValida = false

    async execute(input: EntradaCambiarContrasena, ctx: ContextoAccion) {
        const intento = await registrarIntento(claveCliente(input.clienteId), input.ip)
        this.#actualValida = false
        try {
            return await super.execute(input, ctx)
        } finally {
            // Solo la contraseña actual equivocada cuenta como fallo (no una nueva que no se acepta).
            if (this.#actualValida) await marcarIntentoExitoso(intento)
        }
    }

    protected async handle(input: EntradaCambiarContrasena, t: Transaccion): Promise<ContrasenaCambiada> {
        t.fijarEntidad('cliente', input.clienteId)
        const cliente = (await t.trx
            .from('core.clientes')
            .where('id', input.clienteId)
            .forUpdate()
            .select('nit_cui')
            .first()) as { nit_cui: string | null }

        const propia = await contrasenaPropia(t.trx, input.clienteId)
        const defectos = await hashesPorDefecto(t.trx, await empresasDelCliente(t.trx, input.clienteId, null))
        const actualValida = propia
            ? await hash.verify(propia, input.contrasena_actual)
            : await coincideAlguno(defectos, input.contrasena_actual)
        this.#actualValida = actualValida
        if (!actualValida) {
            throw new ValidacionFallida(
                [
                    {
                        field: 'contrasena_actual',
                        message: 'La contraseña actual no es correcta',
                        rule: 'contrasena',
                    },
                ],
                'La contraseña actual no es correcta',
            )
        }

        const nueva = input.contrasena_nueva
        if (await coincideAlguno(defectos, nueva)) {
            throw new ValidacionFallida([
                {
                    field: 'contrasena_nueva',
                    message: 'Elige una contraseña distinta a la que te dio la empresa',
                    rule: 'contrasena',
                },
            ])
        }
        if (cliente.nit_cui && normalizarDocumento(nueva) === normalizarDocumento(cliente.nit_cui)) {
            throw new ValidacionFallida([
                {
                    field: 'contrasena_nueva',
                    message: 'Tu contraseña no puede ser tu número de documento',
                    rule: 'contrasena',
                },
            ])
        }

        const contrasenaHash = await hash.make(nueva)
        const guardada = await t.trx.rawQuery(
            `INSERT INTO core.portal_credenciales (cliente_id, contrasena_hash)
             VALUES (?, ?)
             ON CONFLICT (cliente_id) DO UPDATE
                SET contrasena_hash = EXCLUDED.contrasena_hash,
                    actualizada_en = now(),
                    version = core.portal_credenciales.version + 1
             RETURNING actualizada_en`,
            [input.clienteId, contrasenaHash],
        )

        const filas = guardada.rows as Array<{ actualizada_en: Date }>

        await t.trx
            .from('core.portal_sesiones')
            .where('id', input.sesionId)
            .update({ debe_cambiar_contrasena: false })
        const cerradas = (await t.trx
            .from('core.portal_sesiones')
            .where('cliente_id', input.clienteId)
            .whereNot('id', input.sesionId)
            .whereNull('revocada_en')
            .where('expira_en', '>', t.trx.knexRawQuery('now()'))
            .update({ revocada_en: t.trx.knexRawQuery('now()') })) as unknown as number

        await t.registrarCambios(
            { tipo: 'cliente', id: input.clienteId },
            { portal_contrasena: propia ? 'anterior' : null },
            { portal_contrasena: 'nueva' },
        )
        return { actualizada_en: filas[0]!.actualizada_en.toISOString(), sesiones_cerradas: Number(cerradas) }
    }
}
