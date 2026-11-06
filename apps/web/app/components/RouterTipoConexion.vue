<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Tipo de conexión del router en su ficha, junto al control de velocidad
 * (`contratos/tipo-conexion-router.md`): uno por router y todos sus servicios lo usan. «Cambiar
 * tipo» abre la vista previa y lo aplica servicio por servicio (`CambiarTipoConexionModal`,
 * `routers.cambiar_tipo_conexion`). Si hay servicios anteriores a la regla que no usan el tipo del
 * router (`difiere_del_router`, vista previa sin `?tipo=`), avisa y ofrece «Unificar».
 */
const props = defineProps<{
    router: RouterNas
}>()

const emit = defineEmits<{
    actualizado: [router: RouterNas]
}>()

const { puede } = usePermisos()
const puedeCambiar = computed(() => puede('routers.cambiar_tipo_conexion'))

const tipo = computed(() => TIPOS_CONEXION[props.router.tipo_conexion])

/* Los servicios que difieren del router (vista de «unificar»). */
const vista = shallowRef<VistaPreviaTipoConexion | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useRouters().vistaPreviaTipoConexion(props.router.id)
    cargando.value = false
    vista.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)
watch(() => [props.router.id, props.router.version], () => void cargar())

const difieren = computed(() => (vista.value?.servicios ?? []).filter(s => s.difiere_del_router))
const totalDifieren = computed(() => vista.value?.resumen.difieren_del_router ?? 0)

const modalAbierto = ref(false)
const tipoModal = ref<TipoConexion>('pppoe')

function abrirCambio() {
    tipoModal.value = (Object.keys(TIPOS_CONEXION) as TipoConexion[]).find(t => t !== props.router.tipo_conexion) ?? props.router.tipo_conexion
    modalAbierto.value = true
}

function abrirUnificar() {
    tipoModal.value = props.router.tipo_conexion
    modalAbierto.value = true
}

function alCambiar(resultado: ResultadoCambiarTipoConexion) {
    emit('actualizado', resultado.router)
}
</script>

<template>
    <RouterSeccion
        id-titulo="titulo-tipo-conexion"
        titulo="Tipo de conexión"
        icono="i-lucide-cable"
        descripcion="Uno por router: todos sus servicios lo usan y los nuevos lo toman al darse de alta. Cambiarlo muestra antes qué servicios cambian y qué les falta."
        data-prueba="router-tipo-conexion"
    >
        <template
            v-if="puedeCambiar"
            #acciones
        >
            <UButton
                label="Cambiar tipo"
                icon="i-lucide-arrow-right-left"
                data-prueba="abrir-cambio-tipo"
                @click="abrirCambio"
            />
        </template>

        <div class="flex items-start gap-3 rounded-lg border border-default bg-default p-4">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <UIcon
                    :name="tipo.icono"
                    class="size-5"
                />
            </span>
            <div class="flex min-w-0 flex-col gap-0.5">
                <span
                    class="text-sm font-semibold text-highlighted"
                    data-prueba="router-tipo-actual"
                >{{ tipo.etiqueta }}</span>
                <span class="text-sm text-muted">{{ router.tipo_conexion === 'pppoe' && esSinRadius(router) ? AYUDA_PPPOE_SIN_RADIUS : tipo.descripcion }}</span>
            </div>
        </div>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
            data-prueba="router-tipo-error"
        />
        <UAlert
            v-else-if="totalDifieren > 0"
            color="warning"
            variant="subtle"
            icon="i-lucide-split"
            :title="totalDifieren === 1 ? '1 servicio no usa el tipo del router' : `${totalDifieren} servicios no usan el tipo del router`"
            :actions="puedeCambiar ? [{ label: 'Unificar', icon: 'i-lucide-merge', color: 'warning', variant: 'outline', onClick: abrirUnificar }] : undefined"
            data-prueba="router-tipo-difieren"
        >
            <template #description>
                <p>
                    Son de antes de que el tipo fuera uno por router: siguen funcionando, pero se configuran distinto que el resto.
                    {{ puedeCambiar ? '«Unificar» los pasa a ' + tipo.etiqueta + ' con vista previa.' : 'Un administrador puede unificarlos.' }}
                </p>
                <p class="mt-1 text-xs">
                    {{ difieren.slice(0, 5).map(s => `${s.cliente_nombre} (${TIPOS_CONEXION[s.tipo_conexion].corta})`).join(', ') }}{{ totalDifieren > 5 ? ` y ${totalDifieren - 5} más` : '' }}
                </p>
            </template>
        </UAlert>

        <p
            v-if="!puedeCambiar"
            class="text-xs text-muted"
        >
            Solo un administrador cambia el tipo de conexión.
        </p>

        <CambiarTipoConexionModal
            v-if="puedeCambiar"
            v-model:open="modalAbierto"
            :router="router"
            :tipo-inicial="tipoModal"
            @cambiado="alCambiar"
        />
    </RouterSeccion>
</template>
