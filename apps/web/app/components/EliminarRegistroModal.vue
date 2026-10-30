<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Confirmar «Eliminar» de un servicio o un router que nunca se usó (`contratos/eliminar.md` §2):
 * el nombre, lo que se libera (IPs, prefijos, redes y pools) y una casilla de «no se puede
 * deshacer». `DELETE …?version=N` con `Idempotency-Key` (una por apertura). 409: otra sesión lo
 * cambió (recargar); 422 `*_con_historial`: la lista de lo que lo impide y la alternativa.
 * Permiso: `servicios.eliminar` / `routers.eliminar` (quien lo abre lo comprobó).
 */
const props = defineProps<{
    tipo: 'servicio' | 'router'
    id: number
    nombre: string
    version: number
    /** Lo que queda libre al eliminar, en lenguaje simple. */
    libera: string[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    eliminado: []
    recargar: []
}>()

const entiende = ref(false)
const eliminando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(abierto, (valor) => {
    if (valor) {
        entiende.value = false
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

const conHistorial = computed(() => {
    const codigo = problema.value ? codigoProblema(problema.value) : null
    return codigo === 'servicio_con_historial' || codigo === 'router_con_historial'
})

async function eliminar() {
    eliminando.value = true
    problema.value = null
    const resultado = props.tipo === 'servicio'
        ? await useServicios().eliminar(props.id, props.version, clave)
        : await useRouters().eliminar(props.id, props.version, clave)
    eliminando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    emit('eliminado')
}

function recargar() {
    abierto.value = false
    emit('recargar')
}

const articulo = computed(() => (props.tipo === 'servicio' ? 'el servicio' : 'el router'))
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Eliminar ${nombre}`"
        :description="`Se borra ${articulo} para siempre. Solo se permite porque nunca se usó: no tiene facturas, pagos, sesiones ni otro historial.`"
        :dismissible="!eliminando"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="eliminar-modal"
            >
                <div
                    v-if="libera.length"
                    class="flex flex-col gap-2"
                >
                    <p class="text-sm font-medium text-highlighted">
                        Queda libre
                    </p>
                    <ul
                        class="flex flex-col gap-1"
                        data-prueba="eliminar-libera"
                    >
                        <li
                            v-for="dato in libera"
                            :key="dato"
                            class="flex items-start gap-1.5 text-sm text-default"
                        >
                            <UIcon
                                name="i-lucide-circle-check"
                                class="mt-0.5 size-4 shrink-0 text-success"
                            />
                            <span class="break-all">{{ dato }}</span>
                        </li>
                    </ul>
                </div>
                <p class="text-xs text-muted">
                    La bitácora conserva quién lo eliminó y cuándo, con los datos que tenía.
                </p>

                <UAlert
                    v-if="problema?.status === 409"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-refresh-cw"
                    :title="`Otra sesión cambió ${articulo}`"
                    :description="`Alguien lo modificó mientras lo veías. Recarga para ver cómo quedó y, si todavía se puede, vuelve a eliminarlo.`"
                    :actions="[{ label: 'Recargar', color: 'warning', variant: 'outline', onClick: recargar }]"
                    data-prueba="eliminar-409"
                />
                <UAlert
                    v-else-if="problema && conHistorial"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-history"
                    title="Ya no se puede eliminar"
                    :description="textoNoEliminable(tipo, motivosDeProblema(problema))"
                    data-prueba="eliminar-422"
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                    con-errores
                />

                <UCheckbox
                    v-model="entiende"
                    label="Entiendo que no se puede deshacer"
                    :disabled="eliminando || conHistorial"
                    data-prueba="eliminar-entiende"
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="eliminando"
                    @click="abierto = false"
                />
                <UButton
                    :label="tipo === 'servicio' ? 'Eliminar servicio' : 'Eliminar router'"
                    icon="i-lucide-trash-2"
                    color="error"
                    :loading="eliminando"
                    :disabled="!entiende || conHistorial"
                    data-prueba="eliminar-confirmar"
                    @click="eliminar"
                />
            </div>
        </template>
    </UModal>
</template>
