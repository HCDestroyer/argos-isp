import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import { readFile } from 'node:fs/promises'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'
import { cifrar, descifrar } from '#shared/cifrado'
import { Problema, ValidacionFallida } from '#shared/errores'
import { cuiValido, limpiarDocumento } from '#core/nit_cui'
import { normalizarNombre } from '#core/actions/verificar_identidad_cliente'

/**
 * Identidad del titular (contrato Iris 0.10.0 §3.4.2 y §3.4.3, A41): validación del documento,
 * cifrado en reposo de número, nombre y fotos, huellas para comparar sin descifrar y las reglas del
 * cliente «con historial».
 *
 * Claves: derivadas de `APP_KEY` (SHA-256 con etiquetas distintas para cifrar y para las huellas);
 * no hacen falta variables nuevas. Rotar `APP_KEY` deja ilegibles las identidades guardadas.
 */

export const DOCUMENTOS_IDENTIDAD = ['dpi', 'pasaporte'] as const
export type DocumentoIdentidad = (typeof DOCUMENTOS_IDENTIDAD)[number]
export const METODOS_IDENTIDAD = ['foto_documento', 'revision_panel'] as const
export type MetodoIdentidad = (typeof METODOS_IDENTIDAD)[number]

export const TAMANO_MAXIMO_FOTO = 5 * 1024 * 1024
export const TIPOS_FOTO = ['image/jpeg', 'image/png'] as const
export type TipoFoto = (typeof TIPOS_FOTO)[number]

function clave(etiqueta: string): Buffer {
    return createHash('sha256')
        .update(`argosisp:${etiqueta}:v1:${env.get('APP_KEY')}`)
        .digest()
}

const claveCifrado = () => clave('identidad-cifrado')
const claveHuella = () => clave('identidad-huella')

export function cifrarTexto(texto: string): string {
    return cifrar(texto, claveCifrado())
}

export function descifrarTexto(valor: string): string {
    return descifrar(valor, claveCifrado())
}

/** AES-256-GCM: `iv (12) | tag (16) | datos`. */
export function cifrarBytes(datos: Buffer): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', claveCifrado(), iv)
    const cifrado = Buffer.concat([cipher.update(datos), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), cifrado])
}

export function descifrarBytes(valor: Buffer): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', claveCifrado(), valor.subarray(0, 12))
    decipher.setAuthTag(valor.subarray(12, 28))
    return Buffer.concat([decipher.update(valor.subarray(28)), decipher.final()])
}

/** HMAC del valor ya normalizado: compara sin guardar el dato en claro. */
export function huella(valor: string): string {
    return createHmac('sha256', claveHuella()).update(valor, 'utf8').digest('hex')
}

/** Número de documento normalizado (sin espacios ni guiones, en mayúsculas). */
export function normalizarNumero(numero: string): string {
    return limpiarDocumento(numero)
}

/** Nombre normalizado (§3.4.4): sin tildes, sin mayúsculas y sin espacios dobles. */
export { normalizarNombre }

/**
 * Valida tipo y número (§3.4.2): DPI de 13 dígitos con departamento y municipio; pasaporte
 * alfanumérico de 5 a 20. 422 `validacion` con el campo y la regla, **nunca el valor**.
 */
export function validarDocumentoIdentidad(
    tipo: DocumentoIdentidad,
    numero: string,
    campo = 'documento_numero',
): string {
    const limpio = normalizarNumero(numero)
    const valido = tipo === 'dpi' ? cuiValido(limpio) : /^[A-Z0-9]{5,20}$/.test(limpio)
    if (!valido) {
        throw new ValidacionFallida([
            {
                field: campo,
                rule: tipo === 'dpi' ? 'dpi' : 'pasaporte',
                message:
                    tipo === 'dpi'
                        ? 'DPI inválido: 13 dígitos con departamento y municipio válidos'
                        : 'Pasaporte inválido: de 5 a 20 letras o dígitos',
            },
        ])
    }
    return limpio
}

// ── Archivos ─────────────────────────────────────────────────────────────────────────────────

/**
 * Foto del documento en memoria. `toJSON` devuelve `***`: nunca llega a la auditoría ni a un log
 * (la entrada de la acción se serializa para `audit.acciones`).
 */
export class FotoIdentidad {
    constructor(
        readonly contenido: Buffer,
        readonly tipo: TipoFoto,
    ) {}

    toJSON() {
        return '***'
    }
}

function firmaFoto(contenido: Uint8Array): TipoFoto | null {
    if (contenido.length >= 3 && contenido[0] === 0xff && contenido[1] === 0xd8 && contenido[2] === 0xff) {
        return 'image/jpeg'
    }
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (contenido.length >= 8 && png.every((b, i) => contenido[i] === b)) return 'image/png'
    return null
}

/**
 * Lee una parte del multipart (`frente`, `reverso`): 413 `tamano_excedido` sobre 5 MB, 422
 * `mime_no_permitido` si no es JPEG ni PNG (por la firma de los bytes, no por la extensión).
 */
export async function leerFoto(archivo: MultipartFile | null, campo: string): Promise<FotoIdentidad | null> {
    if (!archivo) return null
    if (archivo.size > TAMANO_MAXIMO_FOTO) {
        throw new Problema(413, 'tamano_excedido', 'Archivo demasiado grande', `${campo}: hasta 5 MB`)
    }
    if (!archivo.tmpPath) {
        throw new Problema(422, 'mime_no_permitido', 'Tipo de archivo no permitido', `${campo}: JPEG o PNG`)
    }
    const contenido = await readFile(archivo.tmpPath)
    if (contenido.length > TAMANO_MAXIMO_FOTO) {
        throw new Problema(413, 'tamano_excedido', 'Archivo demasiado grande', `${campo}: hasta 5 MB`)
    }
    const tipo = firmaFoto(contenido)
    if (!tipo) {
        throw new Problema(422, 'mime_no_permitido', 'Tipo de archivo no permitido', `${campo}: JPEG o PNG`)
    }
    return new FotoIdentidad(contenido, tipo)
}

// ── Historial y titular ──────────────────────────────────────────────────────────────────────

/**
 * Cliente «con historial» (§3.4.3, §3.4.6, ajuste j): otros servicios que no están en
 * `pendiente_instalacion` (sin contar `excluirServicio`), o facturas o pagos.
 */
export async function clienteConHistorial(
    trx: QueryClientContract,
    clienteId: number,
    excluirServicio?: number,
): Promise<boolean> {
    const { rows } = (await trx.rawQuery(
        `SELECT EXISTS (SELECT 1 FROM core.servicios s WHERE s.cliente_id = ? AND s.estado <> 'pendiente_instalacion'
                          AND s.id <> ?)
             OR EXISTS (SELECT 1 FROM billing.facturas f WHERE f.cliente_id = ?)
             OR EXISTS (SELECT 1 FROM billing.pagos p WHERE p.cliente_id = ?) AS con_historial`,
        [clienteId, excluirServicio ?? 0, clienteId, clienteId],
    )) as { rows: Array<{ con_historial: boolean }> }
    return Boolean(rows[0]?.con_historial)
}

interface DocumentoConocido {
    /** el cliente tiene algún documento con el que comparar */
    tieneDocumento: boolean
    /** coincide el número (y tipo) */
    coincideDocumento: boolean
    /** coincide el nombre normalizado (con su identidad vigente o con `nombre`) */
    coincideNombre: boolean
}

/**
 * Compara documento y nombre con lo que Argos ya tiene del cliente: su identidad vigente (huellas)
 * o, para un DPI, el `nit_cui` de tipo `cui`; el nombre, con el de la identidad vigente o el del
 * cliente.
 */
export async function compararConCliente(
    trx: QueryClientContract,
    clienteId: number,
    tipo: DocumentoIdentidad,
    numero: string,
    nombre: string,
): Promise<DocumentoConocido> {
    const cliente = (await trx
        .from('core.clientes')
        .where('id', clienteId)
        .select('nombre', 'nit_cui', 'tipo_documento_fiscal')
        .first()) as { nombre: string; nit_cui: string | null; tipo_documento_fiscal: string } | null
    const vigente = (await trx
        .from('core.clientes_identidades')
        .where({ cliente_id: clienteId, vigente: true })
        .select('documento_tipo', 'documento_huella', 'nombre_huella')
        .first()) as { documento_tipo: string; documento_huella: string; nombre_huella: string } | null
    const nombreNormal = normalizarNombre(nombre)
    const cuiCliente =
        cliente?.tipo_documento_fiscal === 'cui' && cliente.nit_cui ? normalizarNumero(cliente.nit_cui) : null
    const tieneDocumento = Boolean(vigente) || cuiCliente !== null
    const coincideDocumento =
        (vigente !== null &&
            vigente.documento_tipo === tipo &&
            vigente.documento_huella === huella(numero)) ||
        (tipo === 'dpi' && cuiCliente !== null && cuiCliente === numero)
    const coincideNombre =
        (vigente !== null && vigente.nombre_huella === huella(nombreNormal)) ||
        (cliente !== null && normalizarNombre(cliente.nombre) === nombreNormal)
    return { tieneDocumento, coincideDocumento, coincideNombre }
}

/** 422 `titular_no_coincide` (§3.4.7): sin datos del otro cliente. */
export class TitularNoCoincide extends Problema {
    constructor() {
        super(
            422,
            'titular_no_coincide',
            'El titular no coincide',
            'El documento ya es de un titular con otro nombre: lo revisa un supervisor',
        )
    }
}

// ── Titular empresa (contrato Iris 0.14.1 §3.4.4) ────────────────────────────────────────────

/** NIT normalizado como en §7.5: sin guiones ni espacios y en mayúsculas (la `K`). */
export function normalizarNit(nit: string): string {
    return limpiarDocumento(nit)
}

/** SQL del NIT normalizado de una columna (mismo criterio que `normalizarNit`). */
export function sqlNitNormalizado(columna: string): string {
    return `upper(regexp_replace(coalesce(${columna}, ''), '[[:space:]-]', '', 'g'))`
}

/**
 * ¿El representante (tipo, número y nombre normalizado) coincide con una identidad A41, vigente o
 * anterior, del cliente empresa? Devuelve el id de esa identidad o null.
 */
export async function representanteRegistrado(
    trx: QueryClientContract,
    clienteId: number,
    tipo: DocumentoIdentidad,
    numero: string,
    nombre: string,
): Promise<number | null> {
    const fila = (await trx
        .from('core.clientes_identidades')
        .where({
            cliente_id: clienteId,
            documento_tipo: tipo,
            documento_huella: huella(numero),
            nombre_huella: huella(normalizarNombre(nombre)),
        })
        .orderBy('version', 'desc')
        .select('id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

/** Datos que guarda la revisión de un cambio de titular a empresa (fuera de la transacción). */
export interface SolicitudRevisionEmpresa {
    empresa_id: number
    servicio_id: number
    de_cliente_id: number
    candidatos: number[]
    motivo_revision: 'representante_nuevo' | 'varios_candidatos'
    razon_social: string
    nit: string
    telefono: string
    whatsapp: boolean
    email: string | null
    relacion: string | null
    representante: { documento_tipo: DocumentoIdentidad; documento_numero: string; nombre: string }
    frente: FotoIdentidad
    reverso: FotoIdentidad | null
    verificado_en: Date
    metodo: MetodoIdentidad
    motivo_codigo: string
    motivo: string
    origen_tipo: string | null
    origen_id: string | null
}

/**
 * 422 `titular_empresa_en_revision` (§3.4.7, 0.14.1): el representante no coincide con una identidad
 * A41 de la empresa del NIT, o hay más de un candidato. Sin datos del cliente; no cambia nada. La
 * solicitud de revisión (privada: nunca se serializa) la guarda `CambiarTitularServicio` después del
 * rollback.
 */
export class TitularEmpresaEnRevision extends Problema {
    #solicitud: SolicitudRevisionEmpresa | null

    constructor(solicitud: SolicitudRevisionEmpresa | null = null) {
        super(
            422,
            'titular_empresa_en_revision',
            'Titular empresa en revisión',
            'El cambio de titular a esta empresa lo revisa una persona de Argos',
        )
        this.#solicitud = solicitud
    }

    get solicitud(): SolicitudRevisionEmpresa | null {
        return this.#solicitud
    }
}
