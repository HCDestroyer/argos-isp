import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { limpiarDocumento, validarDocumentoFiscal, type TipoDocumentoFiscal } from '#core/nit_cui'
import { verCliente, type ClienteVista } from '#core/consultas/clientes'
import { vincularExterno, type IdExterno } from '#core/ids_externos'
import { resolverCodigoReferido } from '#core/referidos'
import { exigeRequeridos, validarCamposPersonalizados } from '#core/campos_personalizados'
import { telefonoParaGuardar } from '#core/telefonos'

export interface DatosCliente {
    nombre?: string
    tipo?: 'persona' | 'empresa'
    tipo_documento_fiscal?: TipoDocumentoFiscal
    nit_cui?: string | null
    nombre_fiscal?: string | null
    direccion_fiscal?: string | null
    pais_fiscal?: string
    agente_retencion_iva?: boolean
    sector_publico?: boolean
    email?: string | null
    telefono?: string | null
    movil?: string | null
    direccion?: string | null
    /** cómo llegar, texto libre («casa verde frente a la iglesia»; pedido A12 de Iris) */
    referencia?: string | null
    coordenadas?: string | null
    zona_id?: number | null
    campos_personalizados?: Record<string, unknown>
    canal_preferido?: 'correo' | 'telegram' | 'whatsapp'
    /** código del sistema anterior (importador); el estable `codigo` lo pone la base */
    codigo_externo?: string | null
}

export interface EntradaCrearCliente extends DatosCliente {
    nombre: string
    /** id en un sistema de origen (importador); 409 `externo_duplicado` si ya está vinculado */
    externo?: IdExterno
    /**
     * Código de referido de otro cliente (programa de lealtad): guarda quién lo refirió y en qué
     * empresa cuenta. 422 `referido_invalido` si no existe o es del mismo NIT/CUI.
     */
    codigo_referido?: string | null
}

const CAMPOS_DOCUMENTO = ['tipo_documento_fiscal', 'nit_cui', 'pais_fiscal'] as const

/** Documento fiscal (y teléfonos) guardados del cliente que se edita. */
export interface DocumentoAnterior {
    tipo_documento_fiscal: TipoDocumentoFiscal
    nit_cui: string | null
    pais_fiscal: string
    telefono?: unknown
    movil?: unknown
}

const CAMPOS_TELEFONO = ['telefono', 'movil'] as const

/**
 * Documento fiscal validado (`validarDocumentoFiscal`). En el alta siempre; al editar, solo si
 * llega alguno de `tipo_documento_fiscal`, `nit_cui` o `pais_fiscal`, combinado con lo guardado:
 * así un cliente migrado con `nit_cui_invalido` se puede editar en lo demás sin corregirlo, y al
 * corregirlo la marca se apaga.
 *
 * Al editar el número sin tipo explícito, el tipo se **reclasifica** con la misma regla del alta
 * (`deducirTipoDocumento`, la de `core.clasificar_documento` en la base): CF → NIT, NIT → CUI,
 * NIT → CF. Excepción: un pasaporte conserva su tipo (su número no tiene forma propia) salvo que
 * el número quede vacío o `CF`. Un tipo explícito se respeta y se valida contra el número.
 */
function columnasDocumento(datos: DatosCliente, antes?: DocumentoAnterior): Record<string, unknown> {
    if (antes && CAMPOS_DOCUMENTO.every((campo) => datos[campo] === undefined)) return {}
    let tipo = datos.tipo_documento_fiscal
    if (!tipo && antes && (datos.nit_cui === undefined || conservaPasaporte(antes, datos.nit_cui))) {
        tipo = antes.tipo_documento_fiscal
    }
    const documento = validarDocumentoFiscal({
        tipo,
        valor: datos.nit_cui !== undefined ? datos.nit_cui : antes?.nit_cui,
        pais: datos.pais_fiscal ?? antes?.pais_fiscal,
    })
    return { ...documento, nit_cui_invalido: false }
}

function conservaPasaporte(antes: DocumentoAnterior, nitCui: string | null): boolean {
    if (antes.tipo_documento_fiscal !== 'pasaporte') return false
    const limpio = nitCui === null ? '' : limpiarDocumento(nitCui)
    return limpio !== '' && limpio !== 'CF'
}

/**
 * Columnas de `core.clientes` que se escriben a partir de la entrada (documento fiscal validado).
 * `telefono` y `movil` se validan y normalizan solo si cambian (`#core/telefonos`, pedido A14).
 */
export async function columnasCliente(
    t: Transaccion,
    datos: DatosCliente,
    antes?: DocumentoAnterior,
): Promise<Record<string, unknown>> {
    const columnas: Record<string, unknown> = columnasDocumento(datos, antes)
    // catálogo (`#core/campos_personalizados`): en el alta siempre; al editar, si llegan (se reemplazan)
    if (datos.campos_personalizados !== undefined || !antes) {
        await validarCamposPersonalizados(t.trx, datos.campos_personalizados ?? {}, {
            exigirRequeridos: exigeRequeridos(t.ctx),
        })
    }
    for (const [clave, valor] of Object.entries(datos)) {
        if (valor === undefined || (CAMPOS_DOCUMENTO as readonly string[]).includes(clave)) continue
        if ((CAMPOS_TELEFONO as readonly string[]).includes(clave)) {
            const campo = clave as (typeof CAMPOS_TELEFONO)[number]
            const telefono = telefonoParaGuardar(campo, datos[campo], antes?.[campo], t.ctx)
            if (telefono !== undefined) columnas[campo] = telefono
            continue
        }
        if (clave === 'campos_personalizados') columnas.campos_personalizados = JSON.stringify(valor)
        else columnas[clave] = valor
    }
    if (datos.zona_id) {
        const zona = await t.trx.from('core.zonas').where('id', datos.zona_id).select('id').first()
        if (!zona) {
            throw new ValidacionFallida([{ field: 'zona_id', message: 'La zona no existe', rule: 'exists' }])
        }
    }
    return columnas
}

/**
 * Alta de cliente con datos fiscales (tipo de documento con NIT, CUI, pasaporte o CF validado,
 * nombre, dirección y país fiscal, agente de retención y sector público) y campos personalizados
 * (jsonb) validados contra su catálogo (`#core/campos_personalizados`: tipo y requeridos; las claves
 * fuera del catálogo se guardan tal cual). El saldo no se guarda: es la suma de su auxiliar en el libro.
 *
 * `codigo` (`C-000455`) lo deriva la base del id al insertar y es inmutable; el código que traiga
 * el importador del sistema anterior va en `codigo_externo`.
 *
 * `codigo_referido` (lealtad, `contratos/lealtad.md` §4): se resuelve con `resolverCodigoReferido`
 * y queda en `referido_por_id` / `referido_empresa_id`. El referido lo registra y califica A3.
 */
export default class CrearCliente extends DomainAction<EntradaCrearCliente, ClienteVista> {
    readonly nombre = 'clientes.crear'

    protected async handle(input: EntradaCrearCliente, t: Transaccion): Promise<ClienteVista> {
        const { externo, codigo_referido: codigoReferido, ...datos } = input
        const columnas = await columnasCliente(t, datos)
        if (codigoReferido) {
            const referido = await resolverCodigoReferido(t.trx, t.ctx, codigoReferido, columnas)
            columnas.referido_por_id = referido.referido_por_id
            columnas.referido_empresa_id = referido.referido_empresa_id
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.clientes')
            .insert(columnas)
            .returning('id')) as Array<{
            id: number
        }>
        const id = fila!.id
        t.fijarEntidad('cliente', id)
        await vincularExterno(t.trx, 'cliente', id, externo)
        const cliente = await verCliente(id, t.trx)
        // los códigos de referido no son datos del alta (los crea el primer servicio)
        const auditable: Record<string, unknown> = { ...cliente }
        delete auditable.codigos_referido
        await t.registrarCambios({ tipo: 'cliente', id }, null, auditable)
        return cliente
    }
}
