// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
    io,
    time::{Duration, Instant},
};

pub(crate) fn require_non_null_handle(
    handle: isize,
    operation: &str,
    error: u32,
) -> io::Result<isize> {
    if handle == 0 {
        return Err(io::Error::other(format!(
            "{operation} returned NULL; Win32 error={error}; required=valid handle"
        )));
    }
    Ok(handle)
}

pub(crate) fn forward_to_primary<T>(
    limit: Duration,
    find: impl FnMut() -> Option<T>,
    send: impl FnMut(T, Duration) -> io::Result<()>,
) -> io::Result<()> {
    forward_to_primary_with_clock(limit, find, send, Instant::now, std::thread::sleep)
}

fn forward_to_primary_with_clock<T>(
    limit: Duration,
    mut find: impl FnMut() -> Option<T>,
    mut send: impl FnMut(T, Duration) -> io::Result<()>,
    mut now: impl FnMut() -> Instant,
    mut sleep: impl FnMut(Duration),
) -> io::Result<()> {
    let started = now();
    let deadline = started + limit;
    loop {
        let window = find();
        let observed = now();
        let remaining = deadline.saturating_duration_since(observed);
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!(
                    "single-instance primary window discovery exceeded {}ms; elapsed={}ms; required=valid HWND before forwarding",
                    limit.as_millis(),
                    observed.saturating_duration_since(started).as_millis()
                ),
            ));
        }
        if let Some(window) = window {
            // A failed send can have an uncertain outcome. Do not submit twice.
            return send(window, remaining);
        }
        sleep(remaining.min(Duration::from_millis(20)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, time::Instant};

    #[test]
    fn null_mutex_and_window_handles_fail_with_the_native_error() {
        for stage in ["CreateMutexW", "CreateWindowExW"] {
            let error = require_non_null_handle(0, stage, 5)
                .unwrap_err()
                .to_string();
            assert!(
                error.contains(stage) && error.contains("5") && error.contains("NULL"),
                "missing failed native check: {error}"
            );
        }
        assert_eq!(require_non_null_handle(7, "CreateMutexW", 0).unwrap(), 7);
    }

    #[test]
    fn existing_instance_waits_for_its_window_and_forwards_exactly_once() {
        let clock = Cell::new(Instant::now());
        let probes = Cell::new(0);
        let sends = Cell::new(0);
        forward_to_primary_with_clock(
            Duration::from_millis(100),
            || {
                probes.set(probes.get() + 1);
                (probes.get() == 3).then_some(42)
            },
            |window, remaining| {
                assert_eq!(window, 42);
                assert_eq!(remaining, Duration::from_millis(60));
                sends.set(sends.get() + 1);
                Ok(())
            },
            || clock.get(),
            |duration| clock.set(clock.get() + duration),
        )
        .unwrap();
        assert_eq!(probes.get(), 3);
        assert_eq!(sends.get(), 1);
    }

    #[test]
    fn absent_primary_window_times_out_instead_of_starting_another_instance() {
        let start = Instant::now();
        let clock = Cell::new(start);
        let error = forward_to_primary_with_clock::<usize>(
            Duration::from_millis(10),
            || None,
            |_, _| panic!("missing window cannot receive arguments"),
            || clock.get(),
            |duration| {
                assert_eq!(duration, Duration::from_millis(10));
                clock.set(clock.get() + duration);
            },
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("primary window")
                && error.contains("exceeded 10ms")
                && error.contains("elapsed=10ms"),
            "missing bounded discovery evidence: {error}"
        );
        assert_eq!(clock.get().duration_since(start), Duration::from_millis(10));
    }

    #[test]
    fn rejected_or_uncertain_delivery_is_returned_without_retrying() {
        let clock = Cell::new(Instant::now());
        let sends = Cell::new(0);
        let error = forward_to_primary_with_clock(
            Duration::from_millis(100),
            || Some(42),
            |_, _| {
                sends.set(sends.get() + 1);
                Err(io::Error::other(
                    "SendMessageTimeoutW returned 0; Win32 error=1460",
                ))
            },
            || clock.get(),
            |_| panic!("available window must not wait"),
        )
        .unwrap_err()
        .to_string();
        assert_eq!(sends.get(), 1);
        assert!(error.contains("1460"));
    }

    #[test]
    fn window_found_at_or_after_deadline_is_not_forwarded() {
        // Exercise the production clock wrapper without any real waiting.
        let error = forward_to_primary(
            Duration::ZERO,
            || Some(42),
            |_, _| panic!("zero discovery budget must not forward arguments"),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);

        for elapsed_ms in [100, 101] {
            let start = Instant::now();
            let clock = Cell::new(start);
            let error = forward_to_primary_with_clock(
                Duration::from_millis(100),
                || {
                    clock.set(start + Duration::from_millis(elapsed_ms));
                    Some(42)
                },
                |_, _| panic!("late window must not receive arguments"),
                || clock.get(),
                |_| panic!("expired discovery must not wait"),
            )
            .unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::TimedOut);
            let message = error.to_string();
            assert!(message.contains("exceeded 100ms"), "{message}");
            assert!(
                message.contains(&format!("elapsed={elapsed_ms}ms")),
                "{message}"
            );
        }
    }
}
