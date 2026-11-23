<script setup lang="ts">
/**
 * Una fila de ajuste de operación (tablero OperConfigRed): etiqueta, ayuda y el control según el
 * tipo de la clave (interruptor, número con su unidad u opciones segmentadas). Debajo, la etiqueta
 * de alcance: «Para todas las empresas» (solo global), «Cada empresa puede cambiarlo» (vista
 * «Todas») o, en una empresa, «Propio de esta empresa» con «Usar el de Todas».
 */
const props = defineProps<{
    definicion: DefinicionAjuste
    /** `null` = «Todas las empresas». */
    empresaId: number | null
    /** La empresa tiene un valor propio guardado para esta clave. */
    propio: boolean
    editable: boolean
}>()

const valor = defineModel<ValorAjusteOperacion>({ required: true })
const emit = defineEmits<{ heredar: [] }>()

const textos = computed(() => TEXTOS_AJUSTES[props.definicion.clave as ClaveAjusteOperacion] ?? { etiqueta: props.definicion.clave, ayuda: props.definicion.descripcion })
/** En una empresa, una clave solo global se ve y no se cambia aquí. */
const soloGlobal = computed(() => props.empresaId !== null && !props.definicion.por_empresa)
const bloqueado = computed(() => !props.editable || soloGlobal.value)
const idControl = useId()

const numero = computed({
    get: () => (typeof valor.value === 'number' ? valor.value : undefined),
    set: (v: number | undefined) => {
        valor.value = v ?? Number.NaN
    },
})
const booleano = computed({
    get: () => valor.value === true,
    set: (v: boolean) => {
        valor.value = v
    },
})
const opcion = computed({
    get: () => String(valor.value),
    set: (v: string | number) => {
        valor.value = String(v)
    },
})
const opciones = computed(() => (props.definicion.opciones ?? []).map(o => ({ label: o === 'porcentaje' ? 'Porcentaje' : o === 'cantidad' ? 'Cantidad' : o, value: o, disabled: bloqueado.value })))
</script>

<template>
    <div
        class="flex min-w-0 flex-col gap-2 border-(--ax-borde) py-2.5 sm:flex-row sm:items-center sm:justify-between [&:not(:first-child)]:border-t"
        data-fila-config
        :data-ajuste="definicion.clave"
    >
        <div class="flex min-w-0 flex-col">
            <label
                :for="idControl"
                class="text-sm font-semibold text-highlighted"
            >{{ textos.etiqueta }}</label>
            <span class="text-xs text-muted">{{ textos.ayuda }}</span>
            <span class="mt-1 flex flex-wrap items-center gap-1.5">
                <UBadge
                    v-if="!definicion.por_empresa"
                    label="Para todas las empresas"
                    icon="i-lucide-lock"
                    color="neutral"
                    variant="soft"
                    size="sm"
                />
                <UBadge
                    v-else-if="empresaId === null"
                    label="Cada empresa puede cambiarlo"
                    icon="i-lucide-building"
                    color="primary"
                    variant="soft"
                    size="sm"
                />
                <template v-else-if="propio">
                    <UBadge
                        label="Propio de esta empresa"
                        icon="i-lucide-building"
                        color="primary"
                        variant="soft"
                        size="sm"
                    />
                    <UButton
                        v-if="editable"
                        label="Usar el de «Todas»"
                        variant="link"
                        size="xs"
                        class="p-0"
                        @click="emit('heredar')"
                    />
                </template>
                <UBadge
                    v-else
                    label="Igual que «Todas»"
                    color="neutral"
                    variant="soft"
                    size="sm"
                />
            </span>
        </div>
        <div class="flex shrink-0 items-center gap-2">
            <USwitch
                v-if="definicion.tipo === 'booleano'"
                :id="idControl"
                v-model="booleano"
                size="lg"
                :disabled="bloqueado"
            />
            <UFormField
                v-else-if="definicion.tipo === 'entero'"
                :name="definicion.clave"
            >
                <div class="flex items-center gap-2">
                    <UInputNumber
                        :id="idControl"
                        v-model="numero"
                        :min="definicion.min ?? undefined"
                        :max="definicion.max ?? undefined"
                        :step="1"
                        :format-options="{ useGrouping: false }"
                        :disabled="bloqueado"
                        :increment="false"
                        :decrement="false"
                        class="w-24"
                    />
                    <span class="w-10 text-xs text-muted">{{ textos.unidad }}</span>
                </div>
            </UFormField>
            <UTabs
                v-else
                :id="idControl"
                v-model="opcion"
                :items="opciones"
                :content="false"
                variant="pill"
                color="neutral"
                size="sm"
                :ui="{
                    list: 'rounded-xl bg-(--ax-panel) p-1',
                    indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                    trigger: 'rounded-lg px-3 text-muted data-[state=active]:text-primary',
                }"
            />
        </div>
    </div>
</template>
