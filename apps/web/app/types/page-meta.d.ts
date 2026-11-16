declare module '#app' {
    interface PageMeta {
        /**
         * Permiso requerido para entrar a la ruta (`routers.ver`), o una lista de la que basta uno
         * (`['horus.ver', 'iris.ver']`: la pantalla muestra solo lo que cada permiso deja ver). Lo
         * valida `02.permiso.global.ts`.
         */
        permiso?: string | readonly string[]
        /** Ruta accesible sin sesión (login). */
        publica?: boolean
    }
}

export {}
