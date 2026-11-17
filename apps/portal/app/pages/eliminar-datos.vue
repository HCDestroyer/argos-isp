<script setup lang="ts">
/**
 * Instrucciones para eliminar datos, públicas (sin sesión) y renderizadas en el servidor: es la
 * «URL de instrucciones para la eliminación de datos» de la app de Meta.
 *
 * Solo promete lo que el sistema hace: no hay borrado ni anonimización automática del cliente. La
 * solicitud se atiende quitando de la ficha los datos de contacto (`portal.editar_contacto` /
 * `clientes.editar`), desvinculando Telegram y dando de baja el permiso de WhatsApp (que viaja a
 * Iris). Facturas, pagos, libro contable y auditoría no se borran (ley fiscal y libro inmutable).
 */
const { empresa, problema, recargar } = usePoliticasEmpresa()

const responsable = computed(() => nombreCompleto(empresa.value))
const correo = computed(() => empresa.value?.correo ?? null)
const telefono = computed(() => empresa.value?.telefono ?? empresa.value?.telefono_alterno ?? null)
const contacto = computed(() => empresa.value ? `/contacto?empresa=${empresa.value.id}` : '/contacto')

useSeoMeta({
    title: computed(() => `Eliminar mis datos · ${empresa.value?.nombre ?? 'Portal del cliente'}`),
    description: computed(() => `Cómo pedir a ${nombreLegal(empresa.value)} la eliminación de tus datos personales, qué se elimina, qué se conserva por ley y cómo dejar de recibir avisos por WhatsApp.`),
})
</script>

<template>
    <PoliticaPagina
        titulo="Instrucciones para eliminar tus datos"
        actual="/eliminar-datos"
        :problema="problema"
        @reintentar="recargar()"
    >
        <p class="text-sm leading-relaxed text-default">
            Puedes pedir a <strong data-testid="politica-empresa">{{ responsable }}</strong> que elimine tus datos personales.
            Aquí te explicamos cómo hacerlo, qué eliminamos y qué debemos conservar por ley.
        </p>

        <PoliticaSeccion titulo="1. Cómo pedirlo">
            <p>Envíanos tu solicitud por cualquiera de estos medios:</p>
            <ul>
                <li v-if="correo">
                    Por correo a
                    <ULink
                        :to="`mailto:${correo}`"
                        external
                        class="text-primary underline underline-offset-2"
                        data-testid="eliminar-correo"
                    >
                        {{ correo }}
                    </ULink>, con el asunto «Eliminar mis datos».
                </li>
                <li v-if="telefono">
                    Por teléfono al
                    <ULink
                        :to="`tel:${telefono.replace(/[^\d+]/g, '')}`"
                        external
                        class="text-primary underline underline-offset-2"
                        data-testid="eliminar-telefono"
                    >
                        {{ telefono }}
                    </ULink>.
                </li>
                <li>
                    Por los medios de nuestra
                    <ULink
                        :to="contacto"
                        class="text-primary underline underline-offset-2"
                    >página de contacto</ULink>, o en persona en nuestra oficina.
                </li>
            </ul>
            <p>
                Incluye tu nombre completo, tu NIT o CUI (o la dirección del servicio) y el medio por el que quieres que te
                respondamos. Para proteger tu cuenta podemos pedirte que confirmes tu identidad, por ejemplo con un código
                enviado a tu correo o Telegram registrados, antes de hacer cambios.
            </p>
            <PoliticaResponsable :empresa="empresa" />
        </PoliticaSeccion>

        <PoliticaSeccion titulo="2. Plazo de respuesta">
            <p>
                Respondemos tu solicitud en un plazo máximo de {{ PLAZO_RESPUESTA_DIAS }} días calendario desde que la
                recibimos, y te confirmamos por el medio que indicaste qué se eliminó y qué se conserva.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="3. Qué eliminamos">
            <ul>
                <li>Tus datos de contacto: correo, teléfono y celular.</li>
                <li>El vínculo de tu cuenta con nuestro bot de Telegram.</li>
                <li>
                    Tu permiso para recibir avisos por WhatsApp: registramos tu baja y se la comunicamos al sistema de mensajería,
                    así no te volvemos a escribir por ese canal.
                </li>
                <li>
                    Si además quieres terminar tu servicio de Internet, lo retiramos y sus direcciones IP quedan libres.
                </li>
            </ul>
            <p>
                Después de la eliminación ya no recibirás avisos sobre tu cuenta y no podrás entrar al portal con código,
                porque no tendremos a dónde enviarlo.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="4. Qué conservamos y por qué">
            <ul>
                <li>
                    <strong>Facturas, notas de crédito, pagos y comprobantes,</strong> con el nombre, el NIT o CUI y la dirección
                    fiscal que llevan, durante los plazos que exigen las leyes tributarias y mercantiles de Guatemala. Las
                    facturas electrónicas ya certificadas ante la SAT no se pueden borrar.
                </li>
                <li>
                    <strong>Los registros contables,</strong> que no se modifican ni se borran: cualquier corrección se hace con
                    un nuevo registro.
                </li>
                <li>
                    <strong>El registro de actividad</strong> (quién cambió qué y cuándo, incluida tu solicitud) y el historial
                    técnico de conexiones y direcciones IP, por seguridad y para responder a requerimientos legales.
                </li>
            </ul>
            <p>
                Estos datos se conservan solo para esos fines: no los usamos para enviarte mensajes ni para ningún otro
                propósito.
            </p>
        </PoliticaSeccion>

        <PoliticaSeccion titulo="5. Dejar de recibir avisos por WhatsApp">
            <p>No necesitas eliminar tus datos para dejar de recibir WhatsApp. Puedes darte de baja cuando quieras:</p>
            <ul>
                <li>En el portal: entra con tu código y, en «Mi cuenta», «Avisos por WhatsApp», quita la marca de «Acepto recibir avisos por WhatsApp».</li>
                <li>Desde el mismo chat de WhatsApp, pidiendo la baja.</li>
                <li>Pidiéndolo a la empresa por los medios de la sección 1.</li>
            </ul>
            <p>
                De la misma forma puedes desvincular Telegram o quitar tu correo y tus teléfonos desde «Mi cuenta» en el portal. Los
                mensajes que ya recibiste quedan en tu teléfono; puedes borrarlos desde tu aplicación de WhatsApp o Telegram.
            </p>
        </PoliticaSeccion>
    </PoliticaPagina>
</template>
