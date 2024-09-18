package convert_icon_to_byte

import (
	"fmt"
	"io"
	"os"
)

func main() {
	// Open the .ico file
	file, err := os.Open("icon.ico")
	if err != nil {
		fmt.Println("Error opening file:", err)
		return
	}
	defer file.Close()

	// Read the file into a byte slice
	byteArray, err := io.ReadAll(file)
	if err != nil {
		fmt.Println("Error reading file:", err)
		return
	}

	formatted := make([]string, len(byteArray))
	for i, b := range byteArray {
		formatted[i] = fmt.Sprintf("0x%02X", b)
	}

	// Create the Go file
	err = saveToFile("rooster-icon.go", formatted)
	if err != nil {
		fmt.Println("Error saving file:", err)
	}
}

func saveToFile(filename string, formattedBytes []string) error {
	// Open the file for writing
	file, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer file.Close()

	// Write the template and formatted bytes to the file
	_, err = file.WriteString("package main\n\nvar GhostIcon []byte = []byte{\n")
	if err != nil {
		return err
	}

	for i, b := range formattedBytes {
		if i%8 == 0 {
			_, err = file.WriteString("\n\t")
			if err != nil {
				return err
			}
		}
		_, err = file.WriteString(b + ", ")
		if err != nil {
			return err
		}
	}

	_, err = file.WriteString("\n}\n")
	return err
}
