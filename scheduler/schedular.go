package scheduler

import (
	"github.com/robfig/cron/v3"
	"log"
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
		log.Printf("Error adding task: %v\n", err)
		return
	}
	log.Printf("Task added: %v\n", spec)
}
