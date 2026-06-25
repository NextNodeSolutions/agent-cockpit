//! Default theme colors handed to libghostty so it can answer color and
//! color-scheme queries with the user's resolved Ghostty theme.
//!
//! libghostty tracks a default foreground/background/cursor color and answers
//! OSC 10/11/12 ("report color") and DSR `?996n` ("report color scheme")
//! queries from them. mizraj resolves the theme in the renderer, so without
//! seeding these the terminal core keeps its built-in *dark* defaults — and a
//! theme-aware TUI (Claude Code, vim's `background` detection, prompt themes)
//! that probes the terminal then renders its dark variant on what is actually
//! a light terminal (and vice versa). Seeding them makes the probe truthful.

/// An 8-bit-per-channel RGB color.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    pub const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// Perceptual luminance (Rec. 601 weights), 0.0 (black) – 1.0 (white). Used
    /// to decide which side of the light/dark axis a background sits on.
    pub fn luminance(self) -> f32 {
        let lum = 0.299 * f32::from(self.r) + 0.587 * f32::from(self.g) + 0.114 * f32::from(self.b);
        lum / 255.0
    }
}

/// Which side of the light/dark axis the terminal sits on, reported in response
/// to a color-scheme query (DSR `CSI ? 996 n`). Derived from the background
/// luminance so it matches what the terminal actually looks like, not the OS
/// appearance (which can differ from a hand-picked terminal theme).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorScheme {
    Light,
    Dark,
}

/// Luminance at/above which a background counts as light. Mid-grey would be
/// ambiguous; the threshold leans slightly bright so only genuinely light
/// backgrounds report `Light`.
const LIGHT_LUMINANCE_THRESHOLD: f32 = 0.5;

impl ColorScheme {
    /// The scheme a background of `bg` implies. A missing background keeps the
    /// conservative `Dark` default (the historical terminal assumption).
    pub fn from_background(bg: Option<Rgb>) -> Self {
        match bg {
            Some(rgb) if rgb.luminance() >= LIGHT_LUMINANCE_THRESHOLD => Self::Light,
            _ => Self::Dark,
        }
    }
}

/// The default theme colors libghostty answers queries with. A `None` color is
/// left unset, so libghostty keeps its built-in default for that slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DefaultColors {
    pub background: Option<Rgb>,
    pub foreground: Option<Rgb>,
    pub cursor: Option<Rgb>,
    pub scheme: ColorScheme,
}

impl Default for DefaultColors {
    fn default() -> Self {
        Self {
            background: None,
            foreground: None,
            cursor: None,
            scheme: ColorScheme::Dark,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn light_background_reports_light_scheme() {
        // Catppuccin Latte background (#eff1f5) is unambiguously light.
        let latte_bg = Rgb::new(0xef, 0xf1, 0xf5);
        assert!(latte_bg.luminance() > LIGHT_LUMINANCE_THRESHOLD);
        assert_eq!(
            ColorScheme::from_background(Some(latte_bg)),
            ColorScheme::Light
        );
    }

    #[test]
    fn dark_background_reports_dark_scheme() {
        // Catppuccin Mocha background (#1e1e2e) is unambiguously dark.
        let mocha_bg = Rgb::new(0x1e, 0x1e, 0x2e);
        assert_eq!(
            ColorScheme::from_background(Some(mocha_bg)),
            ColorScheme::Dark
        );
    }

    #[test]
    fn missing_background_defaults_to_dark() {
        assert_eq!(ColorScheme::from_background(None), ColorScheme::Dark);
    }
}
