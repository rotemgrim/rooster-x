package db

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"

	"github.com/volatiletech/null/v8"
	"github.com/volatiletech/sqlboiler/v4/boil"
	"go-poc/models"
)

// MigrateToManyToManyGenres migrates from comma-separated genres to many-to-many relationship
func MigrateToManyToManyGenres(db *sql.DB) error {
	// Check if migration was already completed
	var genreCount, junctionCount int64
	db.QueryRow("SELECT COUNT(*) FROM genre").Scan(&genreCount)
	db.QueryRow("SELECT COUNT(*) FROM metaDataGenre").Scan(&junctionCount)

	// If both tables have data, migration already ran successfully - skip it!
	if genreCount > 0 && junctionCount > 0 {
		log.Println("✓ Genre migration already completed (tables have data), skipping...")
		return nil
	}

	log.Println("Starting genre migration...")

	// Step 1: Create new tables if they don't exist
	if err := createNewGenreSchema(db); err != nil {
		return fmt.Errorf("failed to create schema: %w", err)
	}

	// Step 2: Check if migration is needed
	needsMigration, err := checkIfMigrationNeeded(db)
	if err != nil {
		return fmt.Errorf("failed to check migration status: %w", err)
	}

	if !needsMigration {
		log.Println("Migration already completed or no data to migrate")
		return nil
	}

	// Step 3: Migrate existing data
	if err := migrateExistingGenreData(db); err != nil {
		return fmt.Errorf("failed to migrate data: %w", err)
	}

	log.Println("Genre migration completed successfully")
	return nil
}

// createNewGenreSchema creates the new genre and junction tables (only if they don't exist)
func createNewGenreSchema(db *sql.DB) error {
	log.Println("Ensuring genre schema exists...")

	// Just create tables if they don't exist - DON'T drop existing data!
	_, err := db.Exec(`
		-- Create genre table only if it doesn't exist
		CREATE TABLE IF NOT EXISTS genre (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type VARCHAR(255) UNIQUE COLLATE NOCASE
		);
		CREATE INDEX IF NOT EXISTS idx_genre_type ON genre(type);

		-- Create junction table only if it doesn't exist
		CREATE TABLE IF NOT EXISTS metaDataGenre (
			metaDataId INTEGER NOT NULL,
			genreId INTEGER NOT NULL,
			FOREIGN KEY (metaDataId) REFERENCES metaData(id) ON DELETE CASCADE,
			FOREIGN KEY (genreId) REFERENCES genre(id) ON DELETE CASCADE,
			PRIMARY KEY (metaDataId, genreId)
		);
		CREATE INDEX IF NOT EXISTS idx_metaDataGenre_metaDataId ON metaDataGenre(metaDataId);
		CREATE INDEX IF NOT EXISTS idx_metaDataGenre_genreId ON metaDataGenre(genreId);
		-- Composite index for the subquery (genreId + metaDataId for fast lookups)
		CREATE INDEX IF NOT EXISTS idx_metaDataGenre_genreId_metaDataId ON metaDataGenre(genreId, metaDataId);
	`)

	if err != nil {
		return fmt.Errorf("error creating schema: %w", err)
	}

	// Update SQLite statistics for better query planning
	_, err = db.Exec("ANALYZE metaDataGenre; ANALYZE genre;")
	if err != nil {
		log.Printf("Warning: ANALYZE failed: %v", err)
	}

	log.Println("Schema ensured successfully")
	return nil
}

// checkIfMigrationNeeded checks if there's data to migrate
func checkIfMigrationNeeded(db *sql.DB) (bool, error) {
	// Check if metaDataGenre has any data
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM metaDataGenre`).Scan(&count)
	if err != nil {
		return false, err
	}

	// If junction table has data, migration is complete
	if count > 0 {
		return false, nil
	}

	// Check if metaData has genres to migrate
	err = db.QueryRow(`SELECT COUNT(*) FROM metaData WHERE genres IS NOT NULL AND genres != ''`).Scan(&count)
	if err != nil {
		return false, err
	}

	// Migration needed if there are genres in metaData
	return count > 0, nil
}

// migrateExistingGenreData migrates comma-separated genres to many-to-many
func migrateExistingGenreData(db *sql.DB) error {
	log.Println("Migrating existing genre data...")

	// Get all metadata with genres
	ctx := context.Background()
	metas, err := models.MetaData(models.MetaDatumWhere.Genres.IsNotNull()).All(ctx, db)
	if err != nil {
		return fmt.Errorf("could not get metadata: %w", err)
	}

	log.Printf("Found %d metadata records with genres to migrate", len(metas))

	// Track genres to avoid duplicate lookups
	genreCache := make(map[string]int64)

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("could not start transaction: %w", err)
	}
	defer tx.Rollback()

	migrated := 0
	for _, meta := range metas {
		if !meta.Genres.Valid || meta.Genres.String == "" {
			continue
		}

		// Split genres by comma
		genreNames := strings.Split(meta.Genres.String, ",")
		for _, genreName := range genreNames {
			genreName = strings.TrimSpace(strings.ToLower(genreName))
			if genreName == "" {
				continue
			}

			// Get or create genre
			genreId, exists := genreCache[genreName]
			if !exists {
				// Check if genre exists in DB
				var id int64
				err := tx.QueryRow(`SELECT id FROM genre WHERE type = ?`, genreName).Scan(&id)
				if err == sql.ErrNoRows {
					// Create new genre
					result, err := tx.Exec(`INSERT INTO genre (type) VALUES (?)`, genreName)
					if err != nil {
						log.Printf("Error inserting genre '%s': %v", genreName, err)
						continue
					}
					genreId, _ = result.LastInsertId()
				} else if err != nil {
					log.Printf("Error querying genre '%s': %v", genreName, err)
					continue
				} else {
					genreId = id
				}
				genreCache[genreName] = genreId
			}

			// Create junction record
			_, err := tx.Exec(
				`INSERT OR IGNORE INTO metaDataGenre (metaDataId, genreId) VALUES (?, ?)`,
				meta.ID.Int64, genreId,
			)
			if err != nil {
				log.Printf("Error linking genre '%s' to metadata %d: %v", genreName, meta.ID.Int64, err)
			}
		}

		migrated++
		if migrated%100 == 0 {
			log.Printf("Migrated %d/%d metadata records...", migrated, len(metas))
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("could not commit transaction: %w", err)
	}

	log.Printf("Successfully migrated %d metadata records with %d unique genres", migrated, len(genreCache))
	return nil
}

// GetGenreIdByName gets or creates a genre by name (helper for new inserts)
func GetGenreIdByName(genreName string) (null.Int64, error) {
	genreName = strings.TrimSpace(strings.ToLower(genreName))
	if genreName == "" {
		return null.Int64{}, fmt.Errorf("genre name cannot be empty")
	}

	ctx := context.Background()

	// Try to find existing genre
	genre, err := models.Genres(models.GenreWhere.Type.EQ(null.StringFrom(genreName))).One(ctx, DB)
	if err == nil {
		return genre.ID, nil
	}

	// Create new genre
	newGenre := &models.Genre{
		Type: null.StringFrom(genreName),
	}
	err = newGenre.Insert(ctx, DB, boil.Infer())
	if err != nil {
		return null.Int64{}, fmt.Errorf("could not create genre: %w", err)
	}

	return newGenre.ID, nil
}

// SaveGenresForMetaData saves genres for a metadata record using many-to-many
func SaveGenresForMetaData(metaDataId int64, genreNames []string) error {
	if metaDataId == 0 {
		return fmt.Errorf("invalid metaDataId")
	}

	ctx := context.Background()

	for _, genreName := range genreNames {
		genreName = strings.TrimSpace(strings.ToLower(genreName))
		if genreName == "" {
			continue
		}

		// Get or create genre
		genreId, err := GetGenreIdByName(genreName)
		if err != nil {
			log.Printf("Error getting/creating genre '%s': %v", genreName, err)
			continue
		}

		// Create junction record (ignore if exists)
		_, err = DB.ExecContext(ctx,
			`INSERT OR IGNORE INTO metaDataGenre (metaDataId, genreId) VALUES (?, ?)`,
			metaDataId, genreId.Int64)
		if err != nil {
			log.Printf("Error linking genre '%s' to metadata %d: %v", genreName, metaDataId, err)
		}
	}

	return nil
}

// RollbackMigration restores the old genre table (emergency use only)
func RollbackMigration(db *sql.DB) error {
	log.Println("Rolling back genre migration...")

	_, err := db.Exec(`
		-- Drop new tables
		DROP TABLE IF EXISTS metaDataGenre;
		DROP TABLE IF EXISTS genre;

		-- Restore old genre table
		ALTER TABLE genre_old RENAME TO genre;
	`)

	if err != nil {
		return fmt.Errorf("rollback failed: %w", err)
	}

	log.Println("Rollback completed")
	return nil
}
