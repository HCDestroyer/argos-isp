<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'

/**
 * Red del router e IPv4 fija de un servicio, dentro del `UForm` del alta o de la edición (campos
 * `red_id` e `ipv4`; la validación es `problemasIpv4Fija` en los dos esquemas). La red solo ayuda a
 * escribir una IP que caiga en ella: la API busca la red por la IP.
 */
const props = withDefaults(defineProps<{
    redes: RedIpv4[]
    /** Sin redes a la vista (sin `redes.ver`) se escribe solo la IP y la valida la API. */
    exigirRed?: boolean
}>(), {
    exigirRed: true,
})

const redId = defineModel<number | undefined>('redId', { required: true })
const ipv4 = defineModel<string>('ipv4', { required: true })

const red = computed(() => props.redes.find(r => r.id === redId.value) ?? null)
const itemsRed = computed<SelectItem[]>(() => props.redes.map(r => ({ label: etiquetaRedIpv4(r), value: r.id })))
</script>

<template>
    <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
            v-if="exigirRed || redes.length"
            name="red_id"
            label="Red"
            help="La red del router a la que pertenece la IP."
            :required="exigirRed"
        >
            <USelect
                v-model="redId"
                :items="itemsRed"
                placeholder="Elige la red"
                class="w-full"
                data-prueba="ipv4-fija-red"
            />
        </UFormField>
        <UFormField
            name="ipv4"
            label="IP fija"
            :help="red ? `Dentro de ${red.cidr}.` : (redes.length ? 'Elige primero la red.' : 'Una IP de las redes del router.')"
            required
        >
            <UInput
                v-model="ipv4"
                inputmode="decimal"
                placeholder="100.64.10.50"
                autocomplete="off"
                class="w-full font-mono"
                data-prueba="ipv4-fija-ip"
            />
        </UFormField>
    </div>
</template>
