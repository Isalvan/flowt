# Categorías de movimientos

Pulsa la categoría de un movimiento en Actividad reciente o en el historial para abrir el selector de Flowt. Busca por nombre o pulsa una categoría para guardarla.

Para añadir una categoría propia, pulsa **Crear categoría**, escribe un nombre de hasta 50 caracteres y elige si se usará para el tipo de movimiento actual o para gastos e ingresos. **Crear y aplicar** guarda la categoría y la asigna al movimiento.

Las categorías propias se guardan en tu cuenta y se sincronizan entre dispositivos. También aparecen en los filtros de actividad y conservan su nombre al exportar CSV. En modo demo se guardan solo en el navegador.

Las propuestas automáticas siguen usando el catálogo predeterminado. Una categoría propia confirmada se conserva y no se sustituye por una propuesta.

Firestore almacena las categorías en `categorias/{uid}/items/{id}`. Solo el propietario puede leerlas o crearlas. Los movimientos solo admiten categorías existentes de su propietario y compatibles con su tipo. Las categorías existentes no se pueden renombrar ni eliminar desde esta versión.

Los cambios del selector requieren desplegar tanto Hosting como las reglas de Firestore.

![Selector de Flowt con una categoría propia, usando datos de prueba](images/custom-categories.png)
