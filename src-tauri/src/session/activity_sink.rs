//! Liveness signal for the session list: while a child is producing output it is
//! *running* (green); once it falls quiet it is *idle* (grey), waiting on input.
//!
//! This sink emits a tiny `agent:activity` event on each output chunk —
//! throttled, because PTY output is bursty — so the frontend can timestamp the
//! last activity and flip a session to idle after a quiet window. The idle
//! decision lives in the UI (a timeout against the last ping); the backend only
//! reports that output happened, keeping this sink stateless beyond its throttle.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::session::id::SessionId;
use crate::session::sink::OutputSink;

pub const AGENT_ACTIVITY_EVENT: &str = "agent:activity";

/// Wire shape of the `agent:activity` Tauri event: just the session, since the
/// frontend stamps the arrival time itself (the event IS the signal).
#[derive(Debug, Clone, Serialize)]
pub struct ActivityPayload<'a> {
    pub session_id: &'a str,
}

/// Minimum gap between pings per session. Output arrives in many small chunks
/// under load; coalescing to one ping per window keeps IPC cheap while staying
/// well under the UI's idle threshold, so continuous output never reads as idle.
const THROTTLE: Duration = Duration::from_millis(250);

/// Whether a ping is due: always on the first write, then no more than once per
/// [`THROTTLE`]. Pure (takes the clock) so the throttle is unit-testable without
/// a Tauri runtime.
fn should_emit(last: Option<Instant>, now: Instant) -> bool {
    last.is_none_or(|t| now.duration_since(t) >= THROTTLE)
}

/// `OutputSink` that reports output activity as a throttled `agent:activity`
/// event. Carries no terminal state — every non-`write` hook keeps its default
/// no-op.
pub struct ActivitySink<R: Runtime> {
    app: AppHandle<R>,
    session_id: SessionId,
    last_emit: Mutex<Option<Instant>>,
}

impl<R: Runtime> ActivitySink<R> {
    pub fn new(app: AppHandle<R>, session_id: SessionId) -> Self {
        Self {
            app,
            session_id,
            last_emit: Mutex::new(None),
        }
    }
}

impl<R: Runtime> OutputSink for ActivitySink<R> {
    fn write(&self, _bytes: &[u8]) {
        let now = Instant::now();
        {
            let mut last = self
                .last_emit
                .lock()
                .expect("ActivitySink last_emit mutex poisoned");
            if !should_emit(*last, now) {
                return;
            }
            *last = Some(now);
        }
        let _ = self.app.emit(
            AGENT_ACTIVITY_EVENT,
            ActivityPayload {
                session_id: self.session_id.as_str(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_event_name_is_stable() {
        assert_eq!(AGENT_ACTIVITY_EVENT, "agent:activity");
    }

    #[test]
    fn first_write_always_emits() {
        assert!(should_emit(None, Instant::now()));
    }

    #[test]
    fn writes_within_the_throttle_window_are_coalesced() {
        let t0 = Instant::now();
        let within = t0 + THROTTLE - Duration::from_millis(1);
        assert!(!should_emit(Some(t0), within));
    }

    #[test]
    fn a_write_after_the_throttle_window_emits_again() {
        let t0 = Instant::now();
        let after = t0 + THROTTLE;
        assert!(should_emit(Some(t0), after));
    }

    #[test]
    fn payload_serializes_with_session_id() {
        let id = SessionId::new();
        let json = serde_json::to_value(ActivityPayload {
            session_id: id.as_str(),
        })
        .expect("serialize payload");
        assert_eq!(json["session_id"], id.as_str());
    }
}
