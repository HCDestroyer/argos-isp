/**
 * Interfaz de un certificador FEL (contrato de localización fiscal §8.1), como `pasarelas/pasarela.ts`.
 *
 * El DTE que se envía es neutral (`DteParaEnviar`): el XML de la SAT lo arma `#fiscal/fel/xml_gt`
 * y cada adaptador solo lo firma y lo envía como pida su certificador. Hoy: `infile` y `falso`
 * (laboratorio y pruebas; nunca se llama a INFILE en pruebas). Digifact o el certificador de la SAT
 * se agregan registrando otro adaptador, sin tocar nada más.
 */

export type AmbienteFel = 'pruebas' | 'produccion'
export type TipoDte = 'FACT' | 'FCAM' | 'FPEQ' | 'FCAP' | 'NCRE' | 'NDEB'

/** Credenciales ya descifradas (solo viven en memoria durante el envío). */
export type CredencialesFel = Record<string, string>

export interface ReceptorDte {
    /** `nit`, `cui`, `pasaporte` o `cf` (consumidor final) */
    tipo: 'nit' | 'cui' | 'pasaporte' | 'cf'
    /** NIT sin guiones, CUI de 13 dígitos, pasaporte; `CF` para consumidor final */
    id: string
    nombre: string
    direccion: string | null
    correo: string | null
}

export interface EmisorDte {
    nit: string
    nombre: string
    nombre_comercial: string
    /** código del establecimiento ante la SAT */
    establecimiento: number
    direccion: string
    municipio: string
    departamento: string
    codigo_postal: string
    correo: string | null
    /** `GEN` (régimen general) o `PEQ` (pequeño contribuyente) */
    afiliacion_iva: 'GEN' | 'PEQ'
}

export interface LineaDte {
    numero: number
    /** `S` servicio o `B` bien */
    bien_o_servicio: 'S' | 'B'
    descripcion: string
    cantidad: string
    unidad: string
    precio_unitario: string
    /** precio = cantidad × precio unitario, con IVA incluido */
    precio: string
    descuento: string
    /** base gravable (precio − descuento − IVA) */
    gravable: string
    iva: string
    total: string
}

export interface FraseDte {
    tipo: number
    escenario: number
}

/** Documento de origen de una NCRE o NDEB. */
export interface ReferenciaDte {
    autorizacion: string
    serie: string | null
    numero: string | null
    /** fecha de emisión del documento de origen, YYYY-MM-DD */
    fecha: string
    motivo: string
}

export interface DteParaEnviar {
    /** clave de idempotencia ante el certificador (`fiscal.dte.identificador`) */
    identificador: string
    tipo: TipoDte
    /** fecha y hora de emisión, ISO con zona de Guatemala (-06:00) */
    fecha_emision: string
    moneda: 'GTQ'
    emisor: EmisorDte
    receptor: ReceptorDte
    frases: FraseDte[]
    lineas: LineaDte[]
    total: string
    iva: string
    referencia: ReferenciaDte | null
    /** emitido en contingencia (se transmite después) */
    contingencia: boolean
}

export interface DteCertificado {
    identificador: string
    autorizacion: string
    serie: string | null
    numero: string | null
    /** fecha de emisión del DTE certificado, ISO */
    fecha_emision: string
    emisor_nit: string
    receptor_id: string
}

export interface ResultadoPrueba {
    ok: boolean
    detalle: string
}

export type ResultadoCertificacion =
    | {
          resultado: 'certificado'
          autorizacion: string
          serie: string | null
          numero: string | null
          /** instante de certificación según el certificador */
          fecha: Date
          xml: string
          pdf: string | null
          respuesta: Record<string, unknown>
      }
    | { resultado: 'rechazado'; errores: string[]; respuesta: Record<string, unknown> }
    | { resultado: 'error_temporal'; error: string; respuesta: Record<string, unknown> }

export type ResultadoAnulacion =
    | { resultado: 'anulado'; fecha: Date; xml: string | null; respuesta: Record<string, unknown> }
    | { resultado: 'rechazado'; errores: string[]; respuesta: Record<string, unknown> }
    | { resultado: 'error_temporal'; error: string; respuesta: Record<string, unknown> }

export type ResultadoConsulta =
    | {
          encontrado: true
          autorizacion: string
          serie: string | null
          numero: string | null
          fecha: Date
          xml: string | null
          anulado: boolean
          respuesta: Record<string, unknown>
      }
    | { encontrado: false; respuesta: Record<string, unknown> }
    | { encontrado: null; error: string; respuesta: Record<string, unknown> }

export interface ProveedorFel {
    readonly codigo: string
    readonly capacidades: { contingencia: boolean; consultaNit: boolean; pdf: boolean }
    probarCredenciales(cred: CredencialesFel, ambiente: AmbienteFel): Promise<ResultadoPrueba>
    certificar(
        dte: DteParaEnviar,
        cred: CredencialesFel,
        ambiente: AmbienteFel,
    ): Promise<ResultadoCertificacion>
    anular(
        dte: DteCertificado,
        motivo: string,
        cred: CredencialesFel,
        ambiente: AmbienteFel,
    ): Promise<ResultadoAnulacion>
    consultar(identificador: string, cred: CredencialesFel, ambiente: AmbienteFel): Promise<ResultadoConsulta>
    consultarNit?(
        nit: string,
        cred: CredencialesFel,
        ambiente: AmbienteFel,
    ): Promise<{ nombre: string } | null>
}

/** Campos de las credenciales de cada proveedor: cuáles son secretos y cuáles se pueden mostrar. */
export interface CamposCredenciales {
    obligatorios: readonly string[]
    /** se muestran (sin secreto): usuario, prefijo, alias */
    visibles: readonly string[]
}

const proveedores = new Map<string, { proveedor: ProveedorFel; campos: CamposCredenciales }>()

export function registrarProveedorFel(proveedor: ProveedorFel, campos: CamposCredenciales): void {
    proveedores.set(proveedor.codigo, { proveedor, campos })
}

export function proveedorFel(codigo: string): ProveedorFel | null {
    return proveedores.get(codigo)?.proveedor ?? null
}

export function camposProveedor(codigo: string): CamposCredenciales | null {
    return proveedores.get(codigo)?.campos ?? null
}

export function codigosProveedores(): string[] {
    return [...proveedores.keys()]
}
