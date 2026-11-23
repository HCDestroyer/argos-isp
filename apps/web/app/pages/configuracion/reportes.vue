<script setup lang="ts">
/**
 * Configuración › Reportes: los ajustes que el PM decidió para los reportes y el panel del dueño
 * (decisiones 4 y 6; el aviso de pequeño contribuyente, la 12, va en Régimen e impuestos): cuándo
 * un servicio cuenta como baja y la lista aprobada de correos externos para los envíos programados. Sus APIs se construyen en
 * `agente/a3-reportes-pm` y `agente/a1-operacion-pm`: la pantalla los deja listos, con el valor de
 * fábrica de cada decisión y sin inventar el valor actual.
 */
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Reportes · Configuración · ArgosIsp' })
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-reportes"
        titulo="Reportes"
        descripcion="Cómo se cuentan las bajas y a quién se envían los reportes"
    >
        <div class="grid gap-4 xl:grid-cols-2">
            <ConfiguracionBloque
                titulo="Altas y bajas"
                icono="i-lucide-user-minus"
            >
                <ConfiguracionPendiente
                    etiqueta="Días suspendido para contar una baja"
                    ayuda="Un servicio retirado, o suspendido más de estos días, cuenta como baja; si se reactiva deja de contar."
                    fabrica="60 días de fábrica"
                    :decision="4"
                />
            </ConfiguracionBloque>

            <ConfiguracionBloque
                titulo="Envíos programados"
                icono="i-lucide-mail-check"
            >
                <ConfiguracionPendiente
                    etiqueta="Correos externos aprobados"
                    ayuda="Además de los usuarios con permiso, los reportes programados pueden ir a estos correos (un contador, un socio). Solo reportes contables, sin datos personales. La lista la aprueba un admin."
                    fabrica="Lista vacía de fábrica"
                    :decision="6"
                />
            </ConfiguracionBloque>
        </div>
    </ConfiguracionMarco>
</template>
