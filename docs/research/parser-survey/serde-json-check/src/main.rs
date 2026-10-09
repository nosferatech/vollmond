//! serde_json: numbers, duplicate keys and strictness, with and without `arbitrary_precision`.
//! Run: `cargo run --quiet` and `cargo run --quiet --features arbitrary`.

use serde::Deserialize;
use serde_json::value::RawValue;
use serde_json::Value;

/// Describes how a parsed number is held, with its value as serde_json prints it.
fn describe(value: &Value) -> String {
    match value {
        Value::Number(n) => {
            let kind = if n.is_u64() {
                "u64"
            } else if n.is_i64() {
                "i64"
            } else if n.is_f64() {
                "f64"
            } else {
                "other"
            };
            format!("Number[{kind}] as_f64={:?} display={}", n.as_f64(), n)
        }
        other => format!("{other}"),
    }
}

fn show(label: &str, text: &str) {
    let result = match serde_json::from_str::<Value>(text) {
        Ok(v) => describe(&v),
        Err(e) => format!("ERROR {e}"),
    };
    println!("{label:<48} {result}");
}

#[derive(Debug, Deserialize)]
struct Strict {
    #[allow(dead_code)]
    a: i64,
}

fn main() {
    let arbitrary = cfg!(feature = "arbitrary");
    println!("serde_json 1.0.151, arbitrary_precision = {arbitrary}\n");

    println!("== Numbers parsed into serde_json::Value");
    for s in [
        "9007199254740991",
        "9007199254740992",
        "9007199254740993",
        "12345678901234567890",
        "18446744073709551615",
        "18446744073709551616",
        "123456789012345678901234567890",
        "-9223372036854775808",
        "-9223372036854775809",
        "1",
        "1.0",
        "1e0",
        "10e-1",
        "-0",
        "-0.0",
        "1e400",
        "-1e400",
        "1e-400",
        "5e-324",
        "0.1",
        "0.3000000000000000444089209850062616169452667236328125",
        "123456789.123456789123456789",
    ] {
        show(s, s);
    }

    println!("\n== Equality of two Values");
    let pairs = [("1", "1.0"), ("9007199254740993", "9007199254740992"), ("1e2", "100"), ("0.10", "0.1")];
    for (a, b) in pairs {
        match (serde_json::from_str::<Value>(a), serde_json::from_str::<Value>(b)) {
            (Ok(va), Ok(vb)) => println!("{a} == {b} ? {}", va == vb),
            _ => println!("{a} == {b} ? ERROR"),
        }
    }

    println!("\n== Round trip of the text through Value");
    for s in ["1.0", "12345678901234567890", "1e3", "-0", "0.10", "1E400"] {
        match serde_json::from_str::<Value>(s) {
            Ok(v) => println!("{s:<24} -> {v}"),
            Err(e) => println!("{s:<24} -> ERROR {e}"),
        }
    }

    println!("\n== Duplicate keys");
    show("Value, {\"a\":1,\"a\":2}", "{\"a\":1,\"a\":2}");
    println!(
        "{:<48} {:?}",
        "struct with field a, {\"a\":1,\"a\":2}",
        serde_json::from_str::<Strict>("{\"a\":1,\"a\":2}").map_err(|e| e.to_string())
    );

    println!("\n== Strictness");
    for (label, text) in [
        ("NaN", "NaN"),
        ("Infinity", "Infinity"),
        ("trailing comma [1,]", "[1,]"),
        ("comment", "[1 /* c */]"),
        ("leading zero 01", "01"),
        ("+1", "+1"),
        (".5", ".5"),
        ("lone surrogate escape", "\"\\ud800\""),
        ("two values", "1 2"),
    ] {
        let r = match serde_json::from_str::<Value>(text) {
            Ok(v) => format!("{v:?}"),
            Err(e) => format!("ERROR {e}"),
        };
        println!("{label:<48} {r}");
    }

    println!("\n== RawValue keeps the exact text of any JSON value");
    for s in ["1.0", "12345678901234567890", "1e400", "-0"] {
        match serde_json::from_str::<Box<RawValue>>(s) {
            Ok(raw) => println!("{s:<24} -> {}", raw.get()),
            Err(e) => println!("{s:<24} -> ERROR {e}"),
        }
    }
}
