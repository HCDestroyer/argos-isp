import { randomBytes } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrar } from '#shared/cifrado'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { descriptorPasarela, nombresProveedores } from '#billing/pasarelas/pasarela'
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
    exigirProveedorDisponible,
    paraAuditoria,
    validarCredencialesYOpciones,
    validarUsos,
} from '#billing/pasarelas/cuentas_config'

/**
 * `pasarelas.configurar` · crear (`POST /pasarelas/cuentas`): da de alta la cuenta de pasarela de una
 * empresa para un proveedor (D0, `contratos/debito-automatico.md` §2).
 *
 * - Una sola cuenta por (empresa, proveedor): 409 `cuenta_pasarela_duplicada`.
 * - `credenciales` (las claves que declara el adaptador) y `webhook_secreto` se guardan cifrados y
 *   no vuelven en ninguna respuesta; en auditoría salen como `***`. El secreto del webhook puede
 *   llegar después (el proveedor lo entrega al registrar la URL del webhook, que lleva la
 *   `clave_publica` generada aquí).
 * - Nace inactiva y sin probar: `probar` y luego `activar`.
 * - `usos`: `pago_en_linea` (por defecto) y `debito` solo si el adaptador tiene `cargo_con_token`
 *   (422 `debito_no_soportado`).
 */

export interface EntradaCrearCuentaPasarela {
    empresa_id?: number | null
    proveedor: string
    alias: string
    proveedor_cobro_id?: number | null
    modo?: ModoPasarela | null
    usos?: UsoPasarela[] | null
    credenciales?: Record<string, string> | null
    webhook_secreto?: string | null
    opciones?: Record<string, unknown> | null
}

export default class CrearCuentaPasarela extends DomainAction<
    EntradaCrearCuentaPasarela,
    CuentaPasarelaVista
> {
    readonly nombre = 'pasarelas.crear_cuenta'

    protected async handle(input: EntradaCrearCuentaPasarela, t: Transaccion): Promise<CuentaPasarelaVista> {
        if (!nombresProveedores().includes(input.proveedor)) {
            throw new ValidacionFallida([
                {
                    field: 'proveedor',
                    message: `La pasarela ${input.proveedor} no existe (disponibles: ${nombresProveedores().join(', ')})`,
                    rule: 'enum',
                },
            ])
        }
        const descriptor = await descriptorPasarela(input.proveedor)
        exigirProveedorDisponible(descriptor)
        const alias = input.alias?.trim() ?? ''
        if (alias.length < 2) {
            throw new ValidacionFallida([
                { field: 'alias', message: 'El alias es obligatorio', rule: 'required' },
            ])
        }
        const usos = [...new Set(input.usos ?? ['pago_en_linea'])] as UsoPasarela[]
        validarUsos(descriptor, usos)
        validarCredencialesYOpciones(descriptor, input.credenciales, input.opciones)
        exigirCredencialesCompletas(descriptor, Object.keys(input.credenciales ?? {}))

        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const repetida = await t.trx
            .from('billing.pasarela_cuentas')
            .where({ empresa_id: empresaId, proveedor: input.proveedor })
            .select('id')
            .first()
        if (repetida) {
            throw new Conflicto(
                `La empresa ${empresaId} ya tiene una cuenta de ${input.proveedor} (${repetida.id}): edítala`,
                'cuenta_pasarela_duplicada',
                'Cuenta de pasarela duplicada',
            )
        }
        if (input.proveedor_cobro_id) {
            await exigirProveedorCobroDeEmpresa(t.trx, input.proveedor_cobro_id, empresaId)
        }

        const credenciales = Object.fromEntries(
            Object.entries(input.credenciales ?? {}).map(([k, v]) => [k, v.trim()]),
        )
        const claves = Object.keys(credenciales).sort()
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.pasarela_cuentas')
            .insert({
                empresa_id: empresaId,
                proveedor: input.proveedor,
                alias,
                proveedor_cobro_id: input.proveedor_cobro_id ?? null,
                credenciales_cifradas: claves.length > 0 ? cifrar(JSON.stringify(credenciales)) : null,
                credenciales_claves: t.trx.raw('?::text[]', [`{${claves.join(',')}}`]),
                webhook_secreto_cifrado: input.webhook_secreto?.trim()
                    ? cifrar(input.webhook_secreto.trim())
                    : null,
                clave_publica: randomBytes(16).toString('hex'),
                opciones: JSON.stringify(input.opciones ?? {}),
                modo: input.modo ?? 'pruebas',
                usos: t.trx.raw('?::text[]', [`{${usos.join(',')}}`]),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('cuenta_pasarela', id)
        const creada = await filaCuentaPasarela(id, t.trx)
        const campos = await t.registrarCambios({ tipo: 'cuenta_pasarela', id }, null, paraAuditoria(creada))
        await t.emit('pasarela.config_cambiada', {
            pasarela_cuenta_id: id,
            empresa_id: empresaId,
            proveedor: input.proveedor,
            campos,
        })
        return vistaDeCuenta(creada as FilaCuentaPasarela)
    }
}
