# Guía de uso — FFCH Puntuación

Esta aplicación reemplaza el Excel de puntuación de la FFCH. Aquí puedes consultar la tabla de posiciones,
tu TDP, la asistencia de cada fecha, los equipos armados para el próximo partido e inscribirte a los eventos
de la liga (Pre Temporada, Galas, Team Building).

## Acceso

### Crear una cuenta

1. En la pantalla de inicio elige **Crear cuenta**.
2. Escribe tu nombre, tu correo y una contraseña de al menos 8 caracteres.
3. Después de crearla, inicia sesión con **Iniciar sesión**.

Un administrador puede **vincular tu cuenta con tu jugador** del roster. Así, cuando te inscribas a un
evento, la app usa tu jugador automáticamente.

### ¿Olvidaste tu contraseña?

Elige **Olvidé mi contraseña** y escribe tu correo. Te llegará un enlace para elegir una contraseña nueva.
Si no ves el correo, revisa la carpeta de spam.

### Mi cuenta

Haz clic en tu nombre (arriba a la derecha) para ver tus datos y **cambiar tu contraseña**. Si un
administrador te dio una contraseña temporal, la app te pedirá cambiarla antes de continuar.

## ¿Qué puede hacer cada usuario?

| | Jugador (usuario) | Administrador |
|---|---|---|
| Ver Dashboard, Roster, TDP, Captura Semanal, Equipos y Ayuda | ✅ | ✅ |
| Inscribirse a un evento habilitado | ✅ (solo como su propio jugador) | ✅ (también a nombre de otros) |
| Editar jugadores, asistencia, TDP y equipos | — | ✅ |
| Convocatoria, Ajustes y Usuarios | — | ✅ |

## Páginas

### Dashboard

- **Tabla de posiciones:** jugadores activos ordenados por **Puntos**, con su **TDP %** y su **Rating**.
  El color del número de posición indica el lugar: verde del 1 al 12, amarillo del 13 al 16 y rojo del 17
  en adelante.
- **Anuncios:** avisos de la liga. Puedes minimizarlos con **Minimizar ▲** y volver a abrirlos con
  **Mostrar ▼**.
- **Evento:** cuando hay un evento abierto aparece un aviso con la fecha, el lugar y la fecha límite, y un
  botón **Inscribirme** (o **Ver mi inscripción ✓** si ya te inscribiste).

### Roster

Lista de jugadores: nombre (Galáctico), apodo, número de WhatsApp, si está activo, si es **Socio Fundador**
y si fue **sede la temporada anterior**. Solo los administradores pueden editarla.

### TDP

El **TDP** es un bono por antigüedad y participación que multiplica tus puntos. Elige un **Año** para ver
qué jugadores participaron en cada categoría (Año, Pre Temporada, Galas, Partido del Pavo, Anfitrión Gala,
Team Building) y el TDP resultante de cada uno. Abajo se muestran los **pesos** de cada categoría.

Si te inscribiste a un evento y marcaste **Asistiré**, tu participación aparece en el TDP aunque un
administrador todavía no la haya aplicado.

### Captura Semanal

Asistencia de cada fecha de partido (los jueves). Elige la fecha en la lista para ver, por jugador:

| Columna | Significado |
|---|---|
| RSVP | Confirmó asistencia en la convocatoria. |
| Jugó | Llegó y jugó. |
| Sede | Puso la cancha esa fecha. |
| Pago | Pagó su parte de la renta (aplica de abril a septiembre). |
| Tarde | Llegó 5 minutos tarde o más. |
| Cupo ExPat | Un jugador ExPat tiene cupo para jugar esa fecha (no cambia los puntos). |

### Equipos

Muestra los equipos armados para el próximo partido, los suplentes, el último ganador y los equipos
anteriores. Todos los usuarios ven los mismos equipos en cuanto un administrador los arma.

Cómo se arman los equipos:

1. El administrador marca a los jugadores confirmados. Si hay más de 12, juegan los 12 con mayor TDP y el
   resto queda como suplente.
2. Los jugadores se reparten uno por uno, del rating más alto al más bajo, y cada uno va al equipo con
   menos rating acumulado. Así los dos equipos quedan lo más parejos posible.
3. Se respetan las **restricciones** ("estos dos jugadores no pueden ir en el mismo equipo"). Solo los
   administradores las ven y las editan.

El **rating** (1 a 10) refleja el nivel para armar equipos. Al principio se calcula a partir de los Puntos.
Después de cada partido, el administrador marca el equipo ganador: cada jugador del equipo ganador sube
1 punto de rating y cada jugador del perdedor baja 1, sin salir del rango 1–10.

### Eventos e inscripción

Cuando un administrador habilita un evento, aparece en el menú con su nombre y en el Dashboard.

1. Abre el evento. Verás la fecha, el lugar (con enlace al mapa si hay uno), la descripción y la fecha
   límite de inscripción.
2. Si tu cuenta está vinculada a tu jugador, se usa automáticamente. Si no, elige tu jugador en la lista.
3. Marca **Asistiré** si vas a ir y contesta las opciones (por ejemplo, qué vas a llevar). Algunas opciones
   son obligatorias y otras tienen cupo limitado.
4. Presiona **Enviar inscripción**.

Ten en cuenta:

- **Una vez enviada, tu inscripción no se puede modificar.** Si te equivocaste, pide a un administrador que
  la reabra.
- Recibirás un **correo de confirmación** con los detalles del evento y tus respuestas.
- Después de la fecha límite ya no es posible inscribirse.
- En la misma página puedes ver la lista de asistentes y lo que lleva cada uno. Los nombres marcados como
  "(invitado)" son personas sin cuenta que agregó un administrador.
- La columna **Pagó** muestra si un administrador registró el pago de la cuota del evento.
- Asistir a Pre Temporada, Galas o Team Building cuenta para tu **TDP** en esa categoría y año.

## Cómo se calculan los puntos

Cada fecha te da puntos según si confirmaste (RSVP), si jugaste y si fuiste sede:

| RSVP | Jugó | Sede | Puntos de la fecha |
|---|---|---|---|
| Sí | Sí | Sí | 5 |
| Sí | Sí | No | 3 |
| Sí | No | Sí | 1 |
| Sí | No | No | -3 |
| No | Sí | Sí | -1 |
| No | Sí | No | -2 |
| No | No | Sí | 7 |
| No | No | No | 0 |

**Tarjetas** (según el reglamento):

- 1ª llegada tarde en la temporada: **Tarjeta Amarilla**, solo es una advertencia.
- 2ª llegada tarde o más: **Tarjeta Roja**, pierdes los puntos de esa fecha.
- No pagar la renta: **Tarjeta Roja**, pierdes los puntos de esa fecha.

**Puntos totales** = (1 + TDP) × (suma de los puntos de todas las fechas + 7 si fuiste sede la temporada
anterior).

El detalle completo de las fórmulas está en la sección **FFCH Puntuación**, más abajo en esta página.

## Guía para administradores

### Rutina de cada fecha

1. **Antes de editar:** en **Ajustes**, presiona **⬇ Sincronizar desde Firestore** para trabajar sobre la
   versión más reciente.
2. **Convocatoria:** elige la fecha anterior para contar las tarjetas, completa fecha, hora, lugar, temporada
   y número de fecha, presiona **Generar** y luego **Copiar** para pegarlo en WhatsApp.
3. **Equipos:** marca a los jugadores confirmados y presiona **Armar equipos**. Usa **Copiar texto para
   WhatsApp** para compartir la alineación.
4. **Captura Semanal:** después del partido, elige o crea la fecha (**Nueva fecha**) y marca RSVP, Jugó, Sede,
   Pago y Tarde por jugador. Cada casilla se guarda al marcarla.
5. **Resultado:** en **Equipos**, presiona **🟧 Equipo A ganó** o **🔵 Equipo B ganó** para actualizar los
   ratings.
6. **Al terminar:** en **Ajustes**, presiona **⬆ Guardar cambios en Firestore** para que todos vean los
   cambios.

### ¿Cuándo hay que usar "⬆ Guardar cambios en Firestore"?

Algunos cambios se comparten al instante; otros se quedan solo en tu navegador hasta que presionas el botón.

| Acción | ¿Se comparte al instante? |
|---|---|
| Crear, editar, habilitar o deshabilitar un evento | Sí |
| Inscripciones (propias o a nombre de un jugador) | Sí |
| Registrar el pago de la cuota de un evento | Sí |
| Vincular una cuenta con un jugador, cambiar roles (Usuarios) | Sí |
| Aplicar asistencias de eventos al TDP | Sí |
| Armar equipos, marcar el ganador, restricciones (Equipos) | Sí (los ratings también) |
| Roster, Captura Semanal, casillas y pesos de TDP | **No: usa "⬆ Guardar cambios en Firestore"** |

> **Importante:** "⬆ Guardar cambios en Firestore" reemplaza los datos compartidos con la copia de tu navegador.
> Sincroniza antes de editar para no borrar cambios de otro administrador. "⬇ Sincronizar desde Firestore"
> reemplaza tu copia local, así que guarda primero cualquier cambio pendiente.

### Eventos (Ajustes → Eventos)

- **Crear un evento:** elige la categoría (Pre Temporada, Galas o Team Building) y escribe título, descripción,
  fecha y lugar. Opcionalmente agrega un **enlace del lugar** (por ejemplo, Google Maps; debe empezar con
  `https://`) y una **fecha límite de inscripción**. Solo hay un evento por categoría y año.
- **Opciones:** "Asistiré" siempre está incluida. Con **+ Agregar opción** puedes sumar preguntas de tipo
  **Sí / No**, **Lista** (valores separados por coma, por ejemplo "Postre, Ensalada") o **Texto libre**. Cada
  opción puede ser **Obligatoria** y tener un **Cupo** (por ejemplo, solo 2 personas llevan asador).
- **Habilitar:** solo un evento puede estar habilitado a la vez. Con "Ninguno", la página del evento se oculta
  para todos.
- **Eventos pasados:** se archivan solos. **Duplicar al próximo año** copia el evento con la fecha un año
  después para que solo ajustes los detalles.
- **Inscripciones:** ver quién se inscribió, **Reabrir** una inscripción (el usuario puede volver a
  inscribirse), **Aplicar asistencias al TDP**, **Descargar CSV** (se abre en Excel) y **Copiar resumen
  WhatsApp**.
- **Inscribir a un jugador:** puedes inscribir a cualquier jugador que no tenga inscripción, aunque ya haya
  pasado la fecha límite. Si el jugador tiene cuenta vinculada, recibe el correo de confirmación.
- **Agregar invitado:** para personas que van a asistir pero no tienen cuenta ni están en el roster (por
  ejemplo, familiares o amigos). Escribe su nombre en la página del evento (debajo de la lista de asistentes) o
  en Ajustes → Inscripciones. Aparecen en la lista como "(invitado)", no cuentan para el TDP ni para los cupos y
  puedes quitarlos con **Quitar**.
- **Registrar pagos:** marca o desmarca **Pagó** en la lista de asistentes de la página del evento, también
  para invitados. Todos pueden consultar el estado; solo los administradores pueden cambiarlo.
- Las asistencias se suman al TDP automáticamente cuando un administrador abre la página TDP, se inscribe o
  usa **Aplicar asistencias al TDP**. Después de eso puedes desmarcar en TDP a quien no llegó.

### Usuarios

- **Jugador:** vincula cada cuenta con su jugador del roster. Un jugador solo puede estar vinculado a una
  cuenta, y el usuario solo podrá inscribirse a eventos como ese jugador.
- **Rol:** convierte una cuenta en administrador o quítale el rol. Siempre debe quedar al menos un
  administrador.
- **Estado:** deshabilita una cuenta para impedir que inicie sesión. No puedes deshabilitar tu propia cuenta.
- **Enviar correo de restablecimiento:** le llega al usuario un enlace para elegir una contraseña nueva.

### Equipos: restricciones

Una restricción indica que dos jugadores no pueden ir en el mismo equipo (por ejemplo, "Jose no puede ir con
Andrew"). Elige a los dos jugadores y presiona **Guardar restricción**; usa **Eliminar** cuando ya no aplique.
Las restricciones solo las ven los administradores.

### Ajustes: respaldo e importación

- **Descargar JSON:** guarda una copia de seguridad de todos los datos en tu computadora.
- **Cargar JSON:** reemplaza los datos de tu navegador con una copia de seguridad. Luego usa "⬆ Guardar cambios
  en Firestore" si quieres compartirlos.
- **Importar desde los CSV originales:** carga inicial desde el Excel original (solo se usa una vez). Reemplaza
  todos los datos de tu navegador.

## Preguntas frecuentes

**La tabla de posiciones no muestra los últimos cambios.**
La app guarda una copia de los datos en tu navegador la primera vez que entras y no la actualiza sola después.
Si eres administrador, usa **⬇ Sincronizar desde Firestore** en Ajustes. Si no, borra los datos del sitio en tu
navegador y vuelve a iniciar sesión.

**No me puedo inscribir al evento.**
Revisa que la fecha límite no haya pasado y que no tengas ya una inscripción. Si tu jugador ya tiene una
inscripción hecha desde otra cuenta, contacta a un administrador.

**Me equivoqué en mi inscripción.**
Pide a un administrador que la reabra; después podrás inscribirte de nuevo.

**No me llegó el correo de confirmación.**
Revisa la carpeta de spam. Tu inscripción queda guardada aunque el correo no llegue; puedes verla en la
página del evento.

**No veo Convocatoria, Ajustes ni Usuarios en el menú.**
Esas páginas son solo para administradores.
