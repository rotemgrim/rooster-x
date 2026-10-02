// C interface over libtorrent for cgo. Mechanism only: the Go engine package
// decides what to do (part files, seeding limits, queueing policy, ...).
//
// Torrents are identified by their v1 info hash as 40 lowercase hex chars.
// Functions returning char* return malloc'd UTF-8 (JSON or an error message)
// that the caller frees with lt_free. Error messages are NULL on success.
#ifndef ROOSTERX_LT_SHIM_H
#define ROOSTERX_LT_SHIM_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct lt_session lt_session;

typedef struct {
	int download_rate_limit; // bytes/s, 0 = unlimited
	int upload_rate_limit;
	int active_downloads; // -1 = unlimited
	int connections_limit; // across all torrents
	// Offline opens no sockets and finds no peers (no listening, DHT, local
	// discovery or port mapping); for tests. Only read by lt_create.
	int offline;
} lt_settings;

typedef struct {
	const char* magnet;
	// A .torrent file to add instead of the magnet (tests).
	const char* torrent_file;
	// A fast-resume file written by lt_save_resume. When it exists the
	// torrent is restored from it and the fields below are ignored.
	const char* resume_file;
	const char* save_path;
	int paused;
	int sequential;
	// Connects to peers (so a magnet's metadata arrives) but downloads no
	// pieces.
	int upload_mode;
	int max_connections; // -1 = unlimited
	// Carried over when adding a magnet without resume data.
	int64_t added_time;
	int64_t completed_time;
	int64_t total_downloaded;
	int64_t total_uploaded;
} lt_add_params;

// state_file holds DHT state between runs; it may not exist yet.
lt_session* lt_create(const lt_settings* s, const char* state_file, char** err);
// Saves the DHT state and shuts down. Save resume data first.
void lt_destroy(lt_session* s);
void lt_apply_settings(lt_session* s, const lt_settings* settings);

// hash_out receives 40 hex chars plus a terminating NUL.
char* lt_add(lt_session* s, const lt_add_params* p, char* hash_out);
// Removes the torrent; its files stay on disk.
char* lt_remove(lt_session* s, const char* hash);
// Paused torrents are taken out of the automatic queue; resumed ones rejoin
// it, so the active download limit decides whether they actually start.
char* lt_set_paused(lt_session* s, const char* hash, int paused);
char* lt_set_sequential(lt_session* s, const char* hash, int on);
char* lt_set_upload_mode(lt_session* s, const char* hash, int on);
char* lt_set_max_connections(lt_session* s, const char* hash, int n);
// Sets the priority (0-7, 4 = default) of the listed pieces.
char* lt_set_piece_priorities(lt_session* s, const char* hash, const int* pieces, int n, int priority);
char* lt_rename_file(lt_session* s, const char* hash, int file, const char* name);
char* lt_force_recheck(lt_session* s, const char* hash);

// JSON array of torrent statuses; with_pieces adds the verified-piece
// bitfield as a "0"/"1" string. hash may be NULL for all torrents.
char* lt_status(lt_session* s, const char* hash, int with_pieces, char** err);
// JSON array of events since the last call (metadata received, data
// checked, file completed, file renamed, errors).
char* lt_poll_events(lt_session* s);

// Asks for pieces [first, first+count) to arrive in order, the first within
// step_ms, the next within 2*step_ms and so on (streaming read-ahead).
char* lt_set_deadlines(lt_session* s, const char* hash, int first, int count, int step_ms);
// Copies a piece into buf, fetching it first with top priority if needed.
// Returns the piece size, -1 on error (*err set) or -2 if it hasn't arrived
// within timeout_ms (call again).
int lt_read_piece(lt_session* s, const char* hash, int piece, char* buf, int buf_len, int timeout_ms, char** err);

// Writes <dir>/<hash>.fastresume for every torrent (or only those that
// changed) and waits for the writes, up to timeout_ms.
char* lt_save_resume(lt_session* s, const char* dir, int only_if_needed, int timeout_ms);

void lt_free(void* p);

#ifdef __cplusplus
}
#endif

#endif
