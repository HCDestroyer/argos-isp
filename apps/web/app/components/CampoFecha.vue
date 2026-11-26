<script setup lang="ts">
import { CalendarDate, parseDate, today } from '@internationalized/date'
import type { DateValue } from '@internationalized/date'

/**
 * Campo de fecha del panel (sustituye al `<UInput type="date">` nativo, que en el navegador sale en
 * «mm/dd/yyyy»): un `UInput` que se escribe en dd/mm/aaaa (las barras se ponen solas; solo
 * números) y, a la derecha, su calendario (`UPopover` + `UCalendar`, en español por `UApp`). «Hoy»
 * del calendario es el de `America/Guatemala`.
 *
 * No es `UInputDate`: su campo por segmentos muestra el día y el mes sin cero («31/8/2026»), y el
 * tablero pide dd/mm/aaaa.
 *
 * El valor de entrada y salida es el mismo texto que va a la API: `YYYY-MM-DD`, o `''` mientras el
 * campo está vacío o la fecha no está completa o no existe (igual que el campo nativo). Funciona
 * dentro de `UFormField`/`UForm` con zod: el esquema sigue validando ese texto. `min` y `max`
 * (`YYYY-MM-DD`) limitan el calendario; lo escrito a mano lo valida el esquema, como antes. Lo demás
 * (`class`, `aria-label`, `data-prueba`, `icon`, `ui`, `size`) pasa al `UInput`.
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
    modelValue?: string | null
    min?: string | null
    max?: string | null
    disabled?: boolean
}>(), {
    modelValue: null,
    min: null,
    max: null,
    disabled: false,
})

const emit = defineEmits<{
    'update:modelValue': [valor: string]
}>()

const ZONA = 'America/Guatemala'

/** `YYYY-MM-DD` → fecha de calendario; cualquier otro texto (vacío, incompleto) → sin fecha. */
function aFecha(texto: string | null | undefined): CalendarDate | undefined {
    if (!texto || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
        return undefined
    }
    try {
        const fecha = parseDate(texto)
        // `parseDate` acepta el 31/02 y lo corre al 3/03: solo vale si sale la misma fecha.
        return fecha.toString() === texto ? fecha : undefined
    }
    catch {
        return undefined
    }
}

/** `YYYY-MM-DD` → `dd/mm/aaaa` (lo que se ve). */
function aTexto(iso: string | null | undefined): string {
    const fecha = aFecha(iso)
    return fecha ? `${String(fecha.day).padStart(2, '0')}/${String(fecha.month).padStart(2, '0')}/${String(fecha.year).padStart(4, '0')}` : ''
}

/** `dd/mm/aaaa` (completo) → `YYYY-MM-DD` si la fecha existe; si no, `''`. */
function aIso(texto: string): string {
    const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto)
    if (!partes) {
        return ''
    }
    const iso = `${partes[3]}-${partes[2]}-${partes[1]}`
    return aFecha(iso) ? iso : ''
}

/** Solo números, con las barras en su lugar: «3108» → «31/08». */
function enmascarar(entrada: string): string {
    const digitos = entrada.replace(/\D/g, '').slice(0, 8)
    return [digitos.slice(0, 2), digitos.slice(2, 4), digitos.slice(4)].filter(Boolean).join('/')
}

const texto = ref(aTexto(props.modelValue))

// Un cambio de fuera (rellenar, descartar) se ve en el campo; lo que se está escribiendo no se pisa.
watch(() => props.modelValue, (valor) => {
    if ((valor ?? '') !== aIso(texto.value)) {
        texto.value = aTexto(valor)
    }
})

function publicar(iso: string): void {
    if (iso !== (props.modelValue ?? '')) {
        emit('update:modelValue', iso)
    }
}

function alEscribir(valor: string | number | null | undefined): void {
    texto.value = enmascarar(String(valor ?? ''))
    publicar(aIso(texto.value))
}

const minimo = computed(() => aFecha(props.min))
const maximo = computed(() => aFecha(props.max))
const seleccion = computed(() => aFecha(props.modelValue))
const hoy = today(ZONA)
const abierto = ref(false)

/** Lo que emite `UCalendar` (un solo día). */
function alElegir(fecha: DateValue | DateValue[] | null | undefined | { start?: DateValue, end?: DateValue }): void {
    if (!fecha || !('year' in fecha && 'month' in fecha && 'day' in fecha)) {
        return
    }
    const iso = new CalendarDate(fecha.year, fecha.month, fecha.day).toString()
    texto.value = aTexto(iso)
    publicar(iso)
    abierto.value = false
}
</script>

<template>
    <UInput
        v-bind="$attrs"
        :model-value="texto"
        placeholder="dd/mm/aaaa"
        inputmode="numeric"
        autocomplete="off"
        maxlength="10"
        :disabled="props.disabled"
        @update:model-value="alEscribir"
    >
        <template #trailing>
            <UPopover
                v-model:open="abierto"
                :content="{ align: 'end' }"
            >
                <UButton
                    color="neutral"
                    variant="link"
                    size="sm"
                    icon="i-lucide-calendar"
                    aria-label="Elegir en el calendario"
                    class="px-0"
                    :disabled="props.disabled"
                    data-prueba="campo-fecha-calendario"
                />
                <template #content>
                    <UCalendar
                        :model-value="seleccion"
                        :min-value="minimo"
                        :max-value="maximo"
                        :default-placeholder="seleccion ?? hoy"
                        class="p-2"
                        @update:model-value="alElegir"
                    />
                </template>
            </UPopover>
        </template>
    </UInput>
</template>
