import type { Problem } from '@argosisp/contracts'
import * as z from 'zod'

/**
 * Servicio pendiente de instalación (`.claude/integration/contratos/instalacion.md`): nace con
 * credenciales, router, plan e IP, pero no navega ni factura hasta `POST
 * /servicios/:id/activar-instalacion` (`servicios.activar_instalacion`). Desde un pendiente solo se
 * activa o se retira; el resto de acciones de estado responden 422 `servicio_pendiente_instalacion`.
 */

/** Campos de la referencia de planta (pedido A9 de Iris), en el orden de la API. */
export const CAMPOS_PLANTA = ['caja', 'puerto', 'olt', 'slot', 'pon', 'potencia_dbm'] as const
export type CampoPlanta = typeof CAMPOS_PLANTA[number]

export const ETIQUETAS_PLANTA: Record<CampoPlanta, string> = {
    caja: 'Caja (NAP)',
    puerto: 'Puerto',
    olt: 'OLT',
    slot: 'Slot',
    pon: 'PON',
    potencia_dbm: 'Potencia óptica',
}

/** Datos de planta presentes, en orden; vacío si el servicio no los tiene. */
export function datosPlanta(servicio: Pick<Servicio, 'planta'>): { campo: CampoPlanta, etiqueta: string, valor: string }[] {
    const planta = servicio.planta
    if (!planta) {
        return []
    }
    return CAMPOS_PLANTA
        .map(campo => ({ campo, etiqueta: ETIQUETAS_PLANTA[campo], valor: planta[campo] }))
        .filter((d): d is { campo: CampoPlanta, etiqueta: string, valor: string } => typeof d.valor === 'string' && d.valor !== '')
        .map(d => (d.campo === 'potencia_dbm' ? { ...d, valor: `${d.valor} dBm` } : d))
}

export function esPendienteInstalacion(servicio: Pick<Servicio, 'estado'>): boolean {
    return servicio.estado === 'pendiente_instalacion'
}

const PATRON_POTENCIA = /^-?\d{1,2}(\.\d{1,2})?$/
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

function textoPlanta() {
    return z.string().trim().max(100, 'Máximo 100 caracteres')
}

/**
 * Espejo de `activarInstalacionValidator` (A1). `instalado_en` es un `datetime-local` en hora de
 * Guatemala; `ahoraMs` y `altaMs` acotan la fecha como la API (ni futura con 5 min de tolerancia
 * ni anterior al alta del servicio).
 */
export function esquemaActivarInstalacion(ahoraMs: number, altaMs: number) {
    return z.object({
        instalado_en: z.string()
            .refine(v => LOCAL.test(v) && deHoraGuatemala(v) !== null, 'Fecha y hora de la instalación')
            .refine(v => Date.parse(deHoraGuatemala(v) ?? '') <= ahoraMs + 5 * 60_000, 'La fecha de instalación no puede ser futura')
            // El `datetime-local` va por minuto: se compara contra el minuto del alta.
            .refine(v => Date.parse(deHoraGuatemala(v) ?? '') >= Math.floor(altaMs / 60_000) * 60_000, 'La fecha de instalación no puede ser anterior a la creación del servicio'),
        planta: z.object({
            caja: textoPlanta(),
            puerto: textoPlanta(),
            olt: textoPlanta(),
            slot: textoPlanta(),
            pon: textoPlanta(),
            potencia_dbm: z.string()
                .trim()
                .refine(v => v === '' || PATRON_POTENCIA.test(v), 'Decimal con hasta 2 decimales, por ejemplo -19.40')
                .refine(v => v === '' || !PATRON_POTENCIA.test(v) || (Number(v) >= -60 && Number(v) <= 10), 'La potencia debe estar entre -60 y 10 dBm'),
        }),
    })
}

export type EntradaActivarInstalacion = z.input<ReturnType<typeof esquemaActivarInstalacion>>

/** Formulario inicial: ahora (hora de Guatemala) y la planta vacía. */
export function entradaActivarInstalacion(ahora: Date = new Date()): EntradaActivarInstalacion {
    return {
        instalado_en: aHoraGuatemala(ahora.toISOString()),
        planta: { caja: '', puerto: '', olt: '', slot: '', pon: '', potencia_dbm: '' },
    }
}

/**
 * Formulario → cuerpo de `POST /servicios/:id/activar-instalacion`. Si la fecha no se tocó (la de
 * «ahora» al abrir) no se manda y la API usa su hora; la planta solo con los campos escritos.
 */
export function cuerpoActivarInstalacion(datos: EntradaActivarInstalacion, version: number, instaladoPorDefecto: string): DatosActivarInstalacion {
    const cuerpo: DatosActivarInstalacion = { version }
    if (datos.instalado_en !== instaladoPorDefecto) {
        const iso = deHoraGuatemala(datos.instalado_en)
        if (iso) {
            cuerpo.instalado_en = iso
        }
    }
    const planta: PlantaServicio = {}
    for (const campo of CAMPOS_PLANTA) {
        const valor = datos.planta[campo].trim()
        if (valor) {
            planta[campo] = valor
        }
    }
    if (Object.keys(planta).length) {
        cuerpo.planta = planta
    }
    return cuerpo
}

/**
 * Mensaje de un rechazo de `activar-instalacion` para el operador: 409 (otra persona cambió el
 * servicio) y 422 `servicio_no_pendiente` (ya se activó) piden recargar la ficha.
 */
export function rechazoActivacion(problema: Problem): { titulo: string, detalle: string, recargar: boolean } | null {
    if (problema.status === 409) {
        return {
            titulo: 'El servicio cambió mientras lo veías',
            detalle: problema.detail ?? 'Otra persona modificó este servicio: recárgalo y vuelve a intentarlo.',
            recargar: true,
        }
    }
    if (problema.status === 422 && codigoProblema(problema) === 'servicio_no_pendiente') {
        return {
            titulo: 'El servicio ya no está pendiente de instalación',
            detalle: problema.detail ?? 'Alguien ya activó o retiró este servicio.',
            recargar: true,
        }
    }
    return null
}
