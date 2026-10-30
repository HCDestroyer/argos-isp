<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Aviso de routers duplicados (`GET /routers/duplicados`, `contratos/routers.md` §2): cada grupo de
 * routers activos que parecen el mismo MikroTik, con la clave que comparten y por qué eso los hace
 * el mismo equipo, y el botón «Unir» (`routers.unir`). En la lista van todos los grupos; en la
 * ficha (`routerId`), solo el del router. Sin duplicados no muestra nada; si la consulta falla,
 * el error con «Reintentar».
 */
const props = defineProps<{
    routerId?: number
}>()

const emit = defineEmits<{
    unido: [resultado: UnionRouters]
}>()

const { puede, enlace } = usePermisos()
const grupos = shallowRef<GrupoRoutersDuplicados[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const seleccionado = shallowRef<GrupoRoutersDuplicados | null>(null)
const unirAbierto = ref(false)

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useRouters().duplicados(props.routerId)
    cargando.value = false
    grupos.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

function abrirUnir(grupo: GrupoRoutersDuplicados) {
    seleccionado.value = grupo
    unirAbierto.value = true
}

function alUnir(resultado: UnionRouters) {
    emit('unido', resultado)
    void cargar()
}

onMounted(cargar)
watch(() => props.routerId, () => void cargar())

defineExpose({ cargar })
</script>

<template>
    <div
        v-if="problema || grupos.length"
        class="flex flex-col gap-3"
        data-prueba="routers-duplicados"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
            data-prueba="duplicados-error"
        />
        <UAlert
            v-for="(grupo, indice) in grupos"
            :key="grupo.routers.map(r => r.id).join('-')"
            color="warning"
            variant="subtle"
            icon="i-lucide-copy"
            :title="`${nombresGrupo(grupo.routers)} parecen el mismo MikroTik`"
            :data-prueba="`grupo-duplicados-${indice}`"
        >
            <template
                v-if="puede('routers.unir')"
                #actions
            >
                <UButton
                    label="Unir"
                    icon="i-lucide-merge"
                    color="warning"
                    size="sm"
                    :aria-label="`Unir ${nombresGrupo(grupo.routers)}`"
                    :data-prueba="`unir-grupo-${indice}`"
                    @click="abrirUnir(grupo)"
                />
            </template>
            <template #description>
                <div class="mt-1 flex flex-col gap-2">
                    <ul class="flex flex-col gap-1">
                        <li
                            v-for="razon in razonesDuplicado(grupo)"
                            :key="`${razon.motivo}-${razon.texto}`"
                            class="flex items-start gap-1.5"
                        >
                            <UIcon
                                :name="MOTIVOS_DUPLICADO[razon.motivo].icono"
                                class="mt-0.5 size-4 shrink-0"
                            />
                            <span><strong class="font-medium">{{ razon.texto }}</strong>: {{ MOTIVOS_DUPLICADO[razon.motivo].explicacion }}</span>
                        </li>
                    </ul>
                    <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <li
                            v-for="router in grupo.routers"
                            :key="router.id"
                        >
                            <ULink
                                :to="enlace(`/routers/${router.id}`)"
                                class="font-medium underline-offset-2 hover:underline"
                            >{{ router.nombre }}</ULink>
                            · {{ enPlural(router.servicios_total, 'servicio', 'servicios') }} · {{ enPlural(router.sesiones_abiertas, 'sesión', 'sesiones') }}
                        </li>
                    </ul>
                    <p class="text-xs">
                        Con dos registros, cada uno borra como huérfanas las colas del otro y las sesiones RADIUS se atribuyen a uno solo. Para usar dos formas de control de velocidad en el mismo equipo, configúralas por plan en un solo router.
                    </p>
                    <p
                        v-if="!puede('routers.unir')"
                        class="text-xs"
                    >
                        Pide a un administrador que los una (permiso «routers.unir»).
                    </p>
                </div>
            </template>
        </UAlert>

        <RouterUnirModal
            v-if="seleccionado"
            v-model:open="unirAbierto"
            :grupo="seleccionado"
            @unido="alUnir"
        />
    </div>
</template>
