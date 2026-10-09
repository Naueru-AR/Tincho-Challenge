# Tincho Challenge — leaderboard

Página con el rango, winrate e historial de SoloQ de cada participante del torneo.
Todo corre gratis en **Cloudflare Pages** (sitio + funciones de servidor).

## Qué APIs usa

| Para qué | API | ¿Necesita key? |
|---|---|---|
| Riot ID → PUUID | Riot `account-v1` (`americas`) | Sí |
| Rango, LP, victorias y derrotas | Riot `league-v4` `entries/by-puuid` (`la2`) | Sí |
| Ícono de la cuenta | Riot `summoner-v4` `summoners/by-puuid` (`la2`) | Sí |
| Historial de partidas del torneo | Riot `match-v5` (`americas`, cola 420 = SoloQ) | Sí |
| Imágenes de campeones e íconos de cuenta | Data Dragon (CDN de Riot) | No |
| Emblema de cada rango | Community Dragon (archivos del cliente del juego) | No |
| Perfil completo de cada jugador | Link a OP.GG | No |

### ¿Y la API de OP.GG?
OP.GG **no tiene una API REST pública** para sitios web. Lo que sí publicó es el
**OP.GG MCP Server** (`https://mcp-api.op.gg/mcp`), pensado para conectar sus datos
a asistentes de IA (por ejemplo, Claude), no para alimentar una página pública.
Por eso los datos salen de la API oficial de Riot (que es la misma fuente que usa
OP.GG) y cada Riot ID enlaza a su perfil en OP.GG.

## Estructura

```
public/               ← el sitio (HTML, CSS, JS) + participants.json
  index.html, app.js  página principal
  podio.html, podio.js  podio final por bracket
  premios.html, premios.js  premios del torneo
  admin.html, admin.js  panel privado del organizador
  shared.js           lo que comparten las dos páginas
functions/api/        ← endpoints que corren en Cloudflare (esconden la API key)
  leaderboard.js      GET /api/leaderboard
  player/[puuid].js   GET /api/player/:puuid
  diag.js             GET /api/diag (revisa la API key sin mostrarla)
  admin.js            GET /api/admin (panel del organizador, pide clave)
lib/riot.js           cliente de Riot con caché (KV + Cache API)
lib/lp.js             LP por partida (fotos del rango en Cloudflare KV)
lib/duo.js            posibles dúos (últimas 12 partidas) e histórico de alertas
lib/demo.js           datos de ejemplo
```

La API key **nunca llega al navegador**: el navegador le pide a `/api/...` y la
función de Cloudflare es la que habla con Riot. Además se cachean las respuestas
para no pasarse de los límites (ver "Límites del plan gratis").

## Configurar el torneo

Editá `public/participants.json`:

```json
{
  "title": "Tincho Challenge",
  "edition": "Edición I",
  "start": "2026-10-01T00:00:00-03:00",
  "end":   "2026-11-01T00:00:00-03:00",
  "platform": "la2",        // LAS. LAN = la1, BR = br1, NA = na1, EUW = euw1
  "region": "americas",     // europe para EUW, asia para KR
  "opggRegion": "las",
  "players": [
    { "alias": "Kairo", "riotId": "Kairo#SYS" },
    { "alias": "Tomi", "riotId": "NombreEnJuego#TAG" },
    { "alias": "Nacho", "riotId": "Otro#LAS", "baseline": { "wins": 12, "losses": 9 } }
  ]
}
```

- `alias` es el nombre que se muestra; `riotId` es el `Nombre#TAG` real.
- Por ahora hay 6 cuentas cargadas de prueba (`Kairo#SYS` y cinco amigos, todas de
  LAS). Para sumar jugadores, agregá una línea por cada uno en `players`. No uses Riot IDs inventados de relleno:
  pueden coincidir con cuentas reales de otra gente.
- `baseline` (opcional): las victorias/derrotas que tenía el jugador **el día que
  empezó el torneo**. Si lo cargás, el V–D y el winrate cuentan solo lo jugado
  durante el torneo. Si no, se muestra el total de la temporada.

## Conseguir la API key de Riot

1. Entrá a https://developer.riotgames.com con tu cuenta de Riot.
2. Para probar, copiá la **Development API Key** (vence cada 24 h).
3. Para dejar la página online, registrá un producto → **Personal API Key**.
   No vence, alcanza para un torneo entre amigos y Riot no permite mantener un
   sitio público con la key de desarrollo. La aprobación puede tardar unos días,
   así que pedila apenas puedas.

## Publicarla gratis en Cloudflare Pages

1. El código ya está en GitHub: https://github.com/Naueru-AR/Tincho-Challenge
   (ver [Repositorio](#repositorio)).
2. En https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** y elegí el repo.
3. Configuración del build:
   - Framework preset: **None**
   - Build command: *(vacío)*
   - Build output directory: `public`
4. **Settings → Variables and Secrets** → agregá `RIOT_API_KEY` como *Secret*
   (en Production y Preview).
5. Deploy. Te queda una URL tipo `https://soloq-challenge.pages.dev`.

Cada vez que hagas push (por ejemplo, para cambiar participantes) se republica sola.

Sin `RIOT_API_KEY`, o agregando `?demo` a la URL, la página muestra datos de ejemplo.

### Si la tabla muestra "Riot respondió 401" o 403

Abrí `https://TU-SITIO.pages.dev/api/diag`. No muestra la key, solo su forma y lo
que contesta Riot:

- `present: false` → la variable no existe en ese entorno (o falta redeployar).
- `validFormat: false` → el valor guardado no es una key limpia. Tiene que medir 42
  caracteres (`length`), empezar con `RGAPI-` y no tener espacios, comillas ni `=`.
- `riotStatus: 401` con formato válido → Riot no reconoce esa key (se regeneró otra
  después, o se copió una vieja).
- `riotStatus: 403` → la key venció (la de desarrollo dura 24 h).

### Al cambiar de API key

Riot cifra los PUUID con cada key: uno obtenido con una key da **400** si se usa con
otra. Por eso la caché se guarda separada por key (`lib/riot.js`) y al cambiarla no
hay que hacer nada más. Lo único que se pierde son los LP por partida ya guardados
en KV, porque quedan asociados a los PUUID de la key anterior.

## Probarla en tu computadora

Necesitás **Node.js** (trae `npm`). En Windows se instala con:

```bash
winget install --id OpenJS.NodeJS.LTS -e
```

Después de instalarlo abrí una terminal nueva, para que reconozca `node` y `npm`.
El proyecto está probado con Node 24 LTS y wrangler 4.

```bash
npm install
npm run dev        # abre http://localhost:8788
```

`npm install` baja `wrangler` (el servidor de prueba de Cloudflare) a `node_modules/`.
Las versiones exactas quedan fijadas en `package-lock.json`, que sí va al repo.

Así como está muestra los datos de ejemplo. Para ver datos reales, creá a mano un
archivo `.dev.vars` en la raíz del proyecto (podés copiar `.dev.vars.example`) con
tu key:

```
RIOT_API_KEY=RGAPI-tu-key
```

Ahí también va `ADMIN_KEY`, la clave del panel del organizador para pruebas locales.

- `.dev.vars` **no viene con el proyecto** y está en el `.gitignore`: guarda tu key
  y nunca se sube a GitHub. Cada uno crea el suyo.
- Solo sirve para probar en local. El sitio publicado usa el secret `RIOT_API_KEY`
  de Cloudflare.
- En Windows crealo desde el editor y no con `echo ... > .dev.vars`: PowerShell
  puede guardarlo en una codificación que wrangler no lee bien.

## Repositorio

El proyecto vive en https://github.com/Naueru-AR/Tincho-Challenge, rama `main`.
La carpeta local ya está conectada a ese repositorio (`origin`).

Para guardar y publicar un cambio:

```bash
git add -A
git commit -m "Descripción del cambio"
git push
```

La primera vez que hacés push desde una PC, Git abre una ventana para iniciar
sesión en GitHub; después queda guardado.

### Backups de producción

Antes de un cambio grande se guarda una copia de lo que está publicado como
*tag* de Git. Los que hay:

- `backup-produccion-2026-10-09`: el sitio antes del rediseño (Top 3, menú, podio
  final, límite diario).
- `backup-produccion-2026-10-09-b`: el sitio con el rediseño, antes de agregar el
  panel del organizador y el botón Admin.
- `backup-produccion-2026-10-09-c`: con el panel del organizador, antes de pasar la
  caché a KV (el panel fallaba con "Too many subrequests").
- `backup-produccion-2026-10-09-d`: con la caché en KV y el panel revisando las
  últimas 12 partidas, antes de los refuerzos para 20 jugadores.

Para ver los backups y volver a uno:

```bash
git tag -l "backup-*"
```

```bash
git revert --no-commit backup-produccion-2026-10-09..HEAD
```

El segundo comando deja el proyecto como estaba en ese backup, sin borrar el
historial; después hay que hacer `git commit` y `git push` para publicarlo.

No se suben al repo (están en el `.gitignore`): `node_modules/`, `.wrangler/`,
`.dev.vars` y `.claude/` (configuración local de Claude Code).

## Top 3 y podio final

**Top 3** (página principal, arriba de la tabla): los tres primeros de la tabla
general, sin separar por bracket. Cada tarjeta muestra el ícono de la cuenta, con
una corona en la esquina para el primero, una medalla de plata para el segundo y
una de bronce para el tercero. Si hay menos de tres jugadores con
rango, los lugares que faltan dicen "Vacante".

**Podio final** (`podio.html`): una página aparte con dos podios, High Elo y Low
Elo. Se habilita sola cuando termina el torneo (fecha `end`): recién ahí aparece
el botón "Ver el podio final" en el encabezado. Antes de esa fecha la página solo
avisa cuándo se habilita. Para verla antes y probarla, abrí `/podio?preview`.

### Ícono de la cuenta

En el Top 3, en el podio final y en la tabla de posiciones cada jugador aparece
con el **ícono de invocador** que tiene puesto en su cuenta de LoL (Riot
`summoner-v4`, en caché 6 horas; la imagen sale de Data Dragon). Al pasar el
mouse se resalta y al hacer clic abre su perfil en OP.GG en otra pestaña. Si el
ícono no se puede cargar, se muestra la inicial del jugador.

El corte entre brackets se define en `participants.json`:

```json
"highEloFrom": { "tier": "DIAMOND", "rank": "III" }
```

- **High Elo**: desde ese rango inclusive (Diamante III o más).
- **Low Elo**: todo lo que esté por debajo (Diamante IV o menos).
- El bracket se calcula con el **rango actual**. Para dejar fijo a un jugador,
  agregale `"bracket": "high"` o `"bracket": "low"`.
- Los jugadores sin rango no entran en ningún podio.

El orden de la página principal es: encabezado, Top 3, tabla de posiciones y, al
final, la escalera.

## Tabla de posiciones

Cada fila muestra el puesto, el ícono de la cuenta con el nombre, el rango y el
winrate:

- **Rango**: lleva el emblema oficial del rango (Hierro, Bronce… Retador) al lado
  del nombre y los LP. Las imágenes salen de Community Dragon; si alguna no carga,
  queda solo el texto.
- **Winrate · V / D**: el porcentaje (verde si es 50 % o más, rojo si es menos),
  las victorias y derrotas ("101V · 97D") y, debajo, una barra partida en dos: el
  tramo verde es proporcional a las victorias y el rojo a las derrotas.

## Menú y premios

La barra superior tiene el escudo (lleva al inicio) y tres opciones:

- **Ranking**: baja directo a la tabla de posiciones.
- **Podio**: abre `podio.html` (el podio final por bracket).
- **Premios**: abre `premios.html`.

Los premios se cargan a mano en `participants.json`. Mientras la lista esté vacía,
la página dice que todavía no están anunciados:

```json
"prizes": [
  { "title": "1.º High Elo", "prize": "$50.000", "note": "Opcional: una aclaración" },
  { "title": "1.º Low Elo", "prize": "$30.000" }
]
```

## Diseño

Todo el estilo está en `public/styles.css`; los colores son variables en `:root`.

- **Escudo de la barra superior**: el escudo con la T lleva el nombre del torneo
  adentro, en dos cintas cortas que apenas sobresalen (las primeras palabras en la
  dorada, la última en la de abajo). Sale del `title` de `participants.json` y se comprime solo si es largo.
  Lleva al inicio y, al pasar el mouse, se inclina, brilla y le cruza un destello.
- **Encabezado centrado**: título en itálica con el año "fantasma" detrás (solo
  contorno), fechas, cantidad de jugadores, cuenta regresiva y botón.
- **Sol de rayos dorados** girando muy lento detrás del título (`.hero-rays`). Se
  detiene si el sistema pide menos animaciones.
- **Formas inclinadas**: las cajas de la cuenta regresiva, el botón y los títulos
  comparten la misma inclinación (`--slant`).
- **Pie de página**: letra chica, con el aviso legal de Riot y el copyright
  "© 2026 Tincho Challenge". El año está escrito a mano en los tres `.html`.
- **Colores**: fondo oscuro y dorado como base; el celeste (`--sky`) es el acento
  secundario. El rojo queda solo para derrotas.

## Límite de partidas por día

El torneo tiene un tope de partidas por día, que se define en `participants.json`:

```json
"dailyLimit": 12
```

El historial de cada jugador es **solo del día de hoy**: se reinicia a la
medianoche y no muestra partidas de días anteriores. Al abrirlo aparece una franja
de resumen de todo el ancho y, debajo, la lista de las partidas de hoy:

- **A la izquierda**: cuántas partidas jugó sobre el límite ("7 de 12") y si le
  quedan, si llegó al límite o si lo superó. Si lo superó, el número y la barra de
  12 tramos se ponen en rojo, con el cartel "Límite superado por N".
- **A la derecha**: ganadas, perdidas, remakes y LP sumados de esas mismas
  partidas de hoy.

Cómo se cuenta:

- El día va de 00:00 a 23:59 en la zona horaria del torneo, que se toma de la
  fecha `start` (`-03:00` es Argentina).
- Una partida cuenta para el día en que **empezó**.
- Las **remakes no cuentan** como partidas jugadas ni para el límite; se listan y
  se informan aparte.
- Los LP del día suman solo las partidas que tienen LP registrados (ver "LP por
  partida").
- Se muestran hasta 30 partidas por día.

## Panel del organizador (privado)

En `/admin` hay un panel que pide una clave. Se entra con el botón **Admin**
de la barra superior (antes ahí estaba "Actualizar"; la tabla se sigue
actualizando sola cada 5 minutos). Sirve para controlar las reglas del torneo.
**Solo muestra a los jugadores que tienen alguna alerta**; si nadie tiene, lo dice.
Abre al instante, porque no le consulta nada a Riot: lee lo que el sitio fue
guardando solo (ver "Cómo funciona"). Para cada jugador con alertas hay dos partes:

- **Ahora**: las sospechas de dúo vigentes, calculadas sobre sus **últimas 12
  partidas**. Incluye las de nivel medio y alto.
- **Histórico**: las sospechas **altas** y los días con el límite superado, cada
  una con la fecha y hora en que se detectó. Quedan guardadas aunque el jugador
  siga jugando y esas partidas salgan de las últimas 12.

Las reglas:

- **Posible dúo** (el dúo está prohibido). Riot no informa si una partida se jugó
  en dúo, así que se detecta por estadística, igual para otros participantes que
  para desconocidos. Que te toque alguien una vez pasa; seguido, no. Salta una
  sospecha cuando alguien estuvo en el mismo equipo que el jugador:

  | Nivel | Cuándo |
  |---|---|
  | **Alta** | 3 o más partidas **seguidas**; o 5 o más juntos sin enfrentarse nunca; o 2 seguidas si el otro es un participante del torneo |
  | **Media** | 2 partidas **seguidas**; o 4 en un mismo día, aunque no sean seguidas |

  Cada sospecha muestra cuántas veces se cruzaron, cuántas en el mismo equipo y
  cuántas en contra, y **qué tan probable es que sea casualidad**. Si dos jugadores
  caen en la misma partida por azar, quedan en el mismo equipo 4 de cada 9 veces;
  un dúo, siempre. Por eso 3 veces juntos y ninguna en contra pasa por casualidad
  el 9 % de las veces, 4 veces el 4 % y 5 veces el 1,7 %. Sigue siendo una
  **alerta para revisar, no una prueba**: en elo alto hay poca gente en cola y se
  repiten compañeros. (En Maestro o más, además, Riot no permite hacer cola en dúo.)
- **Límite diario superado**: los días en que jugó más partidas que el límite, con
  cuántas se pasó. Se cuenta partida por partida a medida que las juega, así que
  no depende de la ventana de 12. (El historial público solo muestra hoy.)

Las remakes no cuentan ni cortan una racha. Los umbrales se cambian en
`participants.json`:

```json
"duo": { "streak": 2, "highStreak": 3, "perDay": 4, "neverAgainst": 5 }
```

### Activarlo

1. En Cloudflare → **Configuración → Variables y secretos** → **Agregar** un
   *Secreto* llamado `ADMIN_KEY`, con una clave larga que elijas (en Producción).
2. Reimplementá, como con cualquier variable nueva.
3. Entrá a `https://TU-SITIO.pages.dev/admin` y poné esa clave.

`/api/diag` muestra `adminKey: true` cuando está configurada. Sin `ADMIN_KEY` el
panel no abre.

### Cómo funciona

La clave se guarda solo en esa pestaña del navegador y viaja en cada pedido; el
servidor la compara con el secret y no responde nada sin ella.

La revisión no la hace el panel sino el sitio, solo y de a poco (`lib/duo.js`),
para que alcance aunque haya 20 jugadores:

1. Cada vez que se recalcula la tabla (el cron lo hace cada 5 minutos) se mira,
   por jugador, si jugó algo nuevo. **Si no jugó, no se le consulta nada a Riot.**
2. Si jugó, se trae solo la partida nueva (2 consultas) y se vuelve a analizar la
   ventana de sus últimas 12 partidas. Nunca se revisa el historial completo.
3. Las sospechas altas y los días pasados del límite se anotan en el histórico.

Por cada pasada se gastan como mucho 12 consultas en esto; si muchos jugadores
terminan una partida a la vez, a los que no les toca se los revisa en la pasada
siguiente. Todo se guarda en KV, una clave por jugador (`watch:<puuid>`).

Consecuencias de este diseño:

- El panel **necesita el cron y el KV** andando; sin ellos no hay nada guardado.
- Solo ve las partidas jugadas desde que se activó (y las últimas 12 anteriores,
  que carga de a 4 por pasada). No reconstruye lo que pasó antes.
- Una sospecha **media** que nunca llega a alta no queda en el histórico: se ve
  mientras esté dentro de las últimas 12 partidas y después desaparece.

Para probarlo en tu computadora, `ADMIN_KEY` va en `.dev.vars` (hay un ejemplo en
`.dev.vars.example`).

## Remakes

Las partidas que terminan en remake (menos de 5 minutos o rendición temprana)
aparecen en el historial marcadas como **Remake**, en gris, y no cuentan como
victoria ni derrota en el resumen ni en los LP.

## LP por partida (+25 / −18)

La API de Riot **no informa cuántos LP dio cada partida**. Se calculan como lo hace
OP.GG: cada vez que se consulta la tabla se guarda una "foto" del rango de cada
jugador en **Cloudflare KV** (gratis) y, cuando aparece una partida nueva, la
diferencia entre las dos fotos son los LP de esa partida (`lib/lp.js`).

- Solo se registran partidas jugadas **después** de activar esto.
- Si alguien juega 2 partidas seguidas sin que nadie consulte la tabla, no se puede
  saber cuánto dio cada una y esas quedan sin LP (se muestra V o D). Por eso conviene
  un cron que consulte la tabla cada 5 minutos (ver abajo).
- Sin KV configurado la página funciona igual, solo que sin LP por partida.

### Activar KV
En este proyecto **ya está activado** (namespace `tincho-lp`, binding `LP` en
`wrangler.toml`). Para comprobarlo, `/api/diag` muestra `lpBinding: true` y cuántos
jugadores tienen foto guardada (`lpSnapshots`). Los pasos, por si hay que rehacerlo:

1. En Cloudflare → **Storage & Databases → KV → Create** → nombre `tincho-lp`.
   Copiá el **ID** del namespace.
2. Agregá esto al final de `wrangler.toml` (con tu ID) y hacé push:
   ```toml
   [[kv_namespaces]]
   binding = "LP"
   id = "EL-ID-DEL-NAMESPACE"
   ```

### Cron cada 5 minutos (gratis)
En Cloudflare → **Workers & Pages → Create → Worker** → "Hello World" → Deploy.
Editá el código, pegá esto (con tu URL) y deploy:
```js
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch("https://TU-SITIO.pages.dev/api/leaderboard"));
  },
};
```
Después en el Worker → **Settings → Trigger events → Add → Cron trigger** → `*/5 * * * *`.

## Límites del plan gratis

Hay tres topes que condicionan cómo está hecho el sitio:

| Tope | Cuánto | Cómo se respeta |
|---|---|---|
| Cloudflare: consultas por pedido | 50, contando cada `fetch` a Riot **y cada lectura o escritura de la Cache API** | Cada pedido tiene un tope propio de 42 consultas a Riot; la Cache API se usa unas pocas veces por pedido y lo demás va a KV, que tiene un tope aparte de 1.000 |
| Riot (key personal) | 20 consultas por segundo y 100 cada 2 minutos | Todas las consultas pasan por un regulador de 15 por segundo; la tabla se recalcula como mucho cada 2 minutos |
| Cloudflare KV | 100.000 lecturas y 1.000 escrituras por día | Solo se guarda lo que dura: cuentas, íconos, partidas terminadas, los LP y la revisión del panel |

Qué se guarda y cuánto dura:

- **Respuesta de la tabla y del historial**: 2 minutos (Cache API).
- **Cuenta → PUUID**: 7 días (KV).
- **Ícono de la cuenta**: 24 horas (KV).
- **Partidas terminadas**: 30 días (KV), achicadas a los campos que usa el sitio.
- **Rango y LP actuales**: no se guardan por separado; se piden a Riot en cada
  recálculo de la tabla (1 consulta por jugador).

Los vencimientos llevan un margen al azar (hasta 25 % más), para que no venza todo
junto en la misma pasada.

### Con 20 jugadores

Recalcular la tabla cuesta 1 consulta a Riot por jugador: 20 de las 42 posibles.
Lo que sobra se usa, por prioridad, en:

1. Cuentas y rangos (imprescindible).
2. Íconos que haya que renovar.
3. En segundo plano y de a un jugador: los LP de la partida nueva y la revisión
   del panel.

Si las consultas no alcanzan (por ejemplo, muchos jugadores terminan una partida
a la vez, o es el primer arranque), **nada se rompe**: lo que no entró queda para
la pasada siguiente y se completa solo. Lo único que se demora es el dato de fondo
(un ícono nuevo, los LP de esa partida, la revisión del panel); el rango siempre
sale en la misma pasada.

### Si Riot falla o frena las consultas

- Si Riot responde "esperá" (429), se espera y se reintenta una vez.
- Si igual no se puede consultar a un jugador, **la tabla lo muestra con su último
  dato bueno** en lugar de un error, y esa respuesta no se guarda en caché, así la
  próxima visita vuelve a intentarlo.

### Cuotas diarias

Cada partida que juega un participante cuesta 3 escrituras de KV (la partida, la
foto de LP y la revisión del panel). Con 20 jugadores a 12 partidas por día serían
720 de las 1.000 diarias: entra, pero sin mucho margen. Si un día se agotan, el
sitio sigue funcionando, solo que sin guardar nada nuevo hasta el día siguiente.

El techo práctico del plan gratis ronda los **25 participantes**. Para más, hay
que pasar al plan pago de Cloudflare (sube el tope de 50 a 10.000 consultas por
pedido) y pedirle a Riot una key con más cupo.

## Créditos

SoloQ Challenge no está respaldado por Riot Games. League of Legends y Riot Games
son marcas registradas de Riot Games, Inc.
