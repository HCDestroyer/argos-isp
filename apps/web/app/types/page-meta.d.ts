declare module '#app' {
    interface PageMeta {
        /** Permiso requerido para entrar a la ruta (`routers.ver`). Lo valida `02.permiso.global.ts`. */
        permiso?: string
        /** Ruta accesible sin sesión (login). */
        publica?: boolean
    }
}

export {}
