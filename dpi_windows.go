package main

import "syscall"

// The exe's manifest is MinGW gcc's default one (the torrent engine needs
// cgo, and ld can't merge a manifest of ours with it; see scripts/rsrc.rc),
// so DPI awareness is set here, before any window exists. System-aware keeps
// the tray menu sharp on scaled displays.
func init() {
	const systemAware = ^uintptr(1) // DPI_AWARENESS_CONTEXT_SYSTEM_AWARE (-2)
	proc := syscall.NewLazyDLL("user32.dll").NewProc("SetProcessDpiAwarenessContext")
	if proc.Find() == nil {
		_, _, _ = proc.Call(systemAware)
	}
}
