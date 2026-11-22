/**
 * Mapa único acción → icono (Lucide) del panel (sistema visual Argos, decisión del PM: «usar
 * íconos»). La misma acción lleva siempre el mismo icono en botones, menús, pestañas y filas, y el
 * color del botón dice la intención: verde cobrar o reactivar, rojo lo destructivo, índigo la
 * navegación y lo principal.
 */
export const ICONOS = {
    // Navegación y consulta.
    ver: 'i-lucide-eye',
    vistaRapida: 'i-lucide-panel-right-open',
    abrir: 'i-lucide-arrow-up-right',
    volver: 'i-lucide-chevron-left',
    buscar: 'i-lucide-search',
    filtrar: 'i-lucide-sliders-horizontal',
    ayuda: 'i-lucide-circle-help',
    menu: 'i-lucide-ellipsis-vertical',
    // Edición.
    crear: 'i-lucide-plus',
    editar: 'i-lucide-pencil',
    guardar: 'i-lucide-check',
    cancelar: 'i-lucide-x',
    eliminar: 'i-lucide-trash-2',
    copiar: 'i-lucide-copy',
    exportar: 'i-lucide-download',
    subir: 'i-lucide-upload',
    imprimir: 'i-lucide-printer',
    actualizar: 'i-lucide-refresh-cw',
    // Dinero.
    cobrar: 'i-lucide-banknote',
    promesa: 'i-lucide-calendar-clock',
    factura: 'i-lucide-receipt-text',
    anular: 'i-lucide-ban',
    // Servicio.
    suspender: 'i-lucide-circle-x',
    reactivar: 'i-lucide-power',
    limitar: 'i-lucide-gauge',
    quitarLimite: 'i-lucide-gauge-circle',
    desconectar: 'i-lucide-unplug',
    retirar: 'i-lucide-trash-2',
    sincronizar: 'i-lucide-refresh-cw',
} as const

export type AccionIcono = keyof typeof ICONOS
