// mmt.rs — Importador `.mmt` (XML del microMathematics original) → JSON v1
//
// Especificación: Documentacion/01-investigacion/formato-documento-mmt.md
// Estrategia eficiente: el árbol <term> se convierte DIRECTAMENTE a LaTeX con
// una tabla code→LaTeX — sin formato intermedio, y las celdas resultantes
// tienen la MISMA forma que las del editor (type/latex/assets), de modo que
// loadDoc() las consume sin conversión adicional.
//
// Cobertura: equation (definiciones `f(x)` → `:=` compatibles con nuestro
// engine), equidistant_interval → IntervalCell, plot_function → PlotCell,
// text_fragment → texto, image_fragment (CDATA base64) → celda de imagen con
// assets (dedup por contenido). Celdas desconocidas → warning + omisión.

use quick_xml::events::Event;
use quick_xml::name::QName;
use quick_xml::Reader;
use serde_json::{json, Map, Value};

pub struct Imported {
    pub doc: Value,
    pub warnings: Vec<String>,
}

#[derive(Debug, Default, Clone)]
struct Term {
    key: Option<String>,
    text: Option<String>,
    code: Option<String>,
    children: Vec<Term>,
}

// ── Helpers XML ────────────────────────────────────────────────────────────

fn unesc(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if let Some(rel) = s[i..].find(';') {
                let ent = &s[i + 1..i + rel];
                let decoded: Option<String> = if let Some(hex) = ent.strip_prefix('#') {
                    let code = hex
                        .strip_prefix('x')
                        .or_else(|| hex.strip_prefix('X'))
                        .map(|h| u32::from_str_radix(h, 16).ok())
                        .unwrap_or_else(|| hex.parse::<u32>().ok());
                    code.and_then(char::from_u32).map(|c| c.to_string())
                } else {
                    match ent {
                        "lt" => Some("<".into()),
                        "gt" => Some(">".into()),
                        "quot" => Some("\"".into()),
                        "apos" => Some("'".into()),
                        "amp" => Some("&".into()),
                        _ => None,
                    }
                };
                if let Some(d) = decoded {
                    out.push_str(&d);
                    i += rel + 1;
                    continue;
                }
            }
        }
        let ch_len = s[i..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
        out.push_str(&s[i..i + ch_len]);
        i += ch_len;
    }
    out
}

fn attrs_of(e: &quick_xml::events::BytesStart) -> Vec<(String, String)> {
    e.attributes()
        .filter_map(|a| a.ok())
        .map(|a| {
            (
                a.key.as_ref().to_string(),
                unesc(&a.value),
            )
        })
        .collect()
}

fn get<'a>(attrs: &'a [(String, String)], k: &str) -> Option<&'a str> {
    attrs.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str())
}

fn push_unique(warnings: &mut Vec<String>, msg: String) {
    if !warnings.contains(&msg) {
        warnings.push(msg);
    }
}

/// Salta el elemento cuyo Start ya se consumió (contaje de profundidad).
fn skip_element(reader: &mut Reader<&[u8]>) -> Result<(), String> {
    let mut depth: i32 = 1;
    loop {
        match reader.read_event() {
            Ok(Event::Start(_)) => depth += 1,
            Ok(Event::End(_)) => {
                depth -= 1;
                if depth == 0 {
                    return Ok(());
                }
            }
            Ok(Event::Eof) => return Err("EOF inesperado dentro de un elemento".into()),
            Ok(_) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Lee hijos hasta el End de `end_name` (no incluido) → términos hijos.
fn parse_children(
    reader: &mut Reader<&[u8]>,
    end_name: &str,
    warnings: &mut Vec<String>,
) -> Result<Vec<Term>, String> {
    let mut out = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_string();
                if e.name() == QName("term") {
                    let attrs = attrs_of(&e);
                    out.push(parse_term(reader, &attrs, warnings)?);
                } else {
                    push_unique(warnings, format!("elemento desconocido <{name}> omitido"));
                    skip_element(reader)?;
                }
            }
            Ok(Event::Empty(e)) => {
                if e.name() == QName("term") {
                    out.push(term_from_attrs(&attrs_of(&e)));
                }
            }
            Ok(Event::End(e)) if e.name() == QName(end_name) => return Ok(out),
            Ok(Event::Eof) => return Err("EOF inesperado dentro del elemento".into()),
            Ok(_) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn term_from_attrs(attrs: &[(String, String)]) -> Term {
    Term {
        key: get(attrs, "key").map(String::from),
        text: get(attrs, "text").map(String::from),
        code: get(attrs, "code").map(String::from),
        children: Vec::new(),
    }
}

fn parse_term(
    reader: &mut Reader<&[u8]>,
    attrs: &[(String, String)],
    warnings: &mut Vec<String>,
) -> Result<Term, String> {
    let mut t = term_from_attrs(attrs);
    t.children = parse_children(reader, "term", warnings)?;
    Ok(t)
}

// ── <term> → LaTeX ─────────────────────────────────────────────────────────

/// Funciones mmt → LaTeX (con `arg`). sqrt/abs/floor/ceil/fact van aparte.
const FN_LATEX: &[(&str, &str)] = &[
    ("sin", r"\sin"), ("cos", r"\cos"), ("tan", r"\tan"), ("cot", r"\cot"),
    ("sec", r"\sec"), ("csc", r"\csc"),
    ("asin", r"\arcsin"), ("acos", r"\arccos"), ("atan", r"\arctan"),
    ("sinh", r"\sinh"), ("cosh", r"\cosh"), ("tanh", r"\tanh"),
    ("ln", r"\ln"), ("log", r"\log"), ("log10", r"\log_{10}"), ("log2", r"\log_{2}"),
    ("exp", r"\exp"), ("min", r"\min"), ("max", r"\max"),
    ("gcd", r"\gcd"), ("lcm", r"\operatorname{lcm}"),
];

fn child<'a>(t: &'a Term, k: &str) -> Option<&'a Term> {
    t.children.iter().find(|c| c.key.as_deref() == Some(k))
}

fn arg_of(t: &Term, warnings: &mut Vec<String>) -> String {
    child(t, "argTerm")
        .or_else(|| child(t, "leftTerm"))
        .or_else(|| t.children.first())
        .map(|c| term_latex(c, warnings))
        .unwrap_or_default()
}

fn term_latex(t: &Term, warnings: &mut Vec<String>) -> String {
    // Hoja: números, símbolos, "f(x)" — el texto ya es LaTeX para MathLive
    if let Some(txt) = &t.text {
        return txt.clone();
    }
    let code = t.code.as_deref().unwrap_or("");
    let left = child(t, "leftTerm").map(|c| term_latex(c, warnings));
    let right = child(t, "rightTerm").map(|c| term_latex(c, warnings));

    // content:<link> → referencia al resultado de otra fórmula:
    // con argTerm → llamada f(x); sin arg → referencia simple
    if code.starts_with("content:") {
        let name = code["content:".len()..].rsplit('.').next().unwrap_or(code);
        return match child(t, "argTerm") {
            Some(arg) => format!("{}\\left({}\\right)", name, term_latex(arg, warnings)),
            None => name.to_string(),
        };
    }

    let l = left.clone().unwrap_or_default();
    let r = right.clone().unwrap_or_default();
    match code {
        "plus" => format!("{l} + {r}"),
        "minus" if left.is_some() => format!("{l} - {r}"),
        "minus" | "unary_minus" => {
            if t.children.is_empty() {
                format!("-{}", arg_of(t, warnings))
            } else {
                format!("-{r}")
            }
        }
        "mult" => format!("{l} \\cdot {r}"),
        "divide" => format!("\\frac{{{l}}}{{{r}}}"),
        "power" => format!("{{{l}}}^{{{r}}}"),
        "sqrt" => format!("\\sqrt{{{}}}", arg_of(t, warnings)),
        "abs" => format!("\\left|{}\\right|", arg_of(t, warnings)),
        "floor" => format!("\\left\\lfloor{}\\right\\rfloor", arg_of(t, warnings)),
        "ceil" | "ceiling" => format!("\\left\\lceil{}\\right\\rceil", arg_of(t, warnings)),
        "fact" => format!("{}!", arg_of(t, warnings)),
        "equidistant_interval" => {
            push_unique(warnings, "equidistant_interval fuera de equation — se omite".into());
            String::new()
        }
        "" if t.children.len() == 1 => term_latex(&t.children[0], warnings),
        "" if t.children.is_empty() => String::new(),
        "" => {
            push_unique(warnings, "term con hijos sin code — se concatenan".into());
            t.children
                .iter()
                .map(|c| term_latex(c, warnings))
                .collect::<Vec<_>>()
                .join(" ")
        }
        other => match FN_LATEX.iter().find(|(c, _)| *c == other) {
            Some((_, lx)) => format!("{lx}\\left({}\\right)", arg_of(t, warnings)),
            None => {
                push_unique(
                    warnings,
                    format!("code desconocido «{other}» — importado como operador"),
                );
                let joined = t
                    .children
                    .iter()
                    .map(|c| term_latex(c, warnings))
                    .collect::<Vec<_>>()
                    .join(" ");
                if joined.is_empty() {
                    format!("\\operatorname{{{other}}}")
                } else {
                    joined
                }
            }
        },
    }
}

// ── Importador principal ───────────────────────────────────────────────────

pub fn import_mmt(xml: &str) -> Result<Imported, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut warnings: Vec<String> = Vec::new();
    let mut title = String::new();
    let mut author: Option<String> = None;
    let mut description: Option<String> = None;
    let mut digits: Option<u64> = None;
    let mut text_width: Option<u64> = None;
    let mut cells: Vec<Value> = Vec::new();
    let mut assets: Map<String, Value> = Map::new();
    // dedup de imágenes por contenido (sin hashing: la clave es el propio b64)
    let mut img_seen: Vec<(String, String)> = Vec::new();
    let mut img_n = 0usize;
    // Profundidad de <formulaList> sin cerrar → detecta XML truncado
    let mut depth: i32 = 0;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_string();
                match name.as_str() {
                    "micromath" => { /* contenedor: seguir */ }
                    "formulaList" => {
                        depth += 1;
                        let attrs = attrs_of(&e);
                        title = get(&attrs, "title").unwrap_or("").to_string();
                        author = get(&attrs, "author").filter(|s| !s.is_empty()).map(String::from);
                        description = get(&attrs, "description")
                            .filter(|s| !s.is_empty())
                            .map(String::from);
                        digits = get(&attrs, "significantDigits").and_then(|s| s.parse().ok());
                        text_width = get(&attrs, "textWidth").and_then(|s| s.parse().ok());
                    }
                    "equation" => {
                        let children = parse_children(&mut reader, "equation", &mut warnings)?;
                        cells.push(equation_cell(&children, &mut warnings));
                    }
                    "text_fragment" => {
                        let children =
                            parse_children(&mut reader, "text_fragment", &mut warnings)?;
                        let text = children
                            .iter()
                            .find(|c| c.key.as_deref() == Some("text"))
                            .and_then(|c| c.text.clone())
                            .or_else(|| children.first().and_then(|c| c.text.clone()))
                            .unwrap_or_default();
                        cells.push(json!({"id": "", "type": "text", "latex": text}));
                    }
                    "plot_function" => {
                        let attrs = attrs_of(&e);
                        let children =
                            parse_children(&mut reader, "plot_function", &mut warnings)?;
                        cells.push(plot_cell(&attrs, &children, &mut warnings));
                    }
                    "image_fragment" => {
                        let attrs = attrs_of(&e);
                        let mut b64 = String::new();
                        loop {
                            match reader.read_event() {
                                Ok(Event::CData(c)) => b64.push_str(c.as_ref()),
                                Ok(Event::Text(t)) => b64.push_str(&unesc(t.as_ref())),
                                Ok(Event::End(ev)) if ev.name() == QName("image_fragment") => break,
                                Ok(Event::Eof) => return Err("EOF en image_fragment".into()),
                                Ok(_) => {}
                                Err(er) => return Err(er.to_string()),
                            }
                        }
                        cells.push(image_cell(
                            &attrs, b64, &mut assets, &mut img_seen, &mut img_n, &mut warnings,
                        ));
                    }
                    "integral" | "differential" | "series" | "delta" => {
                        // Celdas avanzadas del original sin equivalente aún
                        push_unique(&mut warnings, format!("celda <{name}> no soportada aún — omitida"));
                        skip_element(&mut reader)?;
                    }
                    other => {
                        push_unique(&mut warnings, format!("elemento <{other}> desconocido — omitido"));
                        skip_element(&mut reader)?;
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                // Self-closing: no hay contenido que parsear
                let name = e.name().as_ref().to_string();
                if matches!(
                    name.as_str(),
                    "equation" | "text_fragment" | "plot_function" | "image_fragment"
                ) {
                    push_unique(&mut warnings, format!("celda <{name}> vacía — omitida"));
                }
            }
            Ok(Event::End(e)) => {
                if e.name() == QName("micromath") {
                    break;
                }
                if e.name() == QName("formulaList") {
                    depth -= 1;
                }
            }
            Ok(Event::Eof) => {
                if depth > 0 {
                    return Err(format!(
                        "XML truncado: {depth} elemento(s) sin cerrar"
                    ));
                }
                break;
            }
            Ok(_) => {}
            Err(e) => return Err(format!("XML inválido: {e}")),
        }
    }

    let mut doc = Map::new();
    doc.insert("version".into(), json!(1));
    doc.insert("title".into(), json!(title));
    let mut settings = Map::new();
    settings.insert("theme".into(), json!("dark"));
    if let Some(d) = digits {
        settings.insert("digits".into(), json!(d.clamp(1, 17)));
    }
    if let Some(w) = text_width {
        settings.insert("textWidth".into(), json!(w));
    }
    doc.insert("settings".into(), Value::Object(settings));
    if author.is_some() || description.is_some() {
        let mut meta = Map::new();
        if let Some(a) = author {
            meta.insert("author".into(), json!(a));
        }
        if let Some(d) = description {
            meta.insert("description".into(), json!(d));
        }
        doc.insert("meta".into(), Value::Object(meta));
    }
    if !assets.is_empty() {
        doc.insert("assets".into(), Value::Object(assets));
    }
    doc.insert("cells".into(), Value::Array(cells));

    Ok(Imported {
        doc: Value::Object(doc),
        warnings,
    })
}

/// <image_fragment> → asset dedup + celda de imagen
fn image_cell(
    attrs: &[(String, String)],
    b64: String,
    assets: &mut Map<String, Value>,
    img_seen: &mut Vec<(String, String)>,
    img_n: &mut usize,
    warnings: &mut Vec<String>,
) -> Value {
    let b64: String = b64.chars().filter(|c| !c.is_whitespace()).collect();
    let img_type = get(attrs, "imgType").unwrap_or("png").to_lowercase();
    let mime = match img_type.as_str() {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        other => {
            push_unique(warnings, format!("imgType «{other}» desconocido → image/png"));
            "image/png"
        }
    };
    // Dedup: misma base64 → mismo id (sin hashing; la clave es el propio dato)
    let id = match img_seen.iter().find(|(data, _)| *data == b64) {
        Some((_, existing)) => existing.clone(),
        None => {
            let id = format!("mmt{img_n}");
            *img_n += 1;
            // bytes ≈ 3/4 de la longitud base64 (solo para mostrar KB)
            let bytes = (b64.len() / 4) * 3;
            assets.insert(
                id.clone(),
                json!({"mime": mime, "bytes": bytes, "data": b64.clone()}),
            );
            img_seen.push((b64, id.clone()));
            id
        }
    };
    json!({"id": "", "type": "image", "latex": "", "assetId": id})
}

/// <equation> → celda math (definición), expression o interval
fn equation_cell(children: &[Term], warnings: &mut Vec<String>) -> Value {
    let left = children.iter().find(|c| c.key.as_deref() == Some("leftTerm"));
    let right = children.iter().find(|c| c.key.as_deref() == Some("rightTerm"));
    let right = match right {
        Some(r) => r,
        None => {
            push_unique(warnings, "equation sin rightTerm — omitida".into());
            return json!({"id": "", "type": "text", "latex": ""});
        }
    };

    // Intervalo equidistante (para variables de gráfico: x = [-ξ, ξ])
    if right.code.as_deref() == Some("equidistant_interval") {
        let from = child(right, "minValue")
            .map(|c| term_latex(c, warnings))
            .unwrap_or_else(|| "-10".into());
        let to = child(right, "maxValue")
            .map(|c| term_latex(c, warnings))
            .unwrap_or_else(|| "10".into());
        return json!({
            "id": "", "type": "interval", "latex": "",
            "interval": {"from": from, "to": to, "steps": 400}
        });
    }

    let rhs = term_latex(right, warnings);
    let lhs = left.map(|c| term_latex(c, warnings)).unwrap_or_default();
    if lhs.is_empty() {
        // Celda de resultado puro (expresión)
        return json!({"id": "", "type": "math", "latex": rhs});
    }
    // Definición de función si el lado izquierdo invoca (f(x) → :=, que es lo
    // que acepta nuestro engine; el original usa =)
    let sep = if lhs.contains('(') { ":=" } else { "=" };
    json!({"id": "", "type": "math", "latex": format!("{lhs}{sep}{rhs}")})
}

/// <plot_function> → celda plot (yFunction1/yFunction2; x paramétrico → warning)
fn plot_cell(attrs: &[(String, String)], children: &[Term], warnings: &mut Vec<String>) -> Value {
    if get(attrs, "xType") == Some("log") || get(attrs, "yType") == Some("log") {
        push_unique(warnings, "escala logarítmica no soportada aún (lineal)".into());
    }
    if children.iter().any(|c| c.key.as_deref() == Some("xFunction1")) {
        push_unique(
            warnings,
            "plot paramétrico (x(t)) no soportado — se importa solo y(x)".into(),
        );
    }
    let f1 = children
        .iter()
        .find(|c| c.key.as_deref() == Some("yFunction1"))
        .map(|c| term_latex(c, warnings))
        .unwrap_or_default();
    let f2 = children
        .iter()
        .find(|c| c.key.as_deref() == Some("yFunction2"))
        .map(|c| term_latex(c, warnings))
        .unwrap_or_default();
    json!({
        "id": "", "type": "plot", "latex": "",
        "plot": {"f1": f1, "f2": f2, "varName": "x"}
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<micromath xmlns:mmt="http://micromath.mkulesh.com">
  <formulaList documentVersion="2" author="Ana" title="Mi hoja"
               description="demo" textWidth="60" significantDigits="6"
               scale="0.38580" redefineAllowed="false">
    <text_fragment>
      <term key="text" text="Simple function plot" />
    </text_fragment>
    <equation>
      <term key="leftTerm" text="&#958;" />
      <term key="rightTerm" text="0.99" />
    </equation>
    <equation>
      <term key="leftTerm" text="f(x)" />
      <term key="rightTerm" code="asin">
        <term key="argTerm" code="power">
          <term key="leftTerm" text="x" />
          <term key="rightTerm" text="2" />
        </term>
      </term>
    </equation>
    <equation>
      <term key="leftTerm" text="x" />
      <term key="rightTerm" code="equidistant_interval">
        <term key="minValue" text="-&#958;" />
        <term key="maxValue" text="&#958;" />
      </term>
    </equation>
    <equation>
      <term key="leftTerm" text="b" />
      <term key="rightTerm" code="divide">
        <term key="leftTerm" text="1" />
        <term key="rightTerm" code="content:com.mkulesh.micromath.link.f">
          <term key="argTerm" text="x" />
        </term>
      </term>
    </equation>
    <plot_function functionsNumber="2" xType="linear" yType="linear">
      <term key="yFunction1" code="plus">
        <term key="leftTerm" text="1" />
        <term key="rightTerm" code="content:com.mkulesh.micromath.link.f">
          <term key="argTerm" text="x" />
        </term>
      </term>
      <term key="yFunction2" text="x" />
    </plot_function>
    <image_fragment imgType="png" binEncoding="base64">
      <![CDATA[aGVsbG8=]]>
    </image_fragment>
    <integral>
      <term key="arg" text="x" />
    </integral>
  </formulaList>
</micromath>"#;

    #[test]
    fn importa_estructura_completa() {
        let r = import_mmt(SAMPLE).expect("import válido");
        let doc = &r.doc;
        assert_eq!(doc["title"], "Mi hoja");
        assert_eq!(doc["settings"]["digits"], 6);
        assert_eq!(doc["settings"]["textWidth"], 60);
        assert_eq!(doc["settings"]["theme"], "dark");
        assert_eq!(doc["meta"]["author"], "Ana");
        assert_eq!(doc["meta"]["description"], "demo");

        let cells = doc["cells"].as_array().unwrap();
        assert_eq!(cells.len(), 7); // text, ξ, f, x(interval), b, plot, image

        // texto
        assert_eq!(cells[0]["type"], "text");
        assert_eq!(cells[0]["latex"], "Simple function plot");

        // ξ = 0.99 (definición de variable con =)
        assert_eq!(cells[1]["type"], "math");
        assert_eq!(cells[1]["latex"], "ξ=0.99");

        // f(x) = asin(x²) → := (compat con nuestro engine)
        assert_eq!(cells[2]["latex"], "f(x):=\\arcsin\\left({x}^{2}\\right)");

        // intervalo equidistante → IntervalCell con -ξ/ξ (rango simbólico)
        assert_eq!(cells[3]["type"], "interval");
        assert_eq!(cells[3]["interval"]["from"], "-ξ");
        assert_eq!(cells[3]["interval"]["to"], "ξ");

        // content:link con arg → llamada f(x)
        assert_eq!(cells[4]["latex"], "b=\\frac{1}{f\\left(x\\right)}");

        // plot con 2 funciones
        assert_eq!(cells[5]["type"], "plot");
        assert_eq!(cells[5]["plot"]["f1"], "1 + f\\left(x\\right)");
        assert_eq!(cells[5]["plot"]["f2"], "x");

        // imagen embebida → asset + celda
        assert_eq!(cells[6]["type"], "image");
        let aid = cells[6]["assetId"].as_str().unwrap();
        assert_eq!(doc["assets"][aid]["mime"], "image/png");
        assert_eq!(doc["assets"][aid]["data"], "aGVsbG8=");

        // <integral> desconocida → warning
        assert!(r.warnings.iter().any(|w| w.contains("<integral>")));
    }

    #[test]
    fn tolera_xml_malformado_con_error() {
        assert!(import_mmt("<micromath><formulaList>").is_err());
    }

    #[test]
    fn entities_y_texto_con_signos() {
        let xml = r#"<micromath><formulaList title="a &amp; b">
            <text_fragment><term key="text" text="5 &gt; 3 &amp; 2 &lt; 9" /></text_fragment>
        </formulaList></micromath>"#;
        let r = import_mmt(xml).unwrap();
        assert_eq!(r.doc["title"], "a & b");
        assert_eq!(r.doc["cells"][0]["latex"], "5 > 3 & 2 < 9");
    }

    #[test]
    fn misma_imagen_dos_veces_dedup() {
        let xml = r#"<micromath><formulaList>
            <image_fragment imgType="svg"><![CDATA[PHN2Zz4=]]></image_fragment>
            <image_fragment imgType="svg"><![CDATA[PHN2Zz4=]]></image_fragment>
        </formulaList></micromath>"#;
        let r = import_mmt(xml).unwrap();
        let cells = r.doc["cells"].as_array().unwrap();
        assert_eq!(cells[0]["assetId"], cells[1]["assetId"]);
        assert_eq!(r.doc["assets"].as_object().unwrap().len(), 1);
        assert_eq!(
            r.doc["assets"][cells[0]["assetId"].as_str().unwrap()]["mime"],
            "image/svg+xml"
        );
    }
}
