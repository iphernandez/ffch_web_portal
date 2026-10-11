# FFCH_Puntuacion

Datos y migración del sistema de puntuación de la FFCH, originalmente llevado en
`FFCH - Puntuacion.xlsx`. La app Angular en [`../webApp/`](../webApp/) reemplaza este Excel; esta carpeta
guarda las fuentes originales (para referencia) y los datos versionados que usa la app.

## Archivos

- `FFCH - Puntuacion.xlsx` — Excel original (referencia histórica, ya no se edita).
- `FFCH - Puntuacion - 2026 Puntos.csv` / `FFCH - Puntuacion - TDP.csv` — exportes CSV usados para la
  migración inicial (ver `webApp` → Ajustes → "Importar desde los CSV originales").
- `formulas.txt` — fórmulas originales de Excel documentadas manualmente (base de la migración).
- `data/ffch-puntuacion.json` — **snapshot histórico**, ya no es la fuente de verdad. Hasta 2026-09-20
  la app leía/escribía este archivo vía GitHub API; ahora los datos compartidos viven en un documento
  Firestore (`data/ffch-puntuacion`, ver [`../webApp/README.md`](../webApp/README.md)) y este archivo
  no se sincroniza automáticamente con nada. Se conserva solo como respaldo/referencia del último
  estado conocido antes de la migración; para cargarlo en la app usa Ajustes → "Cargar JSON" y luego
  "⬆ Guardar cambios en Firestore".

## Fórmulas migradas (`webApp`'s `ScoringService`)

Verificadas contra la tabla de leyenda al final de `FFCH - Puntuacion - TDP.csv`
(columnas `Convocado,Jugo,Sede,...,Pts,Casta`):

- `Pts` = árbol de decisión sobre `(RSVP, Jugo, Sede)`:

  | RSVP | Jugó | Sede | Pts |
  |---|---|---|---|
  | 1 | 1 | 1 | 5 |
  | 1 | 1 | 0 | 3 |
  | 1 | 0 | 1 | 1 |
  | 1 | 0 | 0 | -3 |
  | 0 | 1 | 1 | -1 |
  | 0 | 1 | 0 | -2 |
  | 0 | 0 | 1 | 7 |
  | 0 | 0 | 0 | 0 |

- `PtosFecha` = si no jugó, `Pts` se mantiene; si jugó, se pone en `0` cuando hay sanción esa fecha
  (tarjeta roja por tardanza o por no pago). Ver reglas de tarjetas abajo.
- `Puntos` (total) = `(1 + TDP%) * SUMA(PtosFecha de todas las fechas [+ PtsTemporadaAnterior])`.
- `PtsTemporadaAnterior` = `7` si el jugador fue sede la temporada anterior, si no `0`. **Se incluye**
  dentro de la suma que alimenta `Puntos` (decisión confirmada).
- `TDP%` = suma ponderada de participación histórica por categoría/año: Año (2%), Pre temporada (1%),
  Galas (1%), Socios Fundadores (2%), Partido del Pavo (1%), Anfitrión Gala (1%), Team Building (1%,
  **peso independiente** del de Anfitrión Gala aunque el Excel original reusaba esa misma celda). Los
  pesos y participaciones por año se administran en la página TDP (solo administradores).

  > **"Socios Fundadores" es distinto a las demás categorías**: en el Excel original es una **única
  > columna** (no una por año, a diferencia de Año/Pre temporada/Galas/Partido del Pavo/Anfitrión
  > Gala/Team Building). Por eso en la app es un **campo único por jugador** (`Player.socioFundador`,
  > editable en Roster → tabla de Jugadores), no una entrada repetible en el historial TDP por año.

  > **Verificado con datos reales**: la fila de Rafa en `FFCH - Puntuacion - TDP.csv` (TDP mostrado =
  > 56%) reproduce exactamente ese 56% al aplicar la fórmula documentada en `formulas.txt`
  > (`sum(D:S)*B49 + sum(T:AB)*B50 + sum(AC:AJ)*B51 + sum(AK)*B52 + sum(AL:AM)*B53 + sum(AN:AO)*B54 +
  > sum(AP:AQ)*B54`). Al hacerlo se encontró que la columna `AK` (la única columna del término
  > `sum(AK)*B52`, es decir, Socio Fundador) **no tiene año en el encabezado exportado** (celda en
  > blanco) pero **sí es data real**, no una columna separadora — las etiquetas de grupo combinadas
  > ("Socios fundadores", "Partido del Pavo", "Afitrion Gala", "Team Building") en la fila 1 del Excel
  > están corridas una columna a la derecha respecto a lo que la fórmula realmente pondera. El
  > importador (`CsvImportService`) ubica estas columnas por ancho fijo relativo a la columna "TDP"
  > (16, 9, 8, 1, 2, 2, 2) en vez de por las etiquetas de grupo, y está cubierto por una prueba
  > unitaria (`csv-import.service.spec.ts`) que reproduce el caso de Rafa.

## Reglas de tarjetas (`reglamento.md`)

- 1ª tardanza (5+ min) en la temporada → Tarjeta Amarilla (solo advertencia, sin penalización de puntos).
- 2ª tardanza (o más) → Tarjeta Roja **esa fecha** → `PtosFecha = 0` esa fecha únicamente.
- No pagar la renta antes de la convocatoria → Tarjeta Roja → `PtosFecha = 0` esa fecha.

> Nota de migración: los CSV originales combinaban pago y tardanza en una sola columna
> (`Pago`/`Pago/Tarde`), por lo que el historial migrado no distingue cuál regla aplicó en el pasado
> (`tarde` queda `null` para fechas migradas). Desde la fecha de migración en adelante, la app captura
> `Pago` y `Tarde` por separado y aplica la lógica de arriba automáticamente.

## Campos nuevos (no existían en el Excel)

- `cupoExPat` (por jugador/fecha) — indica si un jugador ExPat puede jugar esa fecha; se captura en
  **Captura Semanal** y no modifica la fórmula de puntos.
- `tarde` (por jugador/fecha) — booleano capturado semana a semana para automatizar las tarjetas
  amarilla/roja por tardanza (antes solo había contadores agregados por temporada en `config.json`).
- `socioFundador` ya existía conceptualmente en el Excel (columna `AK` de TDP.csv), pero ahora es un
  campo explícito en `Player` en vez de vivir mezclado en la tabla de historial TDP por año.

## Re-ejecutar la migración

Si necesitas volver a importar desde cero: `webApp` → **Ajustes → Importar desde los CSV originales**,
selecciona ambos archivos CSV de esta carpeta. Esto **reemplaza** todos los datos locales (IndexedDB) —
revisa las advertencias que muestra el importador (jugadores no encontrados, fechas no reconocidas, etc.)
antes de sincronizar los cambios a GitHub.
