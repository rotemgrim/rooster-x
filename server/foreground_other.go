//go:build !windows

package server

// allowChildForeground is a no-op on non-Windows platforms.
func allowChildForeground() {}
