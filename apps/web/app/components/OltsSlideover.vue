<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Catálogo de OLT y puertos PON (`contratos/red-acceso.md` §1, §4): son datos para ordenar y filtrar
 * la red de acceso; Argos nunca habla con la OLT. Registrar una OLT pide `olts.crear`; sus puertos,
 * `olts.editar`. Cada puerto dice cuántas VLAN tiene (máximo 2) y uno sin VLAN se puede quitar.
 */
const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    cambiado: []
}>()

const { puede } = usePermisos()
const toast = useToast()

const olts = shallowRef<Olt[]>([])
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    cargando.value = true
    const resultado = await useOlts().listar()
    cargando.value = false
    olts.value = resultado.ok ? resultado.data.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

watch(abierto, (valor) => {
    if (valor) {
        void cargar()
    }
})

/** Espejo de `crearOltValidator`. */
const esquemaOlt = z.object({
    nombre: z.string().trim().min(1, 'Ponle un nombre').max(100, 'Máximo 100 caracteres'),
    marca: z.string().trim().max(100, 'Máximo 100 caracteres'),
    modelo: z.string().trim().max(100, 'Máximo 100 caracteres'),
})
const nuevaOlt = reactive<z.input<typeof esquemaOlt>>({ nombre: '', marca: '', modelo: '' })
const formularioOlt = useTemplateRef('formularioOlt')
const creando = ref(false)
const problemaOlt = ref<Problem | null>(null)

async function crearOlt(evento: FormSubmitEvent<z.output<typeof esquemaOlt>>) {
    creando.value = true
    problemaOlt.value = null
    const resultado = await useOlts().crear({ nombre: evento.data.nombre, marca: evento.data.marca || null, modelo: evento.data.modelo || null })
    creando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formularioOlt.value?.setErrors(errores)
        }
        problemaOlt.value = errores.length ? null : resultado.problema
        return
    }
    Object.assign(nuevaOlt, { nombre: '', marca: '', modelo: '' })
    toast.add({ title: `${resultado.data.nombre} registrada`, icon: 'i-lucide-circle-check', color: 'success' })
    emit('cambiado')
    await cargar()
}

const PON = /^\d{1,3}(\/\d{1,3}){1,3}$/
const puertosNuevos = ref<Record<number, string>>({})
const problemaPuerto = ref<{ oltId: number, problema: Problem } | null>(null)

async function agregarPuerto(olt: Olt) {
    const identificador = (puertosNuevos.value[olt.id] ?? '').trim()
    if (!PON.test(identificador)) {
        problemaPuerto.value = { oltId: olt.id, problema: { type: 'about:blank', title: 'Puerto inválido', status: 422, detail: 'Escribe marco/slot/puerto como lo muestra la OLT, p. ej. 0/1/3' } }
        return
    }
    problemaPuerto.value = null
    const resultado = await useOlts().agregarPuerto(olt.id, { identificador })
    if (!resultado.ok) {
        problemaPuerto.value = { oltId: olt.id, problema: resultado.problema }
        return
    }
    puertosNuevos.value = { ...puertosNuevos.value, [olt.id]: '' }
    emit('cambiado')
    await cargar()
}

async function quitarPuerto(olt: Olt, puerto: PuertoPon) {
    const resultado = await useOlts().eliminarPuerto(puerto.id)
    if (!resultado.ok) {
        problemaPuerto.value = { oltId: olt.id, problema: resultado.problema }
        return
    }
    toast.add({ title: `Puerto ${puerto.identificador} quitado`, icon: 'i-lucide-trash-2', color: 'success' })
    emit('cambiado')
    await cargar()
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        title="OLT y puertos PON"
        description="Para ordenar y filtrar la red de acceso. Cada puerto lleva hasta 2 VLAN."
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-6"
                data-prueba="olts"
            >
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="cargar"
                    :reintentando="cargando"
                />
                <USkeleton
                    v-else-if="cargando && !olts.length"
                    class="h-32 w-full"
                />
                <template v-else>
                    <p
                        v-if="!olts.length"
                        class="text-sm text-muted"
                    >
                        Todavía no hay OLT registradas.
                    </p>
                    <section
                        v-for="olt in olts"
                        :key="olt.id"
                        class="flex flex-col gap-3 rounded-lg border border-default p-4"
                        :data-olt="olt.id"
                    >
                        <div class="flex flex-wrap items-center gap-2">
                            <UIcon
                                name="i-lucide-server"
                                class="size-4 text-primary"
                            />
                            <span class="text-sm font-semibold text-highlighted">{{ olt.nombre }}</span>
                            <span class="text-xs text-muted">{{ [olt.marca, olt.modelo].filter(Boolean).join(' ') }}</span>
                        </div>
                        <ul class="flex flex-col divide-y divide-default rounded-md border border-default">
                            <li
                                v-for="puerto in olt.puertos"
                                :key="puerto.id"
                                class="flex items-center justify-between gap-2 px-3 py-1.5"
                                :data-puerto="puerto.id"
                            >
                                <span class="font-mono text-sm">{{ puerto.identificador }}</span>
                                <span class="flex items-center gap-2">
                                    <UBadge
                                        :label="`${puerto.vlans} de ${MAXIMO_VLANS_POR_PUERTO} VLAN`"
                                        :color="puerto.vlans >= MAXIMO_VLANS_POR_PUERTO ? 'warning' : 'neutral'"
                                        variant="subtle"
                                        size="sm"
                                    />
                                    <UButton
                                        v-if="puede('olts.editar') && puerto.vlans === 0"
                                        icon="i-lucide-trash-2"
                                        color="neutral"
                                        variant="ghost"
                                        size="xs"
                                        :aria-label="`Quitar el puerto ${puerto.identificador}`"
                                        @click="quitarPuerto(olt, puerto)"
                                    />
                                </span>
                            </li>
                            <li
                                v-if="!olt.puertos.length"
                                class="px-3 py-1.5 text-sm text-muted"
                            >
                                Sin puertos.
                            </li>
                        </ul>
                        <div
                            v-if="puede('olts.editar')"
                            class="flex gap-2"
                        >
                            <UInput
                                v-model="puertosNuevos[olt.id]"
                                placeholder="0/1/4"
                                class="w-32 font-mono"
                                :aria-label="`Nuevo puerto de ${olt.nombre}`"
                                :data-prueba="`puerto-nuevo-${olt.id}`"
                            />
                            <UButton
                                label="Agregar puerto"
                                icon="i-lucide-plus"
                                color="neutral"
                                variant="outline"
                                :data-prueba="`agregar-puerto-${olt.id}`"
                                @click="agregarPuerto(olt)"
                            />
                        </div>
                        <ProblemaAlerta
                            v-if="problemaPuerto?.oltId === olt.id"
                            :problema="problemaPuerto.problema"
                        />
                    </section>
                </template>

                <UForm
                    v-if="puede('olts.crear')"
                    ref="formularioOlt"
                    :schema="esquemaOlt"
                    :state="nuevaOlt"
                    class="flex flex-col gap-3 rounded-lg border border-dashed border-default p-4"
                    data-prueba="form-olt"
                    @submit="crearOlt"
                >
                    <h3 class="text-sm font-medium text-highlighted">
                        Registrar OLT
                    </h3>
                    <ProblemaAlerta
                        v-if="problemaOlt"
                        :problema="problemaOlt"
                    />
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                    >
                        <UInput
                            v-model="nuevaOlt.nombre"
                            class="w-full"
                            data-prueba="olt-nombre"
                        />
                    </UFormField>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <UFormField
                            label="Marca"
                            name="marca"
                            hint="Opcional"
                        >
                            <UInput
                                v-model="nuevaOlt.marca"
                                placeholder="Huawei"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField
                            label="Modelo"
                            name="modelo"
                            hint="Opcional"
                        >
                            <UInput
                                v-model="nuevaOlt.modelo"
                                placeholder="MA5800-X2"
                                class="w-full"
                            />
                        </UFormField>
                    </div>
                    <UButton
                        type="submit"
                        label="Registrar OLT"
                        icon="i-lucide-plus"
                        color="neutral"
                        variant="outline"
                        :loading="creando"
                        class="self-start"
                        data-prueba="olt-crear"
                    />
                </UForm>
            </div>
        </template>
    </USlideover>
</template>
