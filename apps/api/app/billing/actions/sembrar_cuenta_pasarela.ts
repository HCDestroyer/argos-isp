import { randomBytes } from 'node:crypto'
import env from '#start/env'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrar } from '#shared/cifrado'
import { EMPRESA_PRINCIPAL } from '#core/empresas'
import { descriptorPasarela, nombresProveedores } from '#billing/pasarelas/pasarela'
import { filaCuentaPasarela } from '#billing/pasarelas/cuentas'
import { paraAuditoria } from '#billing/pasarelas/cuentas_config'

/** Sin datos: el entorno se lee dentro para que nunca entre en `audit.acciones.entrada`. */
export type EntradaSembrarCuentaPasarela = Record<string, never>

export interface ResultadoSembrarCuentaPasarela {
    sembrada: boolean
    motivo: 'entorno_vacio' | 'ya_existe' | 'sin_empresa' | null
    cuenta_id: number | null
    /** variables que se usaron (nombres, nunca valores) */
    variables: string[]
}

const VARIABLES_POR_PROVEEDOR: Record<string, string[]> = {
    recurrente: [
        'RECURRENTE_SECRET_KEY',
        'RECURRENTE_WEBHOOK_SECRETO',
        'RECURRENTE_API_URL',
        'RECURRENTE_EXPIRA_HORAS',
    ],
    falsa: ['PASARELA_FALSA_SECRETO'],
}

/**
 * `pasarelas.sembrar_cuenta` (solo sistema, al arrancar la API y el worker de billing): si el
 * entorno trae `PASARELA_PROVEEDOR` (y las llaves de ese proveedor) y la empresa principal todavía
 * no tiene cuenta de ese proveedor, la crea **una sola vez** con esos valores: activa, probada (es
 * lo que ya cobraba), predeterminada de `pago_en_linea` y marcada `sembrada_desde_entorno`. Desde
 * ahí manda la cuenta; el entorno ya no se lee para esa empresa. La ruta anterior del webhook
 * (`/pasarela/webhook/:proveedor`) sigue valiendo para esta cuenta, que también adopta los cobros
 * hechos antes de D0 (sin cuenta).
 *
 * Solo se audita cuando siembra. Las llaves quedan cifradas en la fila y como `***` en
 * `audit.cambios`; nunca en la entrada, el evento ni el log.
 */
export default class SembrarCuentaPasarela extends DomainAction<
    EntradaSembrarCuentaPasarela,
    ResultadoSembrarCuentaPasarela
> {
    readonly nombre = 'pasarelas.sembrar_cuenta'

    protected auditarExito(salida: ResultadoSembrarCuentaPasarela): boolean {
        return salida.sembrada
    }

    protected async handle(
        _input: EntradaSembrarCuentaPasarela,
        t: Transaccion,
    ): Promise<ResultadoSembrarCuentaPasarela> {
        const vacio = (motivo: ResultadoSembrarCuentaPasarela['motivo']): ResultadoSembrarCuentaPasarela => ({
            sembrada: false,
            motivo,
            cuenta_id: null,
            variables: [],
        })
        const proveedor = env.get('PASARELA_PROVEEDOR')
        if (!proveedor || !nombresProveedores().includes(proveedor)) return vacio('entorno_vacio')
        const descriptor = await descriptorPasarela(proveedor)
        // la pasarela falsa no se siembra en producción (solo laboratorio)
        if (descriptor.laboratorio && env.get('NODE_ENV') === 'production') return vacio('entorno_vacio')
        const config = descriptor.desdeEntorno()
        if (!config) return vacio('entorno_vacio')

        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [
            'billing:pasarela_cuentas:sembrar',
        ])
        const empresa = await t.trx.from('core.empresas').where('id', EMPRESA_PRINCIPAL).select('id').first()
        if (!empresa) return vacio('sin_empresa')
        const existente = await t.trx
            .from('billing.pasarela_cuentas')
            .where({ empresa_id: EMPRESA_PRINCIPAL, proveedor })
            .select('id')
            .first()
        if (existente) return { ...vacio('ya_existe'), cuenta_id: Number(existente.id) }

        t.fijarEmpresa(EMPRESA_PRINCIPAL)
        const claves = Object.keys(config.credenciales).sort()
        const opciones: Record<string, unknown> = {}
        for (const o of descriptor.opciones) {
            const valor = config.opciones[o.clave]
            if (valor !== undefined && valor !== null && valor !== '') opciones[o.clave] = valor
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.pasarela_cuentas')
            .insert({
                empresa_id: EMPRESA_PRINCIPAL,
                proveedor,
                alias: `${descriptor.titulo} (del entorno)`,
                credenciales_cifradas: claves.length > 0 ? cifrar(JSON.stringify(config.credenciales)) : null,
                credenciales_claves: t.trx.raw('?::text[]', [`{${claves.join(',')}}`]),
                webhook_secreto_cifrado: config.webhookSecreto ? cifrar(config.webhookSecreto) : null,
                clave_publica: randomBytes(16).toString('hex'),
                opciones: JSON.stringify(opciones),
                modo: config.modo ?? 'pruebas',
                usos: t.trx.raw(`'{pago_en_linea}'::text[]`),
                predeterminada_pago_en_linea: true,
                activa: true,
                prueba_ok: true,
                probada_en: t.trx.knexRawQuery('now()'),
                prueba_detalle: 'Sembrada desde las variables de entorno: ya cobraba así',
                sembrada_desde_entorno: true,
            } as Record<string, unknown>)
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('cuenta_pasarela', id)
        const campos = await t.registrarCambios(
            { tipo: 'cuenta_pasarela', id },
            null,
            paraAuditoria(await filaCuentaPasarela(id, t.trx)),
        )
        await t.emit('pasarela.config_cambiada', {
            pasarela_cuenta_id: id,
            empresa_id: EMPRESA_PRINCIPAL,
            proveedor,
            campos,
        })
        const leer = env as unknown as { get(clave: string): unknown }
        const variables = ['PASARELA_PROVEEDOR', ...(VARIABLES_POR_PROVEEDOR[proveedor] ?? [])].filter((n) =>
            Boolean(leer.get(n)),
        )
        return { sembrada: true, motivo: null, cuenta_id: id, variables }
    }
}
