<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TableColumn } from '@nuxt/ui'
import type { ResultadoReconciliacion, VistaPreviaReconciliar } from '~/types/controlVelocidad'

/**
 * «Reconciliar ahora» (`routeros.reconciliar`, `contratos/control-velocidad.md` §9–§10): primero la
 * vista previa (`GET /routers/:id/vista-previa-reconciliar`, lee el router sin escribir) con lo que
 * se crea, cambia, mueve y borra por grupo (servicio, velocidad, corte); al confirmar,
 * `POST /routers/:id/reconciliar` con `Idempotency-Key` y su resultado. Si el router no responde o
 * no tiene credenciales, se ve el error de la API y «Reintentar». Quien lo abre comprueba el permiso.
 */
const props = defineProps<{
    router: Pick<RouterNas, 'id' | 'nombre'>
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    reconciliado: [resultado: ResultadoReconciliacion]
}>()

const toast = useToast()

const vista = shallowRef<VistaPreviaReconciliar | null>(null)
const cargando = ref(false)
const problemaVista = ref<Problem | null>(null)
const aplicando = ref(false)
const problema = ref<Problem | null>(null)
const resultado = shallowRef<ResultadoReconciliacion | null>(null)
let clave = nuevaClaveIdempotencia()

type Cambio = VistaPreviaReconciliar['cambios'][number]

const GRUPOS: Record<Cambio['grupo'], { etiqueta: string, icono: string }> = {
    corte: { etiqueta: 'Corte', icono: 'i-lucide-shield-off' },
    velocidad: { etiqueta: 'Velocidad', icono: 'i-lucide-gauge' },
    servicio: { etiqueta: 'Servicios', icono: 'i-lucide-user' },
}
const ACCIONES: Record<Cambio['accion'], string> = { crear: 'Crea', actualizar: 'Cambia', mover: 'Mueve', borrar: 'Borra' }
const HECHOS: Record<ResultadoReconciliacion['correcciones'][number]['accion'], string> = { creado: 'Creado', actualizado: 'Cambiado', movido: 'Movido', borrado: 'Borrado' }

const numero = { class: { th: 'w-0 text-right', td: 'w-0 text-right tabular-nums' } }
const columnas: TableColumn<VistaPreviaReconciliar['menus'][number]>[] = [
    { accessorKey: 'ruta', header: 'Menú de RouterOS' },
    { accessorKey: 'crear', header: 'Crea', meta: numero },
    { accessorKey: 'actualizar', header: 'Cambia', meta: numero },
    { accessorKey: 'mover', header: 'Mueve', meta: numero },
    { accessorKey: 'borrar', header: 'Borra', meta: numero },
]

const grupos = computed(() => (Object.keys(GRUPOS) as Cambio['grupo'][])
    .map(grupo => ({ grupo, cambios: vista.value?.cambios.filter(c => c.grupo === grupo) ?? [] }))
    .filter(g => g.cambios.length))

async function cargar() {
    cargando.value = true
    problemaVista.value = null
    const respuesta = await useControlVelocidad().vistaPreviaReconciliar(props.router.id)
    cargando.value = false
    vista.value = respuesta.ok ? respuesta.data : null
    problemaVista.value = respuesta.ok ? null : respuesta.problema
}

watch(abierto, (valor) => {
    if (valor) {
        vista.value = null
        resultado.value = null
        problema.value = null
        clave = nuevaClaveIdempotencia()
        void cargar()
    }
}, { immediate: true })

async function reconciliar() {
    aplicando.value = true
    problema.value = null
    const respuesta = await useControlVelocidad().reconciliar(props.router.id, clave)
    aplicando.value = false
    if (!respuesta.ok) {
        problema.value = respuesta.problema
        clave = nuevaClaveIdempotencia()
        return
    }
    resultado.value = respuesta.data
    emit('reconciliado', respuesta.data)
    if (!respuesta.data.error) {
        toast.add({
            title: `${props.router.nombre}: reconciliado`,
            description: respuesta.data.correcciones.length ? `${respuesta.data.correcciones.length} ${respuesta.data.correcciones.length === 1 ? 'objeto corregido' : 'objetos corregidos'} en el router.` : 'El router ya estaba como Argos lo espera.',
            icon: 'i-lucide-circle-check',
            color: 'success',
        })
    }
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Reconciliar ahora · ${router.nombre}`"
        description="Argos lee el router y deja colas, perfiles, árbol y reglas de corte como deben estar. Primero ves qué cambiaría; nada se escribe hasta confirmar."
        :dismissible="!aplicando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="reconciliar-modal"
            >
                <USkeleton
                    v-if="cargando"
                    class="h-40 w-full"
                />
                <ProblemaAlerta
                    v-else-if="problemaVista"
                    :problema="problemaVista"
                    :reintentar="cargar"
                    :reintentando="cargando"
                    data-prueba="reconciliar-error-vista"
                />
                <template v-else-if="resultado">
                    <UAlert
                        v-if="resultado.error"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-x"
                        title="El router no se pudo reconciliar"
                        :description="resultado.error"
                        :actions="[{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'error', variant: 'outline', loading: aplicando, onClick: reconciliar }]"
                        data-prueba="reconciliar-resultado-error"
                    />
                    <UAlert
                        v-else
                        color="success"
                        variant="subtle"
                        icon="i-lucide-circle-check"
                        :title="resultado.correcciones.length ? `${resultado.correcciones.length} ${resultado.correcciones.length === 1 ? 'objeto corregido' : 'objetos corregidos'}` : 'Nada que corregir'"
                        :description="`${resultado.servicios.toLocaleString('es-GT')} servicios revisados.`"
                        data-prueba="reconciliar-resultado"
                    />
                    <ul
                        v-if="resultado.correcciones.length"
                        class="flex flex-col divide-y divide-default surface-card"
                    >
                        <li
                            v-for="(correccion, indice) in resultado.correcciones"
                            :key="indice"
                            class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                            <span class="min-w-0 break-all font-mono text-xs">{{ correccion.ruta }} · {{ correccion.comment }}</span>
                            <UBadge
                                :label="HECHOS[correccion.accion]"
                                color="neutral"
                                variant="subtle"
                                size="sm"
                            />
                        </li>
                    </ul>
                    <UAlert
                        v-if="resultado.errores_velocidad.length || resultado.avisos.length"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="Revisa"
                    >
                        <template #description>
                            <ul class="mt-1 flex list-disc flex-col gap-1 pl-5">
                                <li
                                    v-for="(texto, indice) in [...resultado.errores_velocidad, ...resultado.avisos]"
                                    :key="indice"
                                >
                                    {{ texto }}
                                </li>
                            </ul>
                        </template>
                    </UAlert>
                </template>
                <template v-else-if="vista">
                    <UAlert
                        v-if="vista.error"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-unplug"
                        title="No se pudo leer el router"
                        :description="vista.error"
                        :actions="[{ label: 'Reintentar', icon: 'i-lucide-rotate-cw', color: 'error', variant: 'outline', loading: cargando, onClick: cargar }]"
                        data-prueba="reconciliar-sin-lectura"
                    />
                    <UAlert
                        v-else-if="!vista.cambios.length"
                        color="success"
                        variant="subtle"
                        icon="i-lucide-circle-check"
                        title="El router ya está como Argos lo espera"
                        description="No hay nada que crear, cambiar, mover ni borrar."
                        data-prueba="reconciliar-sin-cambios"
                    />
                    <template v-else>
                        <UTable
                            :data="vista.menus"
                            :columns="columnas"
                            tabindex="0"
                            aria-label="Cambios por menú de RouterOS"
                            data-prueba="reconciliar-menus"
                        />
                        <section
                            v-for="g in grupos"
                            :key="g.grupo"
                            class="flex flex-col gap-1.5"
                            :data-prueba="`reconciliar-grupo-${g.grupo}`"
                        >
                            <span class="flex items-center gap-1.5 text-xs font-medium text-muted">
                                <UIcon
                                    :name="GRUPOS[g.grupo].icono"
                                    class="size-4"
                                />
                                {{ GRUPOS[g.grupo].etiqueta }} · {{ g.cambios.length }}
                            </span>
                            <ul class="flex flex-col divide-y divide-default surface-card">
                                <li
                                    v-for="(cambio, indice) in g.cambios"
                                    :key="indice"
                                    class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                                >
                                    <span class="min-w-0 break-all font-mono text-xs">{{ cambio.ruta }} · {{ cambio.clave }}</span>
                                    <UBadge
                                        :label="ACCIONES[cambio.accion]"
                                        color="neutral"
                                        variant="subtle"
                                        size="sm"
                                    />
                                </li>
                            </ul>
                        </section>
                    </template>
                    <UAlert
                        v-if="vista.avisos.length"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="Avisos"
                        data-prueba="reconciliar-avisos"
                    >
                        <template #description>
                            <ul class="mt-1 flex list-disc flex-col gap-1 pl-5">
                                <li
                                    v-for="(aviso, indice) in vista.avisos"
                                    :key="indice"
                                >
                                    {{ aviso }}
                                </li>
                            </ul>
                        </template>
                    </UAlert>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                        :reintentar="reconciliar"
                        :reintentando="aplicando"
                        data-prueba="reconciliar-error"
                    />
                </template>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <UButton
                    :label="resultado ? 'Cerrar' : 'Cancelar'"
                    color="neutral"
                    variant="ghost"
                    :disabled="aplicando"
                    class="justify-center"
                    @click="abierto = false"
                />
                <UButton
                    v-if="!resultado"
                    label="Reconciliar ahora"
                    icon="i-lucide-refresh-cw"
                    :loading="aplicando"
                    :disabled="!vista || !!vista.error || !vista.cambios.length"
                    class="justify-center"
                    data-prueba="reconciliar-confirmar"
                    @click="reconciliar"
                />
            </div>
        </template>
    </UModal>
</template>
