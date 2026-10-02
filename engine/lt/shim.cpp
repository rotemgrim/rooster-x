// C interface over libtorrent; see shim.h.

#include "shim.h"

#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/alert_types.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/read_resume_data.hpp>
#include <libtorrent/session.hpp>
#include <libtorrent/session_params.hpp>
#include <libtorrent/settings_pack.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/write_resume_data.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace fs = std::filesystem;

namespace {

char* dup(std::string const& s)
{
	char* p = static_cast<char*>(std::malloc(s.size() + 1));
	std::memcpy(p, s.c_str(), s.size() + 1);
	return p;
}

// Paths come from Go as UTF-8; on Windows a narrow fs::path would use the
// ANSI code page instead.
fs::path u8path(std::string const& s)
{
	return fs::path(std::u8string(s.begin(), s.end()));
}

bool read_file(std::string const& path, std::vector<char>& out)
{
	std::ifstream f(u8path(path), std::ios::binary);
	if (!f) return false;
	out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
	return true;
}

// Writes via a temporary file so a crash never leaves a truncated file.
std::string write_file(std::string const& path, std::vector<char> const& data)
{
	fs::path const target = u8path(path);
	fs::path tmp = target;
	tmp += ".tmp";
	{
		std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
		if (!f) return "cannot write " + path;
		f.write(data.data(), std::streamsize(data.size()));
		if (!f) return "cannot write " + path;
	}
	std::error_code ec;
	fs::rename(tmp, target, ec);
	return ec ? "cannot write " + path + ": " + ec.message() : std::string();
}

std::string hex(lt::sha1_hash const& h)
{
	static char const digits[] = "0123456789abcdef";
	std::string s;
	for (char c : h)
	{
		auto const b = static_cast<unsigned char>(c);
		s += digits[b >> 4];
		s += digits[b & 15];
	}
	return s;
}

bool parse_hash(char const* in, lt::sha1_hash& out)
{
	if (in == nullptr || std::strlen(in) != 40) return false;
	auto nibble = [](char c) {
		if (c >= '0' && c <= '9') return c - '0';
		if (c >= 'a' && c <= 'f') return c - 'a' + 10;
		if (c >= 'A' && c <= 'F') return c - 'A' + 10;
		return -1;
	};
	char bytes[20];
	for (int i = 0; i < 20; ++i)
	{
		int const hi = nibble(in[2 * i]);
		int const lo = nibble(in[2 * i + 1]);
		if (hi < 0 || lo < 0) return false;
		bytes[i] = char(hi << 4 | lo);
	}
	out = lt::sha1_hash(bytes);
	return true;
}

void json_string(std::string& o, std::string const& s)
{
	o += '"';
	for (char ch : s)
	{
		auto const c = static_cast<unsigned char>(ch);
		switch (c)
		{
			case '"': o += "\\\""; break;
			case '\\': o += "\\\\"; break;
			case '\n': o += "\\n"; break;
			case '\r': o += "\\r"; break;
			case '\t': o += "\\t"; break;
			default:
				if (c < 0x20)
				{
					char buf[8];
					std::snprintf(buf, sizeof buf, "\\u%04x", c);
					o += buf;
				}
				else o += ch;
		}
	}
	o += '"';
}

void json_field(std::string& o, char const* name)
{
	if (o.back() != '{') o += ',';
	o += '"';
	o += name;
	o += "\":";
}

void json_field(std::string& o, char const* name, std::string const& v) { json_field(o, name); json_string(o, v); }
void json_field(std::string& o, char const* name, std::int64_t v) { json_field(o, name); o += std::to_string(v); }
void json_field(std::string& o, char const* name, bool v) { json_field(o, name); o += v ? "true" : "false"; }
void json_field(std::string& o, char const* name, double v)
{
	char buf[32];
	std::snprintf(buf, sizeof buf, "%.4f", v);
	json_field(o, name);
	o += buf;
}

lt::settings_pack make_settings(lt_settings const& s)
{
	lt::settings_pack p;
	p.set_int(lt::settings_pack::download_rate_limit, s.download_rate_limit);
	p.set_int(lt::settings_pack::upload_rate_limit, s.upload_rate_limit);
	// Only downloads are queued; finished torrents all keep seeding until the
	// Go side's seeding limits stop them.
	p.set_int(lt::settings_pack::active_downloads, s.active_downloads);
	p.set_int(lt::settings_pack::active_seeds, -1);
	p.set_int(lt::settings_pack::active_limit, -1);
	p.set_bool(lt::settings_pack::dont_count_slow_torrents, false);
	p.set_int(lt::settings_pack::connections_limit, s.connections_limit);
	return p;
}

struct piece_read
{
	bool done = false;
	int waiters = 0;
	std::string error;
	std::vector<char> data;
};

} // namespace

struct lt_session
{
	explicit lt_session(lt::session_params p) : ses(std::move(p)) {}

	lt::session ses;
	std::string state_file;
	std::thread alert_thread;
	std::atomic<bool> stopping{false};

	std::mutex mu; // guards everything below
	std::condition_variable cv;
	std::map<std::pair<lt::sha1_hash, int>, std::shared_ptr<piece_read>> reads;
	std::vector<std::string> events; // JSON objects
	int pending_resume = 0;
	std::string resume_dir;
	std::string resume_errors;

	lt::torrent_handle find(char const* hash) const
	{
		lt::sha1_hash ih;
		if (!parse_hash(hash, ih)) return {};
		return ses.find_torrent(ih);
	}

	void event(char const* type, lt::torrent_handle const& h, int file = -1
		, std::string const& name = {}, std::string const& message = {})
	{
		std::string o = "{";
		json_field(o, "type", std::string(type));
		json_field(o, "hash", hex(h.info_hashes().v1));
		if (file >= 0) json_field(o, "file", std::int64_t(file));
		if (!name.empty()) json_field(o, "name", name);
		if (!message.empty()) json_field(o, "message", message);
		o += '}';
		std::lock_guard<std::mutex> l(mu);
		events.push_back(std::move(o));
	}

	void alert_loop()
	{
		std::vector<lt::alert*> alerts;
		while (!stopping)
		{
			ses.wait_for_alert(std::chrono::milliseconds(250));
			ses.pop_alerts(&alerts);
			for (lt::alert* a : alerts) handle(a);
		}
	}

	void handle(lt::alert* a)
	{
		if (auto* r = lt::alert_cast<lt::read_piece_alert>(a))
		{
			std::lock_guard<std::mutex> l(mu);
			auto it = reads.find({r->handle.info_hashes().v1, static_cast<int>(r->piece)});
			if (it == reads.end() || it->second->done) return;
			piece_read& pr = *it->second;
			if (r->error) pr.error = r->error.message();
			else pr.data.assign(r->buffer.get(), r->buffer.get() + r->size);
			pr.done = true;
			cv.notify_all();
		}
		else if (auto* r = lt::alert_cast<lt::save_resume_data_alert>(a))
		{
			std::string dir;
			{
				std::lock_guard<std::mutex> l(mu);
				dir = resume_dir;
			}
			std::string const err = write_file(dir + "/" + hex(r->handle.info_hashes().v1) + ".fastresume"
				, lt::write_resume_data_buf(r->params));
			std::lock_guard<std::mutex> l(mu);
			if (!err.empty()) resume_errors += err + "; ";
			--pending_resume;
			cv.notify_all();
		}
		else if (auto* r = lt::alert_cast<lt::save_resume_data_failed_alert>(a))
		{
			std::lock_guard<std::mutex> l(mu);
			if (r->error != lt::errors::resume_data_not_modified)
				resume_errors += r->message() + "; ";
			--pending_resume;
			cv.notify_all();
		}
		else if (auto* r = lt::alert_cast<lt::metadata_received_alert>(a))
			event("metadata", r->handle);
		else if (auto* r = lt::alert_cast<lt::torrent_checked_alert>(a))
			event("checked", r->handle);
		else if (auto* r = lt::alert_cast<lt::file_completed_alert>(a))
			event("file_completed", r->handle, static_cast<int>(r->index));
		else if (auto* r = lt::alert_cast<lt::file_renamed_alert>(a))
			event("file_renamed", r->handle, static_cast<int>(r->index), r->new_name());
		else if (auto* r = lt::alert_cast<lt::file_rename_failed_alert>(a))
			event("file_rename_failed", r->handle, static_cast<int>(r->index), {}, r->error.message());
		else if (auto* r = lt::alert_cast<lt::torrent_error_alert>(a))
			event("error", r->handle, -1, {}, r->message());
		else if (auto* r = lt::alert_cast<lt::file_error_alert>(a))
			event("error", r->handle, -1, {}, r->message());
	}
};

namespace {

// Runs f against the torrent, turning failures into an error message.
template <typename F>
char* with_torrent(lt_session* s, char const* hash, F f)
{
	try
	{
		lt::torrent_handle h = s->find(hash);
		if (!h.is_valid()) return dup(std::string("torrent ") + (hash ? hash : "") + " not found");
		f(h);
		return nullptr;
	}
	catch (std::exception const& e)
	{
		return dup(e.what());
	}
}

void status_json(std::string& o, lt::torrent_handle const& h, bool with_pieces)
{
	lt::status_flags_t flags = lt::torrent_handle::query_name | lt::torrent_handle::query_save_path;
	if (with_pieces) flags |= lt::torrent_handle::query_pieces;
	lt::torrent_status const st = h.status(flags);

	o += '{';
	json_field(o, "hash", hex(st.info_hashes.v1));
	json_field(o, "name", st.name);
	json_field(o, "hasMetadata", st.has_metadata);
	json_field(o, "state", std::int64_t(st.state));
	json_field(o, "paused", bool(st.flags & lt::torrent_flags::paused));
	json_field(o, "autoManaged", bool(st.flags & lt::torrent_flags::auto_managed));
	json_field(o, "uploadMode", bool(st.flags & lt::torrent_flags::upload_mode));
	json_field(o, "finished", st.is_finished);
	json_field(o, "totalWanted", std::int64_t(st.total_wanted));
	json_field(o, "totalWantedDone", std::int64_t(st.total_wanted_done));
	json_field(o, "totalDone", std::int64_t(st.total_done));
	json_field(o, "downRate", std::int64_t(st.download_payload_rate));
	json_field(o, "upRate", std::int64_t(st.upload_payload_rate));
	json_field(o, "numPeers", std::int64_t(st.num_peers));
	json_field(o, "numSeeds", std::int64_t(st.num_seeds));
	json_field(o, "listPeers", std::int64_t(st.list_peers));
	json_field(o, "allTimeDownload", std::int64_t(st.all_time_download));
	json_field(o, "allTimeUpload", std::int64_t(st.all_time_upload));
	json_field(o, "addedTime", std::int64_t(st.added_time));
	json_field(o, "completedTime", std::int64_t(st.completed_time));
	json_field(o, "distributedCopies", double(st.distributed_copies));
	json_field(o, "numPieces", std::int64_t(st.num_pieces));
	json_field(o, "savePath", st.save_path);

	if (auto ti = h.torrent_file())
	{
		lt::file_storage const& fs = ti->files();
		json_field(o, "pieceCount", std::int64_t(ti->num_pieces()));
		json_field(o, "pieceLength", std::int64_t(ti->piece_length()));
		std::vector<std::int64_t> progress;
		h.file_progress(progress);
		json_field(o, "files");
		o += '[';
		for (lt::file_index_t i : fs.file_range())
		{
			if (fs.pad_file_at(i)) continue;
			if (o.back() != '[') o += ',';
			o += '{';
			json_field(o, "index", std::int64_t(static_cast<int>(i)));
			json_field(o, "path", fs.file_path(i));
			json_field(o, "size", std::int64_t(fs.file_size(i)));
			json_field(o, "offset", std::int64_t(fs.file_offset(i)));
			json_field(o, "done", progress[static_cast<std::size_t>(static_cast<int>(i))]);
			o += '}';
		}
		o += ']';
	}
	if (with_pieces)
	{
		std::string bits;
		bits.reserve(std::size_t(st.pieces.size()));
		for (bool have : st.pieces) bits += have ? '1' : '0';
		json_field(o, "pieces", bits);
	}
	o += '}';
}

} // namespace

extern "C" {

lt_session* lt_create(lt_settings const* s, char const* state_file, char** err)
{
	try
	{
		lt::session_params params;
		std::vector<char> buf;
		if (state_file && !s->offline && read_file(state_file, buf) && !buf.empty())
		{
			try { params = lt::read_session_params(buf, lt::session_handle::save_dht_state); }
			catch (std::exception const&) {} // a bad state file only costs DHT bootstrap time
		}
		params.settings = make_settings(*s);
		params.settings.set_int(lt::settings_pack::alert_mask
			, lt::alert_category::status | lt::alert_category::storage
			| lt::alert_category::error | lt::alert_category::file_progress);
		if (s->offline)
		{
			params.settings.set_str(lt::settings_pack::listen_interfaces, "");
			params.settings.set_bool(lt::settings_pack::enable_dht, false);
			params.settings.set_bool(lt::settings_pack::enable_lsd, false);
			params.settings.set_bool(lt::settings_pack::enable_upnp, false);
			params.settings.set_bool(lt::settings_pack::enable_natpmp, false);
		}
		auto* ls = new lt_session(std::move(params));
		ls->state_file = state_file && !s->offline ? state_file : "";
		ls->alert_thread = std::thread([ls] { ls->alert_loop(); });
		return ls;
	}
	catch (std::exception const& e)
	{
		*err = dup(e.what());
		return nullptr;
	}
}

void lt_destroy(lt_session* s)
{
	if (!s->state_file.empty())
	{
		try
		{
			write_file(s->state_file, lt::write_session_params_buf(
				s->ses.session_state(lt::session_handle::save_dht_state), lt::session_handle::save_dht_state));
		}
		catch (std::exception const&) {}
	}
	s->stopping = true;
	s->alert_thread.join();
	delete s;
}

void lt_apply_settings(lt_session* s, lt_settings const* settings)
{
	try { s->ses.apply_settings(make_settings(*settings)); }
	catch (std::exception const&) {}
}

char* lt_add(lt_session* s, lt_add_params const* p, char* hash_out)
{
	try
	{
		lt::add_torrent_params atp;
		bool resumed = false;
		std::vector<char> buf;
		if (p->resume_file && read_file(p->resume_file, buf))
		{
			lt::error_code ec;
			atp = lt::read_resume_data(buf, ec);
			resumed = !ec; // a damaged file falls back to the magnet below
		}
		if (!resumed)
		{
			if (p->torrent_file && *p->torrent_file)
			{
				lt::error_code ec;
				atp = lt::add_torrent_params{};
				atp.ti = std::make_shared<lt::torrent_info>(std::string(p->torrent_file), ec);
				if (ec) return dup(ec.message());
			}
			else
			{
				lt::error_code ec;
				atp = lt::parse_magnet_uri(p->magnet ? p->magnet : "", ec);
				if (ec) return dup("invalid magnet: " + ec.message());
			}
			// default_flags are paused + auto_managed: the queue starts it
			if (p->paused) atp.flags &= ~lt::torrent_flags::auto_managed;
			if (p->sequential) atp.flags |= lt::torrent_flags::sequential_download;
			if (p->upload_mode) atp.flags |= lt::torrent_flags::upload_mode;
			atp.added_time = std::time_t(p->added_time);
			atp.completed_time = std::time_t(p->completed_time);
			atp.total_downloaded = p->total_downloaded;
			atp.total_uploaded = p->total_uploaded;
		}
		atp.save_path = p->save_path;
		atp.max_connections = p->max_connections;
		lt::torrent_handle h = s->ses.add_torrent(std::move(atp));
		std::string const hash = hex(h.info_hashes().v1);
		std::memcpy(hash_out, hash.c_str(), hash.size() + 1);
		return nullptr;
	}
	catch (std::exception const& e)
	{
		return dup(e.what());
	}
}

char* lt_remove(lt_session* s, char const* hash)
{
	return with_torrent(s, hash, [s](lt::torrent_handle const& h) { s->ses.remove_torrent(h); });
}

char* lt_set_paused(lt_session* s, char const* hash, int paused)
{
	return with_torrent(s, hash, [paused](lt::torrent_handle const& h) {
		if (paused)
		{
			h.unset_flags(lt::torrent_flags::auto_managed);
			h.pause();
		}
		else
		{
			// the queue resumes it as soon as there is a free slot
			h.set_flags(lt::torrent_flags::auto_managed);
		}
	});
}

char* lt_set_sequential(lt_session* s, char const* hash, int on)
{
	return with_torrent(s, hash, [on](lt::torrent_handle const& h) {
		if (on) h.set_flags(lt::torrent_flags::sequential_download);
		else h.unset_flags(lt::torrent_flags::sequential_download);
	});
}

char* lt_set_upload_mode(lt_session* s, char const* hash, int on)
{
	return with_torrent(s, hash, [on](lt::torrent_handle const& h) {
		if (on) h.set_flags(lt::torrent_flags::upload_mode);
		else h.unset_flags(lt::torrent_flags::upload_mode);
	});
}

char* lt_set_max_connections(lt_session* s, char const* hash, int n)
{
	return with_torrent(s, hash, [n](lt::torrent_handle const& h) { h.set_max_connections(n); });
}

char* lt_set_piece_priorities(lt_session* s, char const* hash, int const* pieces, int n, int priority)
{
	return with_torrent(s, hash, [=](lt::torrent_handle const& h) {
		std::vector<std::pair<lt::piece_index_t, lt::download_priority_t>> v;
		v.reserve(std::size_t(n));
		for (int i = 0; i < n; ++i)
			v.emplace_back(lt::piece_index_t(pieces[i]), lt::download_priority_t(std::uint8_t(priority)));
		h.prioritize_pieces(v);
	});
}

char* lt_rename_file(lt_session* s, char const* hash, int file, char const* name)
{
	return with_torrent(s, hash, [=](lt::torrent_handle const& h) {
		h.rename_file(lt::file_index_t(file), name);
	});
}

char* lt_force_recheck(lt_session* s, char const* hash)
{
	return with_torrent(s, hash, [](lt::torrent_handle const& h) { h.force_recheck(); });
}

char* lt_status(lt_session* s, char const* hash, int with_pieces, char** err)
{
	try
	{
		std::vector<lt::torrent_handle> handles;
		if (hash)
		{
			lt::torrent_handle h = s->find(hash);
			if (!h.is_valid())
			{
				*err = dup(std::string("torrent ") + hash + " not found");
				return nullptr;
			}
			handles.push_back(h);
		}
		else handles = s->ses.get_torrents();

		std::string o = "[";
		for (auto const& h : handles)
		{
			if (!h.is_valid()) continue;
			if (o.back() != '[') o += ',';
			status_json(o, h, with_pieces != 0);
		}
		o += ']';
		return dup(o);
	}
	catch (std::exception const& e)
	{
		*err = dup(e.what());
		return nullptr;
	}
}

char* lt_poll_events(lt_session* s)
{
	std::vector<std::string> events;
	{
		std::lock_guard<std::mutex> l(s->mu);
		events.swap(s->events);
	}
	std::string o = "[";
	for (auto const& e : events)
	{
		if (o.size() > 1) o += ',';
		o += e;
	}
	o += ']';
	return dup(o);
}

char* lt_set_deadlines(lt_session* s, char const* hash, int first, int count, int step_ms)
{
	return with_torrent(s, hash, [=](lt::torrent_handle const& h) {
		auto ti = h.torrent_file();
		if (!ti) return;
		int const end = std::min(first + count, ti->num_pieces());
		for (int i = first; i < end; ++i)
			h.set_piece_deadline(lt::piece_index_t(i), step_ms * (i - first + 1));
	});
}

int lt_read_piece(lt_session* s, char const* hash, int piece, char* buf, int buf_len, int timeout_ms, char** err)
{
	try
	{
		lt::sha1_hash ih;
		lt::torrent_handle h;
		if (parse_hash(hash, ih)) h = s->ses.find_torrent(ih);
		if (!h.is_valid())
		{
			*err = dup(std::string("torrent ") + (hash ? hash : "") + " not found");
			return -1;
		}
		auto const key = std::make_pair(ih, piece);
		std::shared_ptr<piece_read> pr;
		bool request = false;
		{
			std::lock_guard<std::mutex> l(s->mu);
			auto& slot = s->reads[key];
			if (!slot)
			{
				slot = std::make_shared<piece_read>();
				request = true;
			}
			pr = slot;
			++pr->waiters;
		}
		// With alert_when_available a piece we already have is read right
		// away; a missing one is fetched first, ahead of everything else.
		if (request) h.set_piece_deadline(lt::piece_index_t(piece), 0, lt::torrent_handle::alert_when_available);

		std::unique_lock<std::mutex> l(s->mu);
		bool const done = s->cv.wait_for(l, std::chrono::milliseconds(timeout_ms), [&] { return pr->done; });
		--pr->waiters;
		auto it = s->reads.find(key);
		if (pr->waiters == 0 && it != s->reads.end() && it->second == pr) s->reads.erase(it);
		if (!done) return -2;
		if (!pr->error.empty())
		{
			*err = dup(pr->error);
			return -1;
		}
		if (int(pr->data.size()) > buf_len)
		{
			*err = dup("piece larger than the buffer");
			return -1;
		}
		std::memcpy(buf, pr->data.data(), pr->data.size());
		return int(pr->data.size());
	}
	catch (std::exception const& e)
	{
		*err = dup(e.what());
		return -1;
	}
}

char* lt_save_resume(lt_session* s, char const* dir, int only_if_needed, int timeout_ms)
{
	try
	{
		{
			std::lock_guard<std::mutex> l(s->mu);
			s->resume_dir = dir;
			s->resume_errors.clear();
		}
		for (auto const& h : s->ses.get_torrents())
		{
			if (!h.is_valid() || (only_if_needed && !h.need_save_resume_data())) continue;
			{
				std::lock_guard<std::mutex> l(s->mu);
				++s->pending_resume;
			}
			h.save_resume_data(lt::torrent_handle::flush_disk_cache | lt::torrent_handle::save_info_dict);
		}
		std::unique_lock<std::mutex> l(s->mu);
		if (!s->cv.wait_for(l, std::chrono::milliseconds(timeout_ms), [s] { return s->pending_resume <= 0; }))
			return dup("timed out saving resume data");
		return s->resume_errors.empty() ? nullptr : dup(s->resume_errors);
	}
	catch (std::exception const& e)
	{
		return dup(e.what());
	}
}

void lt_free(void* p)
{
	std::free(p);
}

} // extern "C"
