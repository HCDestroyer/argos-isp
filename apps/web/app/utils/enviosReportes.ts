import type { Schema } from '@argosisp/contracts'

/**
 * Presentación de los envíos programados de reportes (tablero PendEnviosReportes, decisión 6 del
 * PM): cada cuánto, formato, estado y por qué una corrida omitió a un destinatario.
 */
type Envio = Schema<'EnvioReporte'>
type Corrida = Schema<'CorridaEnvioReporte'>

const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** «Cada lunes · 7:00», «Cada día · 19:00», «Día 5 de cada mes · 8:00» (hora de Guatemala). */
export function frecuenciaEnvio(envio: Pick<Envio, 'frecuencia' | 'dia' | 'hora'>): string {
    const hora = `${envio.hora}:00`
    if (envio.frecuencia === 'semanal') {
        return `Cada ${DIAS_SEMANA[(envio.dia ?? 1) - 1] ?? 'semana'} · ${hora}`
    }
    if (envio.frecuencia === 'mensual') {
        return `Día ${envio.dia ?? 1} de cada mes · ${hora}`
    }
    return `Cada día · ${hora}`
}

export const FORMATO_ENVIO: Record<Envio['formato'], { etiqueta: string, icono: string }> = {
    xlsx: { etiqueta: 'Excel', icono: 'i-lucide-file-spreadsheet' },
    pdf: { etiqueta: 'PDF', icono: 'i-lucide-file-text' },
    csv: { etiqueta: 'CSV', icono: 'i-lucide-sheet' },
}

/** Estado del envío con ícono, texto y color. */
export function estadoEnvio(envio: Pick<Envio, 'activo'>): { etiqueta: string, icono: string, color: 'success' | 'neutral' } {
    return envio.activo
        ? { etiqueta: 'Activo', icono: 'i-lucide-play', color: 'success' }
        : { etiqueta: 'Pausado', icono: 'i-lucide-pause', color: 'neutral' }
}

/** Título del reporte del catálogo del panel; con otro código, el código tal cual. */
export function tituloReporteEnvio(codigo: string): string {
    return (CLAVES_REPORTE as readonly string[]).includes(codigo) ? REPORTES[codigo as ClaveReporte].titulo : codigo
}

/** Ruta del reporte en el panel, o `null` si el panel no tiene pantalla para ese código. */
export function rutaReporteEnvio(codigo: string): string | null {
    return (CLAVES_REPORTE as readonly string[]).includes(codigo) ? `/reportes/${codigo}` : null
}

/** «Ana Castillo y gerencia@…»: los destinatarios en una línea. */
export function destinatariosEnvio(envio: Pick<Envio, 'destinatarios'>): string {
    const nombres = envio.destinatarios.map(d => (d.tipo === 'usuario' ? d.nombre ?? d.correo : d.correo ?? d.nombre) ?? '—')
    if (nombres.length <= 2) {
        return nombres.join(' y ')
    }
    return `${nombres.slice(0, 2).join(', ')} y ${nombres.length - 2} más`
}

/** Motivos de `CorridaEnvioReporte.resultados[].motivo` (A3, `ResultadoDestinatario`). */
export const MOTIVO_RESULTADO_ENVIO: Record<string, string> = {
    sin_permiso: 'ya no tiene permiso para ver el reporte',
    alcance_parcial: 'su alcance no cubre todo el reporte',
    sin_acceso_empresa: 'no tiene acceso a la empresa',
    usuario_inactivo: 'el usuario está desactivado',
    sin_correo: 'no tiene correo',
    correo_retirado: 'el correo se retiró de la lista',
    no_compartible: 'el reporte tiene datos personales y no va a correos externos',
    sin_responsable: 'quien lo programó ya no puede verlo',
    filtros_invalidos: 'los filtros ya no son válidos',
    sin_smtp: 'el correo del sistema no está configurado',
    error_envio: 'el servidor de correo no respondió',
}

/** «1 enviado · 1 omitido», «2 enviados», «1 enviado · 1 falló» y su tono. */
export function resumenCorridaEnvio(corrida: Pick<Corrida, 'enviados' | 'omitidos' | 'fallidos'>): { texto: string, color: 'success' | 'warning' | 'error' } {
    const partes = [
        `${corrida.enviados} ${corrida.enviados === 1 ? 'enviado' : 'enviados'}`,
        corrida.omitidos ? `${corrida.omitidos} ${corrida.omitidos === 1 ? 'omitido' : 'omitidos'}` : null,
        corrida.fallidos ? `${corrida.fallidos} ${corrida.fallidos === 1 ? 'falló' : 'fallaron'}` : null,
    ].filter(Boolean)
    return { texto: partes.join(' · '), color: corrida.fallidos ? 'error' : corrida.omitidos ? 'warning' : 'success' }
}

/** Texto de un resultado: «Enviado», «Omitido: el correo se retiró de la lista», «Falló: …». */
export function textoResultadoEnvio(resultado: Corrida['resultados'][number]): string {
    const motivo = resultado.detalle ?? (resultado.motivo ? MOTIVO_RESULTADO_ENVIO[resultado.motivo] ?? resultado.motivo : null)
    if (resultado.estado === 'enviado') {
        return 'Enviado'
    }
    const base = resultado.estado === 'omitido' ? 'Omitido' : 'Falló'
    return motivo ? `${base}: ${motivo}` : base
}
