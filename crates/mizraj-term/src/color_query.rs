//! Answer OSC 10/11/12 *color queries* from the seeded theme colors.
//!
//! libghostty-vt's terminal core answers device/cursor/scheme queries but NOT
//! OSC color queries (`OSC 10/11/12 ; ?`) — in real Ghostty those are handled by
//! the app layer. mizraj is that layer, so it sniffs the child's output for a
//! color query and writes the reply itself. Without this a TUI that probes the
//! background (Claude Code, vim's `background` autodetection) gets no answer,
//! times out, and assumes a dark terminal — rendering its dark theme on a light
//! one (and vice versa).
//!
//! The scanner only *observes*: every byte still reaches the terminal core
//! unchanged. It matches a query exactly (`;?` form) so a color *set* by the
//! program is left for the core to apply, never echoed back.

use crate::color::{DefaultColors, Rgb};

/// BEL, the legacy OSC terminator.
const BEL: u8 = 0x07;
/// ESC, both the introducer and the first byte of an ST (`ESC \`) terminator.
const ESC: u8 = 0x1b;
/// The `\` that completes a String Terminator after ESC.
const ST_FINAL: u8 = b'\\';
/// `]`, the OSC introducer's second byte.
const OSC_INTRODUCER: u8 = b']';

/// Longest OSC body we retain while waiting for a terminator. A color query is
/// tiny (`11;?`); anything longer is some other OSC we don't answer, so we stop
/// buffering and resync at the next sequence rather than grow unbounded.
const MAX_BODY_LEN: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    /// Outside any sequence.
    Ground,
    /// Saw ESC, waiting to see if it introduces an OSC.
    Esc,
    /// Inside an OSC body, accumulating until a terminator.
    Body,
    /// Saw ESC inside the body, expecting `\` to complete an ST.
    BodyEsc,
}

/// The terminator a query used, echoed back so the reply matches the dialect the
/// program speaks (some only accept the form they sent).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Terminator {
    Bel,
    St,
}

/// Streaming sniffer that emits OSC color-query replies for the seeded colors.
/// One per session; fed the child's output in arrival order.
#[derive(Debug)]
pub struct ColorQueryResponder {
    colors: DefaultColors,
    state: State,
    body: Vec<u8>,
}

impl ColorQueryResponder {
    pub fn new(colors: DefaultColors) -> Self {
        Self {
            colors,
            state: State::Ground,
            body: Vec::new(),
        }
    }

    /// Swap in freshly resolved colors (config hot reload). Mid-sequence scan
    /// state is preserved; only what a future query reports changes.
    pub fn set_colors(&mut self, colors: DefaultColors) {
        self.colors = colors;
    }

    /// Observe a chunk of child output and return any reply bytes to write back
    /// to the PTY (empty when the chunk holds no answerable query).
    pub fn observe(&mut self, bytes: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        for &byte in bytes {
            self.step(byte, &mut out);
        }
        out
    }

    fn step(&mut self, byte: u8, out: &mut Vec<u8>) {
        match self.state {
            State::Ground => {
                if byte == ESC {
                    self.state = State::Esc;
                }
            }
            State::Esc => {
                if byte == OSC_INTRODUCER {
                    self.body.clear();
                    self.state = State::Body;
                } else {
                    // Some other escape (CSI, charset, …): the core handles it.
                    // A back-to-back ESC keeps us armed for the next byte.
                    self.state = if byte == ESC {
                        State::Esc
                    } else {
                        State::Ground
                    };
                }
            }
            State::Body => match byte {
                BEL => {
                    self.finish(Terminator::Bel, out);
                }
                ESC => {
                    self.state = State::BodyEsc;
                }
                _ => self.push(byte),
            },
            State::BodyEsc => {
                if byte == ST_FINAL {
                    self.finish(Terminator::St, out);
                } else {
                    // ESC not completing an ST aborts this OSC. Re-arm on ESC.
                    self.body.clear();
                    self.state = if byte == ESC {
                        State::Esc
                    } else {
                        State::Ground
                    };
                }
            }
        }
    }

    fn push(&mut self, byte: u8) {
        if self.body.len() < MAX_BODY_LEN {
            self.body.push(byte);
        } else {
            // Too long to be a color query; stop tracking until the next ESC.
            self.body.clear();
            self.state = State::Ground;
        }
    }

    fn finish(&mut self, terminator: Terminator, out: &mut Vec<u8>) {
        if let Some(reply) = self.reply_for(&self.body, terminator) {
            out.extend_from_slice(&reply);
        }
        self.body.clear();
        self.state = State::Ground;
    }

    /// The reply for an OSC body, if it is a color query we can answer.
    fn reply_for(&self, body: &[u8], terminator: Terminator) -> Option<Vec<u8>> {
        let (ps, color) = match body {
            b"10;?" => (10, self.colors.foreground?),
            b"11;?" => (11, self.colors.background?),
            b"12;?" => (12, self.colors.cursor?),
            _ => return None,
        };
        Some(format_color_report(ps, color, terminator))
    }
}

/// `OSC Ps ; rgb:RRRR/GGGG/BBBB <terminator>` — the xterm color report, with the
/// 8-bit channels doubled to 16 bits (`ef` → `efef`) as xterm does.
fn format_color_report(ps: u8, color: Rgb, terminator: Terminator) -> Vec<u8> {
    let body = format!(
        "\x1b]{ps};rgb:{0:02x}{0:02x}/{1:02x}{1:02x}/{2:02x}{2:02x}",
        color.r, color.g, color.b,
    );
    let mut out = body.into_bytes();
    match terminator {
        Terminator::Bel => out.push(BEL),
        Terminator::St => out.extend_from_slice(&[ESC, ST_FINAL]),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::ColorScheme;

    fn latte() -> DefaultColors {
        DefaultColors {
            background: Some(Rgb::new(0xef, 0xf1, 0xf5)),
            foreground: Some(Rgb::new(0x4c, 0x4f, 0x69)),
            cursor: Some(Rgb::new(0xdc, 0x8a, 0x78)),
            scheme: ColorScheme::Light,
        }
    }

    fn reply(input: &[u8]) -> String {
        let mut r = ColorQueryResponder::new(latte());
        String::from_utf8(r.observe(input)).expect("utf8 reply")
    }

    #[test]
    fn answers_background_query_with_seeded_color() {
        assert_eq!(reply(b"\x1b]11;?\x07"), "\x1b]11;rgb:efef/f1f1/f5f5\x07");
    }

    #[test]
    fn answers_foreground_and_cursor_queries() {
        assert_eq!(reply(b"\x1b]10;?\x07"), "\x1b]10;rgb:4c4c/4f4f/6969\x07");
        assert_eq!(reply(b"\x1b]12;?\x07"), "\x1b]12;rgb:dcdc/8a8a/7878\x07");
    }

    #[test]
    fn echoes_the_st_terminator_the_query_used() {
        assert_eq!(
            reply(b"\x1b]11;?\x1b\\"),
            "\x1b]11;rgb:efef/f1f1/f5f5\x1b\\"
        );
    }

    #[test]
    fn ignores_a_color_set_so_the_core_applies_it() {
        // A program SETTING the background must not be echoed back as a report.
        assert_eq!(reply(b"\x1b]11;rgb:1e1e/1e1e/2e2e\x07"), "");
    }

    #[test]
    fn stays_silent_when_the_queried_color_is_unset() {
        let mut r = ColorQueryResponder::new(DefaultColors::default());
        assert_eq!(r.observe(b"\x1b]11;?\x07"), b"");
    }

    #[test]
    fn reassembles_a_query_split_across_chunks() {
        let mut r = ColorQueryResponder::new(latte());
        assert_eq!(r.observe(b"\x1b]1"), b"");
        assert_eq!(r.observe(b"1;?"), b"");
        assert_eq!(r.observe(b"\x07"), b"\x1b]11;rgb:efef/f1f1/f5f5\x07");
    }

    #[test]
    fn passes_surrounding_output_through_untouched() {
        // The query is embedded in ordinary output; only the reply comes back.
        let out = ColorQueryResponder::new(latte()).observe(b"hi\x1b]11;?\x07bye");
        assert_eq!(out, b"\x1b]11;rgb:efef/f1f1/f5f5\x07");
    }

    #[test]
    fn does_not_answer_palette_queries() {
        assert_eq!(reply(b"\x1b]4;1;?\x07"), "");
    }
}
