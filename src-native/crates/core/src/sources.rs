#![allow(unsafe_code)]

use sonicplank_ipc::{CaptureSource, CaptureSourceKind};
use windows::{
    core::BOOL,
    Graphics::Capture::GraphicsCaptureItem,
    Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::Gdi::{
            EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW,
        },
        System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop,
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
            GWL_EXSTYLE, GWL_STYLE, WS_EX_TOOLWINDOW, WS_MINIMIZE,
        },
    },
};

/// Return every capturable monitor and visible application window.
pub fn enumerate() -> Vec<CaptureSource> {
    let mut sources = Vec::new();
    sources.extend(enumerate_monitors());
    sources.extend(enumerate_windows());
    sources
}

// ── Monitors ──────────────────────────────────────────────────────────────────

fn enumerate_monitors() -> Vec<CaptureSource> {
    let mut monitors: Vec<CaptureSource> = Vec::new();

    unsafe {
        let _ = EnumDisplayMonitors(
            None::<HDC>,
            None,
            Some(monitor_enum_proc),
            LPARAM(&raw mut monitors as isize),
        );
    }

    monitors
}

unsafe extern "system" fn monitor_enum_proc(
    hmonitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let monitors = &mut *(lparam.0 as *mut Vec<CaptureSource>);

    // Verify WGC can capture this monitor before advertising it.
    if capture_item_for_monitor(hmonitor).is_err() {
        return BOOL(1); // continue enumeration
    }

    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(hmonitor, &raw mut info.monitorInfo).as_bool() {
        let name = String::from_utf16_lossy(
            &info.szDevice[..info.szDevice.iter().position(|&c| c == 0).unwrap_or(32)],
        );
        let index = monitors.len();
        monitors.push(CaptureSource {
            id: format!("monitor:{index}"),
            name: if name.is_empty() {
                format!("Display {}", index + 1)
            } else {
                name
            },
            kind: CaptureSourceKind::Monitor,
        });
    }

    BOOL(1) // continue
}

// ── Windows ───────────────────────────────────────────────────────────────────

fn enumerate_windows() -> Vec<CaptureSource> {
    let mut windows: Vec<CaptureSource> = Vec::new();

    unsafe {
        let _ = EnumWindows(
            Some(window_enum_proc),
            LPARAM(&raw mut windows as isize),
        );
    }

    windows
}

unsafe extern "system" fn window_enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam.0 as *mut Vec<CaptureSource>);

    // Skip invisible, minimized, and tool windows.
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
    if style & WS_MINIMIZE.0 != 0 {
        return BOOL(1);
    }
    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
        return BOOL(1);
    }

    // Skip windows with no title.
    let title_len = GetWindowTextLengthW(hwnd);
    if title_len == 0 {
        return BOOL(1);
    }

    // Verify WGC supports capturing this window.
    if capture_item_for_hwnd(hwnd).is_err() {
        return BOOL(1);
    }

    let mut buf = vec![0u16; title_len as usize + 1];
    GetWindowTextW(hwnd, &mut buf);
    let title = String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(0)]);

    windows.push(CaptureSource {
        id: format!("window:{:#010x}", hwnd.0 as usize),
        name: title,
        kind: CaptureSourceKind::Window,
    });

    BOOL(1) // continue
}

// ── Capture item construction ─────────────────────────────────────────────────

/// Build a [`GraphicsCaptureItem`] from a source id string.
/// Format: `"monitor:<index>"` or `"window:<hwnd_hex>"`.
pub fn capture_item_for_id(id: &str) -> windows::core::Result<GraphicsCaptureItem> {
    if let Some(rest) = id.strip_prefix("monitor:") {
        // Re-enumerate monitors in order and pick by index.
        let index: usize = rest.parse().unwrap_or(0);
        let hmonitor = nth_monitor(index)?;
        capture_item_for_monitor(hmonitor)
    } else if let Some(rest) = id.strip_prefix("window:") {
        let hwnd_val = usize::from_str_radix(rest.trim_start_matches("0x"), 16)
            .map_err(|_| windows::core::Error::from_win32())?;
        let hwnd = HWND(hwnd_val as *mut core::ffi::c_void);
        capture_item_for_hwnd(hwnd)
    } else {
        Err(windows::core::Error::from_win32())
    }
}

fn capture_item_for_monitor(hmonitor: HMONITOR) -> windows::core::Result<GraphicsCaptureItem> {
    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    unsafe { interop.CreateForMonitor(hmonitor) }
}

fn capture_item_for_hwnd(hwnd: HWND) -> windows::core::Result<GraphicsCaptureItem> {
    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    unsafe { interop.CreateForWindow(hwnd) }
}

fn nth_monitor(index: usize) -> windows::core::Result<HMONITOR> {
    struct State {
        target: usize,
        current: usize,
        result: Option<HMONITOR>,
    }

    unsafe extern "system" fn proc(
        hmonitor: HMONITOR,
        _: HDC,
        _: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let state = &mut *(lparam.0 as *mut State);
        if state.current == state.target {
            state.result = Some(hmonitor);
            return BOOL(0); // stop
        }
        state.current += 1;
        BOOL(1)
    }

    let mut state = State { target: index, current: 0, result: None };
    unsafe {
        let _ = EnumDisplayMonitors(
            None::<HDC>,
            None,
            Some(proc),
            LPARAM(&raw mut state as isize),
        );
    }
    state
        .result
        .ok_or_else(|| windows::core::Error::from_win32())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test — requires a real display; skipped in headless CI.
    #[test]
    #[ignore]
    fn enumerate_returns_at_least_one_monitor() {
        let sources = enumerate();
        let monitors: Vec<_> = sources
            .iter()
            .filter(|s| s.kind == CaptureSourceKind::Monitor)
            .collect();
        assert!(!monitors.is_empty(), "expected at least one monitor source");
        for m in &monitors {
            assert!(m.id.starts_with("monitor:"), "bad monitor id: {}", m.id);
            assert!(!m.name.is_empty(), "monitor name is empty");
        }
    }

    #[test]
    #[ignore]
    fn capture_item_for_primary_monitor() {
        let item = capture_item_for_id("monitor:0");
        assert!(item.is_ok(), "failed to create capture item: {item:?}");
    }
}
