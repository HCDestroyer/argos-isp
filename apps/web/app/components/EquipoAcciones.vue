<script setup lang="ts">
/**
 * Las ventanas de las acciones sobre un equipo (A48), en un solo lugar para Equipos, Por recuperar y
 * Revisión y garantía: cambiar, recibir en bodega, registrar contacto, declarar no recuperado,
 * marcar que funciona, enviar y resolver garantía y dar de baja. `ejecutar(accion, unidad)` abre la
 * que toca; al terminar avisa con un toast y emite `hecho` para recargar la pantalla.
 *
 * Cada acción la ofrece la pantalla solo con su permiso (`accionesEquipo`): el técnico nunca decide
 * pérdidas ni cobros.
 */
const emit = defineEmits<{ hecho: [] }>()

const toast = useToast()

const unidad = shallowRef<UnidadInventario | null>(null)
const pendiente = shallowRef<PendienteNoRecuperado | null>(null)
const contexto = ref<string | null>(null)
const resultadoGarantia = ref<'reparada' | 'reemplazada' | 'rechazada'>('reparada')
const abiertos = reactive<Record<AccionEquipo, boolean>>({ cambiar: false, recibir: false, contacto: false, no_recuperado: false, funciona: false, garantia: false, resolver: false, baja: false })

function ejecutar(accion: AccionEquipo, elegida: UnidadInventario, extra: { pendiente?: PendienteNoRecuperado | null, contexto?: string | null, resultado?: 'reparada' | 'reemplazada' | 'rechazada' } = {}) {
    unidad.value = elegida
    pendiente.value = extra.pendiente ?? null
    contexto.value = extra.contexto ?? null
    resultadoGarantia.value = extra.resultado ?? 'reparada'
    abiertos[accion] = true
}

defineExpose({ ejecutar })

function listo(titulo: string) {
    toast.add({ title: titulo, icon: 'i-lucide-circle-check', color: 'success' })
    emit('hecho')
}

function marcarFunciona(motivo: string): Promise<Resultado<UnidadInventario>> {
    return useUnidadesInventario().marcarReparada(unidad.value?.id ?? 0, motivo)
}

function darDeBaja(motivo: string, clave: string): Promise<Resultado<MovimientoInventario>> {
    const u = unidad.value
    return useInventario().darDeBaja({ producto_id: u?.producto_id ?? 0, bodega_id: u?.bodega_id ?? 0, cantidad: null, unidad_id: u?.id ?? 0, causa: 'danado', motivo }, clave)
}

const nombre = computed(() => (unidad.value ? `${unidad.value.producto_nombre} ${identificacionUnidad(unidad.value)}` : 'El equipo'))
</script>

<template>
    <EquipoCambiarModal
        v-model:open="abiertos.cambiar"
        :unidad="unidad"
        :contexto="contexto"
        @hecho="c => listo(c.cobro_propuesto_id ? 'Equipo cambiado; el cobro quedó propuesto' : 'Equipo cambiado')"
    />
    <EquipoDevolverModal
        v-model:open="abiertos.recibir"
        :unidad="unidad"
        @hecho="u => listo(`${identificacionUnidad(u)} recibido en ${u.bodega_nombre ?? 'la bodega'}`)"
    />
    <EquipoContactoModal
        v-model:open="abiertos.contacto"
        :unidad="unidad"
        @hecho="listo('Contacto registrado')"
    />
    <EquipoNoRecuperadoModal
        v-model:open="abiertos.no_recuperado"
        :unidad="unidad"
        :pendiente="pendiente"
        @hecho="u => listo(u.cobro_id ? 'Declarado no recuperado y cobrado al cliente' : 'Declarado no recuperado')"
    />
    <EquipoGarantiaModal
        v-model:open="abiertos.garantia"
        modo="enviar"
        :unidad="unidad"
        @hecho="listo('Enviado a garantía')"
    />
    <EquipoGarantiaModal
        v-model:open="abiertos.resolver"
        modo="resolver"
        :unidad="unidad"
        :resultado="resultadoGarantia"
        @hecho="listo('Garantía resuelta')"
    />
    <AccionMotivoModal
        v-model:open="abiertos.funciona"
        titulo="Funciona: a bodega"
        :efecto="`${nombre} queda disponible en su bodega como usado.`"
        confirmar="Pasar a bodega"
        icono="i-lucide-circle-check"
        color="primary"
        etiqueta="Qué se probó"
        placeholder="Ej.: se probó con fibra y navega bien"
        :ejecutar="marcarFunciona"
        @hecho="listo('El equipo volvió a la bodega')"
    />
    <AccionMotivoModal
        v-model:open="abiertos.baja"
        titulo="Dar de baja"
        :efecto="`${nombre} sale del inventario como gasto (5.6.02). No se deshace.`"
        confirmar="Dar de baja"
        icono="i-lucide-trash-2"
        placeholder="Ej.: dañado por rayo, no tiene reparación"
        :ejecutar="darDeBaja"
        @hecho="listo('Equipo dado de baja')"
    />
</template>
