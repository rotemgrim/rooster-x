// Package config loads and saves config.yaml, the settings the setup wizard
// collects on first run.
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/robfig/cron/v3"
	"gopkg.in/yaml.v3"
)

const Path = "config.yaml"

type Xtream struct {
	Username string `yaml:"username" json:"username"`
	Password string `yaml:"password" json:"password"`
	Server   string `yaml:"server" json:"server"`
}

type Config struct {
	TmdbApiKey           string   `yaml:"tmdb_api_key" json:"tmdbApiKey"`
	Lang                 string   `yaml:"lang" json:"lang"`
	Directories          []string `yaml:"directories" json:"directories"`
	FullDirectoriesSweep []string `yaml:"full_directories_sweep" json:"fullDirectoriesSweep"`
	TorrentsSweep        []string `yaml:"torrents_sweep" json:"torrentsSweep"`
	ImdbRatingPoll       string   `yaml:"imdb_rating_poll" json:"imdbRatingPoll"`
	MetadataEnrichPoll   string   `yaml:"metadata_enrich_poll" json:"metadataEnrichPoll"`
	DownloadDir          string   `yaml:"download_dir" json:"downloadDir"`
	Xtream               Xtream   `yaml:"xtream" json:"xtream"`
}

// Default is what the setup wizard starts from.
func Default() Config {
	return Config{
		Lang:                 "en-US",
		Directories:          []string{},
		FullDirectoriesSweep: []string{"0 9 * * *", "0 19 * * *"},
		TorrentsSweep:        []string{"0 10 * * *", "30 19 * * *"},
		ImdbRatingPoll:       "* * * * *",
		MetadataEnrichPoll:   "0 2-3 * * *",
	}
}

// Load reads config.yaml. needsSetup is true when there is no config yet or
// it has no TMDB key, which the app needs to identify any media.
func Load() (cfg Config, needsSetup bool, err error) {
	data, err := os.ReadFile(Path)
	if errors.Is(err, os.ErrNotExist) {
		return Default(), true, nil
	}
	if err != nil {
		return cfg, false, fmt.Errorf("reading %s: %w", Path, err)
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return cfg, false, fmt.Errorf("parsing %s: %w", Path, err)
	}
	return cfg, cfg.TmdbApiKey == "", nil
}

// Save writes cfg to config.yaml, replacing the old file only once the new
// one is fully written.
func Save(cfg Config) error {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	data = append([]byte("# RoosterX settings. Schedules are cron expressions: minute hour day month weekday.\n"), data...)
	tmp := Path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, Path)
}

// Validate reports the first setting the app can't run with.
func (c Config) Validate() error {
	if strings.TrimSpace(c.TmdbApiKey) == "" {
		return errors.New("A TMDB API key is required")
	}
	if len(c.Directories) == 0 {
		return errors.New("Add at least one media folder")
	}
	for _, dir := range c.Directories {
		if err := checkDir(dir); err != nil {
			return err
		}
	}
	if c.DownloadDir != "" {
		if err := checkDir(c.DownloadDir); err != nil {
			return err
		}
	}
	specs := append(append([]string{}, c.FullDirectoriesSweep...), c.TorrentsSweep...)
	for _, spec := range append(specs, c.ImdbRatingPoll, c.MetadataEnrichPoll) {
		if spec == "" {
			continue
		}
		if _, err := cron.ParseStandard(spec); err != nil {
			return fmt.Errorf("Invalid schedule %q: %w", spec, err)
		}
	}
	return nil
}

func checkDir(dir string) error {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("Folder not found: %s", dir)
	}
	return nil
}
