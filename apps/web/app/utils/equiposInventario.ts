import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Equipos del cliente por serie o MAC (A48, contrato Iris 0.12.0 §3.10, tablero NuevoInventario):
 * estado del equipo con icono, texto y color, motivos y destinos de «Cambiar equipo», medios de
 * contacto, estados de un cobro de equipo y la línea de tiempo de la ficha de la unidad.
 *
 * Regla del PM: el técnico nunca decide pérdidas ni cobros. Un cambio solo **propone** el cobro; la
 * pérdida («no recuperado») y el cobro los decide una persona con `inventario.cobrar_equipo`.
 */

type BadgeColor = NonNullable<BadgeProps['color']>
type UnidadApi = Schema<'UnidadInventario'>
type DetalleApi = Schema<'UnidadInventarioDetalle'>
type BodegaApi = Schema<'Bodega'>

export type EstadoEquipo = NonNullable<UnidadApi['estado_equipo']>

interface EstadoVisible {
    etiqueta: string
    color: BadgeColor
    icono: string
}

/** Estado del equipo (el de Iris): revisión y garantía son una unidad `en_reparacion` en su bodega. */
export const ESTADOS_EQUIPO: Record<EstadoEquipo, EstadoVisible> = {
    disponible: { etiqueta: 'En bodega', color: 'primary', icono: 'i-lucide-warehouse' },
    en_comodato: { etiqueta: 'En comodato', color: 'success', icono: 'i-lucide-house' },
    por_recuperar: { etiqueta: 'Por recuperar', color: 'warning', icono: 'i-lucide-undo-2' },
    revision: { etiqueta: 'En revisión', color: 'warning', icono: 'i-lucide-wrench' },
    garantia: { etiqueta: 'En garantía', color: 'primary', icono: 'i-lucide-shield-check' },
    dada_de_baja: { etiqueta: 'Dado de baja', color: 'error', icono: 'i-lucide-trash-2' },
    no_recuperada: { etiqueta: 'No recuperado', color: 'error', icono: 'i-lucide-circle-x' },
    vendida: { etiqueta: 'Vendido', color: 'neutral', icono: 'i-lucide-receipt' },
    anulada: { etiqueta: 'Anulado', color: 'neutral', icono: 'i-lucide-ban' },
    devuelta_proveedor: { etiqueta: 'Devuelto al proveedor', color: 'neutral', icono: 'i-lucide-truck' },
    entregada: { etiqueta: 'Entregado (premio)', color: 'neutral', icono: 'i-lucide-gift' },
}

/** «Con técnico»: un equipo disponible en la bodega de un técnico o de una cuadrilla. */
export const CON_TECNICO: EstadoVisible = { etiqueta: 'Con técnico', color: 'neutral', icono: 'i-lucide-hard-hat' }

/**
 * Estado del equipo de una unidad. La API lo manda en `estado_equipo`; si no llegó (versiones
 * anteriores), se deduce del estado de la fila: `en_reparacion` es revisión.
 */
export function estadoEquipoDe(unidad: Pick<UnidadApi, 'estado' | 'estado_equipo'>): EstadoEquipo {
    if (unidad.estado_equipo) {
        return unidad.estado_equipo
    }
    return unidad.estado === 'en_reparacion' ? 'revision' : unidad.estado
}

/** Lo que se muestra del estado: un disponible en la bodega de un técnico o cuadrilla está «Con técnico». */
export function estadoVisibleDe(unidad: Pick<UnidadApi, 'estado' | 'estado_equipo' | 'bodega_id'>, bodegas: Pick<BodegaApi, 'id' | 'tipo'>[] = []): EstadoVisible {
    const estado = estadoEquipoDe(unidad)
    if (estado === 'disponible') {
        const tipo = bodegas.find(b => b.id === unidad.bodega_id)?.tipo
        if (tipo === 'tecnico' || tipo === 'cuadrilla') {
            return CON_TECNICO
        }
    }
    return ESTADOS_EQUIPO[estado]
}

/* Cambiar equipo (`POST /servicios/:id/equipos/cambiar`) */

export type DatosCambio = DatosCambioEquipo
export type MotivoCambio = DatosCambio['motivo']
export type DestinoSale = DatosCambio['destino_sale']

export const MOTIVOS_CAMBIO: Record<MotivoCambio, string> = {
    danado: 'Dañado',
    actualizacion: 'Actualización',
    garantia: 'Garantía',
    otro: 'Otro',
}

export const DESTINOS_SALE: Record<DestinoSale, { etiqueta: string, descripcion: string }> = {
    funciona: { etiqueta: 'Funciona', descripcion: 'Vuelve a bodega como usado' },
    revision: { etiqueta: 'A revisión', descripcion: 'Se prueba en bodega antes de decidir' },
    garantia: { etiqueta: 'Garantía', descripcion: 'Se envía al proveedor' },
    danado: { etiqueta: 'Dañado', descripcion: 'Queda en revisión para darlo de baja' },
}

/** El destino que sugiere cada motivo: un equipo dañado o en garantía nunca vuelve como «funciona». */
export const DESTINO_SUGERIDO: Record<MotivoCambio, DestinoSale> = {
    danado: 'revision',
    actualizacion: 'funciona',
    garantia: 'garantia',
    otro: 'revision',
}

export function destinoPermitido(motivo: MotivoCambio, destino: DestinoSale): boolean {
    return !(destino === 'funciona' && (motivo === 'danado' || motivo === 'garantia'))
}

export const esquemaCambioEquipo = z.object({
    motivo: z.enum(['danado', 'actualizacion', 'garantia', 'otro']),
    entra: z.number({ error: 'Escanea o elige el equipo que entra' }).int().positive('Escanea o elige el equipo que entra'),
    destino: z.enum(['funciona', 'revision', 'garantia', 'danado']),
    cobrar: z.boolean(),
    nota: z.string().trim().max(500).optional(),
}).refine(d => destinoPermitido(d.motivo, d.destino), { path: ['destino'], message: 'Un equipo dañado o en garantía no vuelve como «funciona»' })

export type EntradaCambioEquipo = z.input<typeof esquemaCambioEquipo>

/** Cuerpo de `POST /servicios/:id/equipos/cambiar` desde el formulario del panel. */
export function cuerpoCambioEquipo(saleId: number, d: z.output<typeof esquemaCambioEquipo>): DatosCambio {
    const nota = d.nota?.trim() || null
    return {
        sale: { unidad_id: saleId },
        entra: { unidad_id: d.entra, serie: null, mac: null },
        motivo: d.motivo,
        destino_sale: d.destino,
        ...(d.cobrar ? { cobro_propuesto: { motivo: 'Daño por mal uso', nota } } : {}),
        nota,
    }
}

/* Recuperación */

export type MedioContacto = Schema<'ContactoRecuperacion'>['medio']

export const MEDIOS_CONTACTO: Record<'llamada' | 'whatsapp' | 'correo' | 'visita' | 'oficina' | 'otro', { etiqueta: string, icono: string }> = {
    llamada: { etiqueta: 'Llamada', icono: 'i-lucide-phone' },
    whatsapp: { etiqueta: 'WhatsApp', icono: 'i-lucide-message-circle' },
    correo: { etiqueta: 'Correo', icono: 'i-lucide-mail' },
    visita: { etiqueta: 'Visita', icono: 'i-lucide-map-pin' },
    oficina: { etiqueta: 'En oficina', icono: 'i-lucide-building' },
    otro: { etiqueta: 'Otro', icono: 'i-lucide-message-square' },
}

export const MOTIVOS_INTENTO: Record<DetalleApi['intentos'][number]['motivo'], string> = {
    cliente_ausente: 'Cliente ausente',
    se_nego: 'Se negó a entregarlo',
    equipo_perdido: 'Dice que lo perdió',
    otro: 'Otro motivo',
}

export const ESTADOS_COBRO_EQUIPO: Record<Schema<'CobroEquipo'>['estado'], EstadoVisible> = {
    propuesto: { etiqueta: 'Por decidir', color: 'warning', icono: 'i-lucide-hourglass' },
    aprobado: { etiqueta: 'Cobrado al cliente', color: 'success', icono: 'i-lucide-circle-check' },
    rechazado: { etiqueta: 'Sin cobro (decisión)', color: 'neutral', icono: 'i-lucide-circle-slash' },
}

export const ORIGENES_COBRO_EQUIPO: Record<Schema<'CobroEquipo'>['origen'], string> = {
    no_recuperado: 'Equipo no devuelto',
    cambio_equipo: 'Daño en un cambio de equipo',
}

export const esquemaGarantia = z.object({
    proveedor: z.string().trim().min(2, 'Escribe el proveedor').max(120),
    rma: z.string().trim().min(1, 'Escribe el número de RMA').max(60),
    vence_en: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha'),
})

export const esquemaResolverGarantia = z.object({
    resultado: z.enum(['reparada', 'reemplazada', 'rechazada']),
    serie: z.string().trim().max(60).optional(),
    mac: z.string().trim().max(32).optional(),
    nota: z.string().trim().max(500).optional(),
}).refine(d => d.resultado !== 'reemplazada' || Boolean(d.serie || d.mac), { path: ['serie'], message: 'Escribe la serie o la MAC del equipo nuevo' })

export const RESULTADOS_GARANTIA: Record<'reparada' | 'reemplazada' | 'rechazada', { etiqueta: string, descripcion: string, color: BadgeColor }> = {
    reparada: { etiqueta: 'Volvió reparada', descripcion: 'Vuelve a la bodega como usada', color: 'success' },
    reemplazada: { etiqueta: 'Cambiada por otra', descripcion: 'Toma la serie o MAC del equipo nuevo, al mismo costo', color: 'primary' },
    rechazada: { etiqueta: 'Rechazada', descripcion: 'Vuelve a revisión: repararla o darla de baja', color: 'error' },
}

/* Línea de tiempo de la unidad */

export interface EventoUnidad {
    clave: string
    fecha: string
    titulo: string
    detalle: string
    icono: string
    tono: 'tono-exito' | 'tono-aviso' | 'tono-error' | 'tono-marca'
}

/** Motivos (códigos de la API) en palabras; lo que no se conoce se muestra tal cual. */
const MOTIVOS_ESTADO: Record<string, string> = {
    asignacion_comodato: 'comodato asignado',
    devolucion_comodato: 'devuelto a bodega',
    servicio_retirado: 'servicio retirado',
    servicio_reactivado: 'servicio reactivado',
    cambio_equipo: 'cambio de equipo',
    enviada_garantia: 'enviado a garantía',
    garantia_reparada: 'volvió reparado',
    garantia_reemplazada: 'cambiado por otro',
    garantia_rechazada: 'garantía rechazada',
    declarada_no_recuperada: 'declarado no recuperado',
    marcada_reparada: 'probado: funciona',
    baja: 'dado de baja',
}

export function motivoEnPalabras(motivo: string | null): string | null {
    if (!motivo) {
        return null
    }
    const [codigo = '', ...resto] = motivo.split(' · ')
    const texto = MOTIVOS_ESTADO[codigo] ?? codigo.replaceAll('_', ' ')
    return [texto, ...resto].join(' · ')
}

const TONO_ESTADO: Partial<Record<EstadoEquipo, EventoUnidad['tono']>> = {
    en_comodato: 'tono-exito',
    disponible: 'tono-marca',
    por_recuperar: 'tono-aviso',
    revision: 'tono-aviso',
    garantia: 'tono-marca',
    dada_de_baja: 'tono-error',
    no_recuperada: 'tono-error',
}

/**
 * Historial de la unidad en una sola lista, de lo más nuevo a lo más viejo: cambios de estado,
 * movimientos del kardex, garantías, intentos de recuperación y contactos con el cliente.
 */
export function lineaTiempoUnidad(unidad: DetalleApi, nombreTecnico: (id: number | null) => string | null = () => null): EventoUnidad[] {
    const eventos: EventoUnidad[] = []
    for (const [i, cambio] of unidad.historial_estados.entries()) {
        const servicio = cambio.servicio_id ? ` · servicio #${cambio.servicio_id}` : ''
        const iris = cambio.origen_externo_tipo === 'iris_orden' && cambio.origen_externo_id ? ` · orden ${cambio.origen_externo_id} (Iris)` : ''
        eventos.push({
            clave: `estado-${i}`,
            fecha: cambio.fecha,
            titulo: `${ESTADOS_EQUIPO[cambio.de].etiqueta} → ${ESTADOS_EQUIPO[cambio.a].etiqueta}`,
            detalle: [motivoEnPalabras(cambio.motivo), `${servicio}${iris}`.replace(/^ · /, '')].filter(Boolean).join(' · '),
            icono: ESTADOS_EQUIPO[cambio.a].icono,
            tono: TONO_ESTADO[cambio.a] ?? 'tono-marca',
        })
    }
    for (const m of unidad.historial) {
        eventos.push({
            clave: `mov-${m.id}`,
            fecha: m.created_at,
            titulo: `${TIPOS_MOVIMIENTO_INVENTARIO[m.tipo]} · ${m.bodega_nombre}`,
            detalle: [m.servicio_id ? `servicio #${m.servicio_id}` : null, m.motivo, m.origen_externo_id ? `orden ${m.origen_externo_id} (Iris)` : null].filter(Boolean).join(' · '),
            icono: m.tipo === 'traslado' ? 'i-lucide-truck' : m.tipo === 'entrada_compra' ? 'i-lucide-receipt' : 'i-lucide-list-ordered',
            tono: 'tono-marca',
        })
    }
    for (const g of unidad.garantias) {
        const resultado = g.resultado && g.resuelta_en ? ` · ${g.resultado === 'baja' ? 'dada de baja' : RESULTADOS_GARANTIA[g.resultado].etiqueta.toLowerCase()}` : ''
        eventos.push({
            clave: `garantia-${g.id}`,
            fecha: g.enviada_en ?? g.abierta_en,
            titulo: g.enviada_en ? `Garantía con ${g.proveedor_nombre ?? 'el proveedor'}` : 'Garantía abierta (sin enviar)',
            detalle: [g.rma ? `RMA ${g.rma}` : null, g.vence_en ? `vence ${formatearFecha(g.vence_en)}` : null].filter(Boolean).join(' · ') + resultado,
            icono: 'i-lucide-shield-check',
            tono: 'tono-marca',
        })
    }
    for (const intento of unidad.intentos) {
        const tecnico = intento.actor_tecnico_nombre ?? nombreTecnico(intento.actor_tecnico_id) ?? intento.actor_tecnico ?? 'técnico'
        eventos.push({
            clave: `intento-${intento.id}`,
            fecha: intento.fecha,
            titulo: `Intento ${intento.intento_n} de recuperación · ${MOTIVOS_INTENTO[intento.motivo]}`,
            detalle: [tecnico, intento.origen_externo_id ? `orden ${intento.origen_externo_id} (Iris)` : null, intento.foto_ref ? 'con foto' : null, intento.nota].filter(Boolean).join(' · '),
            icono: 'i-lucide-map-pin-x',
            tono: 'tono-aviso',
        })
    }
    for (const c of unidad.contactos) {
        const medio = MEDIOS_CONTACTO[c.medio as keyof typeof MEDIOS_CONTACTO]
        eventos.push({
            clave: `contacto-${c.id}`,
            fecha: c.created_at,
            titulo: `Contacto con el cliente · ${medio?.etiqueta ?? c.medio}`,
            detalle: [c.registrado_por_nombre, c.nota].filter(Boolean).join(' · '),
            icono: medio?.icono ?? 'i-lucide-message-square',
            tono: 'tono-marca',
        })
    }
    return eventos.sort((a, b) => b.fecha.localeCompare(a.fecha))
}

/** Lo que falta para poder declarar el equipo no recuperado (2 técnicos distintos o un contacto, de fábrica). */
export function faltaParaDeclarar(p: Pick<Schema<'PendienteNoRecuperado'>, 'tecnicos_distintos' | 'contactos'>, minimoTecnicos = 2): string | null {
    if (p.contactos > 0 || p.tecnicos_distintos >= minimoTecnicos) {
        return null
    }
    const faltan = minimoTecnicos - p.tecnicos_distintos
    return `Falta ${faltan === 1 ? 'un intento de otro técnico' : `${faltan} intentos de técnicos distintos`} o registrar un contacto con el cliente`
}

/** Nombre corto de una bodega para las pastillas «dónde está» («Bodega central» → «Central»). */
export function nombreCortoBodega(nombre: string): string {
    const corto = nombre.replace(/^(bodega|vehículo de|vehiculo de)\s+/i, '').trim()
    return corto ? corto.charAt(0).toUpperCase() + corto.slice(1) : nombre
}

/* Acciones sobre un equipo, cada una con su permiso */

export type AccionEquipo = 'cambiar' | 'recibir' | 'contacto' | 'no_recuperado' | 'funciona' | 'garantia' | 'resolver' | 'baja'

export const ACCIONES_EQUIPO: Record<AccionEquipo, { etiqueta: string, icono: string, permiso: string, color?: 'error' }> = {
    cambiar: { etiqueta: 'Cambiar equipo', icono: 'i-lucide-repeat', permiso: 'servicios.cambiar_equipo' },
    recibir: { etiqueta: 'Recibido', icono: 'i-lucide-package-check', permiso: 'inventario.devolver_comodato' },
    contacto: { etiqueta: 'Registrar contacto', icono: 'i-lucide-phone', permiso: 'inventario.registrar_contacto_recuperacion' },
    no_recuperado: { etiqueta: 'No recuperado', icono: 'i-lucide-circle-x', permiso: 'inventario.cobrar_equipo', color: 'error' },
    funciona: { etiqueta: 'Funciona: a bodega', icono: 'i-lucide-circle-check', permiso: 'inventario.marcar_reparada' },
    garantia: { etiqueta: 'Enviar a garantía', icono: 'i-lucide-truck', permiso: 'inventario.enviar_garantia' },
    resolver: { etiqueta: 'Resolver garantía', icono: 'i-lucide-shield-check', permiso: 'inventario.resolver_garantia' },
    baja: { etiqueta: 'Dar de baja', icono: 'i-lucide-trash-2', permiso: 'inventario.dar_de_baja', color: 'error' },
}

/** Lo que se puede hacer con un equipo según su estado y los permisos de quien mira. */
export function accionesEquipo(unidad: Pick<UnidadApi, 'estado' | 'estado_equipo' | 'servicio_id' | 'bodega_id'>, puede: (permiso: string) => boolean): AccionEquipo[] {
    const porEstado: Partial<Record<EstadoEquipo, AccionEquipo[]>> = {
        en_comodato: unidad.servicio_id ? ['cambiar', 'recibir', 'contacto'] : [],
        por_recuperar: unidad.servicio_id ? ['recibir', 'contacto', 'no_recuperado'] : [],
        revision: unidad.bodega_id ? ['funciona', 'garantia', 'baja'] : [],
        garantia: ['resolver'],
    }
    return (porEstado[estadoEquipoDe(unidad)] ?? []).filter(a => puede(ACCIONES_EQUIPO[a].permiso))
}
