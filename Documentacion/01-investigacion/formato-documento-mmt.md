# Formato de documento `.mmt` (XML del original)

> Usado para el **importador** (fase 2+). Documentado con un ejemplo real:
> `examples/function_plot.mmt` del repo original.

## Estructura general

```xml
<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<micromath xmlns:mmt="http://micromath.mkulesh.com">
  <formulaList documentVersion="2"
               author="" title="" description=""
               textWidth="60" significantDigits="6" scale="0.38580"
               redefineAllowed="false">
    <!-- celdas del documento... -->
  </formulaList>
</micromath>
```

### Atributos de `formulaList`

| Atributo | Significado | Nuestro JSON |
|---|---|---|
| `documentVersion` | Versión del formato (2) | `version` |
| `author`, `title`, `description` | Metadatos | `meta.{author,title,description}` |
| `textWidth` | Ancho del texto | `settings.textWidth` |
| `significantDigits` | Dígitos significativos | `settings.significantDigits` |
| `scale` | Escala de visualización | `settings.scale` |
| `redefineAllowed` | ¿Redefinir variables permitido? | `settings.redefineAllowed` |

## Tipo de celda `<equation>`

```xml
<equation inRightOfPrevious="true">
  <term key="leftTerm" text="f(x)" />
  <term key="rightTerm" code="asin">
    <term key="argTerm" code="power">
      <term key="leftTerm" text="x" />
      <term key="rightTerm" text="2" />
    </term>
  </term>
</equation>
```

Traducción a nuestro AST (MathJSON):

```json
{
  "type": "equation",
  "inRightOfPrevious": true,
  "lhs": { "sym": "f", "args": [{"sym": "x"}] },   // o definición de función
  "rhs": { "fn": "Asin", "args": [ { "fn": "Power", "args": [{"sym": "x"}, 2] } ] }
}
```

## El nodo `<term>`

Es un AST recursivo con 3 formas:

1. **Hoja numérica/texto**: `<term key="..." text="0.99" />`
2. **Operador/función**: `<term key="..." code="power"> <hijos> </term>`
3. **Referencia a otra fórmula**: `code="content:com.mkulesh.micromath.link.f"`
   (referencia al resultado de la fórmula cuyo link es `f`)

### `code` comunes observados

| code | Significado | MathJSON |
|---|---|---|
| `plus` / `minus` / `mult` / `divide` | Aritmética | `Add` / `Subtract` / `Multiply` / `Divide` |
| `power` | Potencia | `Power` |
| `asin`, `acos`, `sin`, `cos`… | Trigonométricas | `Asin`… |
| `equidistant_interval` | Rango para variables de plot | Función interna de rango |
| `content:<link>` | Referencia a fórmula/variable | `{"ref": "<link>"}` |

## Celda de intervalo (para variables de gráfico)

```xml
<equation inRightOfPrevious="true">
  <term key="leftTerm" text="x" />
  <term key="rightTerm" code="equidistant_interval">
    <term key="minValue" text="-ξ" />
    <term key="nextValue" code="mult"> ... </term>
    <term key="maxValue" text="ξ" />
  </term>
</equation>
```

## Celda de gráfico `<plot_function>`

```xml
<plot_function inRightOfPrevious="true"
    width="600" height="533"
    axes_style="crossed"
    xLabelsNumber="7" yLabelsNumber="7"
    gridLineColor="#FF838383"
    xType="linear" yType="linear"
    functionsNumber="2">
  <term key="yFunction1" color="#FFFF0043" width="7"
        lineStyle="dotted" shapeType="none" shapeSize="300" code="plus">
    <term key="leftTerm" text="1" />
    <term key="rightTerm" code="content:com.mkulesh.micromath.link.f">
      <term key="argTerm" text="x" />
    </term>
  </term>
  <!-- yFunction2, xFunction1, xFunction2, limits... -->
</plot_function>
```

### Atributos de cada función del gráfico

| Atributo | Valores |
|---|---|
| `color` | ARGB hex (`#FFFF0043`) |
| `width` | grosor (entero escalado) |
| `lineStyle` | `solid`, `dotted`, `dashed`… |
| `shapeType` | forma de marcador (`none`, `circle`…) |
| `shapeSize` | tamaño del marcador |

## Celda de texto `<text_fragment>`

```xml
<text_fragment inRightOfPrevious="true">
  <term key="text" text="Simple function plot" />
</text_fragment>
```

## Celda de imagen `<image_fragment>`

```xml
<image_fragment fileName="..." embedded="true" originalSize="false"
    width="75" height="60" colorType="original"
    binEncoding="base64" imgType="svg">
  <![CDATA[PD94bWwgdmVyc2lvbj0iMS4wIi...]]>
</image_fragment>
```

- Imágenes **embebidas en base64 dentro del XML** (CDATA)
- `imgType`: `svg` | `png` | …
- SVG soportado nativamente

## Traducción a nuestro formato JSON (propuesta)

```json
{
  "version": 1,
  "meta": { "title": "", "author": "", "description": "" },
  "settings": { "textWidth": 60, "significantDigits": 6, "redefineAllowed": false },
  "cells": [
    { "type": "text", "inRightOfPrevious": false, "content": "Simple function plot" },
    { "type": "equation", "id": "xi",
      "lhs": { "sym": "ξ" },
      "rhs": { "num": "0.99" } },
    { "type": "equation", "id": "f",
      "lhs": { "fn": "f", "args": [{"sym": "x"}] },
      "rhs": { "fn": "Asin", "args": [ { "fn": "Power", "args": [{"sym": "x"}, 2] } ] } },
    { "type": "plot", "width": 600, "height": 533, "axesStyle": "crossed",
      "xType": "linear", "yType": "linear",
      "functions": [
        { "y": { "fn": "Add", "args": [1, { "ref": "f", "args": [{"sym": "x"}] } ] },
          "color": "#FF0043", "lineStyle": "dotted", "width": 7 }
      ] }
  ]
}
```

## Notas de compatibilidad

- El importador debe tolerar **celdas desconocidas** (omitirlas con warning)
- `documentVersion="2"` es el formato vigente
- SMath Studio `.sm` es un formato **distinto** (binario) — importador propio
  en `ImportFromSMathStudio.java`, fase tardía
