import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { normalizarTelefono } from '#core/telefonos'
import { claveTelefono } from '#core/consultas/clientes'

/**
 * Contactos del cliente (contrato Iris 0.10.0 §3.5, A42; 0.10.1 §3.8, A46). Tablas
 * `core.contactos_cliente` y `core.contactos_cliente_telefonos` (migración
 * `1795253370497_create_contactos_clientes_table`).
 *
 * - Cada cliente tiene un contacto titular (lo crea la base al insertar el cliente). Sus números
 *   «registrados» son `telefono` y `movil` del cliente; en la tabla de teléfonos solo lleva los
 *   adicionales (`adicional = true`), que nunca cuentan como registrados (§7.5, §12.4).
 * - Los números se guardan en E.164 (`+50255123344`); un mismo número puede estar en varios clientes.
 * - Nunca salen documentos; `GET /contactos/buscar` tampoco devuelve números (`buscarPorTelefono`).
 */

export const RELACIONES_CONTACTO = ['titular', 'familiar', 'inquilino', 'empleado', 'otro'] as const
export type RelacionContacto = (typeof RELACIONES_CONTACTO)[number]

export const PERMISOS_CONTACTO = ['consultar', 'reportar', 'pagar', 'avisos'] as const
export type PermisoContacto = (typeof PERMISOS_CONTACTO)[number]
export type PermisosContacto = Record<PermisoContacto, boolean>

export const PERMISOS_POR_DEFECTO: PermisosContacto = {
    consultar: true,
    reportar: true,
    pagar: true,
    avisos: true,
}

/** Campos de `cliente.contactos_cambiados` (solo nombres, nunca valores ni números). */
export const CAMPOS_CONTACTO = [
    'nombre',
    'relacion',
    'servicios',
    'permisos',
    'telefonos',
    'persona_cliente_id',
] as const
export type CampoContacto = (typeof CAMPOS_CONTACTO)[number]

/** Hasta cuántos números por contacto (y adicionales del titular: 4, §3.2). */
export const MAXIMO_TELEFONOS_CONTACTO = 5
export const MAXIMO_TELEFONOS_ADICIONALES = 4

/** «Verificado» (§3.8, ajuste an): confirmado con un código en los últimos 12 meses. */
export const VIGENCIA_VERIFICACION_MESES = 12

export interface TelefonoContacto {
    numero: string
    whatsapp: boolean
    principal: boolean
    /** número adicional del titular (`telefonos_adicionales[]`): contacto no verificado */
    adicional: boolean
}

export interface ContactoVista {
    contacto_id: number
    cliente_id: number
    /** empresa de sus servicios (la del primero; con `servicios` null, la del primer servicio del cliente) */
    empresa_id: number | null
    nombre: string
    relacion: RelacionContacto
    es_titular: boolean
    /** ids de servicio del cliente a los que aplica; null = todos */
    servicios: number[] | null
    permisos: PermisosContacto
    telefonos: TelefonoContacto[]
    /** otro cliente de la misma empresa que es esta persona (A46) o null */
    persona_cliente_id: number | null
    origen: 'argos' | 'iris' | 'portal'
    version: number
    created_at: string
    updated_at: string
}

interface FilaContacto {
    id: number
    cliente_id: number
    nombre: string
    cliente_nombre: string
    relacion: RelacionContacto
    es_titular: boolean
    servicios: Array<number | string> | null
    permisos: Partial<PermisosContacto>
    persona_cliente_id: number | null
    origen: ContactoVista['origen']
    version: number
    created_at: string
    updated_at: string
    quitado_en: string | null
    empresa_id: number | null
}

/** E.164 sin separadores a partir de cualquier forma que acepta `normalizarTelefono`; null si no vale. */
export function aE164(valor: string): string | null {
    const normalizado = normalizarTelefono(valor)
    if (normalizado === null) return null
    return normalizado.replace(/[\s-]/g, '')
}

/** `+502 ****-3344`: el número enmascarado para los avisos al titular (§3.5). */
export function enmascararNumero(e164: string): string {
    const digitos = e164.replace(/\D/g, '')
    const fin = digitos.slice(-4)
    if (e164.startsWith('+502') && digitos.length === 11) return `+502 ****-${fin}`
    return `+${digitos.slice(0, Math.max(1, digitos.length - 8))} ****${fin}`
}

const SQL_EMPRESA_CONTACTO = `coalesce(
    (SELECT s_e.empresa_id FROM core.servicios s_e
      WHERE k.servicios IS NOT NULL AND s_e.id = ANY(k.servicios) ORDER BY s_e.id LIMIT 1),
    (SELECT s_c.empresa_id FROM core.servicios s_c
      WHERE k.servicios IS NULL AND s_c.cliente_id = k.cliente_id AND s_c.estado <> 'retirado'
      ORDER BY s_c.id LIMIT 1)
) AS empresa_id`

function consultaContactos(cliente: QueryClientContract) {
    return cliente
        .from('core.contactos_cliente as k')
        .join('core.clientes as c', 'c.id', 'k.cliente_id')
        .select(
            'k.id',
            'k.cliente_id',
            'k.nombre',
            'c.nombre as cliente_nombre',
            'k.relacion',
            'k.es_titular',
            'k.servicios',
            'k.permisos',
            'k.persona_cliente_id',
            'k.origen',
            'k.version',
            'k.created_at',
            'k.updated_at',
            'k.quitado_en',
            cliente.raw(SQL_EMPRESA_CONTACTO),
        )
}

async function telefonosDe(
    ids: number[],
    cliente: QueryClientContract,
): Promise<Map<number, TelefonoContacto[]>> {
    const mapa = new Map<number, TelefonoContacto[]>()
    if (ids.length === 0) return mapa
    const filas = (await cliente
        .from('core.contactos_cliente_telefonos')
        .whereIn('contacto_id', ids)
        .orderBy([
            { column: 'principal', order: 'desc' },
            { column: 'id', order: 'asc' },
        ])
        .select('contacto_id', 'numero', 'whatsapp', 'principal', 'adicional')) as Array<
        TelefonoContacto & { contacto_id: number }
    >
    for (const { contacto_id: id, ...telefono } of filas) {
        const lista = mapa.get(Number(id)) ?? []
        lista.push(telefono)
        mapa.set(Number(id), lista)
    }
    return mapa
}

function permisosCompletos(valor: Partial<PermisosContacto> | null | undefined): PermisosContacto {
    return { ...PERMISOS_POR_DEFECTO, ...valor }
}

function aVista(fila: FilaContacto, telefonos: TelefonoContacto[]): ContactoVista {
    return {
        contacto_id: Number(fila.id),
        cliente_id: Number(fila.cliente_id),
        empresa_id: fila.empresa_id === null ? null : Number(fila.empresa_id),
        // el titular siempre con el nombre vigente del cliente
        nombre: fila.es_titular ? fila.cliente_nombre : fila.nombre,
        relacion: fila.relacion,
        es_titular: fila.es_titular,
        servicios: fila.servicios === null ? null : fila.servicios.map(Number),
        permisos: permisosCompletos(fila.permisos),
        telefonos,
        persona_cliente_id: fila.persona_cliente_id === null ? null : Number(fila.persona_cliente_id),
        origen: fila.origen,
        version: Number(fila.version),
        created_at: fila.created_at,
        updated_at: fila.updated_at,
    }
}

/** Un contacto vigente (404 si no existe o se quitó). */
export async function verContacto(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ContactoVista> {
    const fila = (await consultaContactos(cliente)
        .where('k.id', id)
        .whereNull('k.quitado_en')
        .first()) as FilaContacto | null
    if (!fila) throw new NoEncontrado(`El contacto ${id} no existe`)
    const telefonos = await telefonosDe([Number(fila.id)], cliente)
    return aVista(fila, telefonos.get(Number(fila.id)) ?? [])
}

/** Contactos vigentes del cliente, el titular primero. */
export async function listarContactosCliente(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ContactoVista[]> {
    const filas = (await consultaContactos(cliente)
        .where('k.cliente_id', clienteId)
        .whereNull('k.quitado_en')
        .orderBy([
            { column: 'k.es_titular', order: 'desc' },
            { column: 'k.id', order: 'asc' },
        ])) as FilaContacto[]
    const telefonos = await telefonosDe(
        filas.map((f) => Number(f.id)),
        cliente,
    )
    return filas.map((f) => aVista(f, telefonos.get(Number(f.id)) ?? []))
}

/** Contactos vigentes de otros clientes que son esta persona (`persona_cliente_id`; «Está a cargo de»). */
export async function listarContactosACargo(
    personaClienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ContactoVista[]> {
    const filas = (await consultaContactos(cliente)
        .where('k.persona_cliente_id', personaClienteId)
        .whereNull('k.quitado_en')
        .orderBy('k.id')) as FilaContacto[]
    const telefonos = await telefonosDe(
        filas.map((f) => Number(f.id)),
        cliente,
    )
    return filas.map((f) => aVista(f, telefonos.get(Number(f.id)) ?? []))
}

/** Id del contacto titular del cliente. */
export async function contactoTitularDe(clienteId: number, cliente: QueryClientContract): Promise<number> {
    const fila = (await cliente
        .from('core.contactos_cliente')
        .where({ cliente_id: clienteId, es_titular: true })
        .select('id')
        .first()) as { id: number } | null
    if (fila) return Number(fila.id)
    // un cliente insertado antes de la migración y sin fila (no debería pasar): se crea
    const [nueva] = (await cliente
        .insertQuery()
        .table('core.contactos_cliente')
        .insert({
            cliente_id: clienteId,
            nombre: cliente.raw('(SELECT left(nombre, 200) FROM core.clientes WHERE id = ?)', [clienteId]),
            relacion: 'titular',
            es_titular: true,
        })
        .returning('id')) as Array<{ id: number }>
    return Number(nueva!.id)
}

// ── Validación de la entrada ─────────────────────────────────────────────────────────────────

export interface TelefonoEntrada {
    numero: string
    whatsapp?: boolean
    principal?: boolean
}

/**
 * Números normalizados a E.164. 422 por posición sin repetir el valor recibido (§3.4 «Datos
 * personales en errores»). `titular`: solo adicionales (ninguno principal, hasta 4); si no, de 1 a 5
 * con exactamente un principal (con uno solo, es el principal).
 */
export function validarTelefonos(
    entrada: TelefonoEntrada[],
    titular: boolean,
    campo = 'telefonos',
): TelefonoContacto[] {
    const errores: ErrorCampo[] = []
    const vistos = new Set<string>()
    const salida: TelefonoContacto[] = []
    const maximo = titular ? MAXIMO_TELEFONOS_ADICIONALES : MAXIMO_TELEFONOS_CONTACTO
    if (entrada.length > maximo) {
        errores.push({ field: campo, rule: 'maxLength', message: `Hasta ${maximo} números` })
    }
    if (!titular && entrada.length === 0) {
        errores.push({ field: campo, rule: 'minLength', message: 'Al menos un número' })
    }
    entrada.forEach((telefono, i) => {
        const numero = aE164(telefono.numero)
        if (numero === null) {
            errores.push({
                field: `${campo}.${i}.numero`,
                rule: 'telefono',
                message: 'Número inválido: E.164 (+ y 8 a 15 dígitos) o 8 dígitos de Guatemala',
            })
            return
        }
        if (vistos.has(numero)) {
            errores.push({ field: `${campo}.${i}.numero`, rule: 'distinct', message: 'Número repetido' })
            return
        }
        vistos.add(numero)
        salida.push({
            numero,
            whatsapp: telefono.whatsapp ?? false,
            principal: titular ? false : (telefono.principal ?? false),
            adicional: titular,
        })
    })
    if (!titular && salida.length === 1 && entrada[0]?.principal === undefined) salida[0]!.principal = true
    if (titular && entrada.some((t) => t.principal)) {
        errores.push({
            field: campo,
            rule: 'principal',
            message: 'Los números del titular son adicionales: su principal es el teléfono del cliente',
        })
    }
    if (!titular && salida.length > 0 && salida.filter((t) => t.principal).length !== 1) {
        errores.push({ field: campo, rule: 'principal', message: 'Exactamente un número principal' })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return salida
}

/** `servicios[]` del cliente (no retirados). null = todos. 422 si alguno no es del cliente. */
export async function validarServicios(
    t: Transaccion,
    clienteId: number,
    servicios: number[] | null | undefined,
): Promise<number[] | null> {
    if (servicios === undefined || servicios === null) return null
    const unicos = [...new Set(servicios)].toSorted((a, b) => a - b)
    if (unicos.length === 0) {
        throw new ValidacionFallida([
            { field: 'servicios', rule: 'minLength', message: 'Al menos un servicio, o null para todos' },
        ])
    }
    const filas = (await t.trx
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .whereIn('id', unicos)
        .select('id')) as Array<{ id: number }>
    if (filas.length !== unicos.length) {
        throw new ValidacionFallida([
            {
                field: 'servicios',
                rule: 'exists',
                message: 'Algún servicio no es de este cliente o está retirado',
            },
        ])
    }
    return unicos
}

/** Reemplaza los teléfonos del contacto. */
export async function guardarTelefonos(t: Transaccion, contactoId: number, telefonos: TelefonoContacto[]) {
    await t.trx.from('core.contactos_cliente_telefonos').where('contacto_id', contactoId).delete()
    if (telefonos.length === 0) return
    await t.trx
        .insertQuery()
        .table('core.contactos_cliente_telefonos')
        .multiInsert(telefonos.map((tel) => ({ contacto_id: contactoId, ...tel })))
}

// ── Vínculo con otro cliente (A46) ───────────────────────────────────────────────────────────

/** Empresas de los servicios no retirados del cliente. */
export async function empresasDeCliente(clienteId: number, cliente: QueryClientContract): Promise<number[]> {
    const filas = (await cliente
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .distinct('empresa_id')
        .orderBy('empresa_id')) as Array<{ empresa_id: number }>
    return filas.map((f) => Number(f.empresa_id))
}

interface NumerosPersona {
    telefono: string | null
    movil: string | null
    telefono_verificado_en: Date | null
    movil_verificado_en: Date | null
}

async function numerosPersona(
    clienteId: number,
    cliente: QueryClientContract,
): Promise<NumerosPersona | null> {
    return (await cliente
        .from('core.clientes')
        .where('id', clienteId)
        .select('telefono', 'movil', 'telefono_verificado_en', 'movil_verificado_en')
        .first()) as NumerosPersona | null
}

function verificadoVigente(fecha: Date | null, ahora = new Date()): boolean {
    if (!fecha) return false
    const limite = new Date(ahora)
    limite.setUTCMonth(limite.getUTCMonth() - VIGENCIA_VERIFICACION_MESES)
    return new Date(fecha).getTime() >= limite.getTime()
}

/**
 * ¿Algún número del contacto es el `telefono` o `movil` de la persona? Con `soloVerificados`
 * (desde Iris, §3.8), solo cuenta un número confirmado con un código en los últimos 12 meses.
 */
export function coincideConPersona(
    numeros: string[],
    persona: NumerosPersona,
    soloVerificados: boolean,
): boolean {
    const claves = new Set(numeros.map(claveTelefono))
    const candidatos: Array<[string | null, Date | null]> = [
        [persona.telefono, persona.telefono_verificado_en],
        [persona.movil, persona.movil_verificado_en],
    ]
    return candidatos.some(
        ([numero, verificado]) =>
            numero !== null &&
            numero.trim() !== '' &&
            claves.has(claveTelefono(numero)) &&
            (!soloVerificados || verificadoVigente(verificado)),
    )
}

/**
 * Valida `persona_cliente_id` (A46): otro cliente que comparte empresa con el dueño del contacto.
 * Desde el personal de Argos basta con eso (422 si no). Desde Iris (`desdeIris`), además uno de los
 * números del contacto debe ser el `telefono` o `movil` **verificado** de esa persona; si no, el
 * contacto queda suelto (null), sin error (§3.8).
 */
export async function resolverPersona(
    t: Transaccion,
    clienteId: number,
    personaId: number | null | undefined,
    numeros: string[],
    desdeIris: boolean,
): Promise<number | null> {
    if (personaId === undefined || personaId === null) return null
    const invalido = (mensaje: string) =>
        new ValidacionFallida([{ field: 'persona_cliente_id', rule: 'persona', message: mensaje }])
    if (personaId === clienteId) throw invalido('No puede ser el mismo cliente')
    const persona = await numerosPersona(personaId, t.trx)
    if (!persona) throw invalido('El cliente no existe')
    const [delDueno, deLaPersona] = await Promise.all([
        empresasDeCliente(clienteId, t.trx),
        empresasDeCliente(personaId, t.trx),
    ])
    if (!delDueno.some((e) => deLaPersona.includes(e))) {
        throw invalido('Debe ser un cliente de la misma empresa')
    }
    if (desdeIris && !coincideConPersona(numeros, persona, true)) return null
    return personaId
}

/**
 * Vuelve a validar los vínculos (§3.8, ajuste am) de los contactos que apuntan a `personaId` (sus
 * números cambiaron) o del contacto `contactoId` (cambiaron los del contacto): si antes coincidía y
 * ya no, el vínculo se rompe (`persona_cliente_id` null, diff y `cliente.contactos_cambiados`). Un
 * vínculo que el personal hizo sin coincidencia de números no se toca.
 */
export async function revalidarVinculos(
    t: Transaccion,
    filtro: { personaId: number; antes: NumerosPersona } | { contactoId: number; numerosAntes: string[] },
): Promise<number[]> {
    const consulta = t.trx
        .from('core.contactos_cliente')
        .whereNull('quitado_en')
        .whereNotNull('persona_cliente_id')
        .forUpdate()
        .select('id', 'cliente_id', 'persona_cliente_id', 'version')
    if ('personaId' in filtro) consulta.where('persona_cliente_id', filtro.personaId)
    else consulta.where('id', filtro.contactoId)
    const filas = (await consulta) as Array<{
        id: number
        cliente_id: number
        persona_cliente_id: number
        version: number
    }>
    const rotos: number[] = []
    for (const fila of filas) {
        const numeros = (
            (await t.trx
                .from('core.contactos_cliente_telefonos')
                .where('contacto_id', fila.id)
                .select('numero')) as Array<{ numero: string }>
        ).map((n) => n.numero)
        const personaAhora = await numerosPersona(Number(fila.persona_cliente_id), t.trx)
        if (!personaAhora) continue
        const antesCoincidia =
            'personaId' in filtro
                ? coincideConPersona(numeros, filtro.antes, false)
                : coincideConPersona(filtro.numerosAntes, personaAhora, false)
        if (!antesCoincidia || coincideConPersona(numeros, personaAhora, false)) continue
        await t.trx
            .from('core.contactos_cliente')
            .where('id', fila.id)
            .update({
                persona_cliente_id: null,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        await t.registrarCambios(
            { tipo: 'contacto_cliente', id: Number(fila.id) },
            { persona_cliente_id: Number(fila.persona_cliente_id) },
            { persona_cliente_id: null },
        )
        await emitirContactosCambiados(t, {
            cliente_id: Number(fila.cliente_id),
            contacto_id: Number(fila.id),
            accion: 'editado',
            campos: ['persona_cliente_id'],
            persona_cliente_id: null,
            persona_anterior_id: Number(fila.persona_cliente_id),
            motivo: 'vinculo_roto',
        })
        rotos.push(Number(fila.id))
    }
    return rotos
}

export { numerosPersona }
export type { NumerosPersona }

// ── Evento ───────────────────────────────────────────────────────────────────────────────────

export interface CambioContactos {
    cliente_id: number
    contacto_id: number
    accion: 'creado' | 'editado' | 'quitado'
    campos: CampoContacto[]
    persona_cliente_id: number | null
    /** vínculo anterior (para avisar a los dos titulares al romperse o cambiar) */
    persona_anterior_id?: number | null
    /** `vinculo_roto` al revalidar (§3.8) */
    motivo?: 'vinculo_roto'
    /** números nuevos del contacto (`telefonos` cambió): notify avisa al titular enmascarados */
    numeros_agregados?: number
}

/**
 * `cliente.contactos_cambiados` (§2.3): sin números ni nombres. `empresa_id` = la del contacto (o la
 * primera de los servicios del cliente). `numeros_agregados` cuenta los números nuevos (notify avisa
 * al titular con los números enmascarados que lee de `telefonosEnmascarados`).
 */
export async function emitirContactosCambiados(t: Transaccion, cambio: CambioContactos): Promise<void> {
    const fila = (await t.trx
        .from('core.contactos_cliente as k')
        .where('k.id', cambio.contacto_id)
        .select(t.trx.raw(SQL_EMPRESA_CONTACTO))
        .first()) as { empresa_id: number | null } | null
    await t.emit('cliente.contactos_cambiados', {
        cliente_id: cambio.cliente_id,
        empresa_id:
            fila?.empresa_id === null || fila?.empresa_id === undefined ? null : Number(fila.empresa_id),
        contacto_id: cambio.contacto_id,
        accion: cambio.accion,
        campos: cambio.campos,
        persona_cliente_id: cambio.persona_cliente_id,
        ...(cambio.persona_anterior_id !== undefined
            ? { persona_anterior_id: cambio.persona_anterior_id }
            : {}),
        ...(cambio.motivo ? { motivo: cambio.motivo } : {}),
        ...(cambio.numeros_agregados ? { numeros_agregados: cambio.numeros_agregados } : {}),
    })
}

/**
 * Para notify (aviso al titular, §3.5): los números del contacto enmascarados (`+502 ****-3344`),
 * nunca completos.
 */
export async function telefonosEnmascarados(
    contactoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<string[]> {
    const filas = (await cliente
        .from('core.contactos_cliente_telefonos')
        .where('contacto_id', contactoId)
        .orderBy('id')
        .select('numero')) as Array<{ numero: string }>
    return filas.map((f) => enmascararNumero(f.numero))
}
