//go:build windows

package server

import "syscall"

// ASFW_ANY allows any process to receive foreground focus until the next
// foreground change.
const aSFW_ANY = ^uintptr(0) // 0xFFFFFFFF / -1 cast to DWORD

// allowChildForeground gives the next-launched child process permission to
// take focus on Windows. Without this, processes spawned from a background
// app (like mpv from the rooster server) open behind other windows because
// Windows' focus-stealing prevention denies them foreground rights.
func allowChildForeground() {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("AllowSetForegroundWindow")
	// Best effort — ignore errors, the worst case is the existing behavior.
	_, _, _ = proc.Call(aSFW_ANY)
}
