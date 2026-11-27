import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrar } from '#shared/cifrado'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ValidacionFallida } from '#shared/errores'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import { descriptorPasarela } from '#billing/pasarelas/pasarela'
import {
    filaCuentaPasarela,
    vistaDeCuenta,
    type CuentaPasarelaVista,
    type FilaCuentaPasarela,
    type ModoPasarela,
    type UsoPasarela,
} from '#billing/pasarelas/cuentas'
import {
    exigirCredencialesCompletas,
    exigirProveedorCobroDeEmpresa,
    mezclarCredenciales,
    normalizarPredeterminadas,
    paraAuditoria,
    validarCredencialesYOpciones,
    validarUsos,
} from '#billing/pasarelas/cuentas_config'

/**
 * `pasarelas.editar_cuenta` (`PUT /pasarelas/cuentas/:id`, permiso `pasarelas.configurar`): alias,
 * proveedor de cobro, modo, usos, credenciales, secreto del webhook, opciones y cuenta
 * predeterminada por uso. Con `version` (409 si cambió).
 *
 * - Las credenciales que se envían reemplazan a las guardadas; las que no, se conservan. Nunca
 *   vuelven en la respuesta.
 * - Cambiar credenciales, secreto, modo u opciones deja `prueba_ok = false` (hay que volver a
 *   probar); una cuenta ya activa sigue activa para no cortar los cobros.
 * - `predeterminada_para` solo sobre una cuenta activa (422 `cuenta_inactiva`).
 */

export interface EntradaEditarCuentaPasarela {
    id: number
    version: number
    alias?: string | null
    proveedor_cobro_id?: number | null
    modo?: ModoPasarela | null
    usos?: UsoPasarela[] | null
    predeterminada_para?: UsoPasarela[] | null
    credenciales?: Record<string, string> | null
    webhook_secreto?: string | null
    opciones?: Record<string, unknown> | null
}

export default class EditarCuentaPasarela extends DomainAction<
    EntradaEditarCuentaPasarela,
    CuentaPasarelaVista
> {
    readonly nombre = 'pasarelas.editar_cuenta'

    protected async handle(input: EntradaEditarCuentaPasarela, t: Transaccion): Promise<CuentaPasarelaVista> {
        t.fijarEntidad('cuenta_pasarela', input.id)
        const actual = await filaCuentaPasarela(input.id, t.trx, true)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        verificarVersion('cuenta_pasarela', input.id, Number(actual.version), input.version)

        const descriptor = await descriptorPasarela(actual.proveedor)
        const cambios: Record<string, unknown> = {}
        if (input.alias !== undefined && input.alias !== null) {
            const alias = input.alias.trim()
            if (alias.length < 2) {
                throw new ValidacionFallida([
                    { field: 'alias', message: 'El alias es obligatorio', rule: 'required' },
                ])
            }
            cambios.alias = alias
        }
        if (input.proveedor_cobro_id !== undefined) {
            if (input.proveedor_cobro_id !== null) {
                await exigirProveedorCobroDeEmpresa(t.trx, input.proveedor_cobro_id, empresaId)
            }
            cambios.proveedor_cobro_id = input.proveedor_cobro_id
        }
        let usos = actual.usos
        if (input.usos) {
            usos = [...new Set(input.usos)]
            validarUsos(descriptor, usos)
            cambios.usos = t.trx.knexRawQuery('?::text[]', [`{${usos.join(',')}}`])
            // un uso que se quita deja de ser predeterminado (restricción de la tabla)
            if (!usos.includes('pago_en_linea')) cambios.predeterminada_pago_en_linea = false
            if (!usos.includes('debito')) cambios.predeterminada_debito = false
        }
        let reprobar = false
        if (input.modo && input.modo !== actual.modo) {
            cambios.modo = input.modo
            reprobar = true
        }
        validarCredencialesYOpciones(descriptor, input.credenciales, input.opciones)
        if (input.credenciales && Object.keys(input.credenciales).length > 0) {
            const { cifradas, claves } = mezclarCredenciales(actual.credenciales_cifradas, input.credenciales)
            exigirCredencialesCompletas(descriptor, claves)
            cambios.credenciales_cifradas = cifradas
            cambios.credenciales_claves = t.trx.knexRawQuery('?::text[]', [`{${claves.join(',')}}`])
            reprobar = true
        }
        if (input.webhook_secreto?.trim()) {
            cambios.webhook_secreto_cifrado = cifrar(input.webhook_secreto.trim())
            reprobar = true
        }
        if (input.opciones) {
            cambios.opciones = JSON.stringify({ ...actual.opciones, ...input.opciones })
            reprobar = true
        }
        if (reprobar) {
            cambios.prueba_ok = false
            cambios.prueba_detalle = 'Cambió la configuración: vuelve a probar la cuenta'
        }

        const actualizada = await actualizarConVersion<FilaCuentaPasarela & Record<string, unknown>>(
            t.trx,
            'billing.pasarela_cuentas',
            input.id,
            input.version,
            cambios,
        )
        if (input.predeterminada_para) {
            if (!actualizada.activa && input.predeterminada_para.length > 0) {
                throw new ValidacionFallida([
                    {
                        field: 'predeterminada_para',
                        message: 'Solo una cuenta activa puede ser la predeterminada',
                        rule: 'cuenta_inactiva',
                    },
                ])
            }
            const fuera = input.predeterminada_para.filter((u) => !usos.includes(u))
            if (fuera.length > 0) {
                throw new ValidacionFallida([
                    {
                        field: 'predeterminada_para',
                        message: `La cuenta no tiene el uso ${fuera.join(', ')}`,
                        rule: 'uso_no_habilitado',
                    },
                ])
            }
            for (const [uso, columna] of [
                ['pago_en_linea', 'predeterminada_pago_en_linea'],
                ['debito', 'predeterminada_debito'],
            ] as const) {
                const quiere = input.predeterminada_para.includes(uso)
                if (quiere) {
                    // suelta la de otra cuenta de la empresa (índice único) y marca esta
                    await t.trx
                        .from('billing.pasarela_cuentas')
                        .where('empresa_id', empresaId)
                        .whereNot('id', input.id)
                        .where(columna, true)
                        .update({ [columna]: false })
                    await t.trx
                        .from('billing.pasarela_cuentas')
                        .where('id', input.id)
                        .update({ [columna]: true })
                } else if (actualizada[columna]) {
                    await t.trx
                        .from('billing.pasarela_cuentas')
                        .where('id', input.id)
                        .update({ [columna]: false })
                }
            }
        }
        // un uso que se quita no puede quedar como predeterminado; si faltara una, pasa a otra activa
        await normalizarPredeterminadas(t.trx, empresaId)

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
        return vistaDeCuenta(despues)
    }
}
