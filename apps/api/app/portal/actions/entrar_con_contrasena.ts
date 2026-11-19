import hash from '@adonisjs/core/services/hash'
import type { ContextoAccion } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { nombreParcial } from '#portal/consultas'
import { empresaPrincipalDelCliente, marcaDeEmpresa } from '#portal/marca'
import {
    CredencialesPortalInvalidas,
    SQL_DOCUMENTO_CLIENTE,
    abrirSesionPortal,
    claveDocumento,
    coincideAlguno,
    contrasenaPropia,
    empresasDelCliente,
    hashesPorDefecto,
    marcarIntentoExitoso,
    normalizarDocumento,
    registrarIntento,
    verificarSenuelo,
} from '#portal/acceso/contrasenas'
import type { ResultadoVerificacion } from '#portal/actions/verificar_codigo'

export interface EntradaEntrarConContrasena {
    /** NIT, CUI o pasaporte como lo escribió el cliente; se audita como `***` */
    documento: string
    contrasena: string
    ip: string
    /** Portal de una empresa (`/entrar?empresa=`): solo clientes con servicios en ella y su contraseña */
    empresa_id?: number | null
}

/** Máximo de clientes con el mismo documento que se comparan (un documento repetido es raro). */
const MAX_CANDIDATOS = 10

interface Candidato {
    id: number
    nombre: string
}

/**
 * Entrada al portal con documento y contraseña (`POST /portal/entrar`).
 *
 * 1. Cuenta el intento (por documento y por IP) **antes** de verificar y fuera de la transacción:
 *    al pasarse responde 429 sin comparar nada.
 * 2. Busca los clientes con ese documento (normalizado; `CF` no es un documento). Con `empresa_id`,
 *    solo los que tienen servicios en esa empresa.
 * 3. Compara la contraseña:
 *    - con la **propia** de cada candidato que tenga una;
 *    - con la **por defecto** de sus empresas solo si el documento es de **un único** cliente y
 *      ese cliente no tiene propia (con varios, la de por defecto sería la misma para todos y no
 *      dice quién es).
 *    Entra si exactamente un cliente coincide. Cualquier otro caso: 422 `credenciales_invalidas`
 *    con el mismo texto (no revela si el documento existe).
 * 4. Abre la sesión (`origen = contrasena`). Si entró con la de por defecto, la sesión queda con
 *    `debe_cambiar_contrasena`: solo puede cambiarla o salir (403 `cambio_contrasena_requerido`).
 */
export default class EntrarConContrasena extends DomainAction<
    EntradaEntrarConContrasena,
    ResultadoVerificacion
> {
    readonly nombre = 'portal.entrar_con_contrasena'
    protected readonly camposEntradaOcultos = ['documento']

    #intento: number | null = null

    async execute(input: EntradaEntrarConContrasena, ctx: ContextoAccion) {
        const documento = normalizarDocumento(input.documento)
        this.#intento = await registrarIntento(claveDocumento(documento), input.ip)
        const salida = await super.execute(input, ctx)
        await marcarIntentoExitoso(this.#intento)
        return salida
    }

    protected async handle(
        input: EntradaEntrarConContrasena,
        t: Transaccion,
    ): Promise<ResultadoVerificacion> {
        const documento = normalizarDocumento(input.documento)
        const empresaId = input.empresa_id ?? null
        t.fijarEmpresa(empresaId)

        const filtroEmpresa =
            empresaId === null
                ? ''
                : `AND EXISTS (SELECT 1 FROM core.servicios s
                                WHERE s.cliente_id = c.id AND s.empresa_id = ? AND s.estado <> 'retirado')`
        const buscados =
            documento === '' || documento === 'CF'
                ? null
                : await t.trx.rawQuery(
                      `SELECT c.id, c.nombre FROM core.clientes c
                        WHERE ${SQL_DOCUMENTO_CLIENTE} = ? ${filtroEmpresa}
                        ORDER BY c.id
                        LIMIT ${MAX_CANDIDATOS}`,
                      empresaId === null ? [documento] : [documento, empresaId],
                  )
        const candidatos = (buscados?.rows ?? []) as Candidato[]

        if (candidatos.length === 0) {
            await verificarSenuelo(input.contrasena)
            throw new CredencialesPortalInvalidas()
        }

        const aciertos: Array<{ cliente: Candidato; porDefecto: boolean }> = []
        let comparadas = 0
        for (const candidato of candidatos) {
            const propia = await contrasenaPropia(t.trx, Number(candidato.id))
            if (propia) {
                comparadas += 1
                if (await hash.verify(propia, input.contrasena)) {
                    aciertos.push({ cliente: candidato, porDefecto: false })
                }
            } else if (candidatos.length === 1) {
                const empresas = await empresasDelCliente(t.trx, Number(candidato.id), empresaId)
                const hashes = await hashesPorDefecto(t.trx, empresas)
                comparadas += hashes.length
                if (await coincideAlguno(hashes, input.contrasena)) {
                    aciertos.push({ cliente: candidato, porDefecto: true })
                }
            }
        }
        // Sin ninguna comparación (sin contraseña configurada, o documento repetido sin propias), la
        // respuesta tardaría menos y diría que el documento existe: se compara con el señuelo.
        if (comparadas === 0) await verificarSenuelo(input.contrasena)
        if (aciertos.length !== 1) {
            throw new CredencialesPortalInvalidas()
        }

        const { cliente, porDefecto } = aciertos[0]!
        const clienteId = Number(cliente.id)
        t.fijarEntidad('cliente', clienteId)
        t.identificarActor({ tipo: 'cliente', id: clienteId })
        t.anotarAuditoria({ con_contrasena_por_defecto: porDefecto })

        const sesion = await abrirSesionPortal(t.trx, {
            clienteId,
            origen: 'contrasena',
            ip: input.ip,
            debeCambiarContrasena: porDefecto,
        })
        return {
            token: sesion.token,
            sesion: {
                cliente: { nombre_parcial: nombreParcial(cliente.nombre) },
                expira_en: sesion.expiraEn.toISO()!,
                empresa_principal: await marcaDeEmpresa(
                    empresaId ?? (await empresaPrincipalDelCliente(clienteId, t.trx)),
                    t.trx,
                ),
                origen: 'contrasena',
                debe_cambiar_contrasena: porDefecto,
            },
        }
    }
}
