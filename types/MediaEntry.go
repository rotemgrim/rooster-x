package types

type MediaEntry struct {
	Title      string  `json:"title"`
	Season     *int    `json:"season,omitempty"`
	Episode    *int    `json:"episode,omitempty"`
	Year       *int    `json:"year,omitempty"`
	Resolution *string `json:"resolution,omitempty"`
	Quality    *string `json:"quality,omitempty"`
	Codec      *string `json:"codec,omitempty"`
	Audio      *string `json:"audio,omitempty"`
	Group      *string `json:"group,omitempty"`
	Region     *string `json:"region,omitempty"`
	Extended   *bool   `json:"extended,omitempty"`
	Hardcoded  *bool   `json:"hardcoded,omitempty"`
	Proper     *bool   `json:"proper,omitempty"`
	Repack     *bool   `json:"repack,omitempty"`
	Container  *string `json:"container,omitempty"`
	Widescreen *bool   `json:"widescreen,omitempty"`
	Website    *string `json:"website,omitempty"`
	Language   *string `json:"language,omitempty"`
	Garbage    *string `json:"garbage,omitempty"`
}
