package scheduler

import (
	"fmt"
	"github.com/robfig/cron/v3"
)

//var Cron *cron.Cron

type Scheduler struct {
	Cron *cron.Cron
}

func NewScheduler() *Scheduler {
	return &Scheduler{
		Cron: cron.New(),
	}
}

func (sc *Scheduler) Init() *cron.Cron {
	sc.Cron = cron.New()
	// Start the scheduler
	sc.Cron.Start()
	return sc.Cron
}

// Schedule adds a new task to the global cron instance
func (sc *Scheduler) Schedule(spec string, callback func()) {
	_, err := sc.Cron.AddFunc(spec, callback)
	if err != nil {
		fmt.Printf("Error adding task: %v\n", err)
	}
}
