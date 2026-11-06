# FFCH Puntuación — Web App (Angular)

Aplicación web que reemplaza `FFCH_Puntuacion/FFCH - Puntuacion.xlsx`: lleva el registro semanal de
asistencia/pago de los jugadores, calcula sus puntos y TDP, arma equipos balanceados y genera el texto
de convocatoria para WhatsApp. Corre 100% en el navegador (sin servidor) y se publica gratis en GitHub Pages.

## Desarrollo local

```bash
cd webApp
npm install
npm start        # http://localhost:4200
npm test         # unit tests (Vitest)
npm run build    # build de producción en dist/webApp/browser
```

## Arquitectura

- **Angular 22**, componentes standalone, rutas con `withHashLocation()` (necesario para que las rutas
  funcionen en GitHub Pages, que no soporta rewrites del lado del servidor).
- **Base de datos local: [Dexie.js](https://dexie.org/) sobre IndexedDB** — caché/motor de consultas en
  el navegador; los datos "reales" viven en Firestore (ver abajo).
- **Cuentas: Firebase Authentication** — credenciales verificadas del lado del servidor de Firebase,
  nunca expuestas al cliente.
- **Datos compartidos: Firestore** — un documento (`data/ffch-puntuacion`) con jugadores, registros
  semanales, TDP y configuración de temporada, más una colección `users` con el perfil (nombre/rol/estado)
  de cada cuenta. Reglas de seguridad ([`firestore.rules`](./firestore.rules)) controlan quién puede leer/
  escribir cada uno. Ver [DEPLOY.md](./DEPLOY.md) sección 0 para crear el proyecto Firebase.

### Servicios principales (`src/app/core/services`)

| Servicio | Responsabilidad |
|---|---|
| `DataStoreService` | Wrapper de Dexie/IndexedDB; caché local y export/import completo. |
| `ScoringService` | Reproduce las fórmulas de `FFCH_Puntuacion/formulas.txt` (`Pts`, `PtosFecha`, `TDP`, `Puntos`) y las reglas de tarjetas de `reglamento.md`. |
| `RemoteSyncService` | Pull/push del documento `data/ffch-puntuacion` en Firestore, con control de concurrencia optimista. |
| `AuthService` | Login/registro/roles sobre Firebase Authentication + Firestore. |
| `TeamBalancerService` | Arma 2 equipos balanceados por promedio de Puntos ("snake draft"). |
| `MessageTemplateService` | Rellena plantillas `{{VAR}}` como `convocatoria.md`. |
| `CsvImportService` | Migración única desde los CSV exportados del Excel original. |
| `EventService` | Eventos (Pre Temporada / Galas / Team Building), evento habilitado e inscripciones en Firestore; aplica asistencias al TDP. |
| `EventReportService` | Cupos y validación de opciones de eventos, reporte CSV y resumen para WhatsApp. |

### Mapeo de fórmulas del Excel original

Ver [`FFCH_Puntuacion/README.md`](../FFCH_Puntuacion/README.md) para el detalle completo de cómo se
reconstruyeron las fórmulas del Excel (`Pts`, `PtosFecha`, `TDP`, `Puntos`, pesos TDP) y las decisiones
tomadas para los casos ambiguos (PtsTemporadaAnterior, peso de Team Building, tarjetas por tardanza).

## Primeros pasos como administrador

1. Entra a **Ajustes** y, si es la primera vez, usa "Importar desde los CSV originales" para poblar el
   roster y el historial desde los archivos en `FFCH_Puntuacion/`.
2. Usa **TDP** para registrar, por categoría y año, las participaciones y ajustar los pesos de la fórmula.
3. Usa **Captura Semanal** cada fecha para marcar RSVP/Jugó/Sede/Pago/Tarde por jugador.
4. Usa **Equipos** para armar los 2 equipos balanceados y **Convocatoria** para generar el texto a copiar
   a WhatsApp.
5. Cuando termines de editar, usa "⬆ Guardar cambios en Firestore" en **Ajustes** para que los demás
   dispositivos puedan sincronizar los cambios.

### ¿Cuándo hay que usar "⬆ Guardar cambios en Firestore"?

| Acción | Dónde se guarda | ¿Requiere el botón? |
|---|---|---|
| Crear/editar evento ("Guardar evento") | Firestore, al instante | No |
| Habilitar/deshabilitar evento | Firestore, al instante | No |
| Vincular cuenta ↔ jugador (Usuarios) | Firestore, al instante | No |
| Inscripción de un usuario o de un admin a nombre de un jugador | Firestore, al instante | No |
| Aplicar asistencias de eventos al TDP | Se sube a Firestore automáticamente cuando un admin abre TDP, se inscribe o usa "Aplicar asistencias al TDP" | No |
| Ediciones manuales en TDP (casillas, pesos), Roster, Captura Semanal | Solo en IndexedDB del navegador | **Sí** |

> "Guardar cambios" sube la copia local completa y reemplaza la de Firestore. Antes de editar TDP/Roster/Captura,
> usa "⬇ Sincronizar desde Firestore" para no pisar cambios más recientes (por ejemplo, asistencias ya aplicadas).
> Sincronizar reemplaza la copia local, así que primero guarda cualquier cambio local pendiente.

## Matriz de roles

La app distingue dos tipos de acceso:

| Rol | Acceso | Puede editar datos |
|---|---|---:|
| Usuario autenticado no admin | Dashboard, Roster, TDP, Captura Semanal, Equipos, Evento (si hay uno habilitado), Ayuda y Cuenta | Solo su propia inscripción a eventos |
| Administrador | Todas las páginas | Sí |

Enrutamiento real:

- `authGuard` protege `/`, `/cuenta`, `/roster`, `/tdp`, `/captura`, `/equipos` y `/ayuda`.
- `activeEventGuard` protege `/evento` (requiere sesión y un evento habilitado; si no, redirige a `/`).
- `adminGuard` protege `/convocatoria`, `/ajustes` y `/usuarios`.
- La lectura del documento compartido (`data/ffch-puntuacion`) está permitida a cualquier usuario autenticado
  (regla de Firestore); solo administradores pueden escribirlo.

## Auto-sync en primer login

Cuando un usuario autenticado entra por primera vez y la base local de IndexedDB está vacía, la app intenta
hacer un pull del documento compartido `data/ffch-puntuacion` desde Firestore.

Esto tiene dos ventajas importantes:

- un usuario nuevo puede ver los datos sin tener que navegar manualmente a Ajustes;
- un administrador no necesita recrear la base local en cada navegador nuevo.

La lógica es segura por diseño:

- si ya hay datos en la base local, no se sobreescribe automáticamente;
- si la base local está vacía, se rellena desde Firestore;
- los cambios explícitos y los pushes siguen siendo solo para administradores.

En otras palabras, la sincronización automática es una carga inicial de arranque, no un refresh silencioso en cada login.

## Eventos e inscripción (`/evento`)

Los eventos **Pre Temporada**, **Galas** y **Team Building** corresponden 1:1 a las categorías TDP del mismo
nombre (`pretemporada`, `gala`, `teamBuilding`).

**Administración (Ajustes → Eventos):**

- Crear/editar un evento: categoría, título, descripción, fecha (`datetime-local`), lugar y **fecha límite de
  inscripción** opcional (después de esa hora los usuarios ya no pueden inscribirse; también lo validan las reglas
  de Firestore vía `deadlineMs`). El id del evento es `<categoría>-<año de la fecha>`, así que hay un evento por
  categoría y año.
- Opciones: "Asistiré" siempre está incluida; se pueden agregar opciones extra de tipo **Sí / No**, **Lista**
  (valores separados por coma) o **Texto libre** (ej. "Llevo bebidas", "Platillo: Postre, Ensalada"). Cada opción
  puede ser **Obligatoria** y tener un **Cupo**: máximo de asistentes que pueden marcar un Sí / No, o elegir cada
  valor de una Lista (ej. solo 2 personas llevan asador). El cupo se valida en el cliente al enviar.
- Habilitar un evento (radio): solo uno puede estar habilitado a la vez. Con "Ninguno", la página y el enlace del
  menú quedan ocultos para todos.
- **Archivo:** los eventos con fecha pasada se agrupan en "Eventos pasados" (el habilitado siempre se queda arriba).
  Como cada edición anual es un documento distinto, el historial de inscripciones por año se conserva.
  **Duplicar al próximo año** copia título, descripción, lugar y opciones al editor con la fecha +1 año, para
  ajustar los detalles y guardar.
- Ver inscripciones de cualquier evento, **Reabrir** (borra la inscripción para que el usuario se pueda inscribir de
  nuevo), **Aplicar asistencias al TDP**, **Descargar CSV** (compatible con Excel) y **Copiar resumen WhatsApp**
  (asistentes, qué lleva cada uno y totales por opción).
- **Inscribir a un jugador:** un admin puede inscribir a cualquier jugador sin inscripción (ignora la fecha límite).
  Si el jugador está vinculado a una cuenta se usa ese uid (el usuario la ve como suya); si no, el id es
  `player-<playerId>`. Queda marcada con `registeredBy`.

**Dashboard:** mientras hay un evento habilitado se muestra un banner con título, fecha, lugar y fecha límite, y un
botón "Inscribirme" / "Ver mi inscripción ✓". Los anuncios de `public/anuncios.md` siguen siendo para avisos
generales; evita duplicar ahí el evento habilitado.

**Usuarios:** el enlace con el título del evento aparece en el menú solo mientras hay un evento habilitado. Si la
cuenta está vinculada a un jugador (ver abajo) se usa ese jugador automáticamente; si no, el usuario lo elige (los
que ya tienen inscripción no aparecen). Marca "Asistiré" y contesta las opciones.
Al enviar, la inscripción se guarda directo en Firestore y la página queda en solo lectura para ese usuario. La
página también muestra la lista de asistentes y lo que cada uno lleva.

**Vincular cuentas con jugadores (Usuarios):** en la columna **Jugador** un administrador asigna a cada cuenta su
jugador del roster (`users/{uid}.playerId`). Un jugador solo puede estar vinculado a una cuenta. Los usuarios no
pueden cambiar su propio `playerId`, y las reglas de Firestore solo les permiten inscribirse como su jugador
vinculado (las cuentas sin vincular aún pueden elegir).

**Integración con TDP:** asistir marca la categoría del evento en el año de la fecha del evento
(`<playerId>-<categoría>-<año>`, `participated: true`). Como los no-admins no pueden escribir el documento compartido
`data/ffch-puntuacion`, el flujo es:

1. La inscripción se guarda en `events/{eventId}/registrations/{uid}`.
2. Mientras no se haya aplicado, la página TDP la muestra a todos como participación (sin escribir nada).
3. Cuando un administrador se inscribe, abre la página TDP o usa "Aplicar asistencias al TDP", la app aplica
   automáticamente las asistencias pendientes al documento compartido en Firestore (sobre la última versión remota,
   sin pisar cambios locales sin guardar), las guarda en IndexedDB y marca cada inscripción con `appliedToTdp: true`.
   A partir de ahí el TDP es la fuente de verdad, así que un admin puede desmarcar a alguien que no llegó.

**Firestore:**

| Ruta | Lectura | Escritura |
|---|---|---|
| `meta/activeEvent` (`{ eventId }`) | usuarios autenticados | admins |
| `events/{eventId}` | usuarios autenticados | admins |
| `events/{eventId}/registrations/{uid}` | usuarios autenticados | crear: el propio usuario solo si el evento está habilitado y antes de la fecha límite, o cualquier admin; actualizar: admins (solo `appliedToTdp`); borrar: admins |

> Después de actualizar a esta versión hay que volver a publicar [`firestore.rules`](./firestore.rules) en la
> consola de Firebase (ver [DEPLOY.md](./DEPLOY.md)).

## Cómo crea equipos el balanceador

El servicio `TeamBalancerService` sigue una estrategia greedy de tipo "snake draft":

1. Ordena los jugadores seleccionados por `rating` descendente.
2. Recorre la lista en ese orden.
3. Si el equipo A tiene menos total acumulado que el equipo B, el jugador va a A; si no, va a B.
4. Acumula el `total` de cada equipo con el valor del `rating` de cada jugador.
5. Devuelve dos equipos con `total` y `promedio` calculados sobre esos ratings.

El algoritmo es intencionalmente simple y rápido: mantiene los equipos lo más parejos posible sin intentar una búsqueda combinatoria completa.

### Cálculo del rating inicial a partir de puntos

Cuando un jugador no tiene un `rating` persistido aún, se genera desde `puntos`:

- se toma el máximo `puntos` del conjunto activo,
- se normaliza cada jugador a escala `1..10`,
- se redondea para mantener un entero,
- y el valor final queda acotado entre `1` y `10`.

Esto hace que el primer balanceo sea razonable sin necesidad de tener un histórico previo.

### Efecto del último partido

Cuando el administrador marca quién ganó el último partido en la pantalla del balanceador:

- jugadores del equipo ganador: `rating = rating + 1`
- jugadores del equipo perdedor: `rating = rating - 1`
- el resultado queda clavado entre `1` y `10`

Esto hace que el rating evolucione con el resultado de las partidas y que los equipos siguientes se generen con una tendencia histórica ligera pero persistente.

## Restricciones de equipo

El balanceador también acepta restricciones de "no pueden ir juntos". Cada restricción es un par de jugadores y se valida por `playerId` interno; el `WA number` solo se usa como etiqueta de visualización.

Ejemplos de restricciones soportadas:

- Jose no puede ir en el mismo equipo que Andrew.
- Jonathan no puede ir en el mismo equipo que Michael G.

En la pantalla de `Equipos`, el administrador puede:

- seleccionar dos jugadores desde el dropdown,
- guardar la restricción,
- ver la lista de restricciones activas,
- eliminar las que ya no aplique.

Las restricciones se guardan en IndexedDB, bajo la clave `team-balancer:restrictions`, para que sean administrables desde la app y no dependan de un archivo estático de config.

## Publicación en GitHub Pages

Ver [DEPLOY.md](./DEPLOY.md) para el checklist completo (única vez) y cómo funciona el despliegue
automático vía GitHub Actions en cada cambio a `webApp/`.
