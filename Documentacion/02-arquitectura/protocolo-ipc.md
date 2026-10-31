# Protocolo IPC: Rust (Tauri) ⇄ Julia (sidecar)

> JSON-RPC 2.0 sobre stdio, formato NDJSON (un objeto JSON por línea, `\n`).

## Por qué JSON-RPC sobre stdio

- **Cero dependencias**: no abre puertos, no necesita red (seguro por defecto)
- **Testable**: `echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | ./mathesis-engine`
- **Soporte oficial**: `tauri-plugin-shell` lee stdout del sidecar línea a línea
- **Suficiente**: el volumen de datos (arrays de plot) cabe en JSON; si un día
  no cabiera, se añade socket local solo para datos (ADR-008)

## Mensajes de ejemplo

### Handshake

```json
→ {"jsonrpc":"2.0","id":1,"method":"hello","params":{"protocolVersion":1,"appVersion":"0.1.0"}}
← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"engineVersion":"0.1.0","julia":"1.12.6"}}
```

### Evaluar una celda

```json
→ {"jsonrpc":"2.0","id":2,"method":"eval_cell","params":{
     "cellId":"c7",
     "ast":["Sqrt",["Add",["Power","x",2],1]],
     "env":{"xi":{"value":0.99,"unit":"1"},
            "f":{"def":["Asin",["Power","Symbol","x",2]],"args":["x"]}},
     "x":{"value":0.5,"unit":"m"}}}
← {"jsonrpc":"2.0","id":2,"result":{
     "status":"ok",
     "value":"1.118033988749895",
     "unit":"1",
     "latex":"\\sqrt{1.25}",
     "type":"real"}}
```

### Error matemático (no es error RPC)

```json
← {"jsonrpc":"2.0","id":2,"result":{
     "status":"error",
     "error":{"code":"DIV_ZERO","message":"División entre cero","cellId":"c9"}}}
```

### Evaluar documento completo (al cargar)

`changedCellIds` (opcional) → **evaluación incremental**: el engine re-evalúa
solo las celdas cambiadas + las que definen los mismos símbolos (sombreado) +
las que usan sus símbolos, en cascada; el resto sale de la caché de la
evaluación anterior (`recomputed` lista lo re-evaluado; `"all"` = completa).
`settings.digits` configura los dígitos significativos del formato.

```json
→ {"jsonrpc":"2.0","id":3,"method":"eval_document","params":{
     "cells":[…],
     "changedCellIds":["c7"],
     "settings":{"digits":6}}}
← {"jsonrpc":"2.0","id":3,"result":{"cells":[
      {"cellId":"c1","status":"ok","value":"0.99","unit":"1"},
      {"cellId":"c2","status":"ok","value":"…","unit":"m"}
   ],
   "definitions":{"a":2.0}, "functions":["f"],
   "recomputed":["c7","c8"]}}
```

### Solicitar datos de un gráfico

Fase 1 (implementado): UNA expresión por llamada con la variable libre
muestreada; `null` en `y` = gap (dominio inválido). Para gráficos de 2
funciones el frontend hace 2 llamadas con el MISMO rango y concatena series
(la x es idéntica por construcción). Las `env` son las `definitions` del
documento (variables numéricas).

```json
→ {"jsonrpc":"2.0","id":4,"method":"plot_data","params":{
     "ast":["Sin","x"],"xFrom":-10,"xTo":10,"steps":500,"varName":"x",
     "env":{"a":2}}}
← {"jsonrpc":"2.0","id":4,"result":{
     "status":"ok",
     "x":[-10.0,-9.9799,…],
     "y":[-0.544,…,null,…],
     "nonFinite":3,"from":-10.0,"to":10.0}}
```

(Contrato futuro multi-serie con `context` de celdas y funciones de usuario —
ver esquema histórico más abajo — pendiente de la evaluación incremental.)

### Exportar (LaTeX — ✅ implementado Fase 2)

`export` con `kind:"latex"`: el frontend manda `doc.cells` con **latex + ast**
(parse canonical:false); Julia evalúa el doc y devuelve un `.tex` con
`\[ latex = resultado \mathrm{unidad} \]`, texto escapado y errores marcados
como `\text{(error: CÓDIGO)}`. `kind:"figure"` (PNG/SVG vía CairoMakie) queda
pendiente.

```json
→ {"jsonrpc":"2.0","id":5,"method":"export","params":{
     "kind":"latex","doc":{"title":"Mi doc","cells":[
       {"cellId":"a","type":"expression","latex":"a=2","ast":["Equal","a",2]}]}}}
← {"jsonrpc":"2.0","id":5,"result":{"status":"ok",
     "content":"\\documentclass…\\end{document}\n",
     "mime":"application/x-latex","filename":"Mi_doc.tex"}}
```
(Guardado en disco vía comando Tauri `doc_export` con diálogo "Guardar como".)

### Cancelar evaluación en curso

```json
→ {"jsonrpc":"2.0","id":7,"method":"cancel","params":{"id":4}}
```

### Notificaciones del engine (sin `id`)

```json
← {"jsonrpc":"2.0","method":"progress","params":{"cellId":"p1","frac":0.4}}
← {"jsonrpc":"2.0","method":"ready","params":{}}
← {"jsonrpc":"2.0","method":"log","params":{"level":"info","msg":"..."}}
```

## Métodos del motor (catálogo)

| Método | Params | Result |
|---|---|---|
| `hello` | protocolVersion, appVersion | engineVersion, julia |
| `ping` | — | pong |
| `eval_cell` | cellId, ast, env | status, value, unit, latex, type |
| `eval_document` | cells[], changedCellIds?, settings? | cells[], definitions, functions, recomputed |
| `plot_data` | ast, xFrom, xTo, steps, varName, env | x[], y[] (null=gap), nonFinite |
| `export` | kind(latex\|figure\|mathjax), doc/cellId, format, theme | mime, data |
| `simplify` | ast | latex simplificado (para botón "simplificar") |
| `cancel` | id | ack |
| `shutdown` | — | ok (termina el proceso limpio) |

## Manejo de errores RPC

| Código | Significado |
|---|---|
| `-32700` | JSON inválido |
| `-32600` | Petición malformada |
| `-32601` | Método desconocido |
| `-32602` | Params inválidos |
| `-32000` | Error interno del engine (crash capturado) |
| `-32001` | Timeout de evaluación (soft-limit configurable) |

Los **errores matemáticos** (división por cero, raíz de negativo, unidad
incompatible) **NO** son errores RPC: van en `result.status = "error"` con un
código de dominio (`DIV_ZERO`, `UNIT_MISMATCH`…), para que la UI los pinte
como "error en la celda", no como fallo del sistema.

### Códigos de dominio (result.status="error")

| Código | Significado |
|---|---|
| `DIV_ZERO` · `UNDEFINED_VAR` · `DOMAIN` · `NAN` · `INFINITY` | Fase 0/1 |
| `UNIT_MISMATCH` | unidades incompatibles (`1 m + 1 s`, `→` entre dimensiones distintas, `sin(2 m)`) |
| `UNIT_AFFINE` | operación inválida con unidad affine (`100 °C + 50 °C` — usar `→` para convertir) |
| `UNIT_PARSE` | unidad desconocida en `env`/settings round-trip |
| `UNIT_OP` | operador sin definir para cantidades |
| `LATEX_INCOMPLETE` | LaTeX roto (nodo `Error` de MathLive) |
| `ARITY` · `RECURSION` · `FUNC_AS_VALUE` · `INVALID_AST` · `INVALID_CTX` · `UNKNOWN_OP` · `UNSUPPORTED` | estructura/AST |

### Unidades (Fase 2)

- Resultado: `{status:"ok", value:"1000", unit:"m", …}` — `unit:"1"` = adimensional.
- `definitions`: `{a: 5.0}` o `{a: {value: 5.0, unit: "m"}}` — el frontend pinta
  la columna *Dim* del Inspector y `plot_data` reconstruye la cantidad desde
  `env` con el parser de unidades (`"m s^-1"`, `"km"`, `"°C"`, `"bit"`…).

## Ciclo de vida y watchdog (lado Rust) — ✅ implementado (Fase 1)

1. Al abrir la app: `spawn` con resolución de ruta (env `MATHESIS_ENGINE` →
   recurso `engine-runtime/bin/mathesis-engine` (release) → wrapper dev
   `binaries/mathesis-engine-<triple>`)
2. Heartbeat: `ping` cada 30 s; si no responde en 10 s → muerto
3. Si el sidecar muere (EOF de stdout o ping fallido): reinicio con backoff
   1s/2s/4s (máx. 3); eventos al frontend: `engine-status`
   (`{ready, reason: restarting|restarted|dead}`) y `engine-ready`;
   al recibir `restarted` el frontend re-evalúa el documento
4. Al cerrar la app: `shutdown` RPC (timeout 2 s) → kill
5. Tras 3 fallos consecutivos de reinicio → evento `dead` (la UI muestra
   "sin motor Julia"; el watchdog reintenta en el siguiente ciclo)

## Límites de evaluación (soft)

- Cálculo numérico simple: sin límite práctico
- Simbólico (simplify/solve): timeout 30 s con `cancel` disponible
- Plot: máx. 100k puntos por función (advertencia UI si pide más) — Fase 1 acota a 5000
- Documento: máx. 5000 celdas (rendimiento)

## Comandos Tauri (frontend ⇄ Rust, Fase 1)

No pasan por JSON-RPC: son `invoke` directos de Tauri sobre el mismo estado.

| Comando | Params | Result | Notas |
|---|---|---|---|
| `eval_cell` | cellId, ast, env | result (o status=error) | puente al RPC homónimo |
| `eval_document` | cells[] | cells[], definitions, functions | puente al RPC homónimo |
| `plot_data` | ast, xFrom, xTo, steps, varName, env | x[], y[], nonFinite | puente al RPC homónimo |
| `doc_save` | path?, doc | path (null si cancela) | sin path → diálogo "Guardar como" nativo (`tauri-plugin-dialog`); JSON pretty |
| `doc_open` | — | {path, doc} \| null | diálogo nativo; null al cancelar |
| `engine_status` | — | {ready, spawnError} | estado del sidecar |

El formato del documento (`doc`) es el JSON propio v1:
`{ version: 1, title, settings?, assets?, cells: [{id, type: "math"|"text"|"plot"|"interval"|"image", latex, plot?|interval?|assetId?}] }`.

`assets` = registro de imágenes embebidas `{<id>: {mime, bytes, data(base64 sin
prefijo)}}` — el id es el SHA-256 del contenido (dedup) y **solo viajan los
assets referenciados** por celdas (GC en `doc_save`).
