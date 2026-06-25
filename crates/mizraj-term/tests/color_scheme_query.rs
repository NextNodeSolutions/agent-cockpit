//! End-to-end check that, once the embedder seeds a color scheme, a program
//! probing it via DSR `CSI ? 996 n` gets an answer reflecting the seeded theme —
//! the modern signal a TUI uses to pick its light/dark variant. (OSC 10/11/12
//! color queries are answered by `ColorQueryResponder`, unit-tested separately;
//! libghostty's VT core does not answer those itself.)
//!
//! Requires libghostty linked at test time (see `.cargo/config.toml`).

use std::cell::RefCell;
use std::rc::Rc;

use mizraj_term::{ColorScheme, DefaultColors, Rgb, Terminal};

fn terminal_capturing_pty() -> (Terminal, Rc<RefCell<Vec<u8>>>) {
    let mut term = Terminal::new(24, 80).expect("Terminal::new");
    let sink = Rc::new(RefCell::new(Vec::new()));
    let writer_sink = Rc::clone(&sink);
    term.set_pty_writer(Box::new(move |bytes| {
        writer_sink.borrow_mut().extend_from_slice(bytes);
    }))
    .expect("set_pty_writer");
    (term, sink)
}

fn scheme_report(scheme: ColorScheme, bg: Rgb) -> String {
    let (mut term, sink) = terminal_capturing_pty();
    term.set_default_colors(&DefaultColors {
        background: Some(bg),
        foreground: None,
        cursor: None,
        scheme,
    })
    .expect("set_default_colors");

    // DSR CSI ? 996 n — "report the color scheme".
    term.feed(b"\x1b[?996n").expect("feed DSR 996 query");
    let captured = sink.borrow();
    String::from_utf8_lossy(&captured).into_owned()
}

#[test]
fn dsr996_reports_light_for_a_light_theme() {
    // Report is CSI ? 997 ; 2 n for light.
    let response = scheme_report(ColorScheme::Light, Rgb::new(0xef, 0xf1, 0xf5));
    assert!(
        response.contains("997;2"),
        "expected a light color-scheme report, got {response:?}",
    );
}

#[test]
fn dsr996_reports_dark_for_a_dark_theme() {
    // Report is CSI ? 997 ; 1 n for dark.
    let response = scheme_report(ColorScheme::Dark, Rgb::new(0x1e, 0x1e, 0x2e));
    assert!(
        response.contains("997;1"),
        "expected a dark color-scheme report, got {response:?}",
    );
}
