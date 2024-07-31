package scheduler

import (
	"fmt"
	"github.com/robfig/cron/v3"
)

var Cron *cron.Cron

func Init() {
	Cron = cron.New()
	// Start the scheduler
	Cron.Start()
}

// Schedule adds a new task to the global cron instance
func Schedule(spec string, callback func()) {
	_, err := Cron.AddFunc(spec, callback)
	if err != nil {
		fmt.Printf("Error adding task: %v\n", err)
	}
}
