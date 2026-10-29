//! The window the visuals live in.
//!
//! A plain top-level window, created by hand rather than by a windowing
//! library: the toolkit the app already uses owns its own event loop, and a
//! second one in the same process is a fight nobody needs to have.
//!
//! The window is borderless (`WS_POPUP` with no caption), always on top
//! (`WS_EX_TOPMOST`), never in the taskbar (`WS_EX_TOOLWINDOW`) and never
//! takes the focus (`WS_EX_NOACTIVATE`) — a visualiser that steals the focus
//! while you are typing in something else is worse than no visualiser.
//!
//! The window and its message pump must live on ONE thread, and so must the
//! graphics device and the engine: the swap chain is bound to the window and
//! to the thread that created it.

use std::sync::atomic::{AtomicBool, Ordering};

/// Set by the window procedure when the picture is double-clicked. The
/// engine asks for it once a frame, because the window procedure cannot
/// reach the engine and the engine cannot touch the window's message queue
/// from inside a callback.
static FULLSCREEN_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Has the picture been double-clicked since this was last asked?
pub fn take_fullscreen_request() -> bool {
    FULLSCREEN_REQUESTED.swap(false, Ordering::SeqCst)
}

#[cfg(target_os = "windows")]
mod imp {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, HBRUSH, MONITORINFO, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
        MonitorFromPoint, MonitorFromWindow,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::*;

/// The window's own frame: a caption to drag it by, a thick frame to resize
/// it, and a system menu so it has a close button — and nothing else, the
/// way the original renderer's window looked.
const STYLE: WINDOW_STYLE = WINDOW_STYLE(
    (WS_OVERLAPPED.0 | WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0) as u32,
);

/// The window's extended frame: out of the taskbar, always on top, and it
/// never takes the keyboard focus away from the app.
const EXSTYLE: WINDOW_EX_STYLE = WINDOW_EX_STYLE(
    (WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0 | WS_EX_NOACTIVATE.0) as u32,
);

/// the window's own menu
const MENU_ALWAYS_ON_TOP: PCWSTR = w!("Always on top");
const MENU_CLOSE: PCWSTR = w!("Close");

/// whether the listener wants the window above everything
static ALWAYS_ON_TOP: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(true);

/// The window class, registered once per process.
fn class_name() -> PCWSTR {
    w!("MUN15HVisualiser")
}

    /// Register the window class. A second registration is not an error: the
    /// class may already be there from a previous visualiser in the session.
    pub fn register_class() -> Result<(), String> {
        unsafe {
            let module = GetModuleHandleW(None).map_err(|e| e.to_string())?;
            let class = WNDCLASSW {
                /* CS_DBLCLKS is what makes the window report a double
                   click at all: without it the system sends two separate
                   clicks and WM_LBUTTONDBLCLK never arrives */
                style: WNDCLASS_STYLES(CS_DBLCLKS.0),
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: HINSTANCE(module.0),
                hIcon: HICON::default(),
                hCursor: HCURSOR::default(),
                hbrBackground: HBRUSH::default(),
                lpszMenuName: PCWSTR::null(),
                lpszClassName: class_name(),
            };
            let _ = RegisterClassW(&class);
            Ok(())
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_DESTROY => {
                let _ = PostQuitMessage(0);
                LRESULT(0)
            }
            WM_LBUTTONDBLCLK => {
                /* a double-click on the picture goes full screen — the way the
                   original renderer did it */
                super::FULLSCREEN_REQUESTED
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                LRESULT(0)
            }
            WM_RBUTTONUP => {
                /* the menu the listener asked for: the window's own options,
                   where the window is */
                show_menu(hwnd);
                LRESULT(0)
            }
            /* no hit-test override: the system's own answer is what makes the
               title bar drag the window and the borders resize it */
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    /// the window's own menu
    fn show_menu(hwnd: HWND) {
        unsafe {
            let menu = match CreatePopupMenu() {
                Ok(m) => m,
                Err(_) => return,
            };
            let always_on_top = ALWAYS_ON_TOP.load(std::sync::atomic::Ordering::SeqCst);
            let _ = AppendMenuW(
                menu,
                MF_STRING | if always_on_top { MF_CHECKED } else { MENU_ITEM_FLAGS(0) },
                1001,
                MENU_ALWAYS_ON_TOP,
            );
            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
            let _ = AppendMenuW(menu, MF_STRING, 1002, MENU_CLOSE);
            let _ = SetForegroundWindow(hwnd);
            let choice = TrackPopupMenu(
                menu,
                TPM_LEFTALIGN | TPM_TOPALIGN | TPM_RIGHTBUTTON | TPM_RETURNCMD,
                0,
                0,
                Some(0),
                hwnd,
                None,
            );
            let _ = DestroyMenu(menu);
            match choice.0 as u32 {
                1001 => {
                    let on = !ALWAYS_ON_TOP.load(std::sync::atomic::Ordering::SeqCst);
                    ALWAYS_ON_TOP.store(on, std::sync::atomic::Ordering::SeqCst);
                    set_always_on_top(hwnd, on);
                }
                1002 => {
                    let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
                }
                _ => {}
            }
        }
    }

    /// put the window above everything, or let it go
    fn set_always_on_top(hwnd: HWND, on: bool) {
        unsafe {
            let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            if on {
                ex |= WS_EX_TOPMOST.0 as isize;
            } else {
                ex &= !(WS_EX_TOPMOST.0 as isize);
            }
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
            let _ = SetWindowPos(
                hwnd,
                Some(if on { HWND_TOPMOST } else { HWND_NOTOPMOST }),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            );
        }
    }

    /// The monitor the listener is looking at.
    ///
    /// The visualiser follows the eye: a window left behind on another desk is
    /// a window nobody can see.
    fn listener_monitor() -> Option<(i32, i32, i32, i32)> {
        unsafe {
            let foreground = GetForegroundWindow();
            let hmon = if foreground.is_invalid() {
                MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY)
            } else {
                MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST)
            };
            if hmon.is_invalid() {
                return None;
            }
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                rcMonitor: RECT::default(),
                rcWork: RECT::default(),
                dwFlags: 0,
            };
            if !GetMonitorInfoW(hmon, &mut info).as_bool() {
                return None;
            }
            Some((
                info.rcMonitor.left,
                info.rcMonitor.top,
                info.rcMonitor.right - info.rcMonitor.left,
                info.rcMonitor.bottom - info.rcMonitor.top,
            ))
        }
    }

    /// the window's own frame: a caption to drag it by, a thick frame to
    /// The window size that gives a client area of the size asked for.
    fn window_size_for_client(width: u32, height: u32) -> (i32, i32) {
        unsafe {
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: width as i32,
                bottom: height as i32,
            };
            let _ = AdjustWindowRectEx(&mut rect, STYLE, false, EXSTYLE);
            (
                (rect.right - rect.left).max(1),
                (rect.bottom - rect.top).max(1),
            )
        }
    }

    pub struct VisualizerWindow {
        pub hwnd: HWND,
        /// the size to come back to when the full screen ends
        restore_w: u32,
        restore_h: u32,
    }

    impl VisualizerWindow {
        /// Make a window whose CLIENT area is the given size.
        ///
        /// The size asked for is the size of the picture, so the frame the
        /// system draws around it is added on top — otherwise the picture
        /// would be cropped by the title bar and the borders.
        pub fn new(width: u32, height: u32) -> Result<Self, String> {
            register_class()?;
            unsafe {
                let module = GetModuleHandleW(None).map_err(|e| e.to_string())?;
                /* in the middle of the screen, not in the corner */
                let screen_w = GetSystemMetrics(SM_CXSCREEN);
                let screen_h = GetSystemMetrics(SM_CYSCREEN);
                let (frame_w, frame_h) = window_size_for_client(width, height);
                let x = (screen_w - frame_w) / 2;
                let y = (screen_h - frame_h) / 2;
                let hwnd = CreateWindowExW(
                    EXSTYLE,
                    class_name(),
                    w!("MILKDROP 2"),
                    STYLE,
                    x,
                    y,
                    frame_w,
                    frame_h,
                    None,
                    None,
                    Some(HINSTANCE(module.0)),
                    None,
                )
                .map_err(|e| e.to_string())?;
                Ok(Self {
                    hwnd,
                    restore_w: width,
                    restore_h: height,
                })
            }
        }

        /// The handle, in the shape the graphics driver wants it.
        pub fn raw_handle(&self) -> Option<wgpu::rwh::RawWindowHandle> {
            use std::num::NonZeroIsize;
            let handle = NonZeroIsize::new(self.hwnd.0 as isize)?;
            Some(wgpu::rwh::RawWindowHandle::Win32(
                wgpu::rwh::Win32WindowHandle::new(handle),
            ))
        }

        /// Move and resize it. The size asked for is the size of the PICTURE,
        /// so the frame is added on top of it.
        pub fn place(&self, x: i32, y: i32, width: u32, height: u32) {
            unsafe {
                let (frame_w, frame_h) = window_size_for_client(width, height);
                let _ = SetWindowPos(
                    self.hwnd,
                    Some(HWND_TOPMOST),
                    x,
                    y,
                    frame_w,
                    frame_h,
                    SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                );
            }
        }

        /// The size of the picture — the client area, without the frame.
        pub fn client_size(&self) -> Option<(u32, u32)> {
            unsafe {
                let mut rect = RECT::default();
                if GetClientRect(self.hwnd, &mut rect).is_err() {
                    return None;
                }
                Some((
                    (rect.right - rect.left).max(0) as u32,
                    (rect.bottom - rect.top).max(0) as u32,
                ))
            }
        }

        /// Where the window is on the screen.
        pub fn position(&self) -> Option<(i32, i32)> {
            unsafe {
                let mut rect = RECT::default();
                if GetWindowRect(self.hwnd, &mut rect).is_err() {
                    return None;
                }
                Some((rect.left, rect.top))
            }
        }

        /// Go full screen, or come back.
        ///
        /// Full screen here means what it means in the original renderer: no
        /// frame, no caption, and the whole monitor. The picture keeps its
        /// own resolution and is stretched to fill — the same "canvas
        /// stretch" the renderer documented.
        pub fn set_fullscreen(&self, on: bool) {
            unsafe {
                let screen_w = GetSystemMetrics(SM_CXSCREEN);
                let screen_h = GetSystemMetrics(SM_CYSCREEN);
                if on {
                    SetWindowLongPtrW(self.hwnd, GWL_STYLE, (WS_POPUP | WS_VISIBLE).0 as isize);
                    let _ = SetWindowPos(
                        self.hwnd,
                        Some(HWND_TOPMOST),
                        0,
                        0,
                        screen_w,
                        screen_h,
                        SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
                    );
                } else {
                    SetWindowLongPtrW(self.hwnd, GWL_STYLE, (STYLE | WS_VISIBLE).0 as isize);
                    let (frame_w, frame_h) = window_size_for_client(self.restore_w, self.restore_h);
                    let x = (screen_w - frame_w) / 2;
                    let y = (screen_h - frame_h) / 2;
                    let _ = SetWindowPos(
                        self.hwnd,
                        Some(HWND_TOPMOST),
                        x,
                        y,
                        frame_w,
                        frame_h,
                        SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
                    );
                }
            }
        }

        /// remember the size to come back to
        pub fn remember_size(&mut self, width: u32, height: u32) {
            self.restore_w = width;
            self.restore_h = height;
        }

        /// Hide it without destroying it — the engine keeps running.
        pub fn hide(&self) {
            unsafe {
                let _ = ShowWindow(self.hwnd, SW_HIDE);
            }
        }

        /// Show it for the first time — called once the engine has a picture,
        /// so a white window never flashes on the screen.
        pub fn reveal(&self) {
            unsafe {
                let _ = ShowWindow(self.hwnd, SW_SHOW);
                let _ = SetForegroundWindow(self.hwnd);
            }
        }

        /// The size of the display the listener is looking at.
        pub fn monitor_size(&self) -> Option<(i32, i32)> {
            listener_monitor().map(|(_, _, w, h)| (w, h))
        }

        /// Follow the listener to another desk.
        ///
        /// A window left behind on a monitor nobody is looking at is a window
        /// nobody can see, so when the eye moves the picture moves with it.
        pub fn follow_eye(&self) {
            let Some((x, y, w, h)) = listener_monitor() else {
                return;
            };
            /* already on that monitor? then leave it alone */
            let Some((lx, ly, lw, lh)) = self.client_rect_screen() else {
                return;
            };
            if lx >= x && ly >= y && lx + lw <= x + w && ly + lh <= y + h {
                return;
            }
            /* put it in the middle of the monitor the listener is on */
            let (cw, ch) = self.client_size().unwrap_or((512, 384));
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: cw as i32,
                bottom: ch as i32,
            };
            unsafe {
                let style = GetWindowLongPtrW(self.hwnd, GWL_STYLE);
                let _ = AdjustWindowRectEx(&mut rect, WINDOW_STYLE(style as u32), false, EXSTYLE);
                let fw = rect.right - rect.left;
                let fh = rect.bottom - rect.top;
                let nx = x + ((w - fw) / 2).max(0);
                let ny = y + ((h - fh) / 2).max(0);
                let _ = SetWindowPos(
                    self.hwnd,
                    None,
                    nx,
                    ny,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                );
            }
        }

        /// the client area, in screen coordinates
        fn client_rect_screen(&self) -> Option<(i32, i32, i32, i32)> {
            unsafe {
                let mut rect = RECT::default();
                if GetWindowRect(self.hwnd, &mut rect).is_err() {
                    return None;
                }
                Some((
                    rect.left,
                    rect.top,
                    rect.right - rect.left,
                    rect.bottom - rect.top,
                ))
            }
        }

        pub fn show(&self) {
            unsafe {
                let _ = ShowWindow(self.hwnd, SW_SHOW);
            }
        }

        /// Take the window down for good.
        pub fn destroy(&self) {
            unsafe {
                let _ = DestroyWindow(self.hwnd);
            }
        }

        /// Pump the window's messages without blocking.
        ///
        /// The render loop calls this every frame: a blocking wait would stop
        /// the pictures, and the window has to be pumped on the thread that
        /// made it.
        pub fn pump(&self) {
            unsafe {
                let mut msg = MSG::default();
                /* the remove-flag is a plain number here */
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }
    }
}

/// Everywhere else there is no window to make, and the visualiser says so
/// rather than pretending.
#[cfg(not(target_os = "windows"))]
mod imp {
    pub struct VisualizerWindow;

    impl VisualizerWindow {
        pub fn new(_width: u32, _height: u32) -> Result<Self, String> {
            Err("the floating visualiser needs Windows".into())
        }
        pub fn raw_handle(&self) -> Option<wgpu::rwh::RawWindowHandle> {
            None
        }
        pub fn place(&self, _x: i32, _y: i32, _width: u32, _height: u32) {}
        pub fn client_size(&self) -> Option<(u32, u32)> {
            None
        }
        pub fn position(&self) -> Option<(i32, i32)> {
            None
        }
        pub fn set_fullscreen(&self, _on: bool) {}
        pub fn remember_size(&mut self, _width: u32, _height: u32) {}
        pub fn reveal(&self) {}
        pub fn follow_eye(&self) {}
        pub fn monitor_size(&self) -> Option<(i32, i32)> {
            None
        }
        pub fn hide(&self) {}
        pub fn show(&self) {}
        pub fn destroy(&self) {}
        pub fn pump(&self) {}
    }
}

pub use imp::VisualizerWindow;
