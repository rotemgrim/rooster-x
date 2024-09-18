package EventBus

var (
	DataChannel = make(chan string, 100) // Buffered channel with capacity of 100
)

func SendData(data string) {
	DataChannel <- data
}

func ReceiveData() string {
	return <-DataChannel
}
