import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Problema } from '#shared/errores'
import { ErrorPruebaPasarela, descriptorPasarela } from '#billing/pasarelas/pasarela'
import {
    configDeCuenta,
    filaCuentaPasarela,
    vistaDeCuenta,
    type CuentaPasarelaVista,
} from '#billing/pasarelas/cuentas'
import { paraAuditoria } from '#billing/pasarelas/cuentas_config'

/**
 * `pasarelas.probar_cuenta` (`POST /pasarelas/cuentas/:id/probar`, permiso `pasarelas.probar`):
 * comprueba las credenciales con el proveedor (Recurrente: `GET /test`), el secreto del webhook
 * y que el ambiente coincida con el `modo`.
 *
 * Una llave mala NO es un error HTTP: responde 200 con `ok: false`, deja `prueba_ok = false`, el
 * motivo en `prueba_detalle` y no activa la cuenta (la activación exige `prueba_ok`). Una prueba
 * buena tampoco activa: es `activar` quien lo hace.
 */

export interface EntradaProbarCuentaPasarela {
    id: number
}

export interface ResultadoProbarCuentaPasarela {
    ok: boolean
    detalle: string
    cuenta: CuentaPasarelaVista
}

/** Quita del texto cualquier valor secreto que el proveedor haya repetido en su error. */
function sinSecretos(texto: string, secretos: string[]): string {
    let limpio = texto
    for (const s of secretos.filter((x) => x.length >= 4)) limpio = limpio.split(s).join('***')
    return limpio.slice(0, 300)
}

export default class ProbarCuentaPasarela extends DomainAction<
    EntradaProbarCuentaPasarela,
    ResultadoProbarCuentaPasarela
> {
    readonly nombre = 'pasarelas.probar_cuenta'

    protected async handle(
        input: EntradaProbarCuentaPasarela,
        t: Transaccion,
    ): Promise<ResultadoProbarCuentaPasarela> {
        t.fijarEntidad('cuenta_pasarela', input.id)
        const actual = await filaCuentaPasarela(input.id, t.trx, true)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const descriptor = await descriptorPasarela(actual.proveedor)
        let ok = false
        let detalle: string
        let secretos: string[] = []
        try {
            const config = configDeCuenta(actual)
            secretos = [...Object.values(config.credenciales), config.webhookSecreto ?? '']
            const faltan = descriptor.credenciales
                .filter((c) => c.requerida && !config.credenciales[c.clave])
                .map((c) => c.etiqueta)
            if (faltan.length > 0) {
                detalle = `Falta ${faltan.join(', ')}`
            } else if (descriptor.requiere_webhook_secreto && !config.webhookSecreto) {
                detalle =
                    'Falta el secreto del webhook: registra la URL del webhook en el proveedor y pégalo aquí'
            } else {
                const adaptador = descriptor.construir(config)
                const resultado = await adaptador.probar()
                if (resultado.ambiente && resultado.ambiente !== actual.modo) {
                    detalle = `Las credenciales son de ${resultado.ambiente} y la cuenta está en modo ${actual.modo}`
                } else {
                    ok = true
                    detalle = resultado.detalle
                }
            }
        } catch (error) {
            if (!(error instanceof ErrorPruebaPasarela) && !(error instanceof Problema)) throw error
            detalle = error.message
        }
        detalle = sinSecretos(detalle, secretos)

        await t.trx
            .from('billing.pasarela_cuentas')
            .where('id', input.id)
            .update({
                prueba_ok: ok,
                probada_en: t.trx.knexRawQuery('now()'),
                prueba_detalle: detalle,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const despues = await filaCuentaPasarela(input.id, t.trx)
        const campos = await t.registrarCambios(
            { tipo: 'cuenta_pasarela', id: input.id },
            paraAuditoria(actual),
            paraAuditoria(despues),
        )
        if (campos.length > 0) {
            await t.emit('pasarela.config_cambiada', {
                pasarela_cuenta_id: input.id,
                empresa_id: empresaId,
                proveedor: actual.proveedor,
                campos,
            })
        }
        return { ok, detalle, cuenta: vistaDeCuenta(despues) }
    }
}
