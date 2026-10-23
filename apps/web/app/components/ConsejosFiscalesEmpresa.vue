<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Consejos fiscales de una empresa en el tablero (A3, fase 8 PR C). Por defecto solo los que aplican y
 * no están ocultos; los interruptores muestran también los ocultos y los `sin_datos` (con el problema
 * de su bloque fuente, nunca un texto). Cada uno con su fuente, el aviso y «Confirmar con contador».
 * Con `fiscal.configurar`: «Ocultar para la empresa», «Ocultar solo para mí» y «Mostrar»; sin él (p. ej.
 * `lectura`), solo se ven.
 */
const props = withDefaults(defineProps<{
    consejos: ConsejoFiscal[]
    empresaId: number
    aviso: string
    recargar: () => void
    recargando?: boolean
}>(), {
    recargando: false,
})

const verOcultos = defineModel<boolean>('verOcultos', { default: false })
const verSinDatos = defineModel<boolean>('verSinDatos', { default: false })

const { puede } = usePermisos()
const toast = useToast()
const puedeOcultar = computed(() => puede('fiscal.configurar'))

const visibles = computed(() => props.consejos.filter(c => (c.estado === 'aplica' || (verSinDatos.value && c.estado === 'sin_datos')) && (!c.oculto || verOcultos.value)))
const ocultos = computed(() => props.consejos.filter(c => c.oculto && (c.estado === 'aplica' || (verSinDatos.value && c.estado === 'sin_datos'))).length)
const sinDatos = computed(() => props.consejos.filter(c => c.estado === 'sin_datos' && (!c.oculto || verOcultos.value)).length)

/* Ocultar (con motivo opcional). */
const esquema = z.object({ motivo: z.string().trim().max(500, 'Máximo 500 caracteres') })
const estado = reactive({ motivo: '' })
const abierto = ref(false)
const pendiente = ref<{ consejo: ConsejoFiscal, alcance: 'empresa' | 'usuario' } | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

function pedirOcultar(consejo: ConsejoFiscal, alcance: 'empresa' | 'usuario') {
    pendiente.value = { consejo, alcance }
    estado.motivo = ''
    problema.value = null
    clave = nuevaClaveIdempotencia()
    abierto.value = true
}

async function confirmarOcultar(evento: FormSubmitEvent<{ motivo: string }>) {
    if (!pendiente.value) {
        return
    }
    const { consejo, alcance } = pendiente.value
    enviando.value = true
    const resultado = await useConsejosFiscales().ocultar(consejo.clave, { empresa_id: props.empresaId, alcance, motivo: evento.data.motivo || null }, clave)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = problemaFiscalLegible(resultado.problema)
        clave = nuevaClaveIdempotencia()
        return
    }
    abierto.value = false
    toast.add({ title: alcance === 'usuario' ? 'Consejo oculto solo para ti' : 'Consejo oculto para la empresa', description: consejo.titulo, color: 'success', icon: 'i-lucide-eye-off' })
    props.recargar()
}

const mostrando = ref<string | null>(null)

async function mostrar(consejo: ConsejoFiscal) {
    mostrando.value = consejo.clave
    const resultado = await useConsejosFiscales().mostrar(consejo.clave, { empresa_id: props.empresaId, alcance: consejo.oculto_por === 'usuario' ? 'usuario' : 'empresa' }, nuevaClaveIdempotencia())
    mostrando.value = null
    if (!resultado.ok) {
        const legible = problemaFiscalLegible(resultado.problema)
        toast.add({ title: legible.title, description: legible.detail, color: 'error', icon: 'i-lucide-circle-alert' })
        return
    }
    toast.add({ title: 'Consejo visible de nuevo', description: consejo.titulo, color: 'success', icon: 'i-lucide-eye' })
    props.recargar()
}
</script>

<template>
    <UCard
        :ui="{ header: 'px-4 py-3 sm:px-4', body: 'px-4 py-3 sm:px-4' }"
        :data-consejos="empresaId"
    >
        <template #header>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 class="flex items-center gap-2 text-sm font-semibold text-highlighted">
                    <UIcon
                        name="i-lucide-lightbulb"
                        class="size-4 text-muted"
                    />
                    Consejos
                </h3>
                <div class="flex flex-wrap gap-x-4 gap-y-2">
                    <div data-prueba="ver-ocultos">
                        <USwitch
                            v-model="verOcultos"
                            size="sm"
                            :label="ocultos ? `Ver ocultos (${ocultos})` : 'Ver ocultos'"
                        />
                    </div>
                    <div data-prueba="ver-sin-datos">
                        <USwitch
                            v-model="verSinDatos"
                            size="sm"
                            :label="verSinDatos || !sinDatos ? 'Ver sin datos' : `Ver sin datos (${sinDatos})`"
                        />
                    </div>
                </div>
            </div>
        </template>

        <p class="mb-3 text-xs text-muted">
            {{ aviso }}. Salen de las cifras del tablero y del comparador; ninguno se aplica solo.
        </p>

        <p
            v-if="!visibles.length"
            class="text-sm text-muted"
            data-prueba="consejos-vacio"
        >
            Ningún consejo aplica hoy{{ ocultos && !verOcultos ? ' (hay consejos ocultos)' : '' }}.
        </p>

        <ul
            v-else
            class="flex flex-col divide-y divide-default"
        >
            <li
                v-for="consejo in visibles"
                :key="consejo.clave"
                class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                :data-consejo="consejo.clave"
                :data-estado="consejo.estado"
            >
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-medium text-highlighted">{{ consejo.titulo }}</span>
                    <UBadge
                        v-if="consejo.confirmar_contador"
                        color="warning"
                        variant="subtle"
                        size="sm"
                        icon="i-lucide-user-check"
                        label="Confirmar con contador"
                    />
                    <UBadge
                        v-if="consejo.oculto"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        icon="i-lucide-eye-off"
                        :label="consejo.oculto_por === 'usuario' ? 'Oculto para ti' : 'Oculto para la empresa'"
                        data-prueba="consejo-oculto"
                    />
                </div>

                <p
                    v-if="consejo.estado === 'aplica'"
                    class="text-sm text-default"
                    data-prueba="consejo-texto"
                >
                    {{ consejo.texto }}
                </p>
                <ProblemaAlerta
                    v-else-if="consejo.estado === 'sin_datos' && consejo.error"
                    :problema="problemaDeclaracionLegible(consejo.error)"
                    :reintentar="recargar"
                    :reintentando="recargando"
                    data-prueba="consejo-sin-datos"
                />

                <p class="text-xs text-muted">
                    Fuente: {{ consejo.fuente }} · {{ consejo.aviso }}
                </p>

                <div
                    v-if="puedeOcultar"
                    class="flex flex-wrap gap-2"
                >
                    <template v-if="!consejo.oculto">
                        <UButton
                            label="Ocultar para la empresa"
                            icon="i-lucide-eye-off"
                            color="neutral"
                            variant="outline"
                            size="xs"
                            data-prueba="ocultar-empresa"
                            @click="pedirOcultar(consejo, 'empresa')"
                        />
                        <UButton
                            label="Ocultar solo para mí"
                            icon="i-lucide-user-x"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            data-prueba="ocultar-usuario"
                            @click="pedirOcultar(consejo, 'usuario')"
                        />
                    </template>
                    <UButton
                        v-else
                        label="Mostrar"
                        icon="i-lucide-eye"
                        color="neutral"
                        variant="outline"
                        size="xs"
                        :loading="mostrando === consejo.clave"
                        data-prueba="mostrar-consejo"
                        @click="mostrar(consejo)"
                    />
                </div>
            </li>
        </ul>

        <UModal
            v-model:open="abierto"
            :title="pendiente?.alcance === 'usuario' ? 'Ocultar solo para mí' : 'Ocultar para la empresa'"
            :description="pendiente ? `«${pendiente.consejo.titulo}». Queda en la bitácora y se puede volver a mostrar.` : undefined"
        >
            <template #body>
                <UForm
                    id="form-ocultar-consejo"
                    :schema="esquema"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="confirmarOcultar"
                >
                    <p class="text-sm text-muted">
                        {{ pendiente?.alcance === 'usuario' ? 'Solo tú dejarás de verlo; los demás lo siguen viendo.' : 'Nadie de la empresa lo verá hasta que alguien lo vuelva a mostrar.' }}
                    </p>
                    <UFormField
                        label="Motivo (opcional)"
                        name="motivo"
                    >
                        <UTextarea
                            v-model="estado.motivo"
                            :rows="2"
                            class="w-full"
                            data-prueba="motivo-ocultar"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problema"
                        :problema="problema"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        @click="abierto = false"
                    />
                    <UButton
                        type="submit"
                        form="form-ocultar-consejo"
                        label="Ocultar"
                        icon="i-lucide-eye-off"
                        :loading="enviando"
                    />
                </div>
            </template>
        </UModal>
    </UCard>
</template>
