import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, registrarAccion, sinSesion, usuariosPorToken, versionCambiada } from '../comun'

type CuentaBancaria = Schema<'CuentaBancaria'>
type Errores = NonNullable<Problem['errors']>

/** Como `Conflicto` de la API: 409 con `type` `urn:argosisp:problema:<codigo>`. */
function conflicto(codigo: string, titulo: string, detalle: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: titulo, status: 409, detail: detalle }
    return { status: 409, cuerpo }
}

/** Espejo del validador de `POST/PUT /cuentas-bancarias` (A3). */
function validar(cuerpo: Record<string, unknown>, parcial: boolean): Errores {
    const errores: Errores = []
    const { banco_id: bancoId, numero, alias, moneda, activa } = cuerpo
    if (!parcial || bancoId !== undefined) {
        if (!bd.bancos.some(b => b.id === bancoId)) {
            errores.push({ field: 'banco_id', message: `El banco ${String(bancoId)} no existe`, rule: 'exists' })
        }
    }
    if (!parcial || numero !== undefined) {
        const texto = typeof numero === 'string' ? numero.trim() : ''
        if (texto.length < 3 || texto.length > 40) {
            errores.push({ field: 'numero', message: 'El número debe tener entre 3 y 40 caracteres', rule: 'minLength' })
        }
    }
    if (!parcial || alias !== undefined) {
        const texto = typeof alias === 'string' ? alias.trim() : ''
        if (texto.length < 2 || texto.length > 80) {
            errores.push({ field: 'alias', message: 'El alias debe tener entre 2 y 80 caracteres', rule: 'minLength' })
        }
    }
    if (moneda !== undefined && moneda !== 'GTQ' && moneda !== 'USD') {
        errores.push({ field: 'moneda', message: 'Moneda inválida', rule: 'enum' })
    }
    if (activa !== undefined && typeof activa !== 'boolean') {
        errores.push({ field: 'activa', message: 'Debe ser verdadero o falso', rule: 'boolean' })
    }
    return errores
}

function repetida(bancoId: number, numero: string, excepto?: number): CuentaBancaria | undefined {
    return bd.cuentasBancarias.find(c => c.banco_id === bancoId && c.numero === numero && c.id !== excepto)
}

export const rutasBancos: RutasFixture = {
    'GET /api/v1/bancos': ({ token }) => (token && usuariosPorToken[token]
        ? { status: 200, cuerpo: bd.bancos.filter(b => b.activo) }
        : sinSesion()),

    'GET /api/v1/cuentas-bancarias': conPermiso('cuentas_bancarias.ver', (solicitud) => {
        const activa = solicitud.query.get('activa')
        if (activa !== null && activa !== 'true' && activa !== 'false') {
            return datosInvalidos([{ field: 'activa', message: 'Debe ser true o false', rule: 'boolean' }])
        }
        const filas = bd.cuentasBancarias.filter(c => activa === null || c.activa === (activa === 'true'))
        return { status: 200, cuerpo: filas }
    }),

    'GET /api/v1/cuentas-bancarias/:id': conPermiso('cuentas_bancarias.ver', (solicitud) => {
        const cuenta = bd.cuentasBancarias.find(c => c.id === idDe(solicitud))
        return cuenta ? { status: 200, cuerpo: cuenta } : noEncontrado('la cuenta bancaria')
    }),

    'POST /api/v1/cuentas-bancarias': conPermiso('cuentas_bancarias.editar', (solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = validar(cuerpo, false)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const bancoId = Number(cuerpo.banco_id)
        const numero = String(cuerpo.numero).trim()
        const banco = bd.bancos.find(b => b.id === bancoId)
        if (repetida(bancoId, numero)) {
            return conflicto('cuenta_bancaria_duplicada', 'Cuenta bancaria duplicada', `La cuenta ${numero} de ${banco?.nombre ?? ''} ya está registrada`)
        }
        const momento = ahora()
        const id = siguienteId(bd.cuentasBancarias)
        const cuenta: CuentaBancaria = {
            id,
            banco_id: bancoId,
            banco_nombre: banco?.nombre ?? '',
            numero,
            alias: String(cuerpo.alias).trim(),
            moneda: cuerpo.moneda === 'USD' ? 'USD' : 'GTQ',
            activa: cuerpo.activa !== false,
            cuenta_id: 100 + id,
            cuenta_codigo: `1.1.02.${String(id).padStart(2, '0')}`,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.cuentasBancarias.push(cuenta)
        registrarAccion(solicitud, 'cuentas_bancarias.crear', { tipo: 'cuenta_bancaria', id }, cuerpo)
        return { status: 201, cuerpo: cuenta }
    }),

    'PUT /api/v1/cuentas-bancarias/:id': conPermiso('cuentas_bancarias.editar', (solicitud) => {
        const cuenta = bd.cuentasBancarias.find(c => c.id === idDe(solicitud))
        if (!cuenta) {
            return noEncontrado('la cuenta bancaria')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== cuenta.version) {
            return versionCambiada()
        }
        const errores = validar(cuerpo, true)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const bancoId = typeof cuerpo.banco_id === 'number' ? cuerpo.banco_id : cuenta.banco_id
        const numero = typeof cuerpo.numero === 'string' ? cuerpo.numero.trim() : cuenta.numero
        if (repetida(bancoId, numero, cuenta.id)) {
            return conflicto('cuenta_bancaria_duplicada', 'Cuenta bancaria duplicada', `La cuenta ${numero} ya está registrada en ese banco`)
        }
        Object.assign(cuenta, {
            banco_id: bancoId,
            banco_nombre: bd.bancos.find(b => b.id === bancoId)?.nombre ?? cuenta.banco_nombre,
            numero,
            alias: typeof cuerpo.alias === 'string' ? cuerpo.alias.trim() : cuenta.alias,
            moneda: cuerpo.moneda === 'USD' || cuerpo.moneda === 'GTQ' ? cuerpo.moneda : cuenta.moneda,
            activa: typeof cuerpo.activa === 'boolean' ? cuerpo.activa : cuenta.activa,
            version: cuenta.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'cuentas_bancarias.editar', { tipo: 'cuenta_bancaria', id: cuenta.id }, cuerpo)
        return { status: 200, cuerpo: cuenta }
    }),
}
