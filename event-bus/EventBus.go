package EventBus

var (
	dataChannel = make(chan Request, 4000) // Buffered channel with capacity of 4000
)

type Request struct {
	Event    string
	Data     interface{}
	Response chan interface{}
}

func SendEvent(event string, data interface{}) interface{} {
	responseChan := make(chan interface{})
	dataChannel <- Request{Event: event, Data: data, Response: responseChan}
	return <-responseChan
}

func ReceiveData() Request {
	return <-dataChannel
}
