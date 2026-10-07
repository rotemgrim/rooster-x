package db

import (
	"database/sql"
	"fmt"
	"log"
)

// EnsureListTables creates the list and listItem tables on first run.
// Lists are per-user; listItem.position controls drag-to-reorder ordering.
// Safe to run multiple times.
func EnsureListTables(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS list (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			userId INTEGER NOT NULL,
			name TEXT NOT NULL,
			createdAt INTEGER NOT NULL,
			updatedAt INTEGER NOT NULL,
			FOREIGN KEY (userId) REFERENCES user(id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_list_userId ON list(userId)`,

		`CREATE TABLE IF NOT EXISTS listItem (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			listId INTEGER NOT NULL,
			metaDataId INTEGER NOT NULL,
			position INTEGER NOT NULL,
			addedAt INTEGER NOT NULL,
			UNIQUE (listId, metaDataId),
			FOREIGN KEY (listId) REFERENCES list(id) ON DELETE CASCADE,
			FOREIGN KEY (metaDataId) REFERENCES metaData(id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_listItem_listId_position ON listItem(listId, position)`,
		`CREATE INDEX IF NOT EXISTS idx_listItem_metaDataId ON listItem(metaDataId)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("could not create list tables (%s): %w", s, err)
		}
	}
	log.Println("✓ List tables ensured")
	return nil
}
