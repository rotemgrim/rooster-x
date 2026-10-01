// Package classicio makes anacrolix/torrent use plain file reads/writes
// instead of memory-mapped files. Its mmap file IO never unmaps a file when a
// torrent is dropped, so on Windows the file stays locked until the process
// exits and a removed download can't be deleted.
//
// anacrolix reads TORRENT_STORAGE_DEFAULT_FILE_IO in its storage package's
// init. Go initializes ready packages in import-path order, and this package
// only depends on syscall, so it is initialized before "os" (and therefore
// before anything that needs os, including the storage package).
package classicio

import "syscall"

func init() {
	if _, ok := syscall.Getenv("TORRENT_STORAGE_DEFAULT_FILE_IO"); !ok {
		_ = syscall.Setenv("TORRENT_STORAGE_DEFAULT_FILE_IO", "classic")
	}
}
