package db

import "go-poc/types"

func GetAllMedia() ([]types.MediaEntry, error) {
	// Get all media files from the database
	rows, err := DB.Query("SELECT * FROM MediaFile")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var mediaEntries []types.MediaEntry

	for rows.Next() {
		var mediaEntry types.MediaEntry
		err = scanStruct(rows, &mediaEntry)
		if err != nil {
			return nil, err
		}
		mediaEntries = append(mediaEntries, mediaEntry)
	}

	if rows.Err() != nil {
		return nil, rows.Err()
	}

	return mediaEntries, nil
}
