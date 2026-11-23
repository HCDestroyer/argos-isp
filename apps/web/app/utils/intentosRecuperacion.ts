import type { Schema } from '@argosisp/contracts'
import * as z from 'zod'

type Intento = Schema<'IntentoRecuperacionVerificado'>
type Verificacion = NonNullable<Intento['verificacion']>
type Color = 'success' | 'error' | 'warning' | 'neutral' | 'primary' | 'info'

/** Verificación de un intento con Iris (contrato 0.14.0 §3.10), con icono, texto y color. */
export const VERIFICACIONES_INTENTO: Record<Verificacion, { etiqueta: string, color: Color, icono: string, detalle: string }> = {
    no_aplica: { etiqueta: 'Registrado en Argos', color: 'neutral', icono: 'i-lucide-pencil', detalle: 'Lo registró una persona en el panel.' },
    pendiente: { etiqueta: 'Verificando con Iris', color: 'warning', icono: 'i-lucide-hourglass', detalle: 'Argos lo vuelve a consultar con Iris.' },
    verificado: { etiqueta: 'Verificado por Iris', color: 'success', icono: 'i-lucide-shield-check', detalle: 'Foto y ubicación confirmadas.' },
    no_verificado: { etiqueta: 'No verificado', color: 'error', icono: 'i-lucide-circle-x', detalle: 'Iris no lo confirmó.' },
    anterior: { etiqueta: 'Lo decide una persona', color: 'primary', icono: 'i-lucide-info', detalle: 'Registrado antes de la verificación.' },
    aceptado: { etiqueta: 'Aceptado', color: 'success', icono: 'i-lucide-check', detalle: 'Una persona decidió que cuenta.' },
    descartado: { etiqueta: 'Descartado', color: 'neutral', icono: 'i-lucide-circle-slash', detalle: 'Una persona decidió que no cuenta.' },
}

/** Por qué un intento no quedó verificado o sigue pendiente (`verificacion_motivo`). */
export const MOTIVOS_VERIFICACION: Record<string, string> = {
    envio_en_curso: 'Iris todavía lo está enviando',
    foto_pendiente: 'La foto aún se está subiendo en Iris',
    no_enviado_por_iris: 'Iris no lo envió',
    no_coincide: 'No coincide con lo que Iris registró',
    foto_invalida: 'La foto no es válida',
    desconocido_en_iris: 'Iris no conoce este intento',
    error_iris: 'Iris respondió con un error',
    timeout: 'Iris no respondió a tiempo',
    sin_acceso: 'Argos no tiene acceso a esa orden en Iris',
    limitado: 'Iris limitó las consultas; se reintenta',
    sin_conector: 'Iris no está conectado',
    respuesta_invalida: 'Iris respondió algo que Argos no entiende',
}

/** Texto de la verificación de un intento: el motivo si lo hay, si no el detalle del estado. */
export function detalleVerificacion(intento: Pick<Intento, 'verificacion' | 'verificacion_motivo' | 'motivo_decision'>): string {
    const v = intento.verificacion ?? 'no_aplica'
    if ((v === 'aceptado' || v === 'descartado') && intento.motivo_decision) {
        return intento.motivo_decision
    }
    if (intento.verificacion_motivo) {
        return MOTIVOS_VERIFICACION[intento.verificacion_motivo] ?? intento.verificacion_motivo
    }
    return VERIFICACIONES_INTENTO[v].detalle
}

/** Espejo de `decidirIntentoRecuperacionValidator` (A3): aceptar o descartar, con motivo de 3 a 500. */
export const esquemaDecisionIntento = z.object({
    aceptar: z.boolean(),
    motivo: z.string().trim().min(3, 'Escribe el motivo (mínimo 3 caracteres)').max(500, 'Máximo 500 caracteres'),
})

export type DatosDecisionIntento = z.output<typeof esquemaDecisionIntento>

/** Vínculo de un técnico de Iris (contrato 0.14.0 §6.6), con icono, texto y color. */
export const ESTADOS_VINCULO_TECNICO: Record<Schema<'VinculoTecnicoIris'>['estado'], { etiqueta: string, plural: string, color: Color, icono: string }> = {
    rechazado: { etiqueta: 'Rechazado', plural: 'Rechazados', color: 'error', icono: 'i-lucide-circle-x' },
    vinculado: { etiqueta: 'Vinculado', plural: 'Vinculados', color: 'success', icono: 'i-lucide-link' },
    desvinculado: { etiqueta: 'Desvinculado', plural: 'Desvinculados', color: 'neutral', icono: 'i-lucide-x' },
}

/** Por qué Argos rechazó o desvinculó el vínculo (`motivo`). */
export const MOTIVOS_VINCULO_TECNICO: Record<string, string> = {
    usuario_inexistente: 'El usuario de Argos no existe',
    usuario_inactivo: 'El usuario de Argos está desactivado',
    no_es_tecnico: 'El usuario de Argos no tiene rol de técnico',
    fuera_de_la_empresa: 'El usuario de Argos no es de esta empresa',
    id_externo_en_uso: 'Ese id ya lo usa otro técnico',
    desactivado: 'Iris desactivó al técnico',
}
